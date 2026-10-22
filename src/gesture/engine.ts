// GestureEngine: PoseFrame (hand landmarks) → per-hand recognition state +
// a deterministic stream of GestureEvents. The game depends only on this.
//
//   landmarks → normalize/features → shape scores → stabilizer (hysteresis)
//   → per-hand state machine: idle → stance (charge) → cast → afterglow
//   motions (swipe/push/pull/flick), two-hand join→spread and air-drawn
//   sigils release a stance as different techniques.
import { GESTURE } from "../config";
import type { PoseFrame, Vec2 } from "../core/types";
import {
  defaultThresholds,
  features,
  normalize,
  type Features,
  type Normalized,
  type Thresholds,
} from "./features";
import { SHAPE_IDS, type ShapeId } from "./handModel";
import { MotionDetector, TwoHandDetector, type MotionKind } from "./motion";
import {
  RuleClassifier,
  ShapeStabilizer,
  type Classifier,
  type ShapeDecision,
} from "./shapes";
import { recognizeSigil, SIGIL_IDS, type SigilKind } from "./sigil";
import { SealDetector, sealScores, type SealKind } from "./seals";
import { HandTracker, type HandFrame, type TrackedHand } from "./tracker";

export type Release = "hold" | MotionKind | "sigil" | "twoHand";

export type GestureEvent =
  | { type: "handIn"; t: number; hand: number }
  | { type: "handOut"; t: number; hand: number }
  | { type: "stance"; t: number; hand: number; shape: ShapeId; conf: number }
  | { type: "cancel"; t: number; hand: number; shape: ShapeId }
  | {
      type: "motion";
      t: number;
      hand: number;
      kind: MotionKind;
      quality: number;
    }
  | { type: "sigil"; t: number; hand: number; kind: SigilKind; score: number }
  | { type: "twoHand"; t: number; kind: "join" | "spread" }
  | { type: "seal"; t: number; kind: SealKind }
  | {
      type: "cast";
      t: number;
      hand: number;
      shape: ShapeId;
      release: Release;
      sigil?: SigilKind;
      quality: number;
      charge: number;
    };

export type FsmState = "idle" | "stance" | "spent";

export interface GestureHand extends TrackedHand {
  norm: Normalized;
  feat: Features;
  decision: ShapeDecision;
  state: FsmState;
  /** Shape held in the current stance. */
  stance: ShapeId | null;
  /** 0..1 charge of the stance (1 = static cast ready). */
  charge: number;
  /** Sigil stroke being drawn (view coords). */
  stroke: Vec2[];
}

export interface GestureFrame {
  t: number;
  aspect: number;
  hands: GestureHand[];
  events: GestureEvent[];
  frame: HandFrame;
  twoHandJoined: boolean;
  /** Seal being formed (two hands) and its hold progress 0..1. */
  seal: { kind: SealKind; k: number } | null;
}

export interface EngineOptions {
  shapes: readonly ShapeId[];
  motions: boolean;
  sigils: boolean;
  twoHand: boolean;
  /** Two-hand seals (印). */
  seals?: boolean;
  /** Shapes that cast by holding (others need a motion). Default: all allowed shapes. */
  staticCast?: readonly ShapeId[];
  classifier?: Classifier;
  thresholds?: Thresholds;
}

interface HandCtx {
  stab: ShapeStabilizer;
  motion: MotionDetector;
  state: FsmState;
  stance: ShapeId | null;
  since: number;
  lostAt: number | null;
  stroke: Vec2[];
  strokeStillSince: number | null;
  lastTip: Vec2 | null;
  /** The stance that just ended (a motion right after a brief loss still releases it). */
  recent: { shape: ShapeId; since: number; until: number } | null;
  /** Since when the stance shape has been *strongly* recognised (≥ enterConf) without a break. */
  strongSince: number | null;
}

export class GestureEngine {
  readonly tracker = new HandTracker();
  private ctx = new Map<number, HandCtx>();
  private two = new TwoHandDetector();
  private sealDet = new SealDetector();
  /** Seals the game is waiting for right now (assist: easier to form). Set by the game each frame. */
  expectSeals: ReadonlySet<SealKind> = new Set();
  /** Last two-hand pair while a seal was forming (pressed hands can make one vanish briefly). */
  private sealLatch: { hands: [GestureHand, GestureHand]; t: number } | null = null;
  classifier: Classifier;
  thresholds: Thresholds;
  opts: EngineOptions;

  constructor(opts: Partial<EngineOptions> = {}) {
    // Ignore explicitly-undefined options so they don't override the defaults.
    const defined = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as Partial<EngineOptions>;
    this.opts = {
      shapes: SHAPE_IDS,
      motions: true,
      sigils: true,
      twoHand: true,
      ...defined,
    };
    this.classifier = opts.classifier ?? new RuleClassifier();
    this.thresholds = opts.thresholds ?? defaultThresholds();
  }

  reset(): void {
    this.tracker.reset();
    this.ctx.clear();
    this.two.reset();
    this.sealDet.reset();
    this.sealLatch = null;
  }

  update(f: PoseFrame): GestureFrame {
    const hf = this.tracker.update(f);
    const t = hf.t;
    const asp = hf.aspect;
    const events: GestureEvent[] = [];
    const seen = new Set<number>();
    const out: GestureHand[] = [];

    for (const h of hf.hands) {
      seen.add(h.slot);
      let c = this.ctx.get(h.slot);
      if (!c) {
        c = {
          stab: new ShapeStabilizer(),
          motion: new MotionDetector(),
          state: "idle",
          stance: null,
          since: t,
          lostAt: null,
          stroke: [],
          strokeStillSince: null,
          lastTip: null,
          recent: null,
          strongSince: null,
        };
        this.ctx.set(h.slot, c);
        events.push({ type: "handIn", t, hand: h.slot });
      }
      // Shape features from the One-Euro-filtered landmarks: adaptive smoothing
      // removes jitter on small/far hands while staying fast on quick changes.
      const norm = normalize(h.lm, asp);
      const feat = features(norm);
      const decision = c.stab.update(
        this.classifier.classify(feat, this.thresholds, this.opts.shapes),
      );
      const mot = this.opts.motions
        ? c.motion.update(t, h.palm, h.tip, h.size, asp)
        : null;
      if (mot)
        events.push({
          type: "motion",
          t,
          hand: h.slot,
          kind: mot.kind,
          quality: mot.quality,
        });
      this.step(c, h, decision, mot, t, asp, events);
      out.push({
        ...h,
        norm,
        feat,
        decision,
        state: c.state,
        stance: c.stance,
        charge:
          c.stance && c.strongSince !== null
            ? Math.min(1, (t - c.strongSince) / GESTURE.chargeMs)
            : 0,
        stroke: c.stroke,
      });
    }
    for (const [slot, c] of this.ctx) {
      if (seen.has(slot)) continue;
      if (c.stance && c.state === "stance")
        events.push({ type: "cancel", t, hand: slot, shape: c.stance });
      events.push({ type: "handOut", t, hand: slot });
      this.ctx.delete(slot);
    }

    // Two hands: join → spread releases the (left-most) hand's stance as a two-hand technique.
    let joined = false;
    if (this.opts.twoHand) {
      const a = out[0] ?? null;
      const b = out[1] ?? null;
      const k = this.two.update(t, a, b, asp);
      joined = this.two.joined;
      if (k) events.push({ type: "twoHand", t, kind: k });
      if (k === "spread" && a && b) {
        const shape = a.decision.shape ?? b.decision.shape ?? "open";
        events.push({
          type: "cast",
          t,
          hand: a.slot,
          shape,
          release: "twoHand",
          quality: 1,
          charge: 1,
        });
        for (const h of [a, b]) {
          const c = this.ctx.get(h.slot);
          if (c && c.stance) c.state = "spent";
        }
      }
    }
    // Seals: two hands together in one of the seal configurations, held briefly.
    let seal: GestureFrame["seal"] = null;
    if (this.opts.seals) {
      let a = out[0];
      let b = out[1];
      // Occlusion: while a seal is forming, a hand that vanishes for a moment is
      // kept at its last place (the other hand is still there and holding).
      if (a && b) this.sealLatch = this.sealDet.progress ? { hands: [a, b], t } : null;
      else if (a && !b && this.sealLatch && t - this.sealLatch.t < GESTURE.seal.occlusionMs) {
        const [p, q] = this.sealLatch.hands;
        b = p.slot === a.slot ? q : q.slot === a.slot ? p : undefined;
      } else this.sealLatch = null;
      if (a && b && a.palm.x > b.palm.x) [a, b] = [b, a];
      const sc = a && b ? sealScores(toSealHand(a), toSealHand(b), asp, this.expectSeals) : null;
      const fired = this.sealDet.update(t, sc, this.expectSeals);
      seal = this.sealDet.progress;
      if (fired) {
        events.push({ type: "seal", t, kind: fired });
        // The seal consumes both hands' stances (no stray single-hand casts).
        for (const h of [a, b]) {
          const c = h && this.ctx.get(h.slot);
          if (c && c.stance) {
            c.state = "spent";
            c.strongSince = null;
          }
        }
      } else if (seal && seal.k > 0.3) {
        // While a seal is forming, hold back single-hand static casts.
        for (const h of [a, b]) {
          const c = h && this.ctx.get(h.slot);
          if (c) c.strongSince = null;
        }
      }
    }
    return {
      t,
      aspect: asp,
      hands: out,
      events,
      frame: hf,
      twoHandJoined: joined,
      seal,
    };
  }

  private step(
    c: HandCtx,
    h: TrackedHand,
    d: ShapeDecision,
    mot: { kind: MotionKind; quality: number } | null,
    t: number,
    asp: number,
    events: GestureEvent[],
  ): void {
    const shape = d.shape;
    if (c.stance) {
      if (shape === c.stance) c.lostAt = null;
      else if (shape === null) c.lostAt ??= t;
      const lost =
        shape !== null && shape !== c.stance
          ? true
          : c.lostAt !== null && t - c.lostAt > GESTURE.stanceGraceMs;
      if (lost) {
        this.finishStroke(c, h, t, events);
        c.recent = { shape: c.stance, since: c.since, until: t + 250 };
        if (c.state === "stance")
          events.push({ type: "cancel", t, hand: h.slot, shape: c.stance });
        c.stance = null;
        c.state = "idle";
        c.stroke = [];
      }
    }
    // Motion right after a brief loss of the stance (e.g. the palm shrinking on a pull).
    if (
      !c.stance &&
      mot &&
      c.recent &&
      t <= c.recent.until &&
      (t - c.recent.since) / GESTURE.chargeMs >= GESTURE.minChargeForMotion
    ) {
      events.push({
        type: "cast",
        t,
        hand: h.slot,
        shape: c.recent.shape,
        release: mot.kind,
        quality: mot.quality,
        charge: 1,
      });
      c.recent = null;
      return;
    }
    if (!c.stance && shape) {
      c.stance = shape;
      c.since = t;
      c.lostAt = null;
      c.state = "stance";
      c.stroke = [];
      c.strokeStillSince = null;
      c.strongSince = null;
      events.push({ type: "stance", t, hand: h.slot, shape, conf: d.conf });
    }
    if (!c.stance) return;
    const charge = Math.min(1, (t - c.since) / GESTURE.chargeMs);
    // Static casts need the shape held *strongly* for the whole charge (the
    // hysteresis band alone would let a brief accidental shape linger and fire).
    if (shape === c.stance && d.conf >= GESTURE.enterConf) c.strongSince ??= t;
    else c.strongSince = null;
    const strongCharge =
      c.strongSince !== null
        ? Math.min(1, (t - c.strongSince) / GESTURE.chargeMs)
        : 0;

    // Motion release (any time after a minimal charge, even after a static cast).
    if (mot && charge >= GESTURE.minChargeForMotion) {
      events.push({
        type: "cast",
        t,
        hand: h.slot,
        shape: c.stance,
        release: mot.kind,
        quality: mot.quality,
        charge,
      });
      c.state = "spent";
      return;
    }
    // Sigils: with "point", the index fingertip draws.
    if (this.opts.sigils && c.stance === "point") {
      const tip = h.tip;
      const moving = c.lastTip
        ? Math.hypot((tip.x - c.lastTip.x) * asp, tip.y - c.lastTip.y) /
            h.size >
          0.04
        : true;
      c.lastTip = tip;
      if (moving) {
        c.stroke.push({ x: tip.x, y: tip.y });
        if (c.stroke.length > 240) c.stroke.shift();
        c.strokeStillSince = null;
      } else {
        c.strokeStillSince ??= t;
        if (
          t - c.strokeStillSince > GESTURE.sigilEndStillMs &&
          this.finishStroke(c, h, t, events)
        )
          return;
      }
    }
    // Static cast: hold the shape until fully charged (once per stance).
    const staticOk = (this.opts.staticCast ?? this.opts.shapes).includes(
      c.stance,
    );
    if (
      c.state === "stance" &&
      strongCharge >= 1 &&
      staticOk &&
      c.stroke.length < 6
    ) {
      events.push({
        type: "cast",
        t,
        hand: h.slot,
        shape: c.stance,
        release: "hold",
        quality: d.conf,
        charge: 1,
      });
      c.state = "spent";
    }
  }

  /** Recognise a finished sigil stroke; returns true if a sigil cast was emitted. */
  private finishStroke(
    c: HandCtx,
    h: TrackedHand,
    t: number,
    events: GestureEvent[],
  ): boolean {
    const s = c.stroke;
    c.stroke = [];
    c.strokeStillSince = null;
    if (!this.opts.sigils || s.length < 8 || !c.stance) return false;
    let L = 0;
    for (let i = 1; i < s.length; i++)
      L += Math.hypot(
        (s[i]!.x - s[i - 1]!.x) * (16 / 9),
        s[i]!.y - s[i - 1]!.y,
      );
    if (L / h.size < GESTURE.sigilMinPathPalms) return false;
    const r = recognizeSigil(s, SIGIL_IDS);
    if (
      !r ||
      r.score < GESTURE.sigilAccept ||
      r.score - r.second < GESTURE.sigilMargin
    )
      return false;
    events.push({
      type: "sigil",
      t,
      hand: h.slot,
      kind: r.kind,
      score: r.score,
    });
    events.push({
      type: "cast",
      t,
      hand: h.slot,
      shape: c.stance,
      release: "sigil",
      sigil: r.kind,
      quality: r.score,
      charge: 1,
    });
    c.state = "spent";
    return true;
  }
}

function toSealHand(h: GestureHand) {
  return { palm: h.palm, size: h.size, lm: h.lm, scores: h.decision.scores };
}
