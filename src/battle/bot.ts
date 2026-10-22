// Autoplay bot for battle stages: performs every step at the right time with
// synthetic hands (single-hand techniques with the right hand, seals and the
// spread with both). Used by tests, E2E, soak and the attract demo.
import { ease } from '../core/math';
import { Rng } from '../core/rng';
import type { Vec2 } from '../core/types';
import { defaultHand, lerpHand, relaxedHand, sealHands, withShape, type SynthHand } from '../gesture/handModel';
import { perform, type HandScript } from '../gesture/performer';
import type { BattleStage } from './stage';
import { effectiveReq, TECH, type Req } from './techniques';

interface Act {
  start: number;
  end: number;
  hands: (t: number) => SynthHand[];
}

export interface BotOptions {
  /** Absolute time of game time 0. */
  playStart: number;
  offsetMs?: number;
  oneHand?: boolean;
  twoHandOk?: boolean;
  /** Fraction of steps deliberately skipped. */
  missRate?: number;
  /** Timing error amplitude (ms). */
  errorMs?: number;
  seed?: number;
  /** Live session: the bot also fights enemies that appear during play (hidden boss, remnants). */
  session?: { enemies: Array<{ e: { id: number; steps: Array<{ tech: string; t: number | null }>; arrive: number }; state: string }> };
}

const SIZE = 0.15;
const REST_R: Vec2 = { x: 0.6, y: 0.72 };

function actFor(req: Req, T: number): Act {
  switch (req.kind) {
    case 'shape': {
      const at = T - 670;
      const s = perform([{ at, shape: req.shape, holdMs: 700, at2: REST_R }], 'R', SIZE);
      return { start: at, end: at + 1200, hands: s };
    }
    case 'motion': {
      const motion = req.motion === 'swipe' ? 'swipeR' : req.motion;
      const at = T - 870;
      const s = perform([{ at, shape: req.shape, holdMs: 800, motion, at2: { x: motion === 'swipeR' ? 0.45 : 0.6, y: 0.72 } }], 'R', SIZE);
      return { start: at, end: at + 1300, hands: s };
    }
    case 'sigil': {
      const at = T - 2150;
      const s = perform([{ at, shape: 'point', holdMs: 1900, sigil: req.sigil, at2: { x: 0.55, y: 0.78 } }], 'R', SIZE);
      return { start: at, end: at + 2500, hands: s };
    }
    case 'seal': {
      const at = T - 560;
      const end = at + 900;
      const target = sealHands(req.seal, { x: 0.5, y: 0.58 }, SIZE);
      const from = [relaxedHand({ ...defaultHand('L'), size: SIZE, wrist: { x: 0.36, y: 0.75 } }, 0.2), relaxedHand({ ...defaultHand('R'), size: SIZE, wrist: REST_R }, 0.2)];
      return {
        start: at,
        end,
        hands: (t) => {
          const k = ease.inOutSine(Math.min(1, (t - at) / 220));
          const out = (t > end - 200 ? 1 - (t - (end - 200)) / 200 : k) as number;
          return target.map((h, i) => lerpHand(from[i]!, h, Math.max(0, Math.min(1, out))));
        },
      };
    }
    case 'spread': {
      const at = T - 1000;
      return {
        start: at,
        end: at + 1400,
        hands: (t) => {
          const u = t - at;
          const gap = u < 400 ? 1.2 - u / 400 : u < 850 ? 0.2 : 0.2 + Math.min(1, (u - 850) / 160) * 2.6;
          const l = withShape({ ...defaultHand('L'), size: SIZE, wrist: { x: 0.5 - (gap * SIZE) / (16 / 9), y: 0.66 } }, 'open');
          const r = withShape({ ...defaultHand('R'), size: SIZE, wrist: { x: 0.5 + (gap * SIZE) / (16 / 9), y: 0.66 } }, 'open');
          return [l, r];
        },
      };
    }
  }
}

export function battleBot(stage: BattleStage, o: BotOptions): HandScript {
  const rng = new Rng(o.seed ?? 9);
  const off = o.offsetMs ?? 0;
  const acts: Act[] = [];
  const known = new Set<number>();
  const schedule = (e: { id: number; steps: Array<{ tech: string; t: number | null }>; arrive: number }) => {
    known.add(e.id);
    for (const st of e.steps) {
      if (o.missRate && rng.chance(o.missRate)) continue;
      const req = effectiveReq(TECH[st.tech]!, !!o.oneHand, o.twoHandOk ?? true);
      const T = (st.t ?? e.arrive + 500) + off + (o.errorMs ? rng.range(-o.errorMs, o.errorMs) : 0);
      acts.push(actFor(req, T));
    }
    acts.sort((a, b) => a.start - b.start);
  };
  for (const e of stage.enemies) schedule(e);
  const idle = (t: number) => [relaxedHand({ ...defaultHand('R'), size: SIZE, wrist: { x: REST_R.x + Math.sin(t / 900) * 0.01, y: REST_R.y } }, 0.15)];
  return (tAbs: number) => {
    const t = tAbs - o.playStart;
    if (o.session) for (const a of o.session.enemies) if (!known.has(a.e.id)) schedule(a.e);
    for (const a of acts) {
      if (a.start > t) break;
      if (t < a.end) return a.hands(t);
    }
    return idle(t);
  };
}
