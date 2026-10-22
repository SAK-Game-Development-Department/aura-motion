// Scripted synthetic hands: the "ghost hand" demonstrations, the attract
// demo and the autoplay bot all perform a timeline of gesture steps.
import type { PoseFrame, Vec2 } from '../core/types';
import { HL } from '../core/types';
import { ease } from '../core/math';
import { PulledSource } from '../input/source';
import { buildHand, defaultHand, lerpHand, relaxedHand, withShape, type HandSide, type ShapeId, type SynthHand } from './handModel';
import type { MotionKind } from './motion';
import { sigilPath, type SigilKind } from './sigil';

export interface Step {
  /** Start time (script clock, ms). */
  at: number;
  /** Shape to form (reached after `formMs`) and hold. */
  shape: ShapeId | 'relaxed';
  /** Hold duration after forming (ms). */
  holdMs: number;
  formMs?: number;
  /** Optional motion performed at the end of the hold. */
  motion?: MotionKind;
  /** Optional sigil drawn with the fingertip during the hold (shape should be 'point'). */
  sigil?: SigilKind;
  side?: HandSide;
  /** Where (view coords) the wrist rests during this step. */
  at2?: Vec2;
}

export type HandScript = (t: number) => SynthHand[];

const DEFAULT_POS: Record<HandSide, Vec2> = { L: { x: 0.38, y: 0.72 }, R: { x: 0.6, y: 0.72 } };

/** Turn a timeline into a script for one hand (side). Before the first / after the last step the hand is relaxed. */
export function perform(steps: Step[], side: HandSide = 'R', size = 0.15): HandScript {
  const sorted = [...steps].filter((s) => (s.side ?? 'R') === side).sort((a, b) => a.at - b.at);
  return (t) => {
    const base = { ...defaultHand(side), size, wrist: { ...DEFAULT_POS[side] } };
    let h = relaxedHand(base, 0.15);
    let prevShape: SynthHand = h;
    for (const s of sorted) {
      const formMs = s.formMs ?? 220;
      const end = s.at + formMs + s.holdMs + 260;
      if (t < s.at) break;
      const pos = s.at2 ?? base.wrist;
      const target = s.shape === 'relaxed' ? relaxedHand({ ...base, wrist: pos }, 0.15) : withShape({ ...base, wrist: pos }, s.shape);
      if (t >= end) {
        prevShape = relaxedHand({ ...base, wrist: pos }, 0.15);
        h = prevShape;
        continue;
      }
      const k = ease.inOutSine(Math.min(1, (t - s.at) / formMs));
      h = lerpHand(prevShape, target, k);
      const holdT = t - s.at - formMs;
      if (holdT > 0 && s.sigil) {
        const u = Math.min(1, holdT / Math.max(1, s.holdMs - 300));
        const path = sigilPath(s.sigil, 1, 0, 80);
        const p = path[Math.floor(u * (path.length - 1))]!;
        const sc = size * 2.2;
        h = { ...h, wrist: { x: pos.x + (p.x * sc) / (16 / 9), y: pos.y - size * 1.2 + p.y * sc } };
      }
      const mStart = s.holdMs - 300;
      if (s.motion && holdT > mStart) {
        const e = ease.inOutSine(Math.min(1, (holdT - mStart) / 260));
        const d = size * 3.2;
        switch (s.motion) {
          case 'swipeL':
            h = { ...h, wrist: { x: h.wrist.x - (e * d) / (16 / 9), y: h.wrist.y } };
            break;
          case 'swipeR':
            h = { ...h, wrist: { x: h.wrist.x + (e * d) / (16 / 9), y: h.wrist.y } };
            break;
          case 'swipeU':
            h = { ...h, wrist: { x: h.wrist.x, y: h.wrist.y - e * d } };
            break;
          case 'swipeD':
            h = { ...h, wrist: { x: h.wrist.x, y: h.wrist.y + e * d } };
            break;
          case 'push':
            h = { ...h, size: h.size * (1 + 0.4 * e) };
            break;
          case 'pull':
            h = { ...h, size: h.size * (1 - 0.3 * e) };
            break;
          case 'flick':
            h = { ...h, curl: [h.curl[0], 1 - ease.outCubic(Math.min(1, (holdT - mStart) / 90)), h.curl[2], h.curl[3], h.curl[4]] };
            break;
        }
      }
      prevShape = target;
    }
    return [h];
  };
}

/** Combine several one-hand scripts. */
export function both(...scripts: HandScript[]): HandScript {
  return (t) => scripts.flatMap((s) => s(t));
}

/** Synthetic hand source driven by a script (absolute app time). */
export class HandSynthSource extends PulledSource {
  readonly kind = 'synth' as const;
  /** When true, scripts get absolute time; otherwise time since start. */
  absolute = true;
  private t0 = -1;
  constructor(
    public script: HandScript,
    fps = 30,
  ) {
    super(fps);
  }
  protected produce(t: number): PoseFrame {
    if (this.t0 < 0) this.t0 = t;
    const hands = this.script(this.absolute ? t : t - this.t0).map((h) => ({ lm: buildHand(h), score: 0.97 }));
    return { t, poses: [], hands, aspect: 16 / 9, luma: 0.4 };
  }
}

/** Index fingertip of a synthetic hand (view). */
export function tipOf(h: SynthHand): Vec2 {
  const lm = buildHand(h);
  return { x: lm[HL.indexTip]!.x, y: lm[HL.indexTip]!.y };
}

/** A looping demo showing off the gesture vocabulary (attract mode). */
export function showcase(start: number): HandScript {
  const seq: Array<Omit<Step, 'at'>> = [
    { shape: 'open', holdMs: 700 },
    { shape: 'fist', holdMs: 700 },
    { shape: 'point', holdMs: 1600, sigil: 'circle' },
    { shape: 'two', holdMs: 700 },
    { shape: 'fist', holdMs: 600, motion: 'push' },
    { shape: 'open', holdMs: 700, motion: 'swipeL' },
    { shape: 'pinch', holdMs: 700 },
    { shape: 'horn', holdMs: 700 },
  ];
  const loop = seq.reduce((a, s) => a + 220 + s.holdMs + 600, 0);
  const steps: Step[] = [];
  let at = 0;
  for (const s of seq) {
    steps.push({ ...s, at });
    at += 220 + s.holdMs + 600;
  }
  const script = perform(steps, 'R', 0.16);
  return (t) => script(((t - start) % loop + loop) % loop);
}
