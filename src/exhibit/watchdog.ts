// Watchdog: detects stalls and error storms and decides on a recovery action.
// Escalation: soft reset (back to title) → restart tracking → full reload,
// with a reload backoff stored in sessionStorage to avoid reload loops.
import { EXHIBIT } from '../config';

export type RecoveryAction = 'none' | 'softReset' | 'restartTracking' | 'reload';

export interface WatchdogInput {
  now: number;
  lastFrameAt: number;
  /** ms since the last tracking result (0 = not applicable). */
  trackingAge: number;
  trackingExpected: boolean;
  cameraTrackEnded: boolean;
}

export class Watchdog {
  private errors: number[] = [];
  private lastRestartTracking = -Infinity;
  private trackingRestarts = 0;

  recordError(now: number): void {
    this.errors.push(now);
    this.errors = this.errors.filter((t) => now - t < 60_000);
  }

  get errorsLastMinute(): number {
    return this.errors.length;
  }

  check(i: WatchdogInput): RecoveryAction {
    const cfg = EXHIBIT.watchdog;
    if (i.now - i.lastFrameAt > cfg.rafStallMs) return 'reload';
    if (this.errors.length >= cfg.maxErrorsPerMinute) {
      this.errors = [];
      return this.trackingRestarts > 3 ? 'reload' : 'softReset';
    }
    if (i.trackingExpected && (i.cameraTrackEnded || i.trackingAge > cfg.trackingStallMs)) {
      if (i.now - this.lastRestartTracking > 10_000) {
        this.lastRestartTracking = i.now;
        this.trackingRestarts++;
        return this.trackingRestarts > 5 ? 'reload' : 'restartTracking';
      }
    }
    return 'none';
  }

  noteTrackingHealthy(): void {
    this.trackingRestarts = 0;
  }
}

/** Reload guard: refuse to reload more often than the backoff allows. */
export function canReload(now: number, store: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  try {
    const last = Number(store?.getItem('aura.lastReload') ?? 0);
    if (now - last < EXHIBIT.watchdog.reloadBackoffMs) return false;
    store?.setItem('aura.lastReload', String(now));
    return true;
  } catch {
    return true;
  }
}
