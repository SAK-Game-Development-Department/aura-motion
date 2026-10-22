// Two-hand seals (印). Original seal set, built on traditional mudra-like
// gestures that stay readable for a hand tracker (no interlaced fingers —
// fully interlocked hands make the landmark model lose the hands).
//
//   gassho  合  palms pressed together, fingers up
//   kensho  拳掌 a fist pressed into the other open palm
//   soshi   双指 both index fingers pointing, fingertips touching
//   kanmon  環門 thumbs and index fingers form a frame (thumb tips touching)
//   kosa    交差 both "two" (V) hands crossed in front of the chest
import { GESTURE } from '../config';
import { HL, type Vec2 } from '../core/types';
import type { ShapeId } from './handModel';

export type SealKind = 'gassho' | 'kensho' | 'soshi' | 'kanmon' | 'kosa';
export const SEAL_IDS: SealKind[] = ['gassho', 'kensho', 'soshi', 'kanmon', 'kosa'];

export const SEAL_KANJI: Record<SealKind, string> = { gassho: '合掌', kensho: 'グーとパー', soshi: '指タッチ', kanmon: 'フレーム', kosa: 'クロスチョキ' };
export const SEAL_READING: Record<SealKind, string> = { gassho: 'がっしょう', kensho: 'けんしょう', soshi: 'そうし', kanmon: 'かんもん', kosa: 'こうさ' };

/** What a seal needs from each hand (order-free) and how close things must be (palm units). */
interface SealDef {
  shapes: [ShapeId, ShapeId];
  /**
   * Shapes also accepted for each role when the game is waiting for this seal
   * ("assist"): hands pressed together hide fingers from the camera, so the
   * per-hand shape is often misread even when the seal is right.
   */
  loose: [ShapeId[], ShapeId[]];
  /** Palm-centre distance limit. */
  maxPalm?: number;
  /** Specific landmark pair distance limit: [landmark on hand A, landmark on hand B, max]. */
  touch?: [number, number, number];
}

const DEFS: Record<SealKind, SealDef> = {
  gassho: { shapes: ['open', 'open'], loose: [['open', 'two', 'point', 'thumb', 'horn'], ['open', 'two', 'point', 'thumb', 'horn']], maxPalm: 1.5 },
  kensho: { shapes: ['fist', 'open'], loose: [['fist', 'thumb', 'pinch'], ['open', 'two', 'thumb', 'ell']], maxPalm: 1.4 },
  soshi: { shapes: ['point', 'point'], loose: [['point', 'two', 'ell', 'horn'], ['point', 'two', 'ell', 'horn']], touch: [HL.indexTip, HL.indexTip, 0.7] },
  kanmon: { shapes: ['ell', 'ell'], loose: [['ell', 'point', 'open', 'pinch', 'two'], ['ell', 'point', 'open', 'pinch', 'two']], touch: [HL.thumbTip, HL.thumbTip, 0.8] },
  kosa: { shapes: ['two', 'two'], loose: [['two', 'point', 'horn', 'open'], ['two', 'point', 'horn', 'open']], maxPalm: 1.9 },
};

export interface SealHand {
  palm: Vec2;
  size: number;
  lm: Array<{ x: number; y: number }>;
  /** Per-shape scores (soft), not just the decided shape: pressed hands are partly occluded. */
  scores: Partial<Record<ShapeId, number>>;
}

/** Score 0..1 for each seal given two hands. Seals in `assist` also accept their loose shapes and a looser distance. */
export function sealScores(a: SealHand, b: SealHand, aspect: number, assist?: ReadonlySet<SealKind>): Record<SealKind, number> {
  const unit = (a.size + b.size) / 2;
  const dPalm = Math.hypot((a.palm.x - b.palm.x) * aspect, a.palm.y - b.palm.y) / unit;
  const out = {} as Record<SealKind, number>;
  for (const k of SEAL_IDS) {
    const d = DEFS[k];
    const loose = assist?.has(k) ?? false;
    const r1: readonly ShapeId[] = loose ? d.loose[0] : [d.shapes[0]];
    const r2: readonly ShapeId[] = loose ? d.loose[1] : [d.shapes[1]];
    const fit = (h: SealHand, role: readonly ShapeId[]) => role.reduce((m, s) => Math.max(m, h.scores[s] ?? 0), 0);
    // Either hand may take either role.
    const shapeFit = Math.max(Math.min(fit(a, r1), fit(b, r2)), Math.min(fit(a, r2), fit(b, r1)));
    const slack = loose ? GESTURE.seal.assistDistance : 1;
    let near = 1;
    if (d.maxPalm !== undefined) near = Math.min(near, clamp01((d.maxPalm * slack * 1.3 - dPalm) / (d.maxPalm * slack * 0.3)));
    if (d.touch) {
      const [ia, ib, max0] = d.touch;
      const max = max0 * slack;
      const pa = a.lm[ia]!;
      const pb = b.lm[ib]!;
      const dt = Math.hypot((pa.x - pb.x) * aspect, pa.y - pb.y) / unit;
      near = Math.min(near, clamp01((max * 1.4 - dt) / (max * 0.4)));
      // Hands must also be reasonably close overall.
      near = Math.min(near, clamp01((4 - dPalm) / 1));
    }
    // Pressed / touching hands occlude each other: be lenient on shape (0.5 → full).
    out[k] = Math.min(1, shapeFit / 0.5) * near;
  }
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Hold a seal for `holdMs` to complete it; re-arm when the hands part or the seal changes. */
export class SealDetector {
  private cand: SealKind | null = null;
  private since = 0;
  private fired: SealKind | null = null;
  /** Current candidate and its hold progress (for the "forming the seal" visual). */
  progress: { kind: SealKind; k: number } | null = null;

  constructor(
    private holdMs: number = GESTURE.seal.holdMs,
    private threshold: number = GESTURE.seal.threshold,
  ) {}

  reset(): void {
    this.cand = null;
    this.fired = null;
    this.progress = null;
  }

  /** `assist`: seals the game is waiting for — a lower bar and a shorter hold, and they win over other seals. */
  update(t: number, scores: Record<SealKind, number> | null, assist?: ReadonlySet<SealKind>): SealKind | null {
    if (!scores) {
      this.cand = null;
      this.fired = null;
      this.progress = null;
      return null;
    }
    let best: SealKind | null = null;
    let bv = 0;
    let max = 0;
    for (const k of SEAL_IDS) max = Math.max(max, scores[k]);
    // An awaited seal above the assist bar wins.
    if (assist) {
      for (const k of assist) {
        if (scores[k] >= GESTURE.seal.assistThreshold && scores[k] > bv) {
          bv = scores[k];
          best = k;
        }
      }
    }
    const assisted = best !== null;
    if (!best) {
      for (const k of SEAL_IDS) {
        if (scores[k] > bv) {
          bv = scores[k];
          best = k;
        }
      }
    }
    if (!best || (!assisted && bv < this.threshold)) {
      this.cand = null;
      this.progress = null;
      if (max < this.threshold * 0.6 && !(assist && max >= GESTURE.seal.assistThreshold * 0.6)) this.fired = null;
      return null;
    }
    if (best !== this.cand) {
      this.cand = best;
      this.since = t;
    }
    const k = Math.min(1, (t - this.since) / (assisted ? GESTURE.seal.assistHoldMs : this.holdMs));
    this.progress = { kind: best, k };
    if (k >= 1 && this.fired !== best) {
      this.fired = best;
      return best;
    }
    return null;
  }
}
