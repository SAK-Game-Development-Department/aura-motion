import { describe, expect, it } from 'vitest';
import { StageSelector } from '../../src/exhibit/stageSelect';

describe('stage selection (hold the hand over a card)', () => {
  const mk = () => new StageSelector(0, 1000, 500, [0.2, 0.5, 0.8], 0.13);

  it('selects the card held long enough, after the opening grace', () => {
    const s = mk();
    let r = s.update(0, 0.8);
    for (let t = 0; t <= 1400; t += 50) r = s.update(t, 0.8);
    expect(r.chosen).toBeNull(); // 500 ms grace + 1000 ms hold not yet done
    for (let t = 1450; t <= 1600; t += 50) r = s.update(t, 0.8);
    expect(r.chosen).toBe(2);
  });

  it('moving to another card restarts the hold; between cards nothing fills', () => {
    const s = mk();
    for (let t = 0; t <= 1200; t += 50) s.update(t, 0.2);
    let r = s.update(1250, 0.35);
    expect(r.hover).toBeNull();
    expect(r.progress).toBe(0);
    r = s.update(1300, 0.5);
    expect(r.hover).toBe(1);
    expect(r.progress).toBe(0);
    for (let t = 1350; t <= 2300; t += 50) r = s.update(t, 0.5);
    expect(r.chosen).toBe(1);
  });

  it('no hand → no progress; keys choose directly', () => {
    const s = mk();
    for (let t = 0; t <= 3000; t += 50) expect(s.update(t, null).chosen).toBeNull();
    s.choose(0);
    expect(s.update(3050, null).chosen).toBe(0);
  });
});
