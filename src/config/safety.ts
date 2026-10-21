// Photosensitivity safety (docs/art-direction.md §safety).
// Full-screen flashes are limited to <= 3 per second, and every flash/shake
// is scaled by the staff-adjustable intensity (0..1). "Calm mode" caps both.
export const SAFETY = {
  maxFlashesPerSecond: 3,
  /** Max full-screen luminance delta a single flash may add (0..1). */
  maxFlashAmplitude: 0.35,
  /** Flash rise/decay must be at least this long (ms) — no hard edges. */
  minFlashDecayMs: 180,
  defaultFlashIntensity: 0.8,
  defaultShakeIntensity: 0.6,
  calmFlashIntensity: 0.15,
  calmShakeIntensity: 0.0,
  /** Hit stop duration (ms) at full intensity. */
  hitStopMs: 70,
} as const;
