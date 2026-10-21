import { describe, expect, it } from 'vitest';
import { generateStage, generateValidStage, layoutSections } from '../../src/stage/generator';
import { validateStage } from '../../src/stage/validator';
import type { StageOptions } from '../../src/stage/types';

const ALL: Omit<StageOptions, 'seed'> = { seated: false, flow: true, wall: true, dodge: true, structure: true };

describe('stage generator', () => {
  it('same seed → identical stage', () => {
    const a = generateStage({ ...ALL, seed: 1234 });
    const b = generateStage({ ...ALL, seed: 1234 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('different seeds → different stages', () => {
    const a = generateStage({ ...ALL, seed: 1 });
    const b = generateStage({ ...ALL, seed: 2 });
    expect(JSON.stringify(a.orbs)).not.toBe(JSON.stringify(b.orbs));
  });
  it('has the Intro→Flow→Wall→Dodge→Finale structure', () => {
    const s = generateStage({ ...ALL, seed: 9 });
    expect(s.sections.map((x) => x.kind)).toEqual(['intro', 'flow', 'wall', 'dodge', 'finale']);
    expect(s.sections[0]!.start).toBe(0);
    expect(s.sections[s.sections.length - 1]!.end).toBe(s.durationMs);
    expect(s.walls.length).toBeGreaterThan(2);
    expect(s.dodges.length).toBeGreaterThan(2);
    expect(s.flows.length).toBe(2);
  });
  it('Tier 0 (structure off) is orbs only', () => {
    const s = generateStage({ ...ALL, structure: false, seed: 9 });
    expect(s.sections).toEqual([{ kind: 'intro', start: 0, end: s.durationMs }]);
    expect(s.walls.length + s.dodges.length + s.flows.length).toBe(0);
    expect(s.orbs.length).toBeGreaterThan(60);
  });
  it('disabled features collapse into orb sections', () => {
    const secs = layoutSections({ ...ALL, seed: 0, wall: false, flow: false }, 90000);
    expect(secs.map((s) => s.kind)).toEqual(['intro', 'dodge', 'finale']);
  });
  it('seated stages contain no jumps/crouches and no leg poses', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = generateValidStage({ ...ALL, seated: true, seed });
      expect(s.dodges.some((d) => d.kind === 'jump' || d.kind === 'crouch')).toBe(false);
      expect(s.walls.some((w) => w.pose === 'star')).toBe(false);
    }
  });
  it('output always validates (repair pass)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = generateStage({ ...ALL, seed });
      expect(validateStage(s).violations).toEqual([]);
    }
  });
});
