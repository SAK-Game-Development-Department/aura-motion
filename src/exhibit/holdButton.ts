// Hands-free buttons: hold a hand over the button for 1 s to select it.
import { EXHIBIT } from '../config';
import type { Vec2 } from '../core/types';

export interface HoldButtonSpec {
  id: string;
  /** Centre in view space. */
  pos: Vec2;
  /** Radius in view-height units. */
  r?: number;
}

export class HoldButtons {
  private progress = new Map<string, number>();
  private lastT: number | null = null;
  private fired = new Set<string>();

  constructor(public buttons: HoldButtonSpec[] = []) {}

  set(buttons: HoldButtonSpec[]): void {
    this.buttons = buttons;
    this.progress.clear();
    this.fired.clear();
  }

  /** Returns the id of a button that completed its hold this tick (once). */
  update(now: number, hands: Vec2[], aspect: number): string | null {
    const dt = this.lastT === null ? 0 : Math.min(100, now - this.lastT);
    this.lastT = now;
    let done: string | null = null;
    for (const b of this.buttons) {
      const r = b.r ?? EXHIBIT.buttonRadius;
      const over = hands.some((h) => Math.hypot((h.x - b.pos.x) * aspect, h.y - b.pos.y) < r);
      const p = this.progress.get(b.id) ?? 0;
      // Fill while hovering, drain twice as fast when leaving (forgiving jitter).
      const np = over ? Math.min(1, p + dt / EXHIBIT.buttonHoldMs) : Math.max(0, p - (2 * dt) / EXHIBIT.buttonHoldMs);
      this.progress.set(b.id, np);
      if (np >= 1 && !this.fired.has(b.id)) {
        this.fired.add(b.id);
        done = b.id;
      }
      if (np === 0) this.fired.delete(b.id);
    }
    return done;
  }

  progressOf(id: string): number {
    return this.progress.get(id) ?? 0;
  }
}
