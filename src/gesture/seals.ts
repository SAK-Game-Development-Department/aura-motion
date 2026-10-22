// Two-hand seals (印). Original seal set, built on traditional mudra-like
// gestures that stay readable for a hand tracker (no interlaced fingers —
// fully interlocked hands make the landmark model lose the hands).
//
//   gassho  合  palms pressed together, fingers up
//   kensho  拳掌 a fist pressed into the other open palm
//   soshi   双指 both index fingers pointing, fingertips touching
//   kanmon  環門 thumbs and index fingers form a frame (thumb tips touching)
//   kosa    交差 both "two" (V) hands crossed in front of the chest
import { HL, type Vec2 } from '../core/types';
import type { ShapeId } from './handModel';

export type SealKind = 'gassho' | 'kensho' | 'soshi' | 'kanmon' | 'kosa';
export const SEAL_IDS: SealKind[] = ['gassho', 'kensho', 'soshi', 'kanmon', 'kosa'];

export const SEAL_KANJI: Record<SealKind, string> = { gassho: '合', kensho: '拳掌', soshi: '双指', kanmon: '環門', kosa: '交差' };
export const SEAL_READING: Record<SealKind, string> = { gassho: 'がっしょう', kensho: 'けんしょう', soshi: 'そうし', kanmon: 'かんもん', kosa: 'こうさ' };

/** What a seal needs from each hand (order-free) and how close things must be (palm units). */
interface SealDef {
  shapes: [ShapeId, ShapeId];
  /** Palm-centre distance limit. */
  maxPalm?: number;
  /** Specific landmark pair distance limit: [landmark on hand A, landmark on hand B, max]. */
  touch?: [number, number, number];
}

const DEFS: Record<SealKind, SealDef> = {
  gassho: { shapes: ['open', 'open'], maxPalm: 1.5 },
  kensho: { shapes: ['fist', 'open'], maxPalm: 1.4 },
  soshi: { shapes: ['point', 'point'], touch: [HL.indexTip, HL.indexTip, 0.7] },
  kanmon: { shapes: ['ell', 'ell'], touch: [HL.thumbTip, HL.thumbTip, 0.8] },
  kosa: { shapes: ['two', 'two'], maxPalm: 1.9 },
};

export interface SealHand {
  palm: Vec2;
  size: number;
  lm: Array<{ x: number; y: number }>;
  /** Per-shape scores (soft), not just the decided shape: pressed hands are partly occluded. */
  scores: Partial<Record<ShapeId, number>>;
}

/** Score 0..1 for each seal given two hands. */
export function sealScores(a: SealHand, b: SealHand, aspect: number): Record<SealKind, number> {
  const unit = (a.size + b.size) / 2;
  const dPalm = Math.hypot((a.palm.x - b.palm.x) * aspect, a.palm.y - b.palm.y) / unit;
  const out = {} as Record<SealKind, number>;
  for (const k of SEAL_IDS) {
    const d = DEFS[k];
    const [s1, s2] = d.shapes;
    // Either hand may take either role.
    const shapeFit = Math.max(Math.min(a.scores[s1] ?? 0, b.scores[s2] ?? 0), Math.min(a.scores[s2] ?? 0, b.scores[s1] ?? 0));
    let near = 1;
    if (d.maxPalm !== undefined) near = Math.min(near, clamp01((d.maxPalm * 1.3 - dPalm) / (d.maxPalm * 0.3)));
    if (d.touch) {
      const [ia, ib, max] = d.touch;
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
    private holdMs = 280,
    private threshold = 0.7,
  ) {}

  reset(): void {
    this.cand = null;
    this.fired = null;
    this.progress = null;
  }

  update(t: number, scores: Record<SealKind, number> | null): SealKind | null {
    if (!scores) {
      this.cand = null;
      this.fired = null;
      this.progress = null;
      return null;
    }
    let best: SealKind | null = null;
    let bv = 0;
    for (const k of SEAL_IDS) {
      if (scores[k] > bv) {
        bv = scores[k];
        best = k;
      }
    }
    if (!best || bv < this.threshold) {
      this.cand = null;
      this.progress = null;
      if (bv < this.threshold * 0.6) this.fired = null;
      return null;
    }
    if (best !== this.cand) {
      this.cand = best;
      this.since = t;
    }
    const k = Math.min(1, (t - this.since) / this.holdMs);
    this.progress = { kind: best, k };
    if (k >= 1 && this.fired !== best) {
      this.fired = best;
      return best;
    }
    return null;
  }
}
