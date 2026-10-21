// Seeded procedural stage generator. Same options → identical stage.
// Orbs are placed on a beat grid using phrase patterns; walls/dodges/flows
// are placed per section. A validation + repair pass enforces human limits.
import { HUMAN_LIMITS, POSE, DODGE, STAGE } from '../config';
import { Rng } from '../core/rng';
import type { Side, Vec2 } from '../core/types';
import { POSES, POSE_IDS, poseDistance, type PoseId } from './poses';
import type { DodgeKind, DodgeNote, FlowPhase, OrbNote, Section, SectionKind, Stage, StageOptions, WallNote } from './types';
import { repairStage, validateStage } from './validator';

type Phrase = (rng: Rng, reach: Reach) => Array<{ beat: number; pos: Vec2 }>;
interface Reach {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const rnd = (rng: Rng, a: number, b: number) => Math.round(rng.range(a, b) * 100) / 100;

/** Phrase library: 4-beat patterns in body units. */
const PHRASES: Record<string, Phrase> = {
  alternate: (rng, r) => {
    const y = rnd(rng, r.yMin * 0.6, r.yMax * 0.3);
    const x = rnd(rng, 1.1, r.xMax * 0.85);
    return [
      { beat: 0, pos: { x: -x, y } },
      { beat: 1, pos: { x, y } },
      { beat: 2, pos: { x: -x, y: y - 0.4 } },
      { beat: 3, pos: { x, y: y - 0.4 } },
    ];
  },
  rise: (rng, r) => {
    const side = rng.chance(0.5) ? -1 : 1;
    const x = side * rnd(rng, 1.0, r.xMax * 0.8);
    return [
      { beat: 0, pos: { x, y: r.yMax * 0.5 } },
      { beat: 1, pos: { x: x * 1.05, y: 0 } },
      { beat: 2, pos: { x: x * 1.05, y: r.yMin * 0.55 } },
      { beat: 3, pos: { x: x * 0.9, y: r.yMin * 0.9 } },
    ];
  },
  arc: (rng, r) => {
    const rad = rnd(rng, 1.4, Math.min(r.xMax, -r.yMin) * 0.9);
    const dir = rng.chance(0.5) ? 1 : -1;
    return [0, 1, 2, 3].map((i) => {
      const a = ((-150 + i * 40) * Math.PI) / 180;
      return { beat: i, pos: { x: dir * Math.cos(a) * rad, y: Math.sin(a) * rad * 0.9 } };
    });
  },
  double: (rng, r) => {
    const y = rnd(rng, r.yMin * 0.8, r.yMin * 0.3);
    const x = rnd(rng, 1.2, r.xMax * 0.8);
    return [
      { beat: 0, pos: { x: -x, y } },
      { beat: 0, pos: { x, y } },
      { beat: 2, pos: { x: -x * 0.9, y: y + 0.9 } },
      { beat: 2, pos: { x: x * 0.9, y: y + 0.9 } },
    ];
  },
  zigzag: (rng, r) => {
    const x = rnd(rng, 0.9, r.xMax * 0.7);
    const yHi = rnd(rng, r.yMin * 0.7, r.yMin * 0.4);
    const yLo = rnd(rng, 0, r.yMax * 0.4);
    return [
      { beat: 0, pos: { x: -x, y: yHi } },
      { beat: 1, pos: { x: -x * 0.4, y: yLo } },
      { beat: 2, pos: { x: x * 0.4, y: yHi } },
      { beat: 3, pos: { x, y: yLo } },
    ];
  },
  sweep: (rng, r) => {
    const y = rnd(rng, r.yMin * 0.5, 0.2);
    const dir = rng.chance(0.5) ? 1 : -1;
    return [0, 1, 2, 3].map((i) => ({ beat: i * 0.5, pos: { x: dir * (-1.8 + i * 1.2), y } }));
  },
};
const PHRASE_KEYS = Object.keys(PHRASES);

function sideOf(x: number): Side {
  return x < -STAGE.centreBand ? 'L' : x > STAGE.centreBand ? 'R' : 'any';
}

function clampToReach(p: Vec2, r: Reach): Vec2 {
  return { x: Math.max(r.xMin, Math.min(r.xMax, p.x)), y: Math.max(r.yMin, Math.min(r.yMax, p.y)) };
}

export function layoutSections(opts: StageOptions, durationMs: number): Section[] {
  if (!opts.structure) return [{ kind: 'intro', start: 0, end: durationMs }];
  const out: Section[] = [];
  let t = 0;
  for (const s of STAGE.sections) {
    const len = Math.round(s.len * durationMs);
    let kind = s.kind as SectionKind;
    if ((kind === 'flow' && !opts.flow) || (kind === 'wall' && !opts.wall) || (kind === 'dodge' && !opts.dodge)) kind = 'intro';
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.end = t + len;
    else out.push({ kind, start: t, end: t + len });
    t += len;
  }
  out[out.length - 1]!.end = durationMs;
  return out;
}

export function generateStage(opts: StageOptions): Stage {
  const durationMs = opts.durationMs ?? STAGE.durationMs;
  const rng = new Rng(opts.seed);
  const bpm = rng.int(STAGE.bpmMin, STAGE.bpmMax);
  const beatMs = 60000 / bpm;
  const reach: Reach = opts.seated ? STAGE.reachSeated : STAGE.reach;
  const sections = layoutSections(opts, durationMs);

  const orbs: OrbNote[] = [];
  const walls: WallNote[] = [];
  const dodges: DodgeNote[] = [];
  const flows: FlowPhase[] = [];
  let id = 1;

  const orbRng = rng.fork(1);
  const wallRng = rng.fork(2);
  const dodgeRng = rng.fork(3);
  const flowRng = rng.fork(4);

  const addOrbs = (start: number, end: number, density: number) => {
    // Phrases occupy 4 beats followed by a gap of 0-2 beats; first beat snapped to the grid.
    let beat = Math.ceil(Math.max(start, STAGE.leadInMs) / beatMs);
    const lastBeat = Math.floor((end - beatMs) / beatMs);
    let phraseIdx = 0;
    while (beat + 4 <= lastBeat) {
      const key = orbRng.pick(PHRASE_KEYS);
      const notes = PHRASES[key]!(orbRng, reach);
      for (const n of notes) {
        const t = Math.round((beat + n.beat) * beatMs);
        const tier: 0 | 1 | 2 = n.beat % 2 === 0 || density >= 1 ? 0 : orbRng.chance(0.5) ? 1 : 2;
        const pos = clampToReach(n.pos, reach);
        orbs.push({ id: id++, t, pos, side: sideOf(pos.x), tier });
      }
      phraseIdx++;
      beat += 4 + (density >= 1 ? orbRng.int(0, 1) : orbRng.int(1, 2));
    }
    return phraseIdx;
  };

  const addWalls = (start: number, end: number, spacingBeats: number) => {
    const pool = POSE_IDS.filter((p) => !opts.seated || POSES[p].seatedOk);
    let t = start + POSE.approachMs;
    let prev: PoseId | null = null;
    while (t < end - 600) {
      let pose = wallRng.pick(pool);
      // Avoid near-identical consecutive poses (boring) — retry a few times.
      for (let i = 0; i < 4 && prev && (pose === prev || poseDistance(POSES[pose], POSES[prev]) < 25); i++) pose = wallRng.pick(pool);
      walls.push({ id: id++, t: Math.round(t), pose });
      prev = pose;
      t += spacingBeats * beatMs;
    }
  };

  const addDodges = (start: number, end: number, spacingBeats: number) => {
    const kinds: DodgeKind[] = opts.seated ? ['duck', 'leanL', 'leanR'] : ['jump', 'crouch', 'leanL', 'leanR'];
    let t = start + DODGE.approachMs;
    let lastJump = -Infinity;
    while (t < end - 400) {
      let kind = dodgeRng.pick(kinds);
      if (kind === 'jump' && t - lastJump < 2 * HUMAN_LIMITS.jumpIntervalMs) kind = dodgeRng.pick(kinds.filter((k) => k !== 'jump'));
      if (kind === 'jump') lastJump = t;
      dodges.push({ id: id++, t: Math.round(t), kind });
      t += spacingBeats * beatMs;
    }
  };

  for (const s of sections) {
    switch (s.kind) {
      case 'intro':
        addOrbs(s.start, s.end, 0.8);
        break;
      case 'flow': {
        const n = 2;
        const len = (s.end - s.start) / n;
        for (let i = 0; i < n; i++) {
          const fromLeft = flowRng.chance(0.5);
          const ex = fromLeft ? -4.2 : 4.2;
          flows.push({
            id: id++,
            start: Math.round(s.start + i * len),
            end: Math.round(s.start + (i + 1) * len),
            emitter: { x: ex, y: rnd(flowRng, 0.2, 1.0) },
            emitDir: { x: fromLeft ? 1 : -1, y: 0 },
            goal: { x: (fromLeft ? 1 : -1) * rnd(flowRng, 1.4, 2.4), y: rnd(flowRng, reach.yMin * 0.9, reach.yMin * 0.5) },
          });
        }
        break;
      }
      case 'wall':
        addWalls(s.start, s.end, 8);
        break;
      case 'dodge':
        addDodges(s.start, s.end, 4);
        break;
      case 'finale':
        addOrbs(s.start, s.end, 1.0);
        if (opts.wall) addWalls(s.start + 2000, s.end, 16);
        if (opts.dodge) addDodges(s.start + 5000, s.end, 12);
        break;
    }
  }

  orbs.sort((a, b) => a.t - b.t || a.id - b.id);
  walls.sort((a, b) => a.t - b.t);
  dodges.sort((a, b) => a.t - b.t);

  const stage: Stage = { seed: opts.seed, seated: opts.seated, bpm, beatMs, durationMs, sections, orbs, walls, dodges, flows, repairs: 0 };
  return repairStage(stage);
}

/**
 * Generate a stage that passes validation. If a seed cannot be repaired into a
 * playable stage (too sparse after repair), the next seed is tried.
 */
export function generateValidStage(opts: StageOptions, maxTries = 16): Stage {
  for (let i = 0; i < maxTries; i++) {
    const s = generateStage({ ...opts, seed: (opts.seed + i * 7919) >>> 0 });
    const v = validateStage(s);
    if (v.ok && v.playable) return s;
  }
  throw new Error(`no valid stage near seed ${opts.seed}`);
}
