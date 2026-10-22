// Motion recognition from short trajectory history (units: palm sizes, s):
//   swipe (left/right/up/down), push (palm grows = toward camera),
//   pull (palm shrinks), flick (fingertip spike while the wrist is still),
//   two-hand join → spread.
import { GESTURE } from "../config";
import type { Vec2 } from "../core/types";

export type MotionKind =
  "swipeL" | "swipeR" | "swipeU" | "swipeD" | "push" | "pull" | "flick";
export const MOTION_IDS: MotionKind[] = [
  "swipeL",
  "swipeR",
  "swipeU",
  "swipeD",
  "push",
  "pull",
  "flick",
];
export const MOTION_LABEL: Record<MotionKind, string> = {
  swipeL: "払う←",
  swipeR: "払う→",
  swipeU: "払う↑",
  swipeD: "払う↓",
  push: "押す",
  pull: "引く",
  flick: "弾く",
};

interface Sample {
  t: number;
  palm: Vec2;
  tip: Vec2;
  size: number;
}

export interface MotionEvent {
  kind: MotionKind;
  t: number;
  /** 0..1 quality (speed / cleanliness), used for scoring. */
  quality: number;
}

/** Per-hand motion detector. */
const OPPOSITE: Record<MotionKind, MotionKind | null> = {
  swipeL: "swipeR",
  swipeR: "swipeL",
  swipeU: "swipeD",
  swipeD: "swipeU",
  push: "pull",
  pull: "push",
  flick: null,
};

export class MotionDetector {
  private hist: Sample[] = [];
  private lastEvent = -Infinity;
  private lastKind: MotionKind | null = null;

  reset(): void {
    this.hist = [];
  }

  update(
    t: number,
    palm: Vec2,
    tip: Vec2,
    size: number,
    aspect: number,
  ): MotionEvent | null {
    this.hist.push({
      t,
      palm: { x: palm.x * aspect, y: palm.y },
      tip: { x: tip.x * aspect, y: tip.y },
      size,
    });
    while (this.hist.length && t - this.hist[0]!.t > 700) this.hist.shift();
    if (t - this.lastEvent < GESTURE.motionRefractoryMs || this.hist.length < 3)
      return null;
    let ev = this.detect(t);
    // The return stroke after a motion (pulling the hand back after a push,
    // swinging back after a swipe) is not a new gesture.
    if (
      ev &&
      this.lastKind &&
      OPPOSITE[this.lastKind] === ev.kind &&
      t - this.lastEvent < GESTURE.returnStrokeMs
    )
      ev = null;
    if (ev) {
      this.lastEvent = t;
      this.lastKind = ev.kind;
      // Start the next gesture from a clean history.
      this.hist = this.hist.slice(-1);
    }
    return ev;
  }

  private detect(t: number): MotionEvent | null {
    const h = this.hist;
    const cur = h[h.length - 1]!;
    const unit = cur.size;
    // Swipe: large palm displacement inside a short window, mostly along one axis.
    for (let i = h.length - 2; i >= 0; i--) {
      const a = h[i]!;
      const dt = (t - a.t) / 1000;
      if (dt * 1000 > GESTURE.swipeMaxMs) break;
      const dx = (cur.palm.x - a.palm.x) / unit;
      const dy = (cur.palm.y - a.palm.y) / unit;
      const d = Math.hypot(dx, dy);
      if (
        d >= GESTURE.swipeDist &&
        d / Math.max(dt, 1e-3) >= GESTURE.swipeMinSpeed
      ) {
        const horiz = Math.abs(dx) >= Math.abs(dy) * 1.6;
        const vert = Math.abs(dy) >= Math.abs(dx) * 1.6;
        if (!horiz && !vert) return null;
        const kind: MotionKind = horiz
          ? dx < 0
            ? "swipeL"
            : "swipeR"
          : dy < 0
            ? "swipeU"
            : "swipeD";
        const straight = horiz ? Math.abs(dx) / d : Math.abs(dy) / d;
        return {
          kind,
          t,
          quality: Math.min(
            1,
            straight * Math.min(1, d / (GESTURE.swipeDist * 1.5)),
          ),
        };
      }
    }
    // Push / pull: palm size ratio within the window while not translating much.
    for (let i = h.length - 2; i >= 0; i--) {
      const a = h[i]!;
      if (t - a.t > GESTURE.pushWindowMs) break;
      const ratio = cur.size / a.size;
      const move =
        Math.hypot(cur.palm.x - a.palm.x, cur.palm.y - a.palm.y) / unit;
      if (move > 1.5) continue;
      if (ratio >= GESTURE.pushRatio)
        return {
          kind: "push",
          t,
          quality: Math.min(1, (ratio - 1) / (GESTURE.pushRatio - 1) / 1.5),
        };
      if (ratio <= GESTURE.pullRatio)
        return {
          kind: "pull",
          t,
          quality: Math.min(1, (1 - ratio) / (1 - GESTURE.pullRatio) / 1.5),
        };
    }
    // Flick: fingertip moves fast relative to the palm over a very short window.
    for (let i = h.length - 2; i >= 0; i--) {
      const a = h[i]!;
      const dt = (t - a.t) / 1000;
      if (dt * 1000 > GESTURE.flickWindowMs) break;
      const rel0 = { x: a.tip.x - a.palm.x, y: a.tip.y - a.palm.y };
      const rel1 = { x: cur.tip.x - cur.palm.x, y: cur.tip.y - cur.palm.y };
      const tipSpeed =
        Math.hypot(rel1.x - rel0.x, rel1.y - rel0.y) /
        unit /
        Math.max(dt, 1e-3);
      const palmSpeed =
        Math.hypot(cur.palm.x - a.palm.x, cur.palm.y - a.palm.y) /
        unit /
        Math.max(dt, 1e-3);
      if (tipSpeed >= GESTURE.flickSpeed && palmSpeed < tipSpeed * 0.35)
        return {
          kind: "flick",
          t,
          quality: Math.min(1, tipSpeed / (GESTURE.flickSpeed * 1.5)),
        };
    }
    return null;
  }
}

export type TwoHandKind = "join" | "spread";

/** Two hands: palms come together (join), then fly apart (spread = release). */
export class TwoHandDetector {
  private joinedAt: number | null = null;
  private lastEvent = -Infinity;

  reset(): void {
    this.joinedAt = null;
  }

  update(
    t: number,
    a: { palm: Vec2; size: number } | null,
    b: { palm: Vec2; size: number } | null,
    aspect: number,
  ): TwoHandKind | null {
    if (!a || !b) {
      if (this.joinedAt !== null && t - this.joinedAt > GESTURE.spreadWindowMs)
        this.joinedAt = null;
      return null;
    }
    const unit = (a.size + b.size) / 2;
    const d =
      Math.hypot((a.palm.x - b.palm.x) * aspect, a.palm.y - b.palm.y) / unit;
    if (d <= GESTURE.joinDist) {
      const was = this.joinedAt;
      this.joinedAt = t;
      if (was === null && t - this.lastEvent > GESTURE.motionRefractoryMs) {
        this.lastEvent = t;
        return "join";
      }
      return null;
    }
    if (this.joinedAt !== null && d >= GESTURE.spreadDist) {
      const ok = t - this.joinedAt <= GESTURE.spreadWindowMs;
      this.joinedAt = null;
      if (ok) {
        this.lastEvent = t;
        return "spread";
      }
    }
    return null;
  }

  get joined(): boolean {
    return this.joinedAt !== null;
  }
}
