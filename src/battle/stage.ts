// Seeded battle stage: enemies, their weak points (techniques) and timing.
//   intro  – three "ghost hand" tutorial spirits (untimed) + a few singles
//   rush   – swarms of small spirits, two shielded ones (two techniques)
//   guard  – strikers that attack (block with 障壁), a seal-breaker
//   boss   – the Night Lord: a chain of seals → a drawn sigil → the ultimate
import { Rng } from '../core/rng';
import { allowedTechniques, TECH, type Technique, type TechniqueFilter } from './techniques';

export type EnemyKind = 'wisp' | 'warden' | 'striker' | 'breaker' | 'lord' | 'eclipse';
export type SectionKind = 'intro' | 'rush' | 'guard' | 'boss' | 'hidden';

export interface Step {
  tech: string;
  /** Expected time (ms) — null for untimed tutorial steps. */
  t: number | null;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** Appears at the horizon. */
  spawn: number;
  /** Arrives at striking distance (= first step time for timed enemies). */
  arrive: number;
  /** Untimed (tutorial) enemies leave after this time. */
  deadline: number;
  /** Final position (view coords). */
  x: number;
  y: number;
  steps: Step[];
  tutorial: boolean;
  /** Optional enemies appear only when the dynamic difficulty is high enough. */
  tier: 0 | 1;
}

export interface BattleStage {
  seed: number;
  durationMs: number;
  beatMs: number;
  sections: Array<{ kind: SectionKind; start: number; end: number }>;
  enemies: Enemy[];
  repairs: number;
  /** Technique pools (ids) available under this stage's flags — used by the hidden boss and the remnants. */
  pool: { singles: string[]; seals: string[]; sigils: string[] };
}

export interface StageOptions extends TechniqueFilter {
  seed: number;
  structure: boolean;
  durationMs?: number;
  /** Two-hand seals usable (else their one-hand alternatives are required). */
  twoHandOk: boolean;
}

export const APPROACH_MS = 2400;
export const TUTORIAL_MS = 5200;

const SECTIONS: Array<{ kind: SectionKind; len: number }> = [
  { kind: 'intro', len: 0.22 },
  { kind: 'rush', len: 0.28 },
  { kind: 'guard', len: 0.17 },
  { kind: 'boss', len: 0.33 },
];

export function generateBattle(o: StageOptions): BattleStage {
  const durationMs = o.durationMs ?? 90_000;
  const rng = new Rng(o.seed ^ 0xba771e);
  const bpm = rng.int(84, 100);
  const beatMs = 60000 / bpm;
  const allowed = allowedTechniques(o);
  const ids = new Set(allowed.map((t) => t.id));
  const pool = (pred: (t: Technique) => boolean) => allowed.filter(pred);
  const singles = pool((t) => t.req.kind === 'shape' || t.req.kind === 'motion').filter((t) => t.id !== 'heki');
  const core = pool((t) => t.tier === 0 && t.req.kind === 'shape');
  const seals = pool((t) => t.req.kind === 'seal');
  const sigils = pool((t) => t.req.kind === 'sigil');
  const sections: BattleStage['sections'] = [];
  if (o.structure) {
    let t = 0;
    for (const s of SECTIONS) {
      const len = Math.round(s.len * durationMs);
      sections.push({ kind: s.kind, start: t, end: t + len });
      t += len;
    }
    sections[sections.length - 1]!.end = durationMs;
  } else sections.push({ kind: 'intro', start: 0, end: durationMs });

  const enemies: Enemy[] = [];
  let id = 1;
  const lane = (i: number, n: number) => (n <= 1 ? 0.5 + rng.range(-0.18, 0.18) : 0.2 + (0.6 * i) / (n - 1) + rng.range(-0.04, 0.04));
  const add = (kind: EnemyKind, steps: Step[], x: number, y: number, tier: 0 | 1 = 0) => {
    const first = steps[0]!.t!;
    enemies.push({ id: id++, kind, spawn: first - APPROACH_MS, arrive: first, deadline: Infinity, x, y, steps, tutorial: false, tier });
  };
  const snap = (t: number) => Math.round(Math.round(t / beatMs) * beatMs);

  for (const s of sections) {
    if (s.kind === 'intro') {
      // Tutorial: one spirit per core technique, untimed, taught by the ghost hand.
      let t = 1200;
      const tut = core.length ? core : singles.slice(0, 3);
      if (o.structure) {
        const nTut = Math.max(1, Math.min(3, Math.floor((s.end + 2000) / (TUTORIAL_MS + 300))));
        for (const tech of tut.slice(0, nTut)) {
          enemies.push({ id: id++, kind: 'wisp', spawn: t, arrive: t + 1600, deadline: t + TUTORIAL_MS, x: 0.5, y: 0.36, steps: [{ tech: tech.id, t: null }], tutorial: true, tier: 0 });
          t += TUTORIAL_MS + 300;
        }
      }
      // Singles to finish the intro.
      t = snap(Math.max(t + APPROACH_MS, s.start + APPROACH_MS));
      while (t < s.end - beatMs) {
        const tech = rng.pick(core.length && rng.chance(0.7) ? core : singles);
        add('wisp', [{ tech: tech.id, t }], lane(0, 1), rng.range(0.3, 0.42));
        t = snap(t + beatMs * rng.int(2, 3));
      }
    } else if (s.kind === 'rush') {
      let t = snap(s.start + APPROACH_MS * 0.5);
      let wardens = 0;
      while (t < s.end - beatMs * 2) {
        if (wardens < 2 && rng.chance(0.18) && singles.length > 1) {
          // Shielded: two different techniques, 3 beats apart.
          const a = rng.pick(singles);
          let b = rng.pick(singles);
          for (let k = 0; k < 4 && b.id === a.id; k++) b = rng.pick(singles);
          add('warden', [{ tech: a.id, t }, { tech: b.id, t: snap(t + beatMs * 3) }], 0.5, 0.34);
          wardens++;
          t = snap(t + beatMs * 6);
          continue;
        }
        // A small swarm: 2–3 spirits on consecutive (≥ 2) beats across lanes.
        const n = rng.int(2, 3);
        for (let i = 0; i < n; i++) {
          const tech = rng.pick(singles);
          add('wisp', [{ tech: tech.id, t: snap(t + i * beatMs * 2) }], lane(i, n), rng.range(0.28, 0.44), i === n - 1 ? 1 : 0);
        }
        t = snap(t + beatMs * (n * 2 + 1));
      }
    } else if (s.kind === 'guard') {
      let t = snap(s.start + APPROACH_MS * 0.6);
      let breaker = false;
      while (t < s.end - beatMs * 3) {
        if (!breaker && (seals.length || ids.has('kaibyaku'))) {
          const tech = seals.length ? rng.pick(seals) : TECH.kaibyaku!;
          add('breaker', [{ tech: tech.id, t }], 0.5, 0.33);
          breaker = true;
          t = snap(t + beatMs * 4);
          continue;
        }
        // Striker: attacks first (block with 障壁), then is open to a counter.
        const counter = rng.pick(singles);
        add('striker', [{ tech: 'heki', t }, { tech: counter.id, t: snap(t + beatMs * 3) }], rng.range(0.3, 0.7), 0.36);
        t = snap(t + beatMs * 6);
      }
    } else {
      // Boss: the Night Lord. Seal chain every 4 beats, then a sigil finisher.
      const lordAt = snap(s.start + Math.min(APPROACH_MS + beatMs * 2, (s.end - s.start) * 0.3));
      const chain: Step[] = [];
      const fin = sigils.length ? rng.pick(sigils) : (TECH.saiko as Technique);
      // Fit the chain into the section: 4 beats apart when there is room, never
      // less than each technique needs (validated below).
      // The finisher also gets time to drop the previous seal before drawing.
      const finGap = fin.busyMs + 400;
      const room = s.end - 400 - lordAt - finGap;
      const n = Math.max(1, Math.min(3, Math.floor(room / 1300)));
      const gap = Math.max(1300, Math.min(beatMs * 4, room / n));
      let t = lordAt;
      const chainTechs = seals.length ? rng.shuffle([...seals]).slice(0, n) : rng.shuffle([...singles]).slice(0, n);
      for (const tech of chainTechs) {
        chain.push({ tech: tech.id, t: Math.round(t) });
        t += gap;
      }
      chain.push({ tech: fin.id, t: Math.round(t - gap + Math.max(finGap, gap)) });
      add('lord', chain, 0.5, 0.3);
      // Minions before the lord arrives and after the finisher.
      let m = snap(s.start + beatMs);
      while (m < lordAt - APPROACH_MS * 0.4) {
        add('wisp', [{ tech: rng.pick(core.length ? core : singles).id, t: m }], lane(rng.int(0, 2), 3), 0.42, 1);
        m = snap(m + beatMs * 3);
      }
      // After the finisher the session fills the remaining time itself
      // (hidden boss, then remnant waves) — see BattleSession.afterBoss.
    }
  }
  enemies.sort((a, b) => a.spawn - b.spawn || a.id - b.id);
  const poolIds = { singles: singles.map((t) => t.id), seals: seals.map((t) => t.id), sigils: sigils.map((t) => t.id) };
  return repairBattle({ seed: o.seed, durationMs, beatMs, sections, enemies, repairs: 0, pool: poolIds }, o);
}

// ───────────────────────── human-limit validation ─────────────────────────

export interface BattleViolation {
  kind: 'busy' | 'repeat' | 'overrun';
  enemy: number;
  detail: string;
}

/** Every timed step, in time order, with the time the player needs to perform it. */
export function timeline(s: BattleStage): Array<{ enemy: number; t: number; tech: string; busy: number }> {
  const out: Array<{ enemy: number; t: number; tech: string; busy: number }> = [];
  for (const e of s.enemies) {
    for (const st of e.steps) if (st.t !== null) out.push({ enemy: e.id, t: st.t, tech: st.tech, busy: TECH[st.tech]!.busyMs });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function validateBattle(s: BattleStage, o: Pick<StageOptions, 'oneHand' | 'twoHandOk'>): { ok: boolean; playable: boolean; violations: BattleViolation[] } {
  const v: BattleViolation[] = [];
  const tl = timeline(s);
  // Tutorial windows are exclusive (the player is learning).
  const tut = s.enemies.filter((e) => e.tutorial).map((e) => [e.spawn, e.deadline] as const);
  for (let i = 0; i < tl.length; i++) {
    const cur = tl[i]!;
    if (tut.some(([a, b]) => cur.t > a && cur.t < b + 400)) v.push({ kind: 'busy', enemy: cur.enemy, detail: 'during tutorial' });
    if (i > 0) {
      const prev = tl[i - 1]!;
      // The player needs `busy` ms to form/charge/release the next technique.
      if (cur.t - prev.t < cur.busy) v.push({ kind: 'busy', enemy: cur.enemy, detail: `${cur.tech} needs ${cur.busy} ms, has ${cur.t - prev.t}` });
      // Fatigue: never the same technique four times in a row.
      if (i >= 3 && tl[i - 1]!.tech === cur.tech && tl[i - 2]!.tech === cur.tech && tl[i - 3]!.tech === cur.tech) v.push({ kind: 'repeat', enemy: cur.enemy, detail: cur.tech });
    }
    if (cur.t > s.durationMs - 300) v.push({ kind: 'overrun', enemy: cur.enemy, detail: `${cur.t}` });
  }
  void o;
  const scoreable = tl.length + s.enemies.filter((e) => e.tutorial).length;
  return { ok: v.length === 0, playable: scoreable >= Math.floor((s.durationMs / 1000) * 0.25) && s.enemies.some((e) => e.kind === 'lord' || s.sections.length === 1), violations: v };
}

export function repairBattle(stage: BattleStage, o: Pick<StageOptions, 'oneHand' | 'twoHandOk'>): BattleStage {
  let s = stage;
  for (let pass = 0; pass < 30; pass++) {
    const r = validateBattle(s, o);
    if (r.ok) return s;
    // Never drop the boss: drop the other enemy in the conflict instead.
    const bad = new Set(r.violations.map((x) => x.enemy));
    const lord = s.enemies.find((e) => e.kind === 'lord');
    if (lord && bad.has(lord.id)) {
      bad.delete(lord.id);
      const tl = timeline(s);
      for (const x of r.violations.filter((y) => y.enemy === lord.id)) {
        const idx = tl.findIndex((q) => q.enemy === lord.id && x.detail.includes(q.tech));
        const prev = idx > 0 ? tl[idx - 1] : undefined;
        if (prev && prev.enemy !== lord.id) bad.add(prev.enemy);
      }
    }
    s = { ...s, enemies: s.enemies.filter((e) => !bad.has(e.id)), repairs: s.repairs + bad.size };
  }
  return s;
}

export function generateValidBattle(o: StageOptions, maxTries = 16): BattleStage {
  for (let i = 0; i < maxTries; i++) {
    const s = generateBattle({ ...o, seed: (o.seed + i * 7919) >>> 0 });
    const r = validateBattle(s, o);
    if (r.ok && r.playable) return s;
  }
  throw new Error(`no valid battle near seed ${o.seed}`);
}
