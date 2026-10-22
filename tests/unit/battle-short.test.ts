import { it, expect } from 'vitest';
import { generateValidBattle } from '../../src/battle/stage';
import { BattleSession } from '../../src/battle/session';
import { battleBot } from '../../src/battle/bot';
import { GestureEngine } from '../../src/gesture/engine';
import { buildHand } from '../../src/gesture/handModel';
import { DEFAULT_FLAGS } from '../../src/config/flags';
import { Rng } from '../../src/core/rng';

it('short (fast-mode, 20 s) stages still have a boss', () => {
  for (let i = 0; i < 50; i++) {
    const s = generateValidBattle({ seed: i * 977, flags: DEFAULT_FLAGS, oneHand: i % 2 === 0, coreOnly: false, structure: true, twoHandOk: i % 2 === 1, durationMs: 20000 });
    expect(s.enemies.find((e) => e.kind === 'lord'), `seed ${i}`).toBeTruthy();
  }
});

// The E2E loop runs these stages: the bot must land the boss chain (seal → sigil
// finisher) at uneven frame rates (regression: the sigil stroke included the
// hand's approach from the seal and missed).
it('the bot seals the boss in short stages at uneven frame rates', () => {
  for (const fps of [30, 60]) {
    for (let seed = 1; seed <= 12; seed++) {
      const stage = generateValidBattle({ seed, flags: DEFAULT_FLAGS, oneHand: false, coreOnly: false, structure: true, twoHandOk: true, durationMs: 20000 });
      const engine = new GestureEngine({ seals: true, twoHand: true });
      const session = new BattleSession({ stage, dda: false, oneHand: false, twoHandOk: true });
      const s = battleBot(stage, { playStart: 0, session });
      const rng = new Rng(seed);
      for (let t = 0; t <= stage.durationMs + 1500; t += (1000 / fps) * (0.7 + rng.next() * 0.6)) {
        session.update(t);
        const g = engine.update({ t, poses: [], aspect: 16 / 9, hands: s(t).map((h) => ({ lm: buildHand(h), score: 0.97 })) });
        for (const e of g.events) session.pushEvent(t, e);
      }
      expect(session.ultimates, `seed ${seed} @ ${fps} fps`).toBeGreaterThanOrEqual(1);
    }
  }
}, 60_000);
