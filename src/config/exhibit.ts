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
  camera: { width: 1280, height: 720, frameRate: 30 },
  /** Below this mean hand detection score, tracking counts as unstable. */
  unstableScore: 0.7,
  /** Frame luma (0..1) below which the room is "dark". */
  darkLuma: 0.12,
  /** Seconds of history for stability stats. */
  statsWindowSec: 3,
  /** Max time to wait for a worker to initialise before falling back to main thread (ms). */
  workerInitTimeoutMs: 20_000,
} as const;
