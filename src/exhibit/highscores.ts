// High scores in localStorage (score + auto nickname only — no personal data).
import { EXHIBIT } from '../config';

export interface ScoreEntry {
  score: number;
  name: string;
  rank: string;
  /** Unix ms. */
  at: number;
  seated: boolean;
}

const KEY = 'aura.highscores.v1';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function storage(): KV | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class HighScores {
  constructor(private kv: KV | null = storage()) {}

  list(): ScoreEntry[] {
    try {
      const raw = this.kv?.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as ScoreEntry[];
      return Array.isArray(arr) ? arr.filter((e) => typeof e.score === 'number').slice(0, EXHIBIT.highscores) : [];
    } catch {
      return [];
    }
  }

  /** Insert; returns 0-based rank in the table or -1 if it did not place. */
  add(e: ScoreEntry): number {
    const all = [...this.list(), e].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, EXHIBIT.highscores);
    const idx = all.indexOf(e);
    try {
      this.kv?.setItem(KEY, JSON.stringify(all));
    } catch {
      /* storage full / blocked: scores just won't persist */
    }
    return idx;
  }

  /** Scores achieved today (for the daily ranking). */
  today(now = Date.now()): ScoreEntry[] {
    const d = new Date(now).toDateString();
    return this.list().filter((e) => new Date(e.at).toDateString() === d);
  }
}
