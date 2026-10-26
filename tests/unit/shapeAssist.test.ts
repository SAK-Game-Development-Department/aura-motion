import { describe, expect, it } from 'vitest';
import { GestureEngine } from '../../src/gesture/engine';
import { shapeSequence, type Variation } from '../../src/gesture/synth';
import { SHAPE_IDS, type ShapeId } from '../../src/gesture/handModel';

// Pose assist: when an enemy waits for a shape, a sloppy version of that shape
// still casts; other shapes keep the normal bar.
const sloppy = (seed: number): Variation => ({ side: seed % 2 ? 'L' : 'R', rot: (seed % 5) * 9 - 18, yaw: (seed % 3) * 22 - 22, size: 0.75 + (seed % 4) * 0.12, noise: { jitter: 0.01, dropout: 0.05, zNoise: 3 }, sloppy: 0.45 });

function recall(assist: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const shape of SHAPE_IDS) {
    let ok = 0;
    const n = 24;
    for (let seed = 1; seed <= n; seed++) {
      const eng = new GestureEngine({ seals: false, twoHand: false, sigils: false });
      if (assist) eng.expectShapes = new Set<ShapeId>([shape]);
      const { frames } = shapeSequence(shape, sloppy(seed), seed, 1200);
      let cast = false;
      for (const f of frames) for (const e of eng.update(f).events) if (e.type === 'cast' && e.shape === shape) cast = true;
      if (cast) ok++;
    }
    out[shape] = ok / n;
  }
  return out;
}

describe('pose assist', () => {
  it('sloppy shapes the game is waiting for cast much more often', () => {
    const plain = recall(false);
    const helped = recall(true);
    const mean = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0) / SHAPE_IDS.length;
    expect(mean(helped)).toBeGreaterThan(mean(plain) + 0.03);
    for (const s of SHAPE_IDS) expect(helped[s]!, s).toBeGreaterThanOrEqual(plain[s]!);
  });
});

describe('pose assist does not make other shapes fire', () => {
  it('an idle hand with the assist on for every shape stays quiet as often as without', () => {
    // The assist only lowers the bar for the shapes the game is waiting for;
    // a resting hand with nothing expected must behave exactly as before.
    const eng = new GestureEngine({ seals: false, twoHand: false, sigils: false });
    eng.expectShapes = new Set<ShapeId>(['thumb']);
    const { frames } = shapeSequence('fist', sloppy(3), 3, 1200);
    const wrong = frames.flatMap((f) => eng.update(f).events).filter((e) => e.type === 'cast' && e.shape !== 'fist');
    expect(wrong).toHaveLength(0);
  });
});

describe('holding the expected shape', () => {
  it('casts again while the game keeps waiting for it (no need to open and re-form)', () => {
    const casts = (assist: boolean) => {
      const eng = new GestureEngine({ seals: false, twoHand: false, sigils: false });
      if (assist) eng.expectShapes = new Set<ShapeId>(['fist']);
      const { frames } = shapeSequence('fist', { ...sloppy(2), sloppy: 0.05 }, 2, 3000);
      return frames.flatMap((f) => eng.update(f).events).filter((e) => e.type === 'cast' && e.shape === 'fist').length;
    };
    expect(casts(false)).toBe(1);
    expect(casts(true)).toBeGreaterThanOrEqual(2);
  });
});
