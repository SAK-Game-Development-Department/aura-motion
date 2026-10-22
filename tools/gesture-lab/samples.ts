// Labelled landmark samples (no images, ever) + offline evaluation.
import { buildHand, SHAPE_IDS, type ShapeId } from '../../src/gesture/handModel';
import { featureVector, features, normalize, type Thresholds } from '../../src/gesture/features';
import { KnnClassifier, RuleClassifier, type Classifier, type Sample as KnnSample } from '../../src/gesture/shapes';
import { GESTURE } from '../../src/config';
import type { Landmark } from '../../src/core/types';

export type Label = ShapeId | 'none';
export const LABELS: Label[] = [...SHAPE_IDS, 'none'];

export interface Sample {
  label: Label;
  /** 21 × [x, y, z] (view space, mirrored). */
  lm: number[];
  aspect: number;
  /** Session / person tag (for leave-one-person-out evaluation). */
  who: string;
}

export interface SampleFile {
  format: 'aura-gesture-samples';
  version: 1;
  createdAt: string;
  samples: Sample[];
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function toSample(label: Label, lm: Landmark[], aspect: number, who: string): Sample {
  return { label, lm: lm.flatMap((p) => [r4(p.x), r4(p.y), r4(p.z)]), aspect, who };
}

export function landmarksOf(s: Sample): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i + 2 < s.lm.length; i += 3) out.push({ x: s.lm[i]!, y: s.lm[i + 1]!, z: s.lm[i + 2]!, v: 1 });
  return out;
}

export function parseSampleFile(json: string): SampleFile {
  const f = JSON.parse(json) as SampleFile;
  if (f.format !== 'aura-gesture-samples' || f.version !== 1 || !Array.isArray(f.samples)) throw new Error('not an aura-gesture-samples v1 file');
  return f;
}

export interface Confusion {
  labels: Label[];
  /** m[truth][pred] */
  m: Record<Label, Record<Label, number>>;
  recall: Record<Label, number>;
  precision: Record<Label, number>;
  accuracy: number;
  n: number;
}

/** Per-frame decision: best shape if confident enough and clear of the runner-up, else 'none'. */
export function decide(c: Classifier, lm: Landmark[], aspect: number, th: Thresholds, shapes: readonly ShapeId[]): Label {
  const sc = c.classify(features(normalize(lm, aspect)), th, shapes);
  const sorted = Object.entries(sc).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const [best, second] = [sorted[0], sorted[1]];
  if (!best || (best[1] ?? 0) < GESTURE.enterConf || (best[1] ?? 0) - (second?.[1] ?? 0) < GESTURE.margin) return 'none';
  return best[0] as ShapeId;
}

export function confusion(samples: Sample[], predict: (s: Sample, i: number) => Label): Confusion {
  const labels = LABELS;
  const m = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(labels.map((b) => [b, 0]))])) as Confusion['m'];
  let ok = 0;
  samples.forEach((s, i) => {
    const p = predict(s, i);
    m[s.label][p]++;
    if (p === s.label) ok++;
  });
  const recall = {} as Confusion['recall'];
  const precision = {} as Confusion['precision'];
  for (const a of labels) {
    const row = labels.reduce((x, b) => x + m[a][b], 0);
    const col = labels.reduce((x, b) => x + m[b][a], 0);
    recall[a] = row ? m[a][a] / row : NaN;
    precision[a] = col ? m[a][a] / col : NaN;
  }
  return { labels, m, recall, precision, accuracy: samples.length ? ok / samples.length : NaN, n: samples.length };
}

export function evalRule(samples: Sample[], th: Thresholds, shapes: readonly ShapeId[] = SHAPE_IDS): Confusion {
  const c = new RuleClassifier();
  return confusion(samples, (s) => decide(c, landmarksOf(s), s.aspect, th, shapes));
}

/** kNN, leave-one-person-out when several people are recorded, else leave-one-out. */
export function evalKnn(samples: Sample[], th: Thresholds, k = 5, shapes: readonly ShapeId[] = SHAPE_IDS): Confusion {
  const vecs: KnnSample[] = samples.map((s) => ({ label: s.label, vec: featureVector(features(normalize(landmarksOf(s), s.aspect))) }));
  const people = new Set(samples.map((s) => s.who));
  return confusion(samples, (s, i) => {
    const train = vecs.filter((_, j) => (people.size > 1 ? samples[j]!.who !== s.who : j !== i));
    return decide(new KnnClassifier(train, k), landmarksOf(s), s.aspect, th, shapes);
  });
}

/** Synthetic samples (to try the lab without a camera). */
export function syntheticHandLm(h: Parameters<typeof buildHand>[0]): Landmark[] {
  return buildHand(h);
}
