// Static shape classification.
//   RuleClassifier: soft finger states vs. templates → confidence per shape.
//   KnnClassifier:  same interface, trained from recorded samples (gesture lab).
//   ShapeStabilizer: hysteresis (enter/exit thresholds) + N-frame agreement.
import { GESTURE } from '../config';
import { featureVector, fingerStates, type Features, type Thresholds } from './features';
import type { ShapeId } from './handModel';

export type Scores = Partial<Record<ShapeId, number>>;

export interface Classifier {
  readonly name: string;
  classify(f: Features, th: Thresholds, allowed: readonly ShapeId[]): Scores;
}

type Target = 0 | 1 | null;
interface Template {
  /** [thumb, index, middle, ring, pinky]: 1 extended, 0 curled, null don't care. */
  ext: [Target, Target, Target, Target, Target];
  /** Per-finger weights. */
  w?: [number, number, number, number, number];
  /** Pinch requirement: 1 must pinch, 0 must not, null don't care. */
  pinch: Target;
}

const T: Record<ShapeId, Template> = {
  fist: { ext: [0, 0, 0, 0, 0], w: [1, 1, 1, 1, 1], pinch: null },
  open: { ext: [1, 1, 1, 1, 1], w: [0.7, 1, 1, 1, 1], pinch: 0 },
  point: { ext: [0, 1, 0, 0, 0], w: [1, 1.2, 1, 1, 1], pinch: 0 },
  two: { ext: [0, 1, 1, 0, 0], w: [0.8, 1.2, 1.2, 1, 1], pinch: 0 },
  pinch: { ext: [null, null, null, null, null], pinch: 1 },
  horn: { ext: [0, 1, 0, 0, 1], w: [0.8, 1.2, 1, 1, 1.2], pinch: 0 },
  thumb: { ext: [1, 0, 0, 0, 0], w: [1.4, 1, 1, 1, 1], pinch: null },
  ell: { ext: [1, 1, 0, 0, 0], w: [1.2, 1.2, 1, 1, 1], pinch: 0 },
};

export class RuleClassifier implements Classifier {
  readonly name = 'rule';
  classify(f: Features, th: Thresholds, allowed: readonly ShapeId[]): Scores {
    const st = fingerStates(f, th);
    const out: Scores = {};
    for (const id of allowed) {
      const t = T[id];
      let sum = 0;
      let wsum = 0;
      let worst = 1;
      t.ext.forEach((target, i) => {
        if (target === null) return;
        const w = t.w?.[i] ?? 1;
        const m = 1 - Math.abs(st.ext[i]! - target);
        sum += m * w;
        wsum += w;
        if (w >= 0.7) worst = Math.min(worst, m);
      });
      if (t.pinch !== null) {
        const m = t.pinch === 1 ? st.pinch : 1 - st.pinch;
        sum += m * 2;
        wsum += 2;
        worst = Math.min(worst, m);
      }
      if (id === 'open') {
        // A deliberate "open" spreads the fingers; a relaxed hand does not.
        sum += st.spread * 1.5;
        wsum += 1.5;
        worst = Math.min(worst, st.spread);
      }
      if (id === 'pinch') {
        // A pinch keeps the index raised; in a fist the index tip is low.
        const up = Math.max(0, Math.min(1, (f.tipUp[1] - 0.85) / 0.4));
        sum += up;
        wsum += 1;
        worst = Math.min(worst, up);
      }
      const mean = wsum > 0 ? sum / wsum : 0;
      // Soft AND: one clearly wrong finger sinks the whole template.
      out[id] = mean * Math.sqrt(worst);
    }
    return out;
  }
}

export interface Sample {
  label: ShapeId | 'none';
  vec: number[];
}

/** k-nearest-neighbour classifier over recorded feature vectors. */
export class KnnClassifier implements Classifier {
  readonly name = 'knn';
  constructor(
    private samples: Sample[],
    private k = 5,
  ) {}
  classify(f: Features, _th: Thresholds, allowed: readonly ShapeId[]): Scores {
    const v = featureVector(f);
    const d = this.samples
      .map((s) => ({ s, d: Math.hypot(...s.vec.map((x, i) => x - v[i]!)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.k);
    const out: Scores = {};
    for (const id of allowed) out[id] = 0;
    for (const { s, d: dist } of d) {
      if (s.label === 'none' || !allowed.includes(s.label)) continue;
      out[s.label] = (out[s.label] ?? 0) + 1 / this.k / (1 + dist * 2);
    }
    return out;
  }
}

export interface ShapeDecision {
  shape: ShapeId | null;
  conf: number;
  /** Best raw candidate this frame (even if not yet accepted) — for "almost there" hints. */
  best: ShapeId | null;
  bestConf: number;
  scores: Scores;
}

/** Hysteresis + N consecutive frames → flicker-free shape decisions. */
export class ShapeStabilizer {
  private current: ShapeId | null = null;
  private cand: ShapeId | null = null;
  private candN = 0;

  reset(): void {
    this.current = null;
    this.cand = null;
    this.candN = 0;
  }

  update(scores: Scores): ShapeDecision {
    let best: ShapeId | null = null;
    let bestC = 0;
    let second = 0;
    for (const [id, c] of Object.entries(scores) as Array<[ShapeId, number]>) {
      if (c > bestC) {
        second = bestC;
        bestC = c;
        best = id;
      } else if (c > second) second = c;
    }
    const strong = best !== null && bestC >= GESTURE.enterConf && bestC - second >= GESTURE.margin ? best : null;
    if (strong && strong !== this.current) {
      if (this.cand === strong) this.candN++;
      else {
        this.cand = strong;
        this.candN = 1;
      }
      // Switching away from a held shape is stricter than acquiring one.
      const need = this.current ? GESTURE.switchFrames : GESTURE.stableFrames;
      const currentWeak = !this.current || (scores[this.current] ?? 0) < GESTURE.enterConf;
      if (this.candN >= need && currentWeak) {
        this.current = strong;
        this.cand = null;
        this.candN = 0;
      }
    } else if (!strong) {
      this.cand = null;
      this.candN = 0;
    }
    if (this.current && (scores[this.current] ?? 0) < GESTURE.exitConf) this.current = null;
    return { shape: this.current, conf: this.current ? (scores[this.current] ?? 0) : 0, best, bestConf: bestC, scores };
  }
}
