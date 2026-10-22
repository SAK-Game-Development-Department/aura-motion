// HandTracker: raw hand observations → up to two stable hand slots.
//  - IDs come from position continuity, never from MediaPipe's left/right
//    label (which flips with mirroring and is noisy).
//  - Player lock: the largest hands win; hands much smaller than the largest
//    (people in the background) are ignored.
//  - One Euro filtering per landmark, fingertip velocity + short prediction.
import { FILTER, HAND, LATENCY } from '../config';
import { OneEuro2 } from '../core/oneEuro';
import { HAND_LANDMARKS, HL, type HandObs, type Landmark, type PoseFrame, type Vec2 } from '../core/types';

export interface TrackedHand {
  slot: number;
  /** Filtered landmarks (view space). */
  lm: Landmark[];
  /** Raw landmarks of this frame (for shape features — the filter lags on fast curls). */
  raw: Landmark[];
  score: number;
  /** Palm size (view-height units, 2D). */
  size: number;
  palm: Vec2;
  tip: Vec2;
  tipVel: Vec2;
  tipPred: Vec2;
  /** ms since this slot appeared. */
  age: number;
}

export interface HandFrame {
  t: number;
  aspect: number;
  hands: TrackedHand[];
  present: boolean;
  /** Hands were absent for a while and appeared again (possibly a new visitor). */
  newVisitor: boolean;
  /** Hands ignored by the player lock (too small / extra). */
  ignored: number;
  /** Mean detector score (stability stats). */
  score: number;
}

export function palmSize(lm: Landmark[], aspect: number): number {
  const w = lm[HL.wrist]!;
  const m = lm[HL.middleMcp]!;
  return Math.max(1e-4, Math.hypot((w.x - m.x) * aspect, w.y - m.y));
}

interface Slot {
  id: number;
  filters: OneEuro2[];
  tipF: OneEuro2;
  last: Vec2;
  lastSeen: number;
  born: number;
}

export class HandTracker {
  private slots: Slot[] = [];
  private nextId = 0;
  private lastAny = -Infinity;
  predictMs = 0;

  reset(): void {
    this.slots = [];
    this.lastAny = -Infinity;
  }

  update(f: PoseFrame): HandFrame {
    const t = f.t;
    const asp = f.aspect;
    const all = (f.hands ?? []).filter((h) => h.lm.length === HAND_LANDMARKS && h.score > 0.3);
    all.sort((a, b) => palmSize(b.lm, asp) - palmSize(a.lm, asp));
    const biggest = all[0] ? palmSize(all[0].lm, asp) : 0;
    const use = all.filter((h) => palmSize(h.lm, asp) >= biggest * 0.55).slice(0, 2);
    const ignored = all.length - use.length;
    const newVisitor = use.length > 0 && t - this.lastAny > 2500;
    if (use.length) this.lastAny = t;

    const taken = new Set<Slot>();
    const pairs: Array<[HandObs, Slot]> = [];
    for (const o of use) {
      const c = palmCentre(o.lm);
      let best: Slot | null = null;
      // Fast, large hands move far between frames: scale the gate by hand size;
      // a lone hand with a lone slot always continues that slot.
      const lone = use.length === 1 && this.slots.length === 1;
      let bd = lone ? Infinity : Math.max(0.25, palmSize(o.lm, asp) * 4);
      for (const s of this.slots) {
        if (taken.has(s)) continue;
        const d = Math.hypot((c.x - s.last.x) * asp, c.y - s.last.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (!best) {
        best = { id: this.nextId++, filters: Array.from({ length: HAND_LANDMARKS }, () => new OneEuro2(FILTER.hand)), tipF: new OneEuro2(FILTER.hand), last: c, lastSeen: t, born: t };
        this.slots.push(best);
      }
      taken.add(best);
      pairs.push([o, best]);
    }
    this.slots = this.slots.filter((s) => taken.has(s) || t - s.lastSeen < HAND.slotGraceMs);

    const ph = Math.min(this.predictMs, LATENCY.maxPredictMs) / 1000;
    const hands: TrackedHand[] = pairs.map(([o, s]) => {
      s.lastSeen = t;
      const lm = o.lm.map((p, i) => {
        const q = s.filters[i]!.filter(p.x, p.y, t);
        return { x: q.x, y: q.y, z: p.z, v: p.v };
      });
      s.last = palmCentre(lm);
      const raw = o.lm[HL.indexTip]!;
      const tip = s.tipF.filter(raw.x, raw.y, t);
      const tipVel = { x: s.tipF.vx, y: s.tipF.vy };
      return {
        slot: s.id,
        lm,
        raw: o.lm,
        score: o.score,
        size: palmSize(lm, asp),
        palm: s.last,
        tip,
        tipVel,
        tipPred: { x: tip.x + tipVel.x * ph, y: tip.y + tipVel.y * ph },
        age: t - s.born,
      };
    });
    hands.sort((a, b) => a.palm.x - b.palm.x);
    const score = hands.length ? hands.reduce((a, h) => a + h.score, 0) / hands.length : 0;
    return { t, aspect: asp, hands, present: hands.length > 0, newVisitor, ignored, score };
  }
}

export function palmCentre(lm: Landmark[]): Vec2 {
  const ids = [HL.wrist, HL.indexMcp, HL.middleMcp, HL.ringMcp, HL.pinkyMcp];
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += lm[i]!.x;
    y += lm[i]!.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}
