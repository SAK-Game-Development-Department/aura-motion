// BodyTracker: PoseFrame stream → filtered, predicted BodySnapshot.
// Pure & deterministic (time comes from frame timestamps).
import { DODGE, EXHIBIT, FILTER, LATENCY, TRACKING } from '../config';
import { OneEuro, OneEuro2 } from '../core/oneEuro';
import { clamp } from '../core/math';
import { LANDMARK_COUNT, LM, type Hand, type Landmark, type PoseFrame, type Vec2 } from '../core/types';
import { PlayerLock } from './playerLock';

export interface Anchor {
  /** Mid-shoulder (view). */
  x: number;
  y: number;
  /** Body unit = shoulder width in view-height units. */
  unit: number;
}

export interface MotionState {
  jumping: boolean;
  crouching: boolean;
  /** -1 lean to screen-left, 0 none, 1 right. */
  lean: -1 | 0 | 1;
  ducking: boolean;
  /** Baselines are valid (calibrated while standing still). */
  ready: boolean;
}

export interface BodySnapshot {
  t: number;
  present: boolean;
  aspect: number;
  /** Mean visibility of key joints (0..1). */
  conf: number;
  /** Filtered landmarks (view). */
  lm: Landmark[];
  hands: Record<Hand, Vec2>;
  handVel: Record<Hand, Vec2>;
  /** Hands predicted ahead by the latency compensation horizon. */
  handsPred: Record<Hand, Vec2>;
  anchor: Anchor;
  torso: number;
  lowerBodyVisible: boolean;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  motion: MotionState;
  others: number;
  newVisitor: boolean;
  /** Raw-vs-filtered hand jitter (view units), for stability stats. */
  jitter: number;
}

export function palmCenter(lm: Landmark[], hand: Hand): Vec2 {
  const w = lm[hand === 'L' ? LM.leftWrist : LM.rightWrist]!;
  const i = lm[hand === 'L' ? LM.leftIndex : LM.rightIndex];
  if (i && i.v > 0.3) return { x: w.x + (i.x - w.x) * 0.4, y: w.y + (i.y - w.y) * 0.4 };
  return { x: w.x, y: w.y };
}

/** View → body units relative to the anchor. */
export function toBody(p: Vec2, a: Anchor, aspect: number): Vec2 {
  return { x: ((p.x - a.x) * aspect) / a.unit, y: (p.y - a.y) / a.unit };
}

/** Body units → view. */
export function fromBody(p: Vec2, a: Anchor, aspect: number): Vec2 {
  return { x: a.x + (p.x * a.unit) / aspect, y: a.y + p.y * a.unit };
}

const KEY_JOINTS: number[] = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip];

export class BodyTracker {
  readonly lock = new PlayerLock();
  private lmFilters: OneEuro2[] = [];
  private handF: Record<Hand, OneEuro2> = { L: new OneEuro2(FILTER.hand), R: new OneEuro2(FILTER.hand) };
  private unitF = new OneEuro(FILTER.body);
  private torsoF = new OneEuro(FILTER.body);
  private base = { hipY: 0, shY: 0, shX: 0, headY: 0, n: 0 };
  private lastT = -Infinity;
  private snapshot: BodySnapshot | null = null;
  /** Prediction horizon (ms) — set from measured latency. */
  predictMs = 0;

  constructor() {
    for (let i = 0; i < LANDMARK_COUNT; i++) this.lmFilters.push(new OneEuro2(FILTER.body));
  }

  reset(): void {
    this.lock.reset();
    for (const f of this.lmFilters) f.reset();
    this.handF.L.reset();
    this.handF.R.reset();
    this.unitF.reset();
    this.torsoF.reset();
    this.base = { hipY: 0, shY: 0, shX: 0, headY: 0, n: 0 };
    this.snapshot = null;
  }

  get latest(): BodySnapshot | null {
    return this.snapshot;
  }

  /** Feed a frame; returns the snapshot (present=false if no locked player). */
  update(frame: PoseFrame): BodySnapshot {
    const lockRes = this.lock.update(frame.t, frame.poses, frame.aspect);
    if (lockRes.acquired) {
      for (const f of this.lmFilters) f.reset();
      this.handF.L.reset();
      this.handF.R.reset();
      if (lockRes.newVisitor) {
        this.unitF.reset();
        this.torsoF.reset();
        this.base.n = 0;
      }
    }
    const raw = lockRes.pose;
    if (!raw) {
      const prev = this.snapshot;
      const snap: BodySnapshot = prev
        ? { ...prev, t: frame.t, present: false, others: lockRes.others, newVisitor: false }
        : emptySnapshot(frame.t, frame.aspect, lockRes.others);
      this.snapshot = snap;
      return snap;
    }
    const t = frame.t;
    this.lastT = t;
    const aspect = frame.aspect;
    const lm: Landmark[] = raw.map((p, i) => {
      const f = this.lmFilters[i]!.filter(p.x, p.y, t);
      return { x: f.x, y: f.y, z: p.z, v: p.v };
    });

    const hands = {} as Record<Hand, Vec2>;
    const handVel = {} as Record<Hand, Vec2>;
    const handsPred = {} as Record<Hand, Vec2>;
    let jitter = 0;
    for (const h of ['L', 'R'] as const) {
      const rp = palmCenter(raw, h);
      const f = this.handF[h].filter(rp.x, rp.y, t);
      hands[h] = f;
      handVel[h] = { x: this.handF[h].vx, y: this.handF[h].vy };
      const ph = Math.min(this.predictMs, LATENCY.maxPredictMs) / 1000;
      handsPred[h] = { x: f.x + handVel[h].x * ph, y: f.y + handVel[h].y * ph };
      jitter += Math.hypot((rp.x - f.x) * aspect, rp.y - f.y);
    }

    const ls = lm[LM.leftShoulder]!;
    const rs = lm[LM.rightShoulder]!;
    const lh = lm[LM.leftHip]!;
    const rh = lm[LM.rightHip]!;
    const shMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    const hipsOk = lh.v > 0.4 && rh.v > 0.4;
    const swRaw = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
    const torsoRaw = hipsOk ? Math.hypot((shMid.x - hipMid.x) * aspect, shMid.y - hipMid.y) : swRaw * 1.3;
    const torso = this.torsoF.filter(torsoRaw, t);
    // Turning sideways shrinks shoulder width; the torso keeps the unit stable.
    const unit = this.unitF.filter(Math.max(swRaw, torso * 0.72, 0.02), t);

    const lowerIdx: number[] = [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];
    const lowerBodyVisible = lowerIdx.every((i) => (raw[i]?.v ?? 0) > EXHIBIT.lowerBodyVisibility && raw[i]!.y < 1.02);
    const conf = KEY_JOINTS.reduce((a, i) => a + (raw[i]?.v ?? 0), 0) / KEY_JOINTS.length;

    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of lm) {
      if (p.v < 0.4) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }

    const motion = this.updateMotion(t, lm, shMid, hipMid, hipsOk, torso, unit, aspect);

    const snap: BodySnapshot = {
      t,
      present: true,
      aspect,
      conf,
      lm,
      hands,
      handVel,
      handsPred,
      anchor: { x: shMid.x, y: shMid.y, unit },
      torso,
      lowerBodyVisible,
      bbox: { x0, y0, x1, y1 },
      motion,
      others: lockRes.others,
      newVisitor: lockRes.acquired && lockRes.newVisitor,
      jitter: jitter / 2,
    };
    this.snapshot = snap;
    return snap;
  }

  private updateMotion(
    t: number,
    lm: Landmark[],
    shMid: Vec2,
    hipMid: Vec2,
    hipsOk: boolean,
    torso: number,
    unit: number,
    aspect: number,
  ): MotionState {
    const head = lm[LM.nose]!;
    const b = this.base;
    const still = Math.hypot(this.handF.L.vx, this.handF.L.vy) + Math.hypot(this.handF.R.vx, this.handF.R.vy) < 3;
    if (b.n === 0) {
      b.hipY = hipMid.y;
      b.shY = shMid.y;
      b.shX = shMid.x;
      b.headY = head.y;
      b.n = 1;
    }
    const jumpTh = DODGE.jumpRise * torso;
    const crouchTh = DODGE.crouchDrop * torso;
    const jumping = hipsOk && b.hipY - hipMid.y > jumpTh && b.shY - shMid.y > jumpTh * 0.8;
    const crouching = shMid.y - b.shY > crouchTh;
    const leanOff = ((shMid.x - b.shX) * aspect) / unit;
    const lean: -1 | 0 | 1 = leanOff < -DODGE.leanOffset ? -1 : leanOff > DODGE.leanOffset ? 1 : 0;
    const ducking = head.y - b.headY > DODGE.seatedDuckDrop * torso;
    // Baselines adapt slowly while the player is calm (no active evasion).
    if (!jumping && !crouching && !ducking && lean === 0) {
      const dt = this.prevMotionT === null ? 33 : clamp(t - this.prevMotionT, 0, 200);
      const k = still ? 1 - Math.exp(-dt / 1500) : 1 - Math.exp(-dt / 6000);
      b.hipY += (hipMid.y - b.hipY) * k;
      b.shY += (shMid.y - b.shY) * k;
      b.shX += (shMid.x - b.shX) * k;
      b.headY += (head.y - b.headY) * k;
      b.n++;
    }
    this.prevMotionT = t;
    return { jumping, crouching, lean, ducking, ready: b.n > 20 };
  }
  private prevMotionT: number | null = null;

  /** Has the tracker produced a fresh frame recently? */
  isFresh(now: number, maxAgeMs = TRACKING.statsWindowSec * 1000): boolean {
    return now - this.lastT < maxAgeMs;
  }
}

export function emptySnapshot(t: number, aspect: number, others = 0): BodySnapshot {
  const z = { x: 0.5, y: 0.5 };
  return {
    t,
    present: false,
    aspect,
    conf: 0,
    lm: [],
    hands: { L: z, R: z },
    handVel: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } },
    handsPred: { L: z, R: z },
    anchor: { x: 0.5, y: 0.4, unit: 0.18 },
    torso: 0.25,
    lowerBodyVisible: false,
    bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
    motion: { jumping: false, crouching: false, lean: 0, ducking: false, ready: false },
    others,
    newVisitor: false,
    jitter: 0,
  };
}
