// Synthetic hand sequences for recognition tests and the evaluation report.
// Every sequence is a list of PoseFrames generated from the parametric hand
// model with configurable pose variation and detector-like noise.
import type { PoseFrame } from '../core/types';
import { HL } from '../core/types';
import { Rng } from '../core/rng';
import { buildHand, defaultHand, lerpHand, noisy, relaxedHand, withShape, type HandSide, type NoiseOptions, type ShapeId, type SynthHand } from './handModel';
import type { MotionKind } from './motion';
import { sigilPath, type SigilKind } from './sigil';

export interface Variation {
  side: HandSide;
  rot: number;
  yaw: number;
  size: number;
  noise: NoiseOptions;
  /** Curl jitter amplitude added to every finger (imperfect shapes). */
  sloppy: number;
}

export const FPS = 30;
const DT = 1000 / FPS;

function frame(t: number, hands: SynthHand[], rng: Rng, noise: NoiseOptions): PoseFrame {
  return { t, poses: [], aspect: 16 / 9, hands: hands.map((h) => ({ lm: noisy(buildHand(h), rng, noise), score: 0.95 })) };
}

function base(v: Variation): SynthHand {
  const h = defaultHand(v.side);
  return { ...h, wrist: { x: 0.5, y: 0.5 + v.size * 0.8 }, rot: v.rot, yaw: v.yaw, size: v.size };
}

function sloppify(h: SynthHand, rng: Rng, amt: number): SynthHand {
  if (amt <= 0) return h;
  return { ...h, curl: h.curl.map((c) => Math.max(0, Math.min(1, c + rng.range(-amt, amt)))) as SynthHand['curl'] };
}

/** relaxed (400 ms) → transition (180 ms) → hold `shape` (holdMs) → relaxed (300 ms). Hold starts at `holdAt`. */
export function shapeSequence(shape: ShapeId, v: Variation, seed: number, holdMs = 900): { frames: PoseFrame[]; holdAt: number; holdEnd: number } {
  const rng = new Rng(seed);
  const b = base(v);
  const relaxed = relaxedHand(b, rng.range(0, 0.4));
  const target = sloppify(withShape(b, shape), rng, v.sloppy);
  const frames: PoseFrame[] = [];
  const t0 = 400;
  const t1 = t0 + 180;
  const t2 = t1 + holdMs;
  const end = t2 + 300;
  for (let t = 0; t <= end; t += DT) {
    let h: SynthHand;
    if (t < t0) h = relaxed;
    else if (t < t1) h = lerpHand(relaxed, target, (t - t0) / (t1 - t0));
    else if (t < t2) h = target;
    else h = lerpHand(target, relaxed, Math.min(1, (t - t2) / 200));
    // Natural tremor of the whole hand.
    h = { ...h, wrist: { x: h.wrist.x + Math.sin(t / 170 + seed) * 0.002, y: h.wrist.y + Math.cos(t / 210 + seed) * 0.002 } };
    frames.push(frame(t, [h], rng, v.noise));
  }
  return { frames, holdAt: t1, holdEnd: t2 };
}

/** A stance followed by a motion release. Motion starts at `motionAt`. */
export function motionSequence(shape: ShapeId, motion: MotionKind, v: Variation, seed: number): { frames: PoseFrame[]; motionAt: number } {
  const rng = new Rng(seed);
  const b = withShape(base(v), shape);
  const frames: PoseFrame[] = [];
  const motionAt = 650;
  const dur = motion === 'flick' ? 90 : motion === 'push' || motion === 'pull' ? 240 : 260;
  for (let t = 0; t <= motionAt + dur + 400; t += DT) {
    const k = Math.max(0, Math.min(1, (t - motionAt) / dur));
    const e = k * k * (3 - 2 * k);
    let h: SynthHand = { ...b };
    const d = 3.2 * v.size; // swipe distance (view-height units)
    switch (motion) {
      case 'swipeL':
        h.wrist = { x: b.wrist.x - (e * d) / (16 / 9), y: b.wrist.y };
        break;
      case 'swipeR':
        h.wrist = { x: b.wrist.x + (e * d) / (16 / 9), y: b.wrist.y };
        break;
      case 'swipeU':
        h.wrist = { x: b.wrist.x, y: b.wrist.y - e * d };
        break;
      case 'swipeD':
        h.wrist = { x: b.wrist.x, y: b.wrist.y + e * d };
        break;
      case 'push':
        h.size = b.size * (1 + 0.4 * e);
        break;
      case 'pull':
        h.size = b.size * (1 - 0.3 * e);
        break;
      case 'flick': {
        // Index finger snaps from curled to straight (palm still).
        const c = 1 - e;
        h = { ...h, curl: [h.curl[0], c, h.curl[2], h.curl[3], h.curl[4]] };
        break;
      }
    }
    frames.push(frame(t, [h], rng, v.noise));
  }
  return { frames, motionAt };
}

/** "point" stance, then the fingertip draws a sigil (≈ 4 palms wide) and pauses. */
export function sigilSequence(kind: SigilKind, v: Variation, seed: number, dir: 1 | -1 = 1): { frames: PoseFrame[]; drawEnd: number } {
  const rng = new Rng(seed);
  const b = withShape(base(v), 'point');
  const tipOff = (() => {
    const lm = buildHand(b);
    return { x: lm[HL.indexTip]!.x - b.wrist.x, y: lm[HL.indexTip]!.y - b.wrist.y };
  })();
  const path = sigilPath(kind, dir, rng.range(0, 0.3), 60);
  const scale = v.size * 2.2;
  const centre = { x: b.wrist.x + tipOff.x, y: b.wrist.y + tipOff.y };
  const start = 550;
  const drawMs = kind === 'spiral' ? 1500 : 1200;
  const frames: PoseFrame[] = [];
  for (let t = 0; t <= start + drawMs + 600; t += DT) {
    const u = Math.max(0, Math.min(1, (t - start) / drawMs));
    const p = path[Math.min(path.length - 1, Math.floor(u * (path.length - 1)))]!;
    const tip = { x: centre.x + (p.x * scale) / (16 / 9), y: centre.y + p.y * scale };
    const h: SynthHand = { ...b, wrist: { x: tip.x - tipOff.x, y: tip.y - tipOff.y } };
    frames.push(frame(t, [h], rng, v.noise));
  }
  return { frames, drawEnd: start + drawMs };
}

/** Two hands come together and fly apart. */
export function twoHandSequence(v: Variation, seed: number): { frames: PoseFrame[]; spreadAt: number } {
  const rng = new Rng(seed);
  const l = { ...withShape(base({ ...v, side: 'L' }), 'open') };
  const r = { ...withShape(base({ ...v, side: 'R' }), 'open') };
  const frames: PoseFrame[] = [];
  const far = v.size * 2.6;
  const near = v.size * 0.55;
  for (let t = 0; t <= 2200; t += DT) {
    let gap: number;
    if (t < 400) gap = far;
    else if (t < 900) gap = far + (near - far) * ((t - 400) / 500);
    else if (t < 1300) gap = near;
    else if (t < 1550) gap = near + (far * 1.2 - near) * ((t - 1300) / 250);
    else gap = far * 1.2;
    const a = { ...l, wrist: { x: 0.5 - gap / (16 / 9), y: l.wrist.y } };
    const b = { ...r, wrist: { x: 0.5 + gap / (16 / 9), y: r.wrist.y } };
    frames.push(frame(t, [a, b], rng, v.noise));
  }
  return { frames, spreadAt: 1300 };
}

/**
 * Natural, non-gesture hand activity (talking with hands, resting, drifting,
 * turning, partially closing) for false-trigger measurement.
 */
export function idleSequence(durationMs: number, seed: number, noise: NoiseOptions): PoseFrame[] {
  const rng = new Rng(seed);
  // Brief accidental shapes (scratching, adjusting a sleeve): < 300 ms each.
  const ACCIDENTAL: ShapeId[] = ['fist', 'open', 'point', 'two'];
  let flash: { shape: ShapeId; until: number } | null = null;
  const frames: PoseFrame[] = [];
  let k = rng.range(0, 0.5);
  let kT = k;
  let pos = { x: 0.5, y: 0.6 };
  let posT = { ...pos };
  let rot = 0;
  let rotT = 0;
  let size = 0.14;
  let sizeT = 0.14;
  let present = true;
  let nextChange = 0;
  for (let t = 0; t <= durationMs; t += DT) {
    if (t >= nextChange) {
      kT = rng.range(0, 0.75);
      posT = { x: rng.range(0.3, 0.7), y: rng.range(0.4, 0.8) };
      rotT = rng.range(-40, 40);
      sizeT = rng.range(0.1, 0.22);
      if (rng.chance(0.06)) present = !present;
      nextChange = t + rng.range(400, 2200);
    }
    const a = 0.06;
    k += (kT - k) * a;
    pos = { x: pos.x + (posT.x - pos.x) * a, y: pos.y + (posT.y - pos.y) * a };
    rot += (rotT - rot) * a;
    size += (sizeT - size) * a * 0.5;
    if (!present) {
      frames.push({ t, poses: [], hands: [], aspect: 16 / 9 });
      continue;
    }
    let h = relaxedHand({ ...defaultHand('R'), wrist: pos, rot, size, yaw: Math.sin(t / 1300) * 25 }, k);
    if (!flash && rng.chance(0.004)) flash = { shape: rng.pick(ACCIDENTAL), until: t + rng.range(120, 280) };
    if (flash) {
      h = withShape(h, flash.shape);
      if (t > flash.until) flash = null;
    }
    frames.push(frame(t, [h], rng, noise));
  }
  return frames;
}
