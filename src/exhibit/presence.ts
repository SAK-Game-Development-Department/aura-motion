// Hand presence & placement: start when a hand is shown in a good range for
// 1.5 s; return to the title when no hand is seen for 10 s.
import { HAND } from '../config';
import type { HandFrame } from '../gesture/tracker';

export type Placement = 'none' | 'tooClose' | 'tooFar' | 'ok';

export function judgePlacement(f: HandFrame | null): Placement {
  if (!f || !f.present) return 'none';
  const size = Math.max(...f.hands.map((h) => h.size));
  if (size > HAND.maxSize) return 'tooClose';
  if (size < HAND.minSize) return 'tooFar';
  return 'ok';
}

export class PresenceTracker {
  private okSince: number | null = null;
  private lastSeen = -Infinity;
  private firstSeen: number | null = null;

  constructor(
    private absentReturnMs: number = HAND.absentReturnMs,
    private startHoldMs: number = HAND.startHoldMs,
  ) {}

  reset(): void {
    this.okSince = null;
    this.firstSeen = null;
  }

  update(now: number, present: boolean, placement: Placement): void {
    if (present) {
      this.lastSeen = now;
      this.firstSeen ??= now;
    } else if (now - this.lastSeen > 800) this.firstSeen = null;
    if (placement === 'ok') this.okSince ??= now;
    else this.okSince = null;
  }

  presentFor(now: number): number {
    return this.firstSeen === null ? 0 : now - this.firstSeen;
  }

  startProgress(now: number): number {
    return this.okSince === null ? 0 : Math.min(1, (now - this.okSince) / this.startHoldMs);
  }

  ready(now: number): boolean {
    return this.startProgress(now) >= 1;
  }

  absentFor(now: number): number {
    return this.lastSeen === -Infinity ? Infinity : now - this.lastSeen;
  }

  empty(now: number): boolean {
    return this.absentFor(now) >= this.absentReturnMs;
  }
}
