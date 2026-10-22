import { describe, expect, it } from 'vitest';
import { generateValidBattle, timeline, validateBattle } from '../../src/battle/stage';
import { STAGE_IDS, STAGES } from '../../src/battle/stages';
import { BattleSession } from '../../src/battle/session';
import { battleBot } from '../../src/battle/bot';
import { TECH } from '../../src/battle/techniques';
import { GestureEngine } from '../../src/gesture/engine';
import { buildHand } from '../../src/gesture/handModel';
import { DEFAULT_FLAGS, STAGE_TUNE } from '../../src/config';

const base = { flags: DEFAULT_FLAGS, oneHand: false, coreOnly: false, structure: true, twoHandOk: true };

describe('stages by difficulty', () => {
  it('every stage generates valid, human-playable battles (90 s and the 20 s test length)', () => {
    for (const stage of STAGE_IDS) {
      for (const durationMs of [90_000, 20_000]) {
        for (let seed = 1; seed <= 25; seed++) {
          const s = generateValidBattle({ ...base, seed: seed * 131, stage, durationMs });
          expect(s.stageId).toBe(stage);
          expect(validateBattle(s, base).ok).toBe(true);
          expect(s.enemies.some((e) => e.kind === 'lord'), `${stage} ${seed}`).toBe(true);
          const tune = STAGE_TUNE[stage];
          if (tune.techniques !== 'all') for (const st of timeline(s)) expect(tune.techniques).toContain(st.tech);
        }
      }
    }
  });

  it('harder stages are denser, faster and have a longer boss chain', () => {
    const avg = (stage: (typeof STAGE_IDS)[number], f: (s: ReturnType<typeof generateValidBattle>) => number) => {
      let sum = 0;
      for (let seed = 1; seed <= 12; seed++) sum += f(generateValidBattle({ ...base, seed, stage }));
      return sum / 12;
    };
    const steps = (s: ReturnType<typeof generateValidBattle>) => timeline(s).length;
    const chain = (s: ReturnType<typeof generateValidBattle>) => s.enemies.find((e) => e.kind === 'lord')!.steps.length;
    expect(avg('easy', steps)).toBeLessThan(avg('normal', steps));
    expect(avg('normal', steps)).toBeLessThan(avg('hard', steps));
    expect(avg('easy', chain)).toBeLessThan(avg('hard', chain));
    expect(generateValidBattle({ ...base, seed: 3, stage: 'hard' }).approachMs).toBeLessThan(generateValidBattle({ ...base, seed: 3, stage: 'easy' }).approachMs);
  });

  it('easy uses only the gentle techniques; hard uses sigils and many seals', () => {
    const used = (stage: (typeof STAGE_IDS)[number]) => {
      const set = new Set<string>();
      for (let seed = 1; seed <= 20; seed++) for (const st of timeline(generateValidBattle({ ...base, seed, stage }))) set.add(st.tech);
      return set;
    };
    for (const t of used('easy')) expect(['shape', 'motion', 'seal', 'sigil', 'spread']).toContain(TECH[t]!.req.kind);
    expect([...used('easy')].filter((t) => TECH[t]!.req.kind === 'sigil')).toEqual(['enjin']);
    expect([...used('hard')].filter((t) => TECH[t]!.req.kind === 'seal').length).toBeGreaterThanOrEqual(4);
  });

  it('the autoplay bot clears every stage with the boss ultimate', () => {
    for (const stage of STAGE_IDS) {
      for (const seed of [2, 5]) {
        const st = generateValidBattle({ ...base, seed, stage });
        const engine = new GestureEngine({ seals: true, twoHand: true });
        const session = new BattleSession({ stage: st, dda: false, oneHand: false, twoHandOk: true });
        const bot = battleBot(st, { playStart: 0, session });
        for (let t = 0; t <= st.durationMs + 1500; t += 1000 / 30) {
          session.update(t);
          const g = engine.update({ t, poses: [], aspect: 16 / 9, hands: bot(t).map((h) => ({ lm: buildHand(h), score: 0.97 })) });
          for (const e of g.events) session.pushEvent(t, e);
        }
        const c = session.score.counts;
        const acc = (c.perfect + c.good) / Math.max(1, c.perfect + c.good + c.miss);
        expect(acc, `${stage} ${seed}`).toBeGreaterThan(0.9);
        expect(session.ultimates, `${stage} ${seed}`).toBeGreaterThanOrEqual(1);
      }
    }
  }, 120_000);

  it('every stage has its own name, boss, look and backgrounds', () => {
    const names = new Set(STAGE_IDS.map((s) => STAGES[s].name));
    const bosses = new Set(STAGE_IDS.map((s) => STAGES[s].boss.name));
    const styles = new Set(STAGE_IDS.map((s) => STAGES[s].style));
    expect(names.size).toBe(3);
    expect(bosses.size).toBe(3);
    expect(styles.size).toBe(3);
  });
});
