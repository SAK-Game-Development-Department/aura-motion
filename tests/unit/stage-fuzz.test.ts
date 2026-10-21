// Property-based check over many seeds: every generated stage is within human
// limits (validator) and playable. `npm run fuzz` runs 10,000 seeds.
import { describe, expect, it } from 'vitest';
import { HUMAN_LIMITS } from '../../src/config';
import { generateValidStage } from '../../src/stage/generator';
import { assignHands, validateStage } from '../../src/stage/validator';

const N = Number(process.env.FUZZ_SEEDS ?? 500);

describe(`stage fuzz (${N} seeds × standing/seated × feature mixes)`, () => {
  it('all stages valid and playable; independent re-check of limits', () => {
    let repairs = 0;
    let discarded = 0;
    const mixes = [
      { flow: true, wall: true, dodge: true, structure: true },
      { flow: false, wall: true, dodge: false, structure: true },
      { flow: false, wall: false, dodge: false, structure: false },
    ];
    for (let i = 0; i < N; i++) {
      const seed = (i * 2654435761) >>> 0;
      const mix = mixes[i % mixes.length]!;
      const seated = i % 4 === 3;
      const s = generateValidStage({ seed, seated, ...mix });
      if (s.seed !== seed) discarded++;
      repairs += s.repairs;
      const v = validateStage(s);
      expect(v.violations, `seed ${seed}`).toEqual([]);
      expect(v.playable).toBe(true);
      // Independent re-check of the most important property: hand speed.
      const hands = assignHands(s.orbs);
      const last: Record<string, { t: number; x: number; y: number }> = {};
      for (const o of s.orbs) {
        const h = hands.get(o.id)!;
        const p = last[h];
        if (p) expect(o.t - p.t).toBeGreaterThanOrEqual(HUMAN_LIMITS.sameHandMinMs);
        last[h] = { t: o.t, x: o.pos.x, y: o.pos.y };
      }
      for (let k = 1; k < s.walls.length; k++) expect(s.walls[k]!.t - s.walls[k - 1]!.t).toBeGreaterThanOrEqual(HUMAN_LIMITS.poseTransitionMs);
    }
    // Report (visible with --reporter verbose).
    console.log(`fuzz: ${N} seeds, ${discarded} discarded, ${repairs} notes repaired (avg ${(repairs / N).toFixed(2)})`);
    expect(discarded / N).toBeLessThan(0.05);
  });
});
