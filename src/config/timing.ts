// Judgement & latency tuning. "叩き心地" lives here — tweak and playtest.
export const JUDGE = {
  /** |dt| (ms) for Perfect. */
  perfectMs: 90,
  /** |dt| (ms) for Good. Beyond this the orb is a Miss. */
  goodMs: 200,
  /** Window multiplier when tracking is unstable (dark room etc.). */
  unstableWindowScale: 1.5,
  /** Hand collision radius in body units (shoulder widths). */
  handRadius: 0.32,
  /** Orb radius in body units. */
  orbRadius: 0.38,
  /** Extra radius scale for the seated / child mode. */
  seatedRadiusScale: 1.15,
  /** Approach (ring shrink) duration in ms at difficulty 1.0. */
  approachMs: 1400,
  /** If false, either hand may touch any orb (colour is only a hint). Kinder for kids. */
  strictHands: false,
  /** Score per judgement. */
  scorePerfect: 300,
  scoreGood: 100,
  /** Combo multiplier: 1 + floor(combo / step) * add, capped. */
  comboStep: 10,
  comboAdd: 0.1,
  comboMaxMul: 2.0,
} as const;

export const LATENCY = {
  /** Default system latency (capture -> judgement) offset before calibration, ms. */
  defaultOffsetMs: 60,
  /** Clamp for calibrated offset. */
  minOffsetMs: -80,
  maxOffsetMs: 300,
  /** Calibration: number of pulses and interval. */
  calibPulses: 5,
  calibIntervalMs: 900,
  calibLeadInMs: 1200,
  /** A pulse counts if the hand peak lands within this window of the pulse. */
  calibAcceptMs: 450,
  /** Minimum valid samples to accept calibration. */
  calibMinSamples: 3,
  /** Prediction (look-ahead) horizon cap, ms. */
  maxPredictMs: 120,
  /** Fraction of measured pipeline latency to predict ahead (0..1). 1 = full compensation. */
  predictFraction: 0.7,
} as const;

export const FILTER = {
  /** One Euro filter params for hand positions (normalized coords, seconds). */
  hand: { minCutoff: 1.6, beta: 18, dCutoff: 1.0 },
  /** Body (torso/head) — steadier. */
  body: { minCutoff: 1.0, beta: 6, dCutoff: 1.0 },
} as const;
