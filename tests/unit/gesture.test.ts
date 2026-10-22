// Gesture recognition: unit behaviour + synthetic-data quality gates.
// (Synthetic data only — real-hand accuracy is measured in the gesture lab.)
import { describe, expect, it } from 'vitest';
import { buildHand, defaultHand, SHAPE_IDS, withShape, relaxedHand, CORE_SHAPES } from '../../src/gesture/handModel';
import { features, normalize, defaultThresholds } from '../../src/gesture/features';
import { RuleClassifier, ShapeStabilizer, KnnClassifier } from '../../src/gesture/shapes';
import { GestureEngine } from '../../src/gesture/engine';
import { GestureCalibrator } from '../../src/gesture/calibrate';
import { recognizeSigil, sigilPath, SIGIL_IDS } from '../../src/gesture/sigil';
import { evalShapes, evalIdle, evalMotions, evalTwoHand, evalSigils, shapeSeparation, runFrames } from '../../src/gesture/eval';
import { shapeSequence } from '../../src/gesture/synth';
import { featureVector } from '../../src/gesture/features';

describe('normalisation', () => {
  it('is invariant to position, scale, in-plane rotation and left/right', () => {
    const ref = features(normalize(buildHand(withShape(defaultHand('R'), 'two')), 16 / 9));
    for (const side of ['L', 'R'] as const)
      for (const rot of [-40, 0, 30])
        for (const size of [0.08, 0.3]) {
          const f = features(normalize(buildHand(withShape({ ...defaultHand(side), rot, size, wrist: { x: 0.3, y: 0.6 } }, 'two')), 16 / 9));
          f.bend.forEach((b, i) => expect(Math.abs(b - ref.bend[i]!)).toBeLessThan(2));
          expect(Math.abs(f.thumbOut - ref.thumbOut)).toBeLessThan(0.03);
        }
  });
});

describe('shape classification', () => {
  const c = new RuleClassifier();
  it('every canonical shape wins with a clear margin', () => {
    for (const s of SHAPE_IDS) {
      const sc = c.classify(features(normalize(buildHand(withShape(defaultHand('R'), s)), 16 / 9)), defaultThresholds(), SHAPE_IDS);
      const sorted = Object.entries(sc).sort((a, b) => b[1]! - a[1]!);
      expect(sorted[0]![0], s).toBe(s);
      expect(sorted[0]![1]! - sorted[1]![1]!, `${s} margin`).toBeGreaterThan(0.2);
    }
  });
  it('relaxed, natural hands are not recognised as any shape', () => {
    for (const k of [0, 0.25, 0.5, 0.75]) {
      const sc = c.classify(features(normalize(buildHand(relaxedHand(defaultHand('R'), k)), 16 / 9)), defaultThresholds(), SHAPE_IDS);
      expect(Math.max(...Object.values(sc).map(Number)), `relaxed ${k}`).toBeLessThan(0.68);
    }
  });
  it('feature separation: no two shapes are too close (warns on confusable pairs)', () => {
    const sep = shapeSeparation();
    expect(sep[0]!.d, `closest pair ${sep[0]!.a}/${sep[0]!.b}`).toBeGreaterThan(0.5);
  });
  it('stabilizer needs N frames to switch and holds through small dips (hysteresis)', () => {
    const st = new ShapeStabilizer();
    expect(st.update({ fist: 0.9, open: 0.1 }).shape).toBeNull();
    expect(st.update({ fist: 0.9, open: 0.1 }).shape).toBe('fist');
    expect(st.update({ fist: 0.55, open: 0.1 }).shape).toBe('fist'); // above exit threshold
    expect(st.update({ fist: 0.3, open: 0.1 }).shape).toBeNull();
  });
  it('kNN classifier works from samples', () => {
    const samples = SHAPE_IDS.flatMap((s) =>
      [-20, 0, 20].map((rot) => ({ label: s, vec: featureVector(features(normalize(buildHand(withShape({ ...defaultHand('R'), rot }, s)), 16 / 9))) })),
    );
    const knn = new KnnClassifier(samples, 3);
    for (const s of SHAPE_IDS) {
      const sc = knn.classify(features(normalize(buildHand(withShape({ ...defaultHand('L'), rot: 10 }, s)), 16 / 9)), defaultThresholds(), SHAPE_IDS);
      const best = Object.entries(sc).sort((a, b) => b[1]! - a[1]!)[0]![0];
      expect(best, s).toBe(s);
    }
  });
});

describe('state machine', () => {
  it('stance → (charge) → static cast once; re-making the shape casts again', () => {
    const eng = new GestureEngine({ motions: false, sigils: false, twoHand: false });
    const seq = shapeSequence('fist', { side: 'R', rot: 0, yaw: 0, size: 0.15, noise: { jitter: 0.003, dropout: 0, zNoise: 2 }, sloppy: 0 }, 1, 1200);
    const ev = runFrames(eng, seq.frames);
    const types = ev.filter((e) => e.type === 'stance' || e.type === 'cast').map((e) => e.type);
    expect(types).toEqual(['stance', 'cast']);
    const cast = ev.find((e) => e.type === 'cast')!;
    const stance = ev.find((e) => e.type === 'stance')!;
    expect(cast.t - stance.t).toBeGreaterThanOrEqual(370);
  });
  it('core-shape mode only knows fist / open / point', () => {
    const eng = new GestureEngine({ shapes: CORE_SHAPES, motions: false, sigils: false, twoHand: false });
    const seq = shapeSequence('two', { side: 'R', rot: 0, yaw: 0, size: 0.15, noise: { jitter: 0.003, dropout: 0, zNoise: 2 }, sloppy: 0 }, 2);
    const ev = runFrames(eng, seq.frames);
    for (const e of ev) if (e.type === 'stance') expect(CORE_SHAPES).toContain(e.shape);
  });
});

describe('sigils', () => {
  it('recognises every ideal sigil in both directions', () => {
    for (const k of SIGIL_IDS) for (const d of [1, -1] as const) expect(recognizeSigil(sigilPath(k, d))!.kind).toBe(k);
  });
});

describe('calibration', () => {
  it('fits thresholds between the player\'s own open and fist', () => {
    const cal = new GestureCalibrator();
    for (let i = 0; i < 10; i++) {
      cal.add('open', features(normalize(buildHand(withShape(defaultHand('R'), 'open')), 16 / 9)));
      // A stiff hand: the "fist" only reaches 70 % curl.
      cal.add('fist', features(normalize(buildHand({ ...defaultHand('R'), curl: [0.8, 0.7, 0.7, 0.7, 0.7] }), 16 / 9)));
    }
    const { thresholds, ok } = cal.result();
    expect(ok).toBe(true);
    expect(thresholds.bendHi[0]).toBeLessThan(defaultThresholds().bendHi[0]);
    // With the calibrated thresholds the stiff fist is recognised.
    const c = new RuleClassifier();
    const sc = c.classify(features(normalize(buildHand({ ...defaultHand('R'), curl: [0.8, 0.7, 0.7, 0.7, 0.7] }), 16 / 9)), thresholds, SHAPE_IDS);
    expect(Object.entries(sc).sort((a, b) => b[1]! - a[1]!)[0]![0]).toBe('fist');
  });
});

describe('quality gates on synthetic data (quick grid)', () => {
  it('static shapes: recall ≥ 95 %, misrecognition ≤ 3 %', () => {
    const r = evalShapes('quick');
    for (const s of SHAPE_IDS) {
      expect(r.recall[s], `${s} recall`).toBeGreaterThanOrEqual(0.95);
      expect(r.confusionRate[s], `${s} confusion`).toBeLessThanOrEqual(0.03);
    }
  });
  it('natural idle movement: ≤ 1 false cast per 30 s', () => {
    expect(evalIdle(4, [11, 12, 13, 14]).castsPer30s).toBeLessThanOrEqual(1);
  });
  it('motions, sigils, two-hand: recall ≥ 85 %', () => {
    const m = evalMotions('quick');
    for (const [k, v] of Object.entries(m.recall)) expect(v, k).toBeGreaterThanOrEqual(0.85);
    const s = evalSigils('quick');
    for (const [k, v] of Object.entries(s.recall)) expect(v, k).toBeGreaterThanOrEqual(0.85);
    expect(evalTwoHand('quick')).toBeGreaterThanOrEqual(0.9);
  });
});
