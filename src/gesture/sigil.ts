// Air-drawn sigils: a $1 Unistroke recogniser (Wobbrock et al. 2007),
// implemented from the paper: resample → rotate to the indicative angle →
// scale to a square → translate → golden-section search over rotation.
// Templates are generated procedurally (several directions / start points).
import type { Vec2 } from '../core/types';

export type SigilKind = 'circle' | 'triangle' | 'zigzag' | 'spiral';
export const SIGIL_IDS: SigilKind[] = ['circle', 'triangle', 'zigzag', 'spiral'];
export const SIGIL_LABEL: Record<SigilKind, string> = { circle: '円', triangle: '三角', zigzag: '稲妻', spiral: '渦' };

const N = 64;
const SQUARE = 250;
const HALF_DIAG = 0.5 * Math.sqrt(2 * SQUARE * SQUARE);
const ANGLE_RANGE = (45 * Math.PI) / 180;
const ANGLE_PRECISION = (2 * Math.PI) / 180;
const PHI = 0.5 * (-1 + Math.sqrt(5));

function pathLen(p: Vec2[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
  return d;
}

export function resample(points: Vec2[], n = N): Vec2[] {
  const pts = points.map((p) => ({ ...p }));
  const I = pathLen(pts) / (n - 1);
  if (!(I > 0)) return Array.from({ length: n }, () => ({ ...pts[0]! }));
  let D = 0;
  const out: Vec2[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (D + d >= I) {
      const k = (I - D) / d;
      const q = { x: a.x + k * (b.x - a.x), y: a.y + k * (b.y - a.y) };
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1]! });
  return out.slice(0, n);
}

const centroid = (p: Vec2[]): Vec2 => ({ x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length });

function rotateBy(p: Vec2[], r: number): Vec2[] {
  const c = centroid(p);
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  return p.map((q) => ({ x: (q.x - c.x) * cs - (q.y - c.y) * sn + c.x, y: (q.x - c.x) * sn + (q.y - c.y) * cs + c.y }));
}

function normalizeStroke(points: Vec2[]): Vec2[] {
  let p = resample(points);
  const c = centroid(p);
  p = rotateBy(p, -Math.atan2(c.y - p[0]!.y, c.x - p[0]!.x));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of p) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  // Uniform-ish scaling that keeps 1D strokes (lines) from exploding.
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const sx = SQUARE / w;
  const sy = SQUARE / h;
  p = p.map((q) => ({ x: q.x * sx, y: q.y * sy }));
  const c2 = centroid(p);
  return p.map((q) => ({ x: q.x - c2.x, y: q.y - c2.y }));
}

function pathDistance(a: Vec2[], b: Vec2[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y);
  return d / a.length;
}

function distanceAtBestAngle(p: Vec2[], t: Vec2[]): number {
  let a = -ANGLE_RANGE;
  let b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = pathDistance(rotateBy(p, x1), t);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = pathDistance(rotateBy(p, x2), t);
  while (Math.abs(b - a) > ANGLE_PRECISION) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = pathDistance(rotateBy(p, x1), t);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = pathDistance(rotateBy(p, x2), t);
    }
  }
  return Math.min(f1, f2);
}

/** Ideal stroke for a sigil (screen coords, y down). `dir` ±1, `phase` start offset 0..1. */
export function sigilPath(kind: SigilKind, dir: 1 | -1 = 1, phase = 0, n = 80): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    switch (kind) {
      case 'circle': {
        const a = (phase + dir * u) * Math.PI * 2 - Math.PI / 2;
        out.push({ x: Math.cos(a), y: Math.sin(a) });
        break;
      }
      case 'spiral': {
        const a = (phase + dir * u * 2) * Math.PI * 2 - Math.PI / 2;
        const r = 1 - 0.8 * u;
        out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        break;
      }
      case 'triangle': {
        const V = [
          { x: 0, y: -1 },
          { x: 0.95, y: 0.7 },
          { x: -0.95, y: 0.7 },
        ];
        const seq = dir === 1 ? [0, 1, 2, 0] : [0, 2, 1, 0];
        const k = ((u + phase) % 1) * 3;
        const s = Math.min(2, Math.floor(k));
        const f = k - s;
        const a = V[seq[s]!]!;
        const b = V[seq[s + 1]!]!;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        break;
      }
      case 'zigzag': {
        // Lightning bolt: three strokes, left→right going down.
        const P = [
          { x: -0.6, y: -1 },
          { x: 0.5, y: -0.2 },
          { x: -0.5, y: 0.2 },
          { x: 0.6, y: 1 },
        ].map((p) => ({ x: p.x * dir, y: p.y }));
        const k = u * 3;
        const s = Math.min(2, Math.floor(k));
        const f = k - s;
        out.push({ x: P[s]!.x + (P[s + 1]!.x - P[s]!.x) * f, y: P[s]!.y + (P[s + 1]!.y - P[s]!.y) * f });
        break;
      }
    }
  }
  return out;
}

interface Tpl {
  kind: SigilKind;
  pts: Vec2[];
}

let TEMPLATES: Tpl[] | null = null;
function templates(): Tpl[] {
  if (TEMPLATES) return TEMPLATES;
  const t: Tpl[] = [];
  for (const kind of SIGIL_IDS) {
    for (const dir of [1, -1] as const) {
      // Strokes may start anywhere on closed shapes.
      const phases = kind === 'circle' || kind === 'spiral' ? [0, 0.25, 0.5, 0.75] : kind === 'triangle' ? [0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6] : [0];
      for (const ph of phases) t.push({ kind, pts: normalizeStroke(sigilPath(kind, dir, ph)) });
    }
  }
  TEMPLATES = t;
  return t;
}

/** Number of sharp turns (> 55° over a short window) along the resampled stroke. */
export function countCorners(stroke: Vec2[]): number {
  const p = resample(stroke, 64);
  const w = 3;
  const turn: number[] = [];
  for (let i = w; i < p.length - w; i++) {
    const a = Math.atan2(p[i]!.y - p[i - w]!.y, p[i]!.x - p[i - w]!.x);
    const b = Math.atan2(p[i + w]!.y - p[i]!.y, p[i + w]!.x - p[i]!.x);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    turn.push(d);
  }
  let corners = 0;
  for (let i = 0; i < turn.length; i++) {
    const v = turn[i]!;
    if (v < (55 * Math.PI) / 180) continue;
    // Local maximum (non-max suppression over ±w).
    let isMax = true;
    for (let j = Math.max(0, i - w); j <= Math.min(turn.length - 1, i + w); j++) if (turn[j]! > v) isMax = false;
    if (isMax) {
      corners++;
      i += w;
    }
  }
  return corners;
}

export interface SigilResult {
  kind: SigilKind;
  score: number;
  /** Second best (for margin checks). */
  second: number;
}

/** Moving-average smoothing (detector jitter would otherwise look like corners). */
export function smoothStroke(p: Vec2[], w = 2): Vec2[] {
  return p.map((_, i) => {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(p.length - 1, i + w); j++) {
      x += p[j]!.x;
      y += p[j]!.y;
      n++;
    }
    return { x: x / n, y: y / n };
  });
}

export function recognizeSigil(raw: Vec2[], allowed: readonly SigilKind[] = SIGIL_IDS): SigilResult | null {
  if (raw.length < 8) return null;
  const stroke = smoothStroke(raw, 1);
  const p = normalizeStroke(stroke);
  const corners = countCorners(stroke);
  const best = new Map<SigilKind, number>();
  for (const t of templates()) {
    if (!allowed.includes(t.kind)) continue;
    const d = distanceAtBestAngle(p, t.pts);
    let s = 1 - d / HALF_DIAG;
    // Corner evidence separates round from angular shapes ($1 alone confuses them).
    if ((t.kind === 'circle' || t.kind === 'spiral') && corners >= 2) s -= 0.08;
    if ((t.kind === 'triangle' || t.kind === 'zigzag') && corners < 2) s -= 0.08;
    if (s > (best.get(t.kind) ?? -Infinity)) best.set(t.kind, s);
  }
  const sorted = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  return { kind: sorted[0]![0], score: sorted[0]![1], second: sorted[1]?.[1] ?? 0 };
}
