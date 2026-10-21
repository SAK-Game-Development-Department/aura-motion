// Parametric 2D skeleton → 33 MediaPipe-style landmarks. Used by the synthetic
// motion generator (tests, attract mode, autoplayer) and the mouse emergency
// mode. Works in a "metric" plane (mx = x * aspect, y) so proportions are
// isotropic, then converts back to view space.
import { LANDMARK_COUNT, LM, type Landmark, type Vec2 } from '../core/types';

/** Direction angle convention: 0 = pointing down the screen, +90° = screen-right, 180° = up. */
export function dirFromAngle(deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

export function angleFromDir(dx: number, dy: number): number {
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export interface LimbAngles {
  /** Upper segment direction (shoulder→elbow or hip→knee), degrees. */
  upper: number;
  /** Lower segment direction (elbow→wrist or knee→ankle), degrees. */
  lower: number;
}

export interface SynthBody {
  aspect: number;
  /** Hip-centre x (view). */
  cx: number;
  /** Feet (ankle) y (view) when standing. */
  floorY: number;
  /** Full body height in view-y units. */
  height: number;
  /** Per-side arms. If `target` is set, IK overrides angles (target is a palm centre in view space). */
  armL: LimbAngles & { target?: Vec2 | null };
  armR: LimbAngles & { target?: Vec2 | null };
  legL: LimbAngles;
  legR: LimbAngles;
  /** 0..1 crouch depth. */
  crouch: number;
  /** 0..1 jump height (fraction of 0.15 * height). */
  jump: number;
  /** Torso tilt in degrees (+ = toward screen-right). */
  lean: number;
  /** Seated (lower body hidden / low visibility). */
  seated: boolean;
  /** Visibility multiplier (simulate bad light). */
  visibility: number;
}

export const PROPORTIONS = {
  shoulderW: 0.235,
  hipW: 0.15,
  torso: 0.3,
  upperArm: 0.165,
  forearm: 0.145,
  palm: 0.03,
  thigh: 0.235,
  shin: 0.235,
  neck: 0.075,
  head: 0.06,
};

export const NEUTRAL_ARM_L: LimbAngles = { upper: -12, lower: -6 };
export const NEUTRAL_ARM_R: LimbAngles = { upper: 12, lower: 6 };
export const NEUTRAL_LEG_L: LimbAngles = { upper: -4, lower: -2 };
export const NEUTRAL_LEG_R: LimbAngles = { upper: 4, lower: 2 };

export function defaultBody(aspect = 16 / 9): SynthBody {
  return {
    aspect,
    cx: 0.5,
    floorY: 0.9,
    height: 0.78,
    armL: { ...NEUTRAL_ARM_L },
    armR: { ...NEUTRAL_ARM_R },
    legL: { ...NEUTRAL_LEG_L },
    legR: { ...NEUTRAL_LEG_R },
    crouch: 0,
    jump: 0,
    lean: 0,
    seated: false,
    visibility: 0.98,
  };
}

const add = (a: Vec2, b: Vec2, s = 1): Vec2 => ({ x: a.x + b.x * s, y: a.y + b.y * s });

/** Two-link IK in the metric plane. Returns the elbow; prefers the lower elbow. */
export function solveIk(s: Vec2, t: Vec2, a: number, b: number): { elbow: Vec2; end: Vec2 } {
  let dx = t.x - s.x;
  let dy = t.y - s.y;
  let d = Math.hypot(dx, dy);
  const maxD = a + b - 1e-4;
  const minD = Math.abs(a - b) + 1e-4;
  if (d < 1e-6) {
    dx = 0;
    dy = 1;
    d = minD;
  }
  const dc = Math.min(maxD, Math.max(minD, d));
  const ux = dx / d;
  const uy = dy / d;
  const end = { x: s.x + ux * dc, y: s.y + uy * dc };
  const cosA = (a * a + dc * dc - b * b) / (2 * a * dc);
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const base = Math.atan2(uy, ux);
  const e1 = { x: s.x + a * Math.cos(base + ang), y: s.y + a * Math.sin(base + ang) };
  const e2 = { x: s.x + a * Math.cos(base - ang), y: s.y + a * Math.sin(base - ang) };
  return { elbow: e1.y >= e2.y ? e1 : e2, end };
}

/** Build 33 landmarks (view space) for a synthetic body. */
export function buildLandmarks(b: SynthBody): Landmark[] {
  const H = b.height;
  const P = PROPORTIONS;
  const asp = b.aspect;
  const lm: Vec2[] = new Array(LANDMARK_COUNT);
  const vis: number[] = new Array(LANDMARK_COUNT).fill(b.visibility);

  // Metric plane: mx = x * aspect.
  const jumpLift = b.jump * 0.15 * H;
  const crouchDrop = b.crouch * 0.2 * H;
  const legLen = (P.thigh + P.shin) * H;
  const hipY = b.seated ? b.floorY - 0.32 * H : b.floorY - legLen + crouchDrop - jumpLift;
  const hipMid: Vec2 = { x: b.cx * asp, y: hipY };

  const tilt = (b.lean * Math.PI) / 180;
  const up: Vec2 = { x: Math.sin(tilt), y: -Math.cos(tilt) };
  const right: Vec2 = { x: Math.cos(tilt), y: Math.sin(tilt) };
  const shMid = add(hipMid, up, P.torso * H);
  const sL = add(shMid, right, (-P.shoulderW * H) / 2);
  const sR = add(shMid, right, (P.shoulderW * H) / 2);
  const hL = add(hipMid, { x: 1, y: 0 }, (-P.hipW * H) / 2);
  const hR = add(hipMid, { x: 1, y: 0 }, (P.hipW * H) / 2);

  const arm = (s: Vec2, cfg: SynthBody['armL']) => {
    const a = P.upperArm * H;
    const f = P.forearm * H;
    const palm = P.palm * H;
    let elbow: Vec2;
    let wrist: Vec2;
    if (cfg.target) {
      const tgt = { x: cfg.target.x * asp, y: cfg.target.y };
      const r = solveIk(s, tgt, a, f + palm);
      elbow = r.elbow;
      const d = Math.hypot(r.end.x - elbow.x, r.end.y - elbow.y) || 1;
      wrist = { x: r.end.x - ((r.end.x - elbow.x) / d) * palm, y: r.end.y - ((r.end.y - elbow.y) / d) * palm };
    } else {
      elbow = add(s, dirFromAngle(cfg.upper), a);
      wrist = add(elbow, dirFromAngle(cfg.lower), f);
    }
    const dx = wrist.x - elbow.x;
    const dy = wrist.y - elbow.y;
    const d = Math.hypot(dx, dy) || 1;
    const u = { x: dx / d, y: dy / d };
    const n = { x: -u.y, y: u.x };
    const index = add(wrist, u, 0.075 * H);
    const pinky = add(add(wrist, u, 0.06 * H), n, 0.02 * H);
    const thumb = add(add(wrist, u, 0.035 * H), n, -0.025 * H);
    return { elbow, wrist, index, pinky, thumb };
  };
  const aL = arm(sL, b.armL);
  const aR = arm(sR, b.armR);

  const leg = (hip: Vec2, cfg: LimbAngles, sign: number) => {
    const t = P.thigh * H;
    const s = P.shin * H;
    let knee: Vec2;
    let ankle: Vec2;
    if (b.seated) {
      knee = { x: hip.x + sign * 0.03 * H, y: hip.y + 0.04 * H };
      ankle = { x: knee.x, y: knee.y + s };
    } else if (b.crouch > 0.01 && b.jump < 0.01) {
      // Keep the ankle planted; bend the knee outward.
      const ank = { x: hip.x + sign * 0.02 * H, y: b.floorY };
      const r = solveIk(hip, ank, t, s);
      const mid = { x: (hip.x + ank.x) / 2, y: (hip.y + ank.y) / 2 };
      const off = r.elbow.x - mid.x;
      knee = { x: mid.x + sign * Math.abs(off), y: r.elbow.y };
      ankle = r.end;
    } else {
      knee = add(hip, dirFromAngle(cfg.upper), t);
      ankle = add(knee, dirFromAngle(cfg.lower), s);
    }
    const heel = add(ankle, { x: -sign * 0.01, y: 0.02 * H }, 1);
    const foot = add(ankle, { x: sign * 0.03 * H, y: 0.03 * H }, 1);
    return { knee, ankle, heel, foot };
  };
  const lL = leg(hL, b.legL, -1);
  const lR = leg(hR, b.legR, 1);

  const neck = add(shMid, up, P.neck * H);
  const nose = add(neck, up, P.head * 0.6 * H);
  const eyeY = add(nose, up, 0.02 * H);
  const ex = P.head * 0.35 * H;

  lm[LM.nose] = nose;
  lm[LM.leftEyeInner] = add(eyeY, right, -ex * 0.4);
  lm[LM.leftEye] = add(eyeY, right, -ex * 0.6);
  lm[LM.leftEyeOuter] = add(eyeY, right, -ex * 0.85);
  lm[LM.rightEyeInner] = add(eyeY, right, ex * 0.4);
  lm[LM.rightEye] = add(eyeY, right, ex * 0.6);
  lm[LM.rightEyeOuter] = add(eyeY, right, ex * 0.85);
  lm[LM.leftEar] = add(eyeY, right, -ex * 1.3);
  lm[LM.rightEar] = add(eyeY, right, ex * 1.3);
  lm[LM.mouthLeft] = add(add(nose, up, -0.025 * H), right, -ex * 0.4);
  lm[LM.mouthRight] = add(add(nose, up, -0.025 * H), right, ex * 0.4);
  lm[LM.leftShoulder] = sL;
  lm[LM.rightShoulder] = sR;
  lm[LM.leftElbow] = aL.elbow;
  lm[LM.rightElbow] = aR.elbow;
  lm[LM.leftWrist] = aL.wrist;
  lm[LM.rightWrist] = aR.wrist;
  lm[LM.leftPinky] = aL.pinky;
  lm[LM.rightPinky] = aR.pinky;
  lm[LM.leftIndex] = aL.index;
  lm[LM.rightIndex] = aR.index;
  lm[LM.leftThumb] = aL.thumb;
  lm[LM.rightThumb] = aR.thumb;
  lm[LM.leftHip] = hL;
  lm[LM.rightHip] = hR;
  lm[LM.leftKnee] = lL.knee;
  lm[LM.rightKnee] = lR.knee;
  lm[LM.leftAnkle] = lL.ankle;
  lm[LM.rightAnkle] = lR.ankle;
  lm[LM.leftHeel] = lL.heel;
  lm[LM.rightHeel] = lR.heel;
  lm[LM.leftFootIndex] = lL.foot;
  lm[LM.rightFootIndex] = lR.foot;

  if (b.seated) {
    for (const i of [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex]) {
      vis[i] = 0.08;
    }
  }

  return lm.map((p, i) => {
    const y = p.y;
    const x = p.x / asp;
    const offscreen = x < 0 || x > 1 || y < 0 || y > 1;
    return { x, y, z: 0, v: offscreen ? Math.min(vis[i]!, 0.2) : vis[i]! };
  });
}
