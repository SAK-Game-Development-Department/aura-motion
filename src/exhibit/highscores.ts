// High scores in localStorage (score + auto nickname only — no personal data).
import { EXHIBIT } from '../config';

export interface ScoreEntry {
  score: number;
  name: string;
  rank: string;
  /** Unix ms. */
  at: number;
  seated: boolean;
  /** Stage (difficulty) id; entries from before stages count as 'normal'. */
  stage?: string;
}

const stageOf = (e: ScoreEntry) => e.stage ?? 'normal';

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

  private all(): ScoreEntry[] {
    try {
      const raw = this.kv?.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as ScoreEntry[];
      return Array.isArray(arr) ? arr.filter((e) => typeof e.score === 'number') : [];
    } catch {
      return [];
    }
  }

  /** Best scores (of one stage, or of all stages). */
  list(stage?: string): ScoreEntry[] {
    const all = this.all();
    return (stage ? all.filter((e) => stageOf(e) === stage) : all).sort((a, b) => b.score - a.score || a.at - b.at).slice(0, EXHIBIT.highscores);
  }

  /** Insert; returns 0-based rank in its stage's table or -1 if it did not place. Each stage keeps its own top N. */
  add(e: ScoreEntry): number {
    const st = stageOf(e);
    const mine = [...this.all().filter((x) => stageOf(x) === st), e].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, EXHIBIT.highscores);
    const idx = mine.indexOf(e);
    const others = this.all().filter((x) => stageOf(x) !== st);
    try {
      this.kv?.setItem(KEY, JSON.stringify([...others, ...mine]));
    } catch {
      /* storage full / blocked: scores just won't persist */
    }
    return idx;
  }

  /** Scores achieved today (for the daily ranking). */
  today(now = Date.now(), stage?: string): ScoreEntry[] {
    const d = new Date(now).toDateString();
    return this.list(stage).filter((e) => new Date(e.at).toDateString() === d);
  }
}
