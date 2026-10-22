// Battle judgement & scoring. "手応え" lives here — tweak and playtest.
export const JUDGE = {
  /** Timing window around an enemy's opening (ms). */
  perfectMs: 160,
  goodMs: 380,
  /** Window multiplier when tracking is unstable (dark room etc.). */
  unstableWindowScale: 1.5,
  scorePerfect: 300,
  scoreGood: 120,
  /** Combo multiplier: 1 + floor(combo / step) * add, capped. */
  comboStep: 8,
  comboAdd: 0.1,
  comboMaxMul: 2.0,
} as const;

export const DIFFICULTY = {
  window: 10,
  min: 0.7,
  max: 1.3,
  start: 1.0,
  targetMissRate: 0.2,
  rate: 0.06,
} as const;
