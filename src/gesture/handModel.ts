// Parametric hand model → 21 MediaPipe-style hand landmarks (view space).
//
// Used for: synthetic recognition test data (with noise / blur / dropout),
// the autoplay bot, the attract demo, and the "ghost hand" that demonstrates
// each gesture. Geometry is built in a metric frame (x·aspect, y, z·aspect)
// in units of the palm size s = |wrist → middle MCP|.
import { HAND_LANDMARKS, HL, type Landmark, type Vec2 } from '../core/types';
import { Rng } from '../core/rng';

export type HandSide = 'L' | 'R';

/** Static hand shapes (docs/art-direction.md §gestures). Names are original. */
export type ShapeId = 'fist' | 'open' | 'point' | 'two' | 'pinch' | 'horn' | 'thumb' | 'ell';

export const SHAPE_IDS: ShapeId[] = ['fist', 'open', 'point', 'two', 'pinch', 'horn', 'thumb', 'ell'];
/** Tier 0 / fallback (dark room) set. */
export const CORE_SHAPES: ShapeId[] = ['fist', 'open', 'point'];

export const SHAPE_LABEL: Record<ShapeId, string> = {
  fist: '握る',
  open: '開く',
  point: '指す',
  two: '二指',
  pinch: '摘む',
  horn: '角',
  thumb: '親指',
  ell: '鉤',
};

export interface SynthHand {
  side: HandSide;
  /** Wrist position (view). */
  wrist: Vec2;
  /** Palm size in view-height units (wrist → middle MCP). */
  size: number;
  /** In-plane rotation in degrees (0 = fingers up, + = clockwise on screen). */
  rot: number;
  /** Rotation about the vertical axis (degrees): 0 = palm facing the camera. Foreshortens the palm. */
  yaw: number;
  /** Curl 0 (straight) .. 1 (fully bent) for [thumb, index, middle, ring, pinky]. */
  curl: [number, number, number, number, number];
  /** Finger spread multiplier (1 = natural). */
  spread: number;
  /** Thumb tip pinched onto the index tip. */
  pinch: boolean;
  aspect: number;
}

export const SHAPES: Record<ShapeId, { curl: SynthHand['curl']; pinch?: boolean; spread?: number }> = {
  fist: { curl: [1, 1, 1, 1, 1] },
  open: { curl: [0, 0, 0, 0, 0], spread: 1.6 },
  point: { curl: [1, 0, 1, 1, 1] },
  two: { curl: [1, 0, 0, 1, 1], spread: 1.3 },
  pinch: { curl: [0.5, 0.45, 0.35, 0.45, 0.5], pinch: true },
  horn: { curl: [1, 0, 1, 1, 0], spread: 1.2 },
  thumb: { curl: [0, 1, 1, 1, 1] },
  ell: { curl: [0, 0, 1, 1, 1] },
};

export function defaultHand(side: HandSide = 'R', aspect = 16 / 9): SynthHand {
  return {
    side,
    wrist: { x: side === 'R' ? 0.62 : 0.38, y: 0.72 },
    size: 0.14,
    rot: 0,
    yaw: 0,
    curl: [0.15, 0.05, 0.05, 0.05, 0.08],
    spread: 1,
    pinch: false,
    aspect,
  };
}

/** A relaxed, non-gesture hand (idle). `k` 0..1 interpolates between loose and half-closed. */
export function relaxedHand(h: SynthHand, k: number): SynthHand {
  const c = 0.12 + 0.38 * k;
  return { ...h, curl: [0.2 + 0.3 * k, c, c + 0.05, c + 0.08, c + 0.1], spread: 0.75, pinch: false };
}

export function withShape(h: SynthHand, shape: ShapeId): SynthHand {
  const d = SHAPES[shape];
  return { ...h, curl: [...d.curl] as SynthHand['curl'], pinch: !!d.pinch, spread: d.spread ?? 1 };
}

/** Blend two hands' joint parameters (for animated transitions). */
export function lerpHand(a: SynthHand, b: SynthHand, k: number): SynthHand {
  const l = (x: number, y: number) => x + (y - x) * k;
  return {
    ...b,
    wrist: { x: l(a.wrist.x, b.wrist.x), y: l(a.wrist.y, b.wrist.y) },
    size: l(a.size, b.size),
    rot: l(a.rot, b.rot),
    yaw: l(a.yaw, b.yaw),
    curl: a.curl.map((c, i) => l(c, b.curl[i]!)) as SynthHand['curl'],
    spread: l(a.spread, b.spread),
    pinch: k < 0.5 ? a.pinch : b.pinch,
  };
}

/** Two-link IK in a plane. Returns the elbow (prefers the lower one) and the clamped end. */
export function solveIk(s: Vec2, t: Vec2, a: number, b: number): { elbow: Vec2; end: Vec2 } {
  let dx = t.x - s.x;
  let dy = t.y - s.y;
  let d = Math.hypot(dx, dy);
  const minD = Math.abs(a - b) + 1e-4;
  if (d < 1e-6) {
    dx = 0;
    dy = 1;
    d = minD;
  }
  const dc = Math.min(a + b - 1e-4, Math.max(minD, d));
  const ux = dx / d;
  const uy = dy / d;
  const end = { x: s.x + ux * dc, y: s.y + uy * dc };
  const cosA = (a * a + dc * dc - b * b) / (2 * a * dc);
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const base = Math.atan2(uy, ux);
  const e1 = { x: s.x + a * Math.cos(base + ang), y: s.y + a * Math.sin(base + ang) };
  const e2 = { x: s.x + a * Math.cos(base - ang), y: s.y + a * Math.sin(base - ang) };
  return { elbow: e1.y >= e2.y ? e1 : e2, end };
}

// Finger table: [mcpU, mcpR, fanDeg, lengths(prox, mid, dist)].
const FINGERS: Array<[number, number, number, [number, number, number]]> = [
  [0.95, 0.32, 10, [0.45, 0.27, 0.22]],
  [1.0, 0.1, 0, [0.5, 0.3, 0.24]],
  [0.95, -0.12, -9, [0.46, 0.28, 0.22]],
  [0.85, -0.32, -20, [0.36, 0.21, 0.19]],
];
const BEND = [75, 100, 65]; // degrees per joint at curl 1

interface P3 {
  x: number;
  y: number;
  z: number;
}

export function buildHand(h: SynthHand): Landmark[] {
  const s = h.size;
  const asp = h.aspect;
  const sideSign = h.side === 'L' ? 1 : -1;
  const rr = (h.rot * Math.PI) / 180;
  const yaw = (h.yaw * Math.PI) / 180;
  // Hand frame: u = along the fingers, r = across toward the thumb, n = out of the palm (toward camera = −z).
  const pts: P3[] = new Array(HAND_LANDMARKS);
  const local: P3[] = new Array(HAND_LANDMARKS); // (u, r, n) in palm sizes
  local[HL.wrist] = { x: 0, y: 0, z: 0 };

  FINGERS.forEach(([mu, mr, fan, lens], fi) => {
    const base = 5 + fi * 4;
    local[base] = { x: mu, y: mr, z: 0 };
    const fr = ((fan * h.spread) * Math.PI) / 180;
    const du = Math.cos(fr);
    const dr = Math.sin(fr);
    const c = h.curl[fi + 1]!;
    let a = 0;
    let p = { ...local[base]! };
    for (let j = 0; j < 3; j++) {
      a += ((BEND[j]! * Math.PI) / 180) * c;
      const L = lens[j]!;
      p = { x: p.x + du * L * Math.cos(a), y: p.y + dr * L * Math.cos(a), z: p.z + L * Math.sin(a) };
      local[base + 1 + j] = { ...p };
    }
  });

  // Thumb.
  const tc = h.curl[0];
  local[HL.thumbCmc] = { x: 0.18, y: 0.28, z: 0 };
  const tl = [0.32, 0.28, 0.24];
  let ang = (65 * Math.PI) / 180;
  let tp = { ...local[HL.thumbCmc]! };
  const bendIn = [0.25, 0.4, 0.45];
  for (let j = 0; j < 3; j++) {
    ang -= ((110 * Math.PI) / 180) * tc * bendIn[j]!;
    const L = tl[j]!;
    const zb = Math.sin(((30 * Math.PI) / 180) * tc);
    const k = Math.sqrt(1 - zb * zb);
    tp = { x: tp.x + Math.cos(ang) * L * k, y: tp.y + Math.sin(ang) * L * k, z: tp.z + L * zb };
    local[HL.thumbMcp + j] = { ...tp };
  }
  if (h.pinch) {
    const mcp = local[HL.thumbMcp]!;
    const tgt = local[HL.indexTip]!;
    const r = solveIk({ x: mcp.x, y: mcp.y }, { x: tgt.x, y: tgt.y }, tl[1]!, tl[2]!);
    local[HL.thumbIp] = { x: r.elbow.x, y: r.elbow.y, z: tgt.z * 0.5 };
    local[HL.thumbTip] = { ...tgt };
  }

  // Local (u, r, n) → camera: yaw about the u axis-ish (vertical when upright), then in-plane rotation.
  const U = { x: Math.sin(rr), y: -Math.cos(rr) };
  const R = { x: sideSign * Math.cos(rr), y: sideSign * Math.sin(rr) };
  const W = { x: h.wrist.x * asp, y: h.wrist.y };
  for (let i = 0; i < HAND_LANDMARKS; i++) {
    const q = local[i]!;
    // Yaw: rotate (r, n) — across-palm extent shrinks, depth appears.
    const rY = q.y * Math.cos(yaw) - q.z * Math.sin(yaw) * sideSign;
    const nY = q.y * Math.sin(yaw) * sideSign + q.z * Math.cos(yaw);
    pts[i] = { x: W.x + (U.x * q.x + R.x * rY) * s, y: W.y + (U.y * q.x + R.y * rY) * s, z: -nY * s };
  }
  return pts.map((p) => ({ x: p.x / asp, y: p.y, z: p.z / asp, v: 1 }));
}

export interface NoiseOptions {
  /** Gaussian-ish jitter (view-height units). */
  jitter: number;
  /** Probability per landmark of being displaced strongly (detector error / occlusion). */
  dropout: number;
  /** Depth (z) noise relative to x/y noise. */
  zNoise: number;
}

/** Corrupt landmarks like a real detector would (deterministic with the given rng). */
export function noisy(lm: Landmark[], rng: Rng, o: NoiseOptions, aspect = 16 / 9): Landmark[] {
  const g = () => (rng.next() + rng.next() + rng.next() - 1.5) / 1.5; // ~N(0, 0.33²)·…
  return lm.map((p) => {
    let x = p.x + (g() * o.jitter) / aspect;
    let y = p.y + g() * o.jitter;
    const z = p.z + (g() * o.jitter * o.zNoise) / aspect;
    if (rng.chance(o.dropout)) {
      x += (g() * o.jitter * 6) / aspect;
      y += g() * o.jitter * 6;
    }
    return { x, y, z, v: p.v };
  });
}

/** Translate a hand so that landmark `idx` lands on `target` (view). */
export function placeLandmark(h: SynthHand, idx: number, target: Vec2): SynthHand {
  const lm = buildHand(h);
  const p = lm[idx]!;
  return { ...h, wrist: { x: h.wrist.x + target.x - p.x, y: h.wrist.y + target.y - p.y } };
}

/**
 * Two synthetic hands forming a seal (印) around `centre` (view). Used by the
 * ghost hand, the bot and the seal tests.
 */
export function sealHands(kind: 'gassho' | 'kensho' | 'soshi' | 'kanmon' | 'kosa', centre: Vec2, size: number, aspect = 16 / 9): SynthHand[] {
  const L0 = { ...defaultHand('L', aspect), size };
  const R0 = { ...defaultHand('R', aspect), size };
  const dx = (v: number) => (v * size) / aspect;
  switch (kind) {
    case 'gassho': {
      // Palms together: two open hands side by side, fingers up, nearly touching.
      const l = { ...withShape(L0, 'open'), spread: 1.0, yaw: 60, wrist: { x: centre.x - dx(0.12), y: centre.y + size * 0.6 } };
      const r = { ...withShape(R0, 'open'), spread: 1.0, yaw: 60, wrist: { x: centre.x + dx(0.12), y: centre.y + size * 0.6 } };
      return [l, r];
    }
    case 'kensho': {
      const f = { ...withShape(L0, 'fist'), rot: 20, wrist: { x: centre.x - dx(0.55), y: centre.y + size * 0.4 } };
      const o = { ...withShape(R0, 'open'), rot: -25, wrist: { x: centre.x + dx(0.35), y: centre.y + size * 0.55 } };
      return [f, o];
    }
    case 'soshi': {
      const l = placeLandmark({ ...withShape(L0, 'point'), rot: 50 }, 8, { x: centre.x - dx(0.08), y: centre.y - size * 0.4 });
      const r = placeLandmark({ ...withShape(R0, 'point'), rot: -50 }, 8, { x: centre.x + dx(0.08), y: centre.y - size * 0.4 });
      return [l, r];
    }
    case 'kanmon': {
      const l = placeLandmark({ ...withShape(L0, 'ell'), rot: 10 }, 4, { x: centre.x - dx(0.1), y: centre.y + size * 0.3 });
      const r = placeLandmark({ ...withShape(R0, 'ell'), rot: -10 }, 4, { x: centre.x + dx(0.1), y: centre.y + size * 0.3 });
      return [l, r];
    }
    case 'kosa': {
      const l = { ...withShape(L0, 'two'), rot: 35, wrist: { x: centre.x - dx(0.7), y: centre.y + size * 0.7 } };
      const r = { ...withShape(R0, 'two'), rot: -35, wrist: { x: centre.x + dx(0.7), y: centre.y + size * 0.7 } };
      return [l, r];
    }
  }
}
