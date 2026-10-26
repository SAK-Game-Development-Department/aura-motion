import { describe, expect, it } from 'vitest';
import { generateValidBattle } from '../../src/battle/stage';
import { BattleSession } from '../../src/battle/session';
import { battleBot } from '../../src/battle/bot';
import { GestureEngine } from '../../src/gesture/engine';
import { buildHand } from '../../src/gesture/handModel';
import { DEFAULT_FLAGS } from '../../src/config/flags';
import { accuracy, newScore, rankOf } from '../../src/game/score';

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

  it('a late player behind a laggy camera still clears B (steps stay open for the charge and the lag)', () => {
    for (const stage of ['yoi', 'hoshi', 'gesshoku'] as const) {
      const st = generateValidBattle({ seed: 4, flags: DEFAULT_FLAGS, oneHand: false, coreOnly: false, structure: true, twoHandOk: true, stage });
      const engine = new GestureEngine({ seals: true, twoHand: true });
      const session = new BattleSession({ stage: st, dda: false, oneHand: false, twoHandOk: true });
      // 150 ms later than at the ring, seen through a camera 150 ms behind.
      const bot = battleBot(st, { playStart: 0, session, offsetMs: 450 });
      const lagMs = 150;
      const seen: Array<{ t: number; hands: ReturnType<typeof bot> }> = [];
      for (let t = 0; t <= st.durationMs + 1500; t += 1000 / 30) {
        session.update(t);
        engine.expectSeals = session.expectedSeals(t);
        seen.push({ t, hands: bot(t) });
        while (seen.length > 1 && seen[0]!.t < t - lagMs) seen.shift();
        const g = engine.update({ t, poses: [], aspect: 16 / 9, hands: seen[0]!.hands.map((h) => ({ lm: buildHand(h), score: 0.97 })) });
        for (const e of g.events) session.pushEvent(t, e);
      }
      expect(['S', 'A', 'B'], stage).toContain(rankOf(session.score));
    }
  }, 60_000);
});

describe('rank', () => {
  it('S, A, B, C, D by weighted accuracy (the same for every stage)', () => {
    const at = (perfect: number, good: number, miss: number) => {
      const s = newScore();
      s.counts = { perfect, good, miss };
      return rankOf(s);
    };
    expect(at(10, 0, 0)).toBe('S');
    expect(at(5, 3, 2)).toBe('A'); // (5 + 2.25) / 10
    expect(at(4, 1, 5)).toBe('B'); // (4 + 0.75) / 10
    expect(at(3, 1, 6)).toBe('C'); // (3 + 0.75) / 10
    expect(at(2, 1, 7)).toBe('D'); // (2 + 0.75) / 10
    expect(at(0, 0, 0)).toBe('D');
  });
});
