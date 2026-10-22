// Silhouette field builder (CPU, runs in the tracking worker or main thread).
//
// mask (soft 0..1, view-oriented/mirrored, top row first)
//   → chamfer signed distance (inside positive)
//   → motion field: mask temporal difference along the contour normal,
//     plus landmark velocity splats (hands/elbows), accumulated with decay
//   → packed RGBA8 texture for the GPU particle compute.
//
// All buffers are allocated once per instance (8h operation: no per-frame
// allocation except the returned view, which is a reused buffer).
import { HAND_BONES, HL, type Landmark } from '../../core/types';

export const SDF_RANGE = 0.125; // ± view-height units encoded in R
export const VEL_RANGE = 4.0; // ± view-height units / s encoded in G/B

/** Fingertips of up to two hands concatenated (21 landmarks each) — velocity splats. */
export const HAND_SPLATS = [4, 8, 12, 16, 20, 25, 29, 33, 37, 41];
export class FieldBuilder {
  readonly out: Uint8Array;
  private inside: Float32Array;
  private outside: Float32Array;
  private sdf: Float32Array;
  private prev: Float32Array;
  private velX: Float32Array;
  private velY: Float32Array;
  private tmp: Float32Array;
  private capsMask: Float32Array;
  private hasPrev = false;
  private prevT = 0;
  private prevLm: Landmark[] | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly aspect = 16 / 9,
  ) {
    const n = w * h;
    this.out = new Uint8Array(n * 4);
    this.inside = new Float32Array(n);
    this.outside = new Float32Array(n);
    this.sdf = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.capsMask = new Float32Array(n);
  }

  reset(): void {
    this.hasPrev = false;
    this.prevLm = null;
    this.velX.fill(0);
    this.velY.fill(0);
  }

  /** Rasterize soft capsules for hands (fingers + palm). Hands are 21-landmark arrays. */
  maskFromHands(hands: Landmark[][]): Float32Array {
    const m = this.capsMask;
    m.fill(0);
    const { aspect } = this;
    for (const lm of hands) {
      const w = lm[HL.wrist];
      const mm = lm[HL.middleMcp];
      if (!w || !mm) continue;
      const size = Math.hypot((w.x - mm.x) * aspect, w.y - mm.y);
      const caps: Array<[number, number, number, number, number]> = [];
      for (const [a, b] of HAND_BONES) {
        const p = lm[a]!;
        const q = lm[b]!;
        const palm = a === 0 || (a === 5 && b === 9) || (a === 9 && b === 13) || (a === 13 && b === 17);
        caps.push([p.x * aspect, p.y, q.x * aspect, q.y, size * (palm ? 0.2 : 0.1)]);
      }
      // Palm centre.
      const c = lm[HL.middleMcp]!;
      caps.push([(w.x + c.x) / 2 * aspect, (w.y + c.y) / 2, (w.x + c.x) / 2 * aspect, (w.y + c.y) / 2, size * 0.42]);
      this.rasterCapsules(caps);
    }
    return m;
  }

  private rasterCapsules(caps: Array<[number, number, number, number, number]>): void {
    const m = this.capsMask;
    const { w, h, aspect } = this;
    for (const [ax, ay, bx, by, r] of caps) {
      const x0 = Math.max(0, Math.floor(((Math.min(ax, bx) - r) / aspect) * w) - 1);
      const x1 = Math.min(w - 1, Math.ceil(((Math.max(ax, bx) + r) / aspect) * w) + 1);
      const y0 = Math.max(0, Math.floor((Math.min(ay, by) - r) * h) - 1);
      const y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + r) * h) + 1);
      const ex = bx - ax;
      const ey = by - ay;
      const l2 = ex * ex + ey * ey;
      const soft = 1.5 / h;
      for (let y = y0; y <= y1; y++) {
        const py = (y + 0.5) / h;
        for (let x = x0; x <= x1; x++) {
          const px = ((x + 0.5) / w) * aspect;
          const u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
          const d = Math.hypot(px - (ax + ex * u), py - (ay + ey * u)) - r;
          const v = Math.max(0, Math.min(1, 0.5 - d / soft));
          const i = y * w + x;
          if (v > m[i]!) m[i] = v;
        }
      }
    }
  }

  /**
   * Build the packed field. `mask` must be w*h, view-oriented (mirrored), top row first.
   * `lm` are view-space landmarks of the locked player (for velocity splats).
   */
  build(mask: Float32Array, lm: Landmark[] | null, tMs: number, splatIdx: readonly number[] = HAND_SPLATS): Uint8Array {
    const { w, h } = this;
    const n = w * h;
    // Binary seeds for the distance transform.
    for (let i = 0; i < n; i++) {
      const inside = mask[i]! >= 0.5;
      this.inside[i] = inside ? 0 : 1e9; // distance to nearest inside pixel
      this.outside[i] = inside ? 1e9 : 0; // distance to nearest outside pixel
    }
    chamfer(this.inside, w, h);
    chamfer(this.outside, w, h);
    for (let i = 0; i < n; i++) {
      // Inside positive, in view-height units.
      this.sdf[i] = (this.outside[i]! > 0 ? this.outside[i]! - 0.5 : -(this.inside[i]! - 0.5)) / h;
    }

    // Motion field.
    const dt = this.hasPrev ? Math.max(0.008, (tMs - this.prevT) / 1000) : 0;
    const decay = dt > 0 ? Math.exp(-dt / 0.12) : 0;
    for (let i = 0; i < n; i++) {
      this.velX[i] = this.velX[i]! * decay;
      this.velY[i] = this.velY[i]! * decay;
    }
    if (this.hasPrev && dt > 0 && dt < 0.25) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const d = mask[i]! - this.prev[i]!;
          if (Math.abs(d) < 0.05) continue;
          // Outward normal = -grad(sdf).
          const gx = (this.sdf[i + 1]! - this.sdf[i - 1]!) * 0.5;
          const gy = (this.sdf[i + w]! - this.sdf[i - w]!) * 0.5;
          const gl = Math.hypot(gx, gy);
          if (gl < 1e-9) continue;
          // Edge moved ~ |d| pixels along the normal during dt.
          const speed = (d * 1.5) / h / dt;
          this.velX[i] = this.velX[i]! + (-gx / gl) * speed;
          this.velY[i] = this.velY[i]! + (-gy / gl) * speed;
        }
      }
      // Landmark velocity splats (strong, reliable trails behind waving hands).
      if (lm && this.prevLm && this.prevLm.length === lm.length) {
        for (const j of splatIdx) {
          const a = lm[j];
          const b = this.prevLm[j];
          if (!a || !b || a.v < 0.4 || b.v < 0.4) continue;
          const vx = ((a.x - b.x) * this.aspect) / dt;
          const vy = (a.y - b.y) / dt;
          // Splat along the path from b to a so fast hands leave a continuous trail.
          for (let s = 0; s <= 3; s++) {
            const f = s / 3;
            splat(this.velX, this.velY, w, h, (b.x + (a.x - b.x) * f) * w, (b.y + (a.y - b.y) * f) * h, vx, vy, 5);
          }
        }
      }
      blur3(this.velX, this.tmp, w, h);
      blur3(this.velY, this.tmp, w, h);
    }

    this.prev.set(mask);
    this.hasPrev = true;
    this.prevT = tMs;
    this.prevLm = lm ? lm.map((p) => ({ ...p })) : null;

    const out = this.out;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out[o] = enc(0.5 + this.sdf[i]! / SDF_RANGE / 2);
      out[o + 1] = enc(0.5 + this.velX[i]! / VEL_RANGE / 2);
      out[o + 2] = enc(0.5 + this.velY[i]! / VEL_RANGE / 2);
      out[o + 3] = enc(mask[i]!);
    }
    return out;
  }

  /** Decoded accessors (tests & debug overlay). */
  sdfAt(x: number, y: number): number {
    return this.sdf[y * this.w + x]!;
  }
  velAt(x: number, y: number): [number, number] {
    const i = y * this.w + x;
    return [this.velX[i]!, this.velY[i]!];
  }
}

const enc = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

/** Two-pass 3-4 chamfer distance transform (in pixels), in place. */
export function chamfer(d: Float32Array, w: number, h: number): void {
  const A = 1;
  const B = 1.4142;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + A);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + A);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + B);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + B);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + A);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + A);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + B);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + B);
      }
      d[i] = v;
    }
  }
}

function splat(vx: Float32Array, vy: Float32Array, w: number, h: number, cx: number, cy: number, sx: number, sy: number, r: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > r2) continue;
      const k = (1 - d2 / r2) * 0.35;
      const i = y * w + x;
      vx[i] = vx[i]! + (sx - vx[i]!) * k;
      vy[i] = vy[i]! + (sy - vy[i]!) * k;
    }
  }
}

/** Separable 3-tap box blur, in place. */
function blur3(a: Float32Array, tmp: Float32Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? a[r + x - 1]! : a[r + x]!;
      const rr = x < w - 1 ? a[r + x + 1]! : a[r + x]!;
      tmp[r + x] = (l + a[r + x]! + rr) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = y > 0 ? tmp[i - w]! : tmp[i]!;
      const d = y < h - 1 ? tmp[i + w]! : tmp[i]!;
      a[i] = (u + tmp[i]! + d) / 3;
    }
  }
}
