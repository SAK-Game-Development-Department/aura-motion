// Latency & filtering.
export const LATENCY = {
  /** Default system latency (capture -> judgement) offset before calibration, ms. */
  defaultOffsetMs: 60,
  /** Clamp for calibrated offset. */
  minOffsetMs: -80,
  maxOffsetMs: 300,
  /** Calibration (make a fist on each light pulse): number of pulses and interval. */
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
  /** Drawn hand: fraction of (now − capture time) extrapolated with landmark velocities. */
  displayPredictGain: 0.85,
} as const;

export const FILTER = {
  /** One Euro filter params for hand positions (normalized coords, seconds). */
  hand: { minCutoff: 2.0, beta: 28, dCutoff: 1.2 },
  /** Palm / wrist — steadier. */
  palm: { minCutoff: 1.0, beta: 6, dCutoff: 1.0 },
} as const;
