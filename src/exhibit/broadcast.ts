// Same-origin, in-browser state sharing for the audience window
// (BroadcastChannel — never leaves the machine). Numbers only, no images.
import type { ScoreEntry } from './highscores';

export interface AudienceState {
  phase: string;
  score: number;
  combo: number;
  section: string | null;
  progress: number;
  present: boolean;
  lastJudge: { grade: string; at: number } | null;
  ranking: ScoreEntry[];
  stats: { fps: number; latencyMs: number; particles: number; backend: string; tracking: string; trackFps: number };
  /** Coarse body skeleton (view coords) for the audience mini-view. */
  skeleton: number[] | null;
}

export const CHANNEL = 'aura-audience-v1';

export class Broadcaster {
  private ch: BroadcastChannel | null = null;
  private last = 0;
  constructor() {
    try {
      this.ch = new BroadcastChannel(CHANNEL);
    } catch {
      this.ch = null;
    }
  }
  /** Rate-limited to ~10 Hz. */
  send(now: number, s: AudienceState): void {
    if (!this.ch || now - this.last < 100) return;
    this.last = now;
    this.ch.postMessage(s);
  }
}
