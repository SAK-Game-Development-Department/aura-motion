// Gesture recognition thresholds (src/gesture/). Defaults come from synthetic
// data and are re-centred per player by the open/fist calibration.
export const GESTURE = {
  /** Finger bend (sum of joint angles, degrees): ≤ lo = extended, ≥ hi = curled. */
  bendLo: 50,
  bendHi: 185,
  /** Finger reach |wrist→tip| / |wrist→MCP|: ≤ lo curled, ≥ hi extended. */
  reachLo: 1.15,
  reachHi: 1.6,
  /** Thumb: tip→index-MCP distance / palm size; ≤ lo folded, ≥ hi out. */
  thumbLo: 0.5,
  thumbHi: 0.8,
  /** Open hand: index↔pinky fan angle (deg). A relaxed hand keeps fingers together. */
  fanLo: 26,
  fanHi: 38,
  /** Pinch: thumb tip ↔ index tip / palm size. */
  pinchOn: 0.3,
  pinchOff: 0.5,
  /** Shape decision: enter / exit confidence, and the margin over the runner-up. */
  enterConf: 0.68,
  exitConf: 0.45,
  margin: 0.12,
  /** Consecutive frames before a new shape is accepted. */
  stableFrames: 2,
  /** Consecutive frames to switch from one held shape to another (stricter). */
  switchFrames: 3,
  /** Stance → cast: hold the shape this long for a static cast (ms). */
  chargeMs: 380,
  /** Minimum charge before a motion can release the technique. */
  minChargeForMotion: 0.25,
  /** A lost shape ends the stance after this grace (ms). */
  stanceGraceMs: 140,
  /** After a cast: afterglow; the same static shape must be re-made to cast again. */
  afterglowMs: 300,
  /** Motion detection (units: palm sizes, seconds). */
  swipeDist: 2.2,
  swipeMaxMs: 380,
  swipeMinSpeed: 6,
  pushRatio: 1.22,
  pullRatio: 0.82,
  pushWindowMs: 320,
  flickSpeed: 11,
  flickWindowMs: 140,
  motionRefractoryMs: 420,
  /** Two hands: join below / spread above this palm-centre distance (palm sizes). */
  joinDist: 1.6,
  spreadDist: 3.2,
  spreadWindowMs: 700,
  /** Air-drawn sigils. */
  sigilMinPathPalms: 3,
  sigilAccept: 0.75,
  sigilMargin: 0.05,
  sigilEndStillMs: 260,
} as const;
