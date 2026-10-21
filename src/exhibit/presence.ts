// Presence & positioning: decides when a visitor is "ready" (in position for
// 1.5 s) and when the booth is empty long enough to return to the title.
import { EXHIBIT } from '../config';
import type { BodySnapshot } from '../input/body';

export type Placement = 'none' | 'tooClose' | 'tooFar' | 'offCenter' | 'ok';

export interface PlacementInfo {
  placement: Placement;
  /** Whether the visitor seems seated (lower body not visible but upper body well framed). */
  seated: boolean;
}

export interface PlacementOptions {
  /** Staff/visitor explicitly chose the seated (upper-body) mode. */
  forceSeated?: boolean;
  /**
   * A standing visitor who is too close looks exactly like a seated one (legs
   * out of frame). While true, missing legs are reported as 'tooClose' so the
   * guide asks people to step back; the app clears it after a few seconds and
   * then accepts the upper-body mode.
   */
  preferStanding?: boolean;
}

export function judgePlacement(b: BodySnapshot | null, o: PlacementOptions = {}): PlacementInfo {
  if (!b || !b.present) return { placement: 'none', seated: false };
  const seated = !!o.forceSeated || !b.lowerBodyVisible;
  const cx = b.anchor.x;
  if (Math.abs(cx - 0.5) > 0.22) return { placement: 'offCenter', seated };
  if (seated && !o.forceSeated && o.preferStanding) return { placement: 'tooClose', seated };
  if (seated) {
    const sw = b.anchor.unit; // shoulder width in view-height units
    if (sw > EXHIBIT.guideSeated.maxShoulderW) return { placement: 'tooClose', seated };
    if (sw < EXHIBIT.guideSeated.minShoulderW) return { placement: 'tooFar', seated };
    return { placement: 'ok', seated };
  }
  const h = b.bbox.y1 - b.bbox.y0;
  if (h > EXHIBIT.guideStanding.maxH || b.bbox.y0 < 0.01) return { placement: 'tooClose', seated };
  if (h < EXHIBIT.guideStanding.minH) return { placement: 'tooFar', seated };
  return { placement: 'ok', seated };
}

export class PresenceTracker {
  private okSince: number | null = null;
  private lastSeen = -Infinity;
  private firstSeen: number | null = null;

  /** How long the current visitor has been continuously present (ms). */
  presentFor(now: number): number {
    return this.firstSeen === null ? 0 : now - this.firstSeen;
  }

  reset(): void {
    this.okSince = null;
    this.firstSeen = null;
  }

  update(now: number, b: BodySnapshot | null, placement: Placement): void {
    if (b?.present) {
      this.lastSeen = now;
      if (this.firstSeen === null) this.firstSeen = now;
    } else if (now - this.lastSeen > EXHIBIT.lossGraceMs) {
      this.firstSeen = null;
    }
    if (placement === 'ok') this.okSince ??= now;
    else this.okSince = null;
  }

  /** 0..1 progress toward the 1.5 s start hold. */
  startProgress(now: number): number {
    if (this.okSince === null) return 0;
    return Math.min(1, (now - this.okSince) / EXHIBIT.startHoldMs);
  }

  ready(now: number): boolean {
    return this.startProgress(now) >= 1;
  }

  absentFor(now: number): number {
    return this.lastSeen === -Infinity ? Infinity : now - this.lastSeen;
  }

  /** Booth considered empty → return to title. */
  empty(now: number): boolean {
    return this.absentFor(now) >= EXHIBIT.absentReturnMs;
  }
}
