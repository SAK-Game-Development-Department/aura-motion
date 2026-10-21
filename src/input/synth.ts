// Synthetic motion generator: scripted bodies for tests, attract mode and the
// autoplayer (which plays a Stage "perfectly" with configurable error).
import { DODGE, LATENCY, POSE } from '../config';
import { ease, lerp } from '../core/math';
import { Rng } from '../core/rng';
import type { Hand, Landmark, PoseFrame, Vec2 } from '../core/types';
import { POSES } from '../stage/poses';
import type { Stage } from '../stage/types';
import { assignHands } from '../stage/validator';
import { fromBody, type Anchor } from './body';
import { buildLandmarks, defaultBody, NEUTRAL_ARM_L, NEUTRAL_ARM_R, type SynthBody } from './skeleton';
import { PulledSource } from './source';

export type SynthScript = (t: number) => SynthBody | null;

export class SynthSource extends PulledSource {
  readonly kind = 'synth' as const;
  private t0 = -1;
  /** When true, scripts receive the absolute frame time instead of time since start. */
  absolute = false;
  constructor(
    public script: SynthScript,
    fps = 30,
    private noise = 0,
    private seed = 1,
  ) {
    super(fps);
  }

  protected produce(t: number): PoseFrame | null {
    if (this.t0 < 0) this.t0 = t;
    const b = this.script(this.absolute ? t : t - this.t0);
    const poses: Landmark[][] = [];
    if (b) poses.push(jitter(buildLandmarks(b), this.noise, new Rng(this.seed ^ Math.floor(t))));
    return { t, poses, aspect: 16 / 9, luma: 0.4 };
  }

  /** Restart the script clock at the next frame. */
  restart(): void {
    this.t0 = -1;
  }
}

export function jitter(lm: Landmark[], amount: number, rng: Rng): Landmark[] {
  if (amount <= 0) return lm;
  return lm.map((p) => ({ ...p, x: p.x + rng.range(-amount, amount), y: p.y + rng.range(-amount, amount) }));
}

/** Anchor (mid-shoulder, unit) of a synthetic body. */
export function synthAnchor(b: SynthBody): Anchor {
  const lm = buildLandmarks(b);
  const ls = lm[11]!;
  const rs = lm[12]!;
  const unit = Math.hypot((ls.x - rs.x) * b.aspect, ls.y - rs.y);
  return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, unit };
}

// ───────────────────────── simple scripts ─────────────────────────

export const scripts = {
  absent: (): SynthScript => () => null,

  idle: (seated = false): SynthScript => (t) => {
    const b = defaultBody();
    b.seated = seated;
    const s = Math.sin(t / 900);
    b.cx = 0.5 + s * 0.01;
    b.armL = { upper: -12 - s * 4, lower: -6 };
    b.armR = { upper: 12 + s * 4, lower: 6 };
    return b;
  },

  wave: (): SynthScript => (t) => {
    const b = defaultBody();
    const s = Math.sin(t / 220);
    b.armR = { upper: 120 + s * 25, lower: 160 + s * 30 };
    b.armL = { upper: -120 + s * 25, lower: -160 + s * 30 };
    return b;
  },

  /** Walk in from the side, stay, then leave. */
  visit: (stayMs: number, enterMs = 1500): SynthScript => (t) => {
    const b = defaultBody();
    if (t < enterMs) b.cx = lerp(-0.2, 0.5, ease.outCubic(t / enterMs));
    else if (t < enterMs + stayMs) b.cx = 0.5;
    else if (t < enterMs * 2 + stayMs) b.cx = lerp(0.5, 1.25, ease.inCubic((t - enterMs - stayMs) / enterMs));
    else return null;
    return b;
  },

  /** Repeating crouch / jump / lean cycle (for detector tests). */
  moves: (): SynthScript => (t) => {
    const b = defaultBody();
    const cyc = t % 8000;
    if (cyc > 2000 && cyc < 2600) b.jump = Math.sin(((cyc - 2000) / 600) * Math.PI);
    if (cyc > 3500 && cyc < 4500) b.crouch = Math.sin(((cyc - 3500) / 1000) * Math.PI);
    if (cyc > 5200 && cyc < 6200) b.cx = 0.5 - 0.09 * Math.sin(((cyc - 5200) / 1000) * Math.PI);
    if (cyc > 6600 && cyc < 7600) b.cx = 0.5 + 0.09 * Math.sin(((cyc - 6600) / 1000) * Math.PI);
    return b;
  },

  /** Clap on calibration pulses (pulse times relative to script start). */
  clapper: (pulsesRel: number[], lagMs: number): SynthScript => (t) => {
    const b = defaultBody();
    // Hands meet in front of the chest at each pulse + lag.
    let closeness = 0;
    for (const p of pulsesRel) {
      const d = (t - (p + lagMs)) / 200;
      closeness = Math.max(closeness, Math.exp(-d * d * 2));
    }
    const a = synthAnchor(b);
    const spread = lerp(1.6, 0.05, closeness);
    b.armL.target = fromBody({ x: -spread, y: 0.9 }, a, b.aspect);
    b.armR.target = fromBody({ x: spread, y: 0.9 }, a, b.aspect);
    return b;
  },
};

// ───────────────────────── autoplayer ─────────────────────────

export interface AutoplayOptions {
  /** Script time at which game time 0 occurs. */
  playStartRel: number;
  /** Simulated end-to-end latency (ms): body moves this much *earlier* in capture time is NOT modelled; the
   *  autoplayer just times its touches to (orb time + latency offset) as a real player would after calibration. */
  offsetMs?: number;
  /** Timing error stddev-ish (ms). */
  errorMs?: number;
  /** Fraction of orbs deliberately missed. */
  missRate?: number;
  seed?: number;
  seated?: boolean;
}

interface Key {
  t: number;
  p: Vec2;
  hit: boolean;
}

/**
 * A bot that plays a stage. It produces a body whose palms pass through each
 * orb at its target time, strikes wall poses and performs dodges. Used by
 * attract mode, E2E and soak tests.
 */
export function autoplayScript(stage: Stage, o: AutoplayOptions): SynthScript {
  const rng = new Rng(o.seed ?? 7);
  const base = defaultBody();
  base.seated = o.seated ?? stage.seated;
  const anchor = synthAnchor(base);
  const aspect = base.aspect;
  const offset = o.offsetMs ?? LATENCY.defaultOffsetMs;
  const err = o.errorMs ?? 0;
  const hands = assignHands(stage.orbs);
  const rest: Record<Hand, Vec2> = {
    L: fromBody({ x: -1.0, y: 1.8 }, anchor, aspect),
    R: fromBody({ x: 1.0, y: 1.8 }, anchor, aspect),
  };
  const keys: Record<Hand, Key[]> = { L: [], R: [] };
  for (const orb of stage.orbs) {
    if (o.missRate && rng.chance(o.missRate)) continue;
    const h = hands.get(orb.id)!;
    const p = fromBody(orb.pos, anchor, aspect);
    keys[h].push({ t: orb.t + offset + rng.range(-err, err), p, hit: true });
  }
  // Insert rest poses in long gaps so arms relax between phrases.
  for (const h of ['L', 'R'] as const) {
    const ks = keys[h];
    const out: Key[] = [{ t: -1e9, p: rest[h], hit: false }];
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i]!;
      const prev = out[out.length - 1]!;
      if (k.t - prev.t > 1600) {
        out.push({ t: prev.t + 500, p: rest[h], hit: false });
        out.push({ t: k.t - 700, p: rest[h], hit: false });
      }
      out.push(k);
    }
    out.push({ t: 1e12, p: rest[h], hit: false });
    keys[h] = out;
  }
  const idx: Record<Hand, number> = { L: 0, R: 0 };

  const handAt = (h: Hand, tg: number): Vec2 => {
    const ks = keys[h];
    // Scripts are sampled monotonically; keep a cursor.
    let i = idx[h];
    while (i > 0 && ks[i]!.t > tg) i--;
    while (i + 1 < ks.length && ks[i + 1]!.t <= tg) i++;
    idx[h] = i;
    const a = ks[i]!;
    const b = ks[i + 1]!;
    // Pass *through* the orb: overshoot slightly along the motion direction.
    const u = (tg - a.t) / Math.max(1, b.t - a.t);
    const k = ease.inOutSine(u);
    return { x: lerp(a.p.x, b.p.x, k), y: lerp(a.p.y, b.p.y, k) };
  };

  return (tRel: number) => {
    const tg = tRel - o.playStartRel; // game-time (latency offset already in key times)
    const b: SynthBody = { ...base, armL: { ...NEUTRAL_ARM_L }, armR: { ...NEUTRAL_ARM_R }, legL: { ...base.legL }, legR: { ...base.legR } };
    b.armL.target = handAt('L', tg);
    b.armR.target = handAt('R', tg);

    // Walls: blend into the template around the arrival time.
    for (const w of stage.walls) {
      const dt = tg - (w.t + offset);
      if (dt > -POSE.windowBeforeMs - 700 && dt < POSE.windowAfterMs + 150) {
        const tpl = POSES[w.pose];
        b.armL = { ...tpl.armL, target: null };
        b.armR = { ...tpl.armR, target: null };
        if (tpl.legL && tpl.legR && !b.seated) {
          b.legL = { ...tpl.legL };
          b.legR = { ...tpl.legR };
        }
      }
    }
    // Dodges.
    for (const d of stage.dodges) {
      const dt = tg - (d.t + offset);
      const w = DODGE.windowBeforeMs;
      if (dt < -w - 250 || dt > DODGE.windowAfterMs + 200) continue;
      const k = Math.sin(Math.min(1, Math.max(0, (dt + w + 250) / (w + DODGE.windowAfterMs + 450))) * Math.PI);
      if (d.kind === 'jump') b.jump = k;
      else if (d.kind === 'crouch') b.crouch = k;
      else if (d.kind === 'duck') b.crouch = b.seated ? 0 : k;
      else if (d.kind === 'leanL') b.cx = base.cx - 0.1 * k;
      else if (d.kind === 'leanR') b.cx = base.cx + 0.1 * k;
      if (d.kind === 'duck' && b.seated) b.lean = 0;
    }
    if (b.seated) {
      // Seated duck: drop the torso by leaning forward (head goes down).
      for (const d of stage.dodges) {
        const dt = tg - (d.t + offset);
        if (d.kind === 'duck' && dt > -DODGE.windowBeforeMs - 200 && dt < DODGE.windowAfterMs + 150) b.floorY = base.floorY + 0.08;
      }
    }
    // Flow: sweep the goal-side forearm upward under the stream.
    for (const f of stage.flows) {
      if (tg < f.start || tg > f.end) continue;
      const side = f.emitDir.x > 0 ? 'armR' : 'armL';
      const ph = ((tg - f.start) % 1400) / 1400;
      const sweep = Math.sin(ph * Math.PI * 2);
      const tgt = fromBody({ x: (f.emitDir.x > 0 ? 1 : -1) * (0.6 + 0.5 * sweep), y: f.emitter.y + 0.2 - 1.0 * Math.max(0, sweep) }, anchor, aspect);
      b[side] = { ...b[side], target: tgt };
    }
    return b;
  };
}

/** Attract-mode script: an autoplayed demo that loops forever. */
export function attractScript(stage: Stage): SynthScript {
  const play = autoplayScript(stage, { playStartRel: 1500, offsetMs: 0, errorMs: 40, seed: 3 });
  const loop = stage.durationMs + 3000;
  return (t) => play(t % loop);
}
