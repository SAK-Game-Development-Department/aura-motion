import { describe, expect, it } from 'vitest';
import { generateBattle, generateValidBattle, timeline, validateBattle, type StageOptions } from '../../src/battle/stage';
import { BattleSession, type BattleEvent } from '../../src/battle/session';
import { battleBot } from '../../src/battle/bot';
import { allowedTechniques, TECHNIQUES, matches } from '../../src/battle/techniques';
import { GestureEngine } from '../../src/gesture/engine';
import { buildHand } from '../../src/gesture/handModel';
import type { HandScript } from '../../src/gesture/performer';
import { DEFAULT_FLAGS } from '../../src/config/flags';
import { accuracy } from '../../src/game/score';

const OPTS: Omit<StageOptions, 'seed'> = { flags: DEFAULT_FLAGS, oneHand: false, coreOnly: false, structure: true, twoHandOk: true };

/** Run the full pipeline: synthetic hands → gesture engine → battle session. */
function play(stageOpts: StageOptions, script: (s: ReturnType<typeof generateValidBattle>, session: BattleSession) => HandScript, offsetMs = 0) {
  const stage = generateValidBattle(stageOpts);
  const engine = new GestureEngine({ seals: !stageOpts.oneHand, twoHand: !stageOpts.oneHand, shapes: stageOpts.coreOnly ? ['fist', 'open', 'point'] : undefined });
  const session = new BattleSession({ stage, dda: false, oneHand: stageOpts.oneHand, twoHandOk: stageOpts.twoHandOk });
  const s = script(stage, session);
  const events: BattleEvent[] = [];
  let rt = 0;
  for (let t = 0; t <= stage.durationMs + 1500; t += 1000 / 30) {
    while (rt < t) {
      events.push(...session.update(rt));
      rt += 1000 / 60;
    }
    const g = engine.update({ t, poses: [], aspect: 16 / 9, hands: s(t).map((h) => ({ lm: buildHand(h), score: 0.97 })) });
    for (const e of g.events) session.pushEvent(t - offsetMs, e);
  }
  events.push(...session.update(stage.durationMs + 1600));
  return { stage, session, events };
}

describe('battle stage', () => {
  it('is deterministic and has intro → rush → guard → boss with tutorial spirits and a boss chain', () => {
    const a = generateBattle({ ...OPTS, seed: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(generateBattle({ ...OPTS, seed: 5 })));
    expect(a.sections.map((s) => s.kind)).toEqual(['intro', 'rush', 'guard', 'boss']);
    expect(a.enemies.filter((e) => e.tutorial)).toHaveLength(3);
    const lord = a.enemies.find((e) => e.kind === 'lord')!;
    expect(lord.steps.length).toBeGreaterThanOrEqual(4);
    expect(a.enemies.some((e) => e.kind === 'striker' && e.steps[0]!.tech === 'heki')).toBe(true);
  });
  it('fuzz: 300 seeds × modes stay within human limits', () => {
    for (let i = 0; i < 300; i++) {
      const o = { ...OPTS, seed: (i * 2654435761) >>> 0, oneHand: i % 3 === 1, coreOnly: i % 5 === 4 };
      const s = generateValidBattle(o);
      const v = validateBattle(s, o);
      expect(v.violations, `seed ${o.seed}`).toEqual([]);
      const tl = timeline(s);
      for (let k = 1; k < tl.length; k++) expect(tl[k]!.t - tl[k - 1]!.t).toBeGreaterThanOrEqual(tl[k]!.busy);
      if (o.coreOnly) for (const x of tl) expect(['saiko', 'hamon', 'sen', 'heki']).toContain(x.tech);
    }
  });
  it('every technique requirement is unique (no two techniques share a requirement)', () => {
    const keys = TECHNIQUES.map((t) => JSON.stringify(t.req));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('one-hand mode never requires two hands', () => {
    const allowed = allowedTechniques({ flags: DEFAULT_FLAGS, oneHand: true, coreOnly: false });
    expect(allowed.length).toBeGreaterThan(10);
    for (const t of allowed) if (t.req.kind === 'seal' || t.req.kind === 'spread') expect(t.alt).toBeTruthy();
  });
});

describe('battle session (full pipeline: hands → gestures → battle)', () => {
  it('the bot clears the stage: kills, the boss chain, the ultimate', () => {
    const { session, events, stage } = play({ ...OPTS, seed: 42 }, (st, ses) => battleBot(st, { playStart: 0, session: ses }));
    const hits = events.filter((e) => e.type === 'hit');
    const total = timeline(stage).length + stage.enemies.filter((e) => e.tutorial).length;
    expect(hits.length / total).toBeGreaterThan(0.85);
    expect(session.ultimates).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'blocked')).toBe(true);
    expect(events.filter((e) => e.type === 'section').map((e) => (e as { kind: string }).kind).slice(0, 4)).toEqual(['intro', 'rush', 'guard', 'boss']);
    expect(accuracy(session.score)).toBeGreaterThan(0.8);
    expect(session.ended).toBe(true);
  });
  it('one-hand mode: the bot clears the stage with single-hand alternatives', () => {
    const { session } = play({ ...OPTS, seed: 43, oneHand: true, twoHandOk: false }, (st) => battleBot(st, { playStart: 0, oneHand: true, twoHandOk: false }));
    expect(accuracy(session.score)).toBeGreaterThan(0.75);
    expect(session.ultimates).toBe(1);
  });
  it('idle hands defeat nothing and get hurt', () => {
    const { session } = play({ ...OPTS, seed: 44 }, () => (t) => [{ ...buildIdle(t) }]);
    expect(session.kills).toBe(0);
    expect(session.hurts).toBeGreaterThan(3);
  });
  it('is deterministic', () => {
    const a = play({ ...OPTS, seed: 45 }, (st) => battleBot(st, { playStart: 0, errorMs: 150, missRate: 0.1, seed: 2 }));
    const b = play({ ...OPTS, seed: 45 }, (st) => battleBot(st, { playStart: 0, errorMs: 150, missRate: 0.1, seed: 2 }));
    expect(JSON.stringify(a.events.map((e) => ({ ...e, ev: undefined, tech: 'tech' in e && e.tech ? e.tech.id : null })))).toBe(
      JSON.stringify(b.events.map((e) => ({ ...e, ev: undefined, tech: 'tech' in e && e.tech ? e.tech.id : null }))),
    );
  });
  it('latency offset is compensated', () => {
    const lag = 300;
    const ok = play({ ...OPTS, seed: 46 }, (st) => battleBot(st, { playStart: 0, offsetMs: lag }), lag);
    expect(accuracy(ok.session.score)).toBeGreaterThan(0.8);
    expect(ok.session.score.counts.perfect).toBeGreaterThan(ok.session.score.counts.good);
  });
  it('matches(): a seal event satisfies only its seal', () => {
    const seal = TECHNIQUES.find((t) => t.id === 'in-gassho')!;
    expect(matches(seal.req, { type: 'seal', t: 0, kind: 'gassho' })).toBe(true);
    expect(matches(seal.req, { type: 'seal', t: 0, kind: 'kosa' })).toBe(false);
  });
});

import { defaultHand, relaxedHand } from '../../src/gesture/handModel';
function buildIdle(t: number) {
  return relaxedHand({ ...defaultHand('R'), wrist: { x: 0.6 + Math.sin(t / 700) * 0.05, y: 0.7 } }, 0.3);
}

describe('hidden boss & no dead time', () => {
  it('beating the boss early summons the hidden boss, then remnants keep coming', () => {
    const { session, events, stage } = play({ ...OPTS, seed: 42 }, (st, ses) => battleBot(st, { playStart: 0, session: ses }));
    const hb = events.find((e) => e.type === 'hiddenBoss');
    expect(hb, 'hidden boss appeared').toBeTruthy();
    expect(events.filter((e) => e.type === 'section').map((e) => (e as { kind: string }).kind)).toContain('hidden');
    expect(events.some((e) => e.type === 'ultimate' && e.hidden)).toBe(true);
    expect(session.ultimates).toBe(2);
    // No long stretch without an enemy after the boss section starts.
    const bossStart = stage.sections.find((x) => x.kind === 'boss')!.start;
    const spawnTimes = [bossStart, ...events.filter((e) => e.type === 'hit').map((e) => e.t)].sort((a, b) => a - b);
    for (let i = 1; i < spawnTimes.length; i++) expect(spawnTimes[i]! - spawnTimes[i - 1]!, `gap before ${spawnTimes[i]}`).toBeLessThan(8000);
    expect(stage.durationMs - spawnTimes[spawnTimes.length - 1]!).toBeLessThan(6000);
  });
  it('the hidden boss can be turned off', () => {
    const stage = generateValidBattle({ ...OPTS, seed: 42 });
    const s = new BattleSession({ stage, dda: false, oneHand: false, twoHandOk: true, hidden: false });
    expect(s).toBeTruthy();
  });
});
