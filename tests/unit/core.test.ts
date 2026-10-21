import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../../src/core/rng';
import { OneEuro } from '../../src/core/oneEuro';
import { Ring, median } from '../../src/core/math';
import { parseFlags, DEFAULT_FLAGS } from '../../src/config/flags';

describe('Rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(sa);
    for (const x of sa) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(1);
  });
  it('fork streams are independent but deterministic', () => {
    expect(new Rng(1).fork(5).next()).toBe(new Rng(1).fork(5).next());
    expect(new Rng(1).fork(5).next()).not.toBe(new Rng(1).fork(6).next());
  });
  it('seedFromString is stable', () => {
    expect(seedFromString('aura')).toBe(seedFromString('aura'));
  });
});

describe('OneEuro', () => {
  it('smooths jitter while tracking a step quickly', () => {
    const f = new OneEuro({ minCutoff: 1.6, beta: 18, dCutoff: 1 });
    const rng = new Rng(1);
    let rawSq = 0;
    let filtSq = 0;
    for (let i = 0; i < 60; i++) {
      const raw = 0.5 + rng.range(-0.01, 0.01);
      const v = f.filter(raw, i * 33);
      if (i > 10) {
        rawSq += (raw - 0.5) ** 2;
        filtSq += (v - 0.5) ** 2;
      }
    }
    expect(Math.sqrt(filtSq / rawSq)).toBeLessThan(0.6);
    // Step to 0.8: should be within 0.03 after 5 frames (~165ms).
    let v = 0;
    for (let i = 60; i < 65; i++) v = f.filter(0.8, i * 33);
    expect(Math.abs(v - 0.8)).toBeLessThan(0.03);
  });
});

describe('utils', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('ring buffer keeps capacity', () => {
    const r = new Ring<number>(3);
    for (let i = 0; i < 10; i++) r.push(i);
    expect(r.toArray()).toEqual([7, 8, 9]);
    expect(r.last()).toBe(9);
  });
  it('parseFlags toggles', () => {
    const f = parseFlags('-particles,+qr,bogus');
    expect(f.particles).toBe(false);
    expect(f.qr).toBe(true);
    expect(f.wall).toBe(DEFAULT_FLAGS.wall);
  });
});
