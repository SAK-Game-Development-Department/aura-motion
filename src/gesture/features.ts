// Normalisation + features: landmarks → a pose-invariant description.
//
// normalize(): wrist origin, divide by palm size (scale), rotate so the palm
// axis (wrist → middle MCP) points up (in-plane rotation), and mirror so the
// thumb is always on +x (left/right hands and mirrored video look the same —
// we never depend on MediaPipe's handedness label).
// features(): per-finger bend angles, thumb position, fingertip distances.
import { GESTURE } from '../config';
import { HL, type Landmark } from '../core/types';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const angleDeg = (a: V3, b: V3) => {
  const d = dot(a, b) / Math.max(1e-9, len(a) * len(b));
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
};

export interface Normalized {
  /** 21 points in palm units: wrist at origin, fingers up (−y), thumb on +x. */
  pts: V3[];
  /** Palm size in view-height units (2D, for placement & motion scaling). */
  size: number;
  /** In-plane palm angle (degrees, 0 = fingers up). */
  angle: number;
  /** Was the hand mirrored to put the thumb on +x? */
  mirrored: boolean;
  /** |palm normal · camera axis|: 1 = facing the camera squarely, 0 = edge-on. */
  facing: number;
}

export function normalize(lm: Landmark[], aspect: number): Normalized {
  const m = lm.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));
  const w = m[HL.wrist]!;
  const mid = m[HL.middleMcp]!;
  const axis = sub(mid, w);
  const size3 = Math.max(1e-6, len(axis));
  const size2 = Math.max(1e-6, Math.hypot(axis.x, axis.y));
  // In-plane rotation that maps the palm axis to (0, -1).
  const ang = Math.atan2(axis.x, -axis.y);
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  let pts = m.map((p) => {
    const q = sub(p, w);
    return { x: (q.x * c - q.y * s) / size3, y: (q.x * s + q.y * c) / size3, z: q.z / size3 };
  });
  // Thumb side: index MCP vs pinky MCP across the palm.
  const mirrored = pts[HL.indexMcp]!.x < pts[HL.pinkyMcp]!.x;
  if (mirrored) pts = pts.map((p) => ({ x: -p.x, y: p.y, z: p.z }));
  // Palm normal from (index MCP − wrist) × (pinky MCP − wrist).
  const a = pts[HL.indexMcp]!;
  const b = pts[HL.pinkyMcp]!;
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const facing = Math.abs(n.z) / Math.max(1e-9, len(n));
  return { pts, size: size2, angle: (ang * 180) / Math.PI, mirrored, facing };
}

/** Finger order for features. */
export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

export interface Features {
  /** Total bend per finger (sum of the three joint angles, degrees). [index..pinky] */
  bend: [number, number, number, number];
  /** Reach per finger: |wrist→tip| / |wrist→MCP| (≈1.9 straight, ≈0.9 curled). Robust to jitter. */
  reach: [number, number, number, number];
  /** Thumb tip → index MCP distance (palm units). */
  thumbOut: number;
  /** Thumb tip → pinky MCP distance (palm units) — a folded thumb crosses the palm. */
  thumbAcross: number;
  /** Thumb tip ↔ index tip (palm units). */
  pinch: number;
  /** Index tip ↔ middle tip (palm units). */
  vSpread: number;
  /** Fan: angle between the index and pinky directions (MCP → tip), degrees, 3D. */
  fan: number;
  /** Fingertip heights above the wrist along the palm axis (palm units) [thumb..pinky]. */
  tipUp: [number, number, number, number, number];
  facing: number;
}

export function features(n: Normalized): Features {
  const p = n.pts;
  const fingerBend = (mcp: number): number => {
    const v0 = sub(p[mcp]!, p[HL.wrist]!);
    const v1 = sub(p[mcp + 1]!, p[mcp]!);
    const v2 = sub(p[mcp + 2]!, p[mcp + 1]!);
    const v3 = sub(p[mcp + 3]!, p[mcp + 2]!);
    return angleDeg(v0, v1) + angleDeg(v1, v2) + angleDeg(v2, v3);
  };
  const d = (i: number, j: number) => len(sub(p[i]!, p[j]!));
  return {
    bend: [fingerBend(HL.indexMcp), fingerBend(HL.middleMcp), fingerBend(HL.ringMcp), fingerBend(HL.pinkyMcp)],
    reach: [HL.indexMcp, HL.middleMcp, HL.ringMcp, HL.pinkyMcp].map((m) => d(m + 3, HL.wrist) / Math.max(1e-6, d(m, HL.wrist))) as Features['reach'],
    thumbOut: d(HL.thumbTip, HL.indexMcp),
    thumbAcross: d(HL.thumbTip, HL.pinkyMcp),
    pinch: d(HL.thumbTip, HL.indexTip),
    vSpread: d(HL.indexTip, HL.middleTip),
    // 3D angle: turning the palm away (yaw) foreshortens the 2D fan but not this.
    fan: angleDeg(sub(p[HL.indexTip]!, p[HL.indexMcp]!), sub(p[HL.pinkyTip]!, p[HL.pinkyMcp]!)),
    tipUp: [-p[HL.thumbTip]!.y, -p[HL.indexTip]!.y, -p[HL.middleTip]!.y, -p[HL.ringTip]!.y, -p[HL.pinkyTip]!.y],
    facing: n.facing,
  };
}

/** Per-player thresholds (re-centred by the open/fist calibration). */
export interface Thresholds {
  bendLo: [number, number, number, number];
  bendHi: [number, number, number, number];
  thumbLo: number;
  thumbHi: number;
  pinchOn: number;
  pinchOff: number;
  /** Open-hand fan angle: ≤ lo fingers together, ≥ hi clearly spread. */
  fanLo: number;
  fanHi: number;
}

export function defaultThresholds(): Thresholds {
  return {
    bendLo: [GESTURE.bendLo, GESTURE.bendLo, GESTURE.bendLo, GESTURE.bendLo],
    bendHi: [GESTURE.bendHi, GESTURE.bendHi, GESTURE.bendHi, GESTURE.bendHi],
    thumbLo: GESTURE.thumbLo,
    thumbHi: GESTURE.thumbHi,
    pinchOn: GESTURE.pinchOn,
    pinchOff: GESTURE.pinchOff,
    fanLo: GESTURE.fanLo,
    fanHi: GESTURE.fanHi,
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Soft finger states 0 (curled) .. 1 (extended) for [thumb, index, middle, ring, pinky] + pinch degree. */
export interface FingerStates {
  ext: [number, number, number, number, number];
  pinch: number;
  /** 0..1 how clearly the fingers are spread. */
  spread: number;
}

export function fingerStates(f: Features, th: Thresholds): FingerStates {
  // Average of the angle-based and the distance-based estimate: the angle sum
  // is precise on large hands, the reach ratio is stable on small/noisy ones.
  const ext = [
    smooth(th.thumbLo, th.thumbHi, Math.min(f.thumbOut, f.thumbAcross * 0.75)),
    ...f.bend.map((b, i) => 0.5 * (1 - smooth(th.bendLo[i]!, th.bendHi[i]!, b)) + 0.5 * smooth(GESTURE.reachLo, GESTURE.reachHi, f.reach[i]!)),
  ] as FingerStates['ext'];
  return { ext, pinch: 1 - smooth(th.pinchOn, th.pinchOff, f.pinch), spread: smooth(th.fanLo, th.fanHi, f.fan) };
}

/** Fixed-length numeric vector (for kNN and the separability test). */
export function featureVector(f: Features): number[] {
  return [...f.bend.map((b) => b / 180), ...f.reach.map((r) => r / 2), f.thumbOut, f.thumbAcross, f.pinch, f.vSpread, f.fan / 60, ...f.tipUp];
}
