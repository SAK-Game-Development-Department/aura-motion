// Rendering & automatic quality control.
export const RENDER = {
  /** Particle budget presets (index = quality level). */
  particleLevels: [30_000, 60_000, 100_000, 150_000, 250_000, 400_000],
  /** Start level for unknown / integrated GPUs. */
  startLevel: 3,
  /** WebGL2 fallback cap. */
  webglMaxLevel: 2,
  /** Internal resolution scale levels (applied after particles bottom out). */
  resolutionScales: [0.6, 0.75, 1.0],
  /** Bloom. */
  bloom: { strength: 1.1, radius: 0.55, threshold: 0.12 },
  /** Fraction of particles bound to the body silhouette (rest are ambient). */
  bodyFraction: 0.72,
  particleSize: 0.0055,
  /** Curl noise. */
  curlScale: 2.2,
  curlSpeed: 0.25,
} as const;

export const QUALITY = {
  targetFrameMs: 16.7,
  /** Downgrade if EMA frame time exceeds this for `downAfterMs`. */
  downThresholdMs: 18.5,
  downAfterMs: 1500,
  /** Upgrade if EMA is below this for `upAfterMs`. */
  upThresholdMs: 13.0,
  upAfterMs: 8000,
  emaAlpha: 0.08,
} as const;
