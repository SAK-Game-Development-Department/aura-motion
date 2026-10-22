// Recognition evaluation over synthetic data (and, in the lab, recorded data).
// Metrics: per-shape recall, confusion matrix, false triggers during natural
// idle movement, motion / sigil / two-hand recall, stance latency.
import { GestureEngine, type GestureEvent } from './engine';
import { buildHand, defaultHand, SHAPE_IDS, withShape, type ShapeId } from './handModel';
import { featureVector, features, normalize } from './features';
import { MOTION_IDS, type MotionKind } from './motion';
import { SIGIL_IDS, type SigilKind } from './sigil';
import { idleSequence, motionSequence, shapeSequence, sigilSequence, twoHandSequence, type Variation } from './synth';
import type { PoseFrame } from '../core/types';
import { median } from '../core/math';

export function runFrames(engine: GestureEngine, frames: PoseFrame[]): GestureEvent[] {
  const ev: GestureEvent[] = [];
  for (const f of frames) ev.push(...engine.update(f).events);
  return ev;
}

export function variations(level: 'quick' | 'full'): Variation[] {
  const out: Variation[] = [];
  const sides = ['L', 'R'] as const;
  const rots = level === 'full' ? [-35, -15, 0, 20, 35] : [-25, 0, 25];
  const yaws = level === 'full' ? [0, 25, 45] : [0, 35];
  const sizes = level === 'full' ? [0.08, 0.15, 0.28] : [0.1, 0.2];
  const noises = level === 'full' ? [0.003, 0.006, 0.01] : [0.004, 0.008];
  const drops = level === 'full' ? [0, 0.03] : [0.02];
  for (const side of sides)
    for (const rot of rots)
      for (const yaw of yaws)
        for (const size of sizes)
          for (const j of noises)
            for (const dropout of drops) out.push({ side, rot, yaw, size, noise: { jitter: j, dropout, zNoise: 2 }, sloppy: 0.12 });
  return out;
}

export interface ShapeEval {
  total: Record<ShapeId, number>;
  /** confusion[target][decided] (decided 'none' = never recognised). */
  confusion: Record<ShapeId, Record<ShapeId | 'none', number>>;
  recall: Record<ShapeId, number>;
  /** Fraction of holds where a *different* shape was decided at any time during the hold. */
  confusionRate: Record<ShapeId, number>;
  /** Median ms from the start of the shape transition (180 ms long) to the stance event. */
  latencyMs: Record<ShapeId, number>;
  worstCases: Array<{ shape: ShapeId; v: Variation; got: string }>;
}

export function evalShapes(level: 'quick' | 'full', shapes: readonly ShapeId[] = SHAPE_IDS, makeEngine = () => new GestureEngine({ shapes, motions: false, sigils: false, twoHand: false })): ShapeEval {
  const vs = variations(level);
  const total = {} as ShapeEval['total'];
  const confusion = {} as ShapeEval['confusion'];
  const recall = {} as ShapeEval['recall'];
  const confusionRate = {} as ShapeEval['confusionRate'];
  const latencyMs = {} as ShapeEval['latencyMs'];
  const worstCases: ShapeEval['worstCases'] = [];
  for (const s of shapes) {
    total[s] = 0;
    confusion[s] = Object.fromEntries([...shapes, 'none'].map((k) => [k, 0])) as Record<ShapeId | 'none', number>;
    let hit = 0;
    let wrong = 0;
    const lats: number[] = [];
    vs.forEach((v, i) => {
      const seq = shapeSequence(s, v, 1000 + i * 31 + s.length);
      const ev = runFrames(makeEngine(), seq.frames);
      // Recognised: a stance of the target shape during the transition or hold.
      const during = ev.filter((e): e is Extract<GestureEvent, { type: 'stance' }> => e.type === 'stance' && e.t >= seq.holdAt - 200 && e.t <= seq.holdEnd);
      const right = during.find((e) => e.shape === s);
      // Misrecognised: another shape decided once the shape is complete, or a
      // wrong cast at any time (transitional shapes never get to cast).
      const other =
        during.find((e) => e.shape !== s && e.t >= seq.holdAt + 70) ??
        (ev.find((e) => e.type === 'cast' && e.shape !== s) as Extract<GestureEvent, { type: 'cast' }> | undefined);
      total[s]++;
      if (right) {
        hit++;
        // From the start of the transition (the hand begins to form the shape).
        lats.push(right.t - (seq.holdAt - 180));
      }
      if (other) wrong++;
      const decided: ShapeId | 'none' = right ? s : other ? other.shape : 'none';
      confusion[s][decided]++;
      if (!right && worstCases.length < 40) worstCases.push({ shape: s, v, got: decided });
    });
    recall[s] = hit / total[s];
    confusionRate[s] = wrong / total[s];
    latencyMs[s] = lats.length ? median(lats) : NaN;
  }
  return { total, confusion, recall, confusionRate, latencyMs, worstCases };
}

export interface IdleEval {
  minutes: number;
  casts: number;
  stances: number;
  castsPer30s: number;
  byShape: Partial<Record<ShapeId, number>>;
  byRelease: Record<string, number>;
}

export function evalIdle(minutes: number, seeds: number[], shapes: readonly ShapeId[] = SHAPE_IDS, noise = { jitter: 0.005, dropout: 0.02, zNoise: 2 }): IdleEval {
  let casts = 0;
  let stances = 0;
  const byShape: IdleEval['byShape'] = {};
  const byRelease: Record<string, number> = {};
  for (const seed of seeds) {
    const eng = new GestureEngine({ shapes, motions: true, sigils: true, twoHand: false });
    const ev = runFrames(eng, idleSequence((minutes * 60_000) / seeds.length, seed, noise));
    for (const e of ev) {
      if (e.type === 'cast') {
        casts++;
        byShape[e.shape] = (byShape[e.shape] ?? 0) + 1;
        byRelease[e.release] = (byRelease[e.release] ?? 0) + 1;
      } else if (e.type === 'stance') stances++;
    }
  }
  return { minutes, casts, stances, castsPer30s: casts / (minutes * 2), byShape, byRelease };
}

export interface MotionEval {
  recall: Record<MotionKind, number>;
  /** Fraction released as a different motion. */
  wrong: Record<MotionKind, number>;
}

export function evalMotions(level: 'quick' | 'full'): MotionEval {
  const vs = variations(level).filter((_, i) => i % 3 === 0);
  const recall = {} as MotionEval['recall'];
  const wrong = {} as MotionEval['wrong'];
  for (const m of MOTION_IDS) {
    let ok = 0;
    let bad = 0;
    vs.forEach((v, i) => {
      const shape: ShapeId = m === 'flick' ? 'fist' : m === 'push' || m === 'pull' ? 'open' : 'fist';
      const seq = motionSequence(shape, m, v, 500 + i);
      const ev = runFrames(new GestureEngine({ motions: true, sigils: false, twoHand: false }), seq.frames);
      const casts = ev.filter((e): e is Extract<GestureEvent, { type: 'cast' }> => e.type === 'cast' && e.t >= seq.motionAt && e.release !== 'hold');
      if (casts.some((c) => c.release === m)) ok++;
      else if (casts.length) bad++;
    });
    recall[m] = ok / vs.length;
    wrong[m] = bad / vs.length;
  }
  return { recall, wrong };
}

export function evalSigils(level: 'quick' | 'full'): { recall: Record<SigilKind, number>; confusion: Record<SigilKind, Record<string, number>> } {
  const vs = variations(level).filter((v, i) => i % 4 === 0 && v.size >= 0.1);
  const recall = {} as Record<SigilKind, number>;
  const confusion = {} as Record<SigilKind, Record<string, number>>;
  for (const k of SIGIL_IDS) {
    let ok = 0;
    confusion[k] = {};
    vs.forEach((v, i) => {
      const seq = sigilSequence(k, v, 700 + i, i % 2 ? 1 : -1);
      const ev = runFrames(new GestureEngine({ motions: false, sigils: true, twoHand: false }), seq.frames);
      const got = ev.find((e): e is Extract<GestureEvent, { type: 'sigil' }> => e.type === 'sigil');
      const key = got?.kind ?? 'none';
      confusion[k][key] = (confusion[k][key] ?? 0) + 1;
      if (got?.kind === k) ok++;
    });
    recall[k] = ok / vs.length;
  }
  return { recall, confusion };
}

export function evalTwoHand(level: 'quick' | 'full'): number {
  const vs = variations(level).filter((v, i) => i % 3 === 0 && v.yaw < 40);
  let ok = 0;
  vs.forEach((v, i) => {
    const seq = twoHandSequence(v, 300 + i);
    const ev = runFrames(new GestureEngine({ motions: false, sigils: false, twoHand: true }), seq.frames);
    if (ev.some((e) => e.type === 'cast' && e.release === 'twoHand')) ok++;
  });
  return ok / vs.length;
}

/** Pairwise feature distances between canonical shapes (separability check). */
export function shapeSeparation(shapes: readonly ShapeId[] = SHAPE_IDS): Array<{ a: ShapeId; b: ShapeId; d: number }> {
  const vec = (s: ShapeId) => featureVector(features(normalize(buildHand(withShape(defaultHand('R'), s)), 16 / 9)));
  const out: Array<{ a: ShapeId; b: ShapeId; d: number }> = [];
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      const va = vec(shapes[i]!);
      const vb = vec(shapes[j]!);
      out.push({ a: shapes[i]!, b: shapes[j]!, d: Math.hypot(...va.map((x, k) => x - vb[k]!)) });
    }
  return out.sort((x, y) => x.d - y.d);
}
