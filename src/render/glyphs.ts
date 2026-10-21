// GlyphBatch: every small glowing shape (orbs, approach rings, hand glows,
// skeleton light lines, goal rings, dodge bands, sparks) drawn as ONE
// instanced mesh with a shape id per instance. Additive, so order is free.
import * as THREE from 'three/webgpu';
import { abs, exp, float, fract, instancedDynamicBufferAttribute, length, max, min, select, smoothstep, uniform, uv, vec4 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const enum Shape {
  Disk = 0,
  Orb = 1,
  Ring = 2,
  Line = 3,
  Band = 4,
}

export class GlyphBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly uTime = uniform(0);
  private color: Float32Array;
  private param: Float32Array;
  private colorAttr: THREE.InstancedBufferAttribute;
  private paramAttr: THREE.InstancedBufferAttribute;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private t = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);

  constructor(readonly capacity = 1024) {
    this.color = new Float32Array(capacity * 4);
    this.param = new Float32Array(capacity * 4);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.color, 4);
    this.paramAttr = new THREE.InstancedBufferAttribute(this.param, 4);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.paramAttr.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const col = instancedDynamicBufferAttribute(this.colorAttr as N, 'vec4') as N;
    const prm = instancedDynamicBufferAttribute(this.paramAttr as N, 'vec4') as N;
    mat.colorNode = (() => {
      const p = uv().sub(0.5).mul(2) as N; // [-1, 1]
      const d = length(p) as N;
      const kind = prm.x;
      // Disk: soft gaussian glow.
      const disk = exp(d.mul(d).mul(-5.0)).mul(smoothstep(1.0, 0.8, d));
      // Orb: bright core (radius p1), static target outline at p1, approach ring at p2 (strength p3).
      const c = max(prm.y, 0.01);
      const core = exp(d.div(c).pow(2).mul(-2.2)).mul(1.2);
      const outline = exp(abs(d.sub(c)).mul(-55.0)).mul(0.45);
      const ring = exp(abs(d.sub(prm.z)).mul(-40.0)).mul(prm.w);
      const orb = core.add(outline).add(ring).mul(smoothstep(1.0, 0.92, d));
      // Ring: radius p1, sharpness p2.
      const ringOnly = exp(abs(d.sub(prm.y)).mul(prm.z.negate())).mul(smoothstep(1.0, 0.94, d));
      // Line (capsule along x): falloff across y with sharpness p1, soft ends.
      const across = exp(p.y.mul(p.y).mul(prm.y.negate()));
      const ends = smoothstep(1.0, 0.75, abs(p.x));
      const line = across.mul(ends);
      // Band with scrolling chevrons (danger): stripes along x, speed p2, density p1.
      const stripes = smoothstep(0.35, 0.5, abs(fract(p.x.mul(prm.y).add(abs(p.y).mul(0.6)).sub(this.uTime.mul(prm.z))).sub(0.5)).mul(2));
      const bandFall = exp(p.y.mul(p.y).mul(-3.0)).mul(smoothstep(1.0, 0.85, abs(p.x)));
      const band = bandFall.mul(stripes.mul(0.6).add(0.4));
      const a = select(kind.lessThan(0.5), disk, select(kind.lessThan(1.5), orb, select(kind.lessThan(2.5), ringOnly, select(kind.lessThan(3.5), line, band))));
      return vec4(col.xyz.mul(col.w).mul(min(a as N, float(4))) as N, 1);
    })();
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
  }

  begin(): void {
    this.n = 0;
  }

  get used(): number {
    return this.n;
  }

  /** Add a glyph centred at (x, y) world, size (w, h) world, rotation (rad). */
  add(shape: Shape, x: number, y: number, w: number, h: number, rot: number, rgb: readonly [number, number, number], intensity: number, p1 = 0, p2 = 0, p3 = 0): void {
    if (this.n >= this.capacity || intensity <= 0.001) return;
    const i = this.n++;
    this.q.setFromAxisAngle(this.z, rot);
    this.t.set(x, y, 0);
    this.s.set(w, h, 1);
    this.m.compose(this.t, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.color.set([rgb[0], rgb[1], rgb[2], intensity], i * 4);
    this.param.set([shape, p1, p2, p3], i * 4);
  }

  /** Glowing line segment between two world points. */
  line(ax: number, ay: number, bx: number, by: number, width: number, rgb: readonly [number, number, number], intensity: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) return;
    // Extend by the width so the soft ends overlap at joints.
    this.add(Shape.Line, (ax + bx) / 2, (ay + by) / 2, len + width * 2, width * 2, Math.atan2(dy, dx), rgb, intensity, 7);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.paramAttr.needsUpdate = true;
  }
}

/** CPU sparks for hit bursts (fixed pool; drawn through the glyph batch). */
export class Sparks {
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private rgb: Float32Array;
  private head = 0;

  constructor(readonly capacity = 700) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rgb = new Float32Array(capacity * 3);
  }

  burst(x: number, y: number, n: number, speed: number, rgb: readonly [number, number, number], lifeS = 0.7, size = 0.012, seed = 0): void {
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.capacity;
      // Deterministic-ish spread (visual only).
      const a = ((k + seed * 0.618) / n) * Math.PI * 2 + Math.sin(k * 12.9898 + seed) * 0.4;
      const s = speed * (0.45 + 0.55 * Math.abs(Math.sin(k * 78.233 + seed)));
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.life[i] = lifeS * (0.6 + 0.4 * Math.abs(Math.cos(k * 3.7 + seed)));
      this.max[i] = this.life[i]!;
      this.size[i] = size;
      this.rgb.set(rgb, i * 3);
    }
  }

  update(dt: number): void {
    const drag = Math.exp(-dt * 3.2);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      this.vx[i] = this.vx[i]! * drag;
      this.vy[i] = this.vy[i]! * drag - dt * 0.05;
      this.x[i] = this.x[i]! + this.vx[i]! * dt;
      this.y[i] = this.y[i]! + this.vy[i]! * dt;
    }
  }

  draw(g: GlyphBatch): void {
    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i]!;
      if (l <= 0) continue;
      const k = l / this.max[i]!;
      const sz = this.size[i]! * (0.4 + 0.6 * k);
      g.add(Shape.Disk, this.x[i]!, this.y[i]!, sz, sz, 0, [this.rgb[i * 3]!, this.rgb[i * 3 + 1]!, this.rgb[i * 3 + 2]!], k * k * 1.6);
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}
