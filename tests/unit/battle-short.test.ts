import { it, expect } from 'vitest';
import { generateValidBattle } from '../../src/battle/stage';
import { DEFAULT_FLAGS } from '../../src/config/flags';
it('short (fast-mode, 20 s) stages still have a boss', () => {
  for (let i = 0; i < 50; i++) {
    const s = generateValidBattle({ seed: i * 977, flags: DEFAULT_FLAGS, oneHand: i % 2 === 0, coreOnly: false, structure: true, twoHandOk: i % 2 === 1, durationMs: 20000 });
    expect(s.enemies.find((e) => e.kind === 'lord'), `seed ${i}`).toBeTruthy();
  }
});
