// Shared data types. Coordinates are "view space": normalized [0,1], already
// mirrored (x grows to the player's right as seen on screen), y grows downward.
// Distances are measured after multiplying x by the frame aspect (w/h).

export interface Vec2 {
  x: number;
  y: number;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** visibility 0..1 */
  v: number;
}

/** One detected hand (21 landmarks, view space). */
export interface HandObs {
  lm: Landmark[];
  /** Detector confidence 0..1. */
  score: number;
}

/** One tracking result as produced by any InputSource. Must be serialisable. */
export interface PoseFrame {
  /** Capture time in the source clock (ms). */
  t: number;
  /** All detected people (each 33 landmarks), most-confident first. */
  poses: Landmark[][];
  /** Detected hands (hand mode). */
  hands?: HandObs[];
  /** Frame aspect ratio (w / h). */
  aspect: number;
  /** Optional mean frame luma 0..1 (for dark-room detection). */
  luma?: number;
  /** Optional timing (ms, same clock as t) for latency display. */
  timing?: { inferStart: number; inferEnd: number };
}

/** Packed silhouette field produced by tracking (not part of replays). */
export interface FieldFrame {
  t: number;
  w: number;
  h: number;
  /** RGBA8: R = signed distance (0.5 = contour, >0.5 inside), G/B = velocity xy (0.5 = 0), A = mask. */
  data: Uint8Array;
}

/** Landmark indices (MediaPipe Pose, 33 points). */
export const LM = {
  nose: 0,
  leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3,
  rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18,
  leftIndex: 19, rightIndex: 20,
  leftThumb: 21, rightThumb: 22,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;

/** Skeleton segments used for the light-line silhouette and capsule masks. */
export const BONES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
  [15, 19], [16, 20],
];

export type Hand = 'L' | 'R';
export type Side = Hand | 'any';

/** Hand landmark indices (MediaPipe Hand Landmarker, 21 points). */
export const HL = {
  wrist: 0,
  thumbCmc: 1, thumbMcp: 2, thumbIp: 3, thumbTip: 4,
  indexMcp: 5, indexPip: 6, indexDip: 7, indexTip: 8,
  middleMcp: 9, middlePip: 10, middleDip: 11, middleTip: 12,
  ringMcp: 13, ringPip: 14, ringDip: 15, ringTip: 16,
  pinkyMcp: 17, pinkyPip: 18, pinkyDip: 19, pinkyTip: 20,
} as const;

export const HAND_LANDMARKS = 21;

export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
