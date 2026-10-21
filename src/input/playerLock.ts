// Player lock: pick the central / largest person, stick to them across frames,
// tolerate short losses, and detect when a different visitor takes over.
import { EXHIBIT } from '../config';
import { LM, type Landmark, type Vec2 } from '../core/types';

export interface LockResult {
  pose: Landmark[] | null;
  /** True on the frame a (possibly different) person is newly locked. */
  acquired: boolean;
  /** True when the new lock looks like a different visitor than the last one. */
  newVisitor: boolean;
  /** Number of other people visible. */
  others: number;
  /** ms since the locked player was last seen (0 when visible). */
  lostMs: number;
}

interface Summary {
  center: Vec2;
  size: number; // shoulder width in height units (aspect-corrected)
  vis: number;
}

export function summarize(p: Landmark[], aspect: number): Summary | null {
  const ls = p[LM.leftShoulder];
  const rs = p[LM.rightShoulder];
  if (!ls || !rs) return null;
  const vis = (ls.v + rs.v + (p[LM.nose]?.v ?? 0)) / 3;
  const lh = p[LM.leftHip];
  const rh = p[LM.rightHip];
  const hipOk = lh && rh && lh.v > 0.3 && rh.v > 0.3;
  const cy = hipOk ? (ls.y + rs.y + lh.y + rh.y) / 4 : (ls.y + rs.y) / 2;
  return {
    center: { x: (ls.x + rs.x) / 2, y: cy },
    size: Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y),
    vis,
  };
}

/** Higher = better candidate: centred, large, confident. */
export function candidateScore(s: Summary): number {
  const centrality = 1 - Math.min(1, Math.abs(s.center.x - 0.5) * 2);
  return (0.35 + centrality) * (0.2 + s.size * 4) * (0.3 + s.vis);
}

export class PlayerLock {
  private last: Summary | null = null;
  private lastSeen = -Infinity;
  private lastAcquiredSize = 0;
  private locked = false;

  constructor(
    private graceMs: number = EXHIBIT.lossGraceMs,
    /** Max centre jump (view units) per frame for the same person. */
    private maxJump = 0.18,
    /** Absence after which a re-acquire is treated as a new visitor. */
    private visitorGapMs = 2500,
  ) {}

  reset(): void {
    this.last = null;
    this.locked = false;
    this.lastSeen = -Infinity;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  update(t: number, poses: Landmark[][], aspect: number): LockResult {
    const cands = poses
      .map((p) => ({ p, s: summarize(p, aspect) }))
      .filter((c): c is { p: Landmark[]; s: Summary } => c.s !== null && c.s.vis > 0.35);

    if (this.locked && this.last) {
      // Track: nearest candidate to the last centre.
      let best: (typeof cands)[number] | null = null;
      let bestD = Infinity;
      for (const c of cands) {
        const d = Math.hypot((c.s.center.x - this.last.center.x) * aspect, c.s.center.y - this.last.center.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best && bestD < this.maxJump * Math.max(1, (t - this.lastSeen) / 100)) {
        this.last = best.s;
        this.lastSeen = t;
        return { pose: best.p, acquired: false, newVisitor: false, others: cands.length - 1, lostMs: 0 };
      }
      const lostMs = t - this.lastSeen;
      if (lostMs < this.graceMs) {
        return { pose: null, acquired: false, newVisitor: false, others: cands.length, lostMs };
      }
      this.locked = false;
    }

    if (cands.length === 0) {
      return { pose: null, acquired: false, newVisitor: false, others: 0, lostMs: t - this.lastSeen };
    }
    cands.sort((a, b) => candidateScore(b.s) - candidateScore(a.s));
    const pick = cands[0]!;
    const gap = t - this.lastSeen;
    const sizeChange = this.lastAcquiredSize > 0 ? Math.abs(pick.s.size - this.lastAcquiredSize) / this.lastAcquiredSize : 1;
    const newVisitor = gap > this.visitorGapMs || sizeChange > 0.35;
    this.locked = true;
    this.last = pick.s;
    this.lastSeen = t;
    this.lastAcquiredSize = pick.s.size;
    return { pose: pick.p, acquired: true, newVisitor, others: cands.length - 1, lostMs: 0 };
  }
}
