import { describe, expect, it } from 'vitest';
import { generateValidBattle } from '../../src/battle/stage';
import { BattleSession } from '../../src/battle/session';
import { battleBot } from '../../src/battle/bot';
import { GestureEngine } from '../../src/gesture/engine';
import { buildHand } from '../../src/gesture/handModel';
import { DEFAULT_FLAGS } from '../../src/config/flags';
import { accuracy, rankOf } from '../../src/game/score';

// A person forms the shape when the timing ring closes — later than the bot,
// which starts early on purpose. The cast completes after the charge, but the
// move must still count (regression: real plays were almost all rank C).
describe('human timing', () => {
  it('forming the shape as the ring closes still hits (judged from the forming, not the charge end)', () => {
    for (const stage of ['yoi', 'hoshi'] as const) {
      const st = generateValidBattle({ seed: 4, flags: DEFAULT_FLAGS, oneHand: false, coreOnly: false, structure: true, twoHandOk: true, stage });
      const engine = new GestureEngine({ seals: true, twoHand: true });
      const session = new BattleSession({ stage: st, dda: false, oneHand: false, twoHandOk: true });
      // 300 ms later than the bot's own timing ≈ forming the shape right at the ring.
      const bot = battleBot(st, { playStart: 0, session, offsetMs: 300 });
      for (let t = 0; t <= st.durationMs + 1500; t += 1000 / 30) {
        session.update(t);
        engine.expectSeals = session.expectedSeals(t);
        const g = engine.update({ t, poses: [], aspect: 16 / 9, hands: bot(t).map((h) => ({ lm: buildHand(h), score: 0.97 })) });
        for (const e of g.events) session.pushEvent(t, e);
      }
      expect(accuracy(session.score), stage).toBeGreaterThan(0.75);
      expect(['S', 'A'], stage).toContain(rankOf(session.score));
    }
  }, 60_000);
});
