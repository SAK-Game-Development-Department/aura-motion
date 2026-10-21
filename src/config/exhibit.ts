// Exhibition behaviour (hands-free operation, auto recovery).
export const EXHIBIT = {
  /** Person must be present & in position this long to start (ms). */
  startHoldMs: 1500,
  /** Hand-over button hold time (ms). */
  buttonHoldMs: 1000,
  /** Button hit radius (normalized screen height units). */
  buttonRadius: 0.085,
  /** Return to title after nobody is seen for this long (ms). */
  absentReturnMs: 10_000,
  /** Results screen duration before auto return (ms). */
  resultsMs: 12_000,
  /** Short loss tolerated without pausing the player lock (ms). */
  lossGraceMs: 800,
  /** Positioning guide: bbox height range (fraction of frame) that counts as "good". */
  guideStanding: { minH: 0.55, maxH: 0.95 },
  guideSeated: { minShoulderW: 0.14, maxShoulderW: 0.34 },
  /** For this long after arrival, missing legs mean "step back" rather than "seated". */
  preferStandingMs: 4000,
  /** Lower body considered visible if ankle/knee visibility exceeds this. */
  lowerBodyVisibility: 0.5,
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
  /** Pose model: 'lite' for integrated GPUs, 'full' if headroom allows. */
  poseModel: 'lite' as 'lite' | 'full',
  numPoses: 2,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  /** Segmentation field resolution. */
  fieldW: 192,
  fieldH: 108,
  /** Camera request. */
  camera: { width: 1280, height: 720, frameRate: 30 },
  /** Below this mean landmark visibility, tracking counts as unstable. */
  unstableVisibility: 0.55,
  /** Frame luma (0..1) below which the room is "dark". */
  darkLuma: 0.12,
  /** Seconds of history for stability stats. */
  statsWindowSec: 3,
  /** Max time to wait for a worker to initialise before falling back to main thread (ms). */
  workerInitTimeoutMs: 20_000,
} as const;
