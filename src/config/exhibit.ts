// Exhibition behaviour (hands-free operation, auto recovery).
export const EXHIBIT = {
  /** Return to title after no hand is seen for this long (ms). */
  absentReturnMs: 10_000,
  /** Results screen duration before auto return (ms). */
  resultsMs: 12_000,
  /** Watchdog. */
  watchdog: {
    rafStallMs: 5000,
    trackingStallMs: 3000,
    maxErrorsPerMinute: 6,
    reloadBackoffMs: 60_000,
  },
  /** High score table size. */
  highscores: 10,
} as const;

export const TRACKING = {
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  /** Silhouette field resolution (hands rendered as particles). */
  fieldW: 192,
  fieldH: 108,
  /** Camera request. */
  // 30 fps: hand recognition runs on the GPU too; 60 doubled its load (motion is predicted for drawing anyway).
  camera: { width: 1280, height: 720, frameRate: 30 },
  /** Below this mean hand detection score, tracking counts as unstable. */
  unstableScore: 0.7,
  /** Frame luma (0..1) below which the room is "dark". */
  darkLuma: 0.12,
  /** Seconds of history for stability stats. */
  statsWindowSec: 3,
  /**
   * Fall back to the next tracking backend after this long *without progress* (ms).
   * Real GPUs initialise in a few seconds; software GL (SwiftShader) in a worker
   * can take 10–25 s, especially while the service worker precaches.
   */
  workerInitTimeoutMs: 45_000,
} as const;

/**
 * Staff settings (S key). Defaults are a little darker than the original look
 * (the room light and projector vary; tune on site). Ranges are enforced when
 * loading saved values.
 */
export const SETTINGS = {
  defaults: {
    /** Overall exposure of the picture. */
    brightness: 0.85,
    /** Bloom (glow) multiplier. */
    glow: 0.8,
    /** Background brightness multiplier. */
    background: 0.9,
    /** Flash / shake / zoom punch / colour fringing strength. */
    effects: 0.7,
    /** Chromatic aberration ("lens") pass. */
    lens: true,
    particles: 'auto' as 'auto' | 'low' | 'mid' | 'high',
    /** Render resolution (device-pixel cap). Lower = lighter. */
    resolution: 'standard' as 'low' | 'standard' | 'high',
    techLens: 'auto' as 'auto' | 'on' | 'off',
    /** Easier two-hand poses while the game waits for one. */
    sealAssist: true,
    /** Send camera plays to the shared ranking. */
    online: true,
    /** Sound effects and ambience (synthesized). */
    sound: true,
    sfxVolume: 0.7,
    ambientVolume: 0.5,
    musicVolume: 0.45,
  },
  ranges: {
    brightness: [0.4, 1.3],
    glow: [0, 1.6],
    background: [0, 1.5],
    effects: [0, 1],
    sfxVolume: [0, 1],
    ambientVolume: [0, 1],
    musicVolume: [0, 1],
  },
  /** Particle presets → RENDER.particleLevels index. */
  particleLevel: { low: 0, mid: 2, high: 4 },
  /** 画質 → device pixel ratio cap. */
  pixelCap: { low: 0.7, standard: 1, high: 1.5 },
} as const;
