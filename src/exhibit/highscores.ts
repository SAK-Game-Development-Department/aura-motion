// High scores in localStorage (score + auto nickname only — no personal data).
import { EXHIBIT } from '../config';

export interface ScoreEntry {
  score: number;
  name: string;
  rank: string;
  /** Unix ms. */
  at: number;
  seated: boolean;
  /** Stage id (e.g. 'yoi'). */
  stage?: string;
  /** Difficulty ('easy' | 'normal' | 'hard'). Rankings are per difficulty. */
  diff?: string;
  /** Stage name for display (e.g. ミラーレイク). */
  stageName?: string;
}

const LEGACY = ['easy', 'normal', 'hard'];
/** Difficulty of an entry (older entries stored the difficulty as `stage`, or nothing → normal). */
export const diffOf = (e: ScoreEntry) => e.diff ?? (e.stage && LEGACY.includes(e.stage) ? e.stage : 'normal');

export interface ScoreFilter {
  diff?: string;
  stage?: string;
}
const pass = (e: ScoreEntry, f?: ScoreFilter) => (!f?.diff || diffOf(e) === f.diff) && (!f?.stage || e.stage === f.stage);

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

  /** Best scores (of one difficulty / stage, or of everything). */
  list(f?: ScoreFilter): ScoreEntry[] {
    return this.all()
      .filter((e) => pass(e, f))
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, EXHIBIT.highscores);
  }

  /** Insert; returns 0-based rank in its difficulty's table or -1 if it did not place. Each difficulty keeps its own top N. */
  add(e: ScoreEntry): number {
    const d = diffOf(e);
    const mine = [...this.all().filter((x) => diffOf(x) === d), e].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, EXHIBIT.highscores);
    const idx = mine.indexOf(e);
    const others = this.all().filter((x) => diffOf(x) !== d);
    try {
      this.kv?.setItem(KEY, JSON.stringify([...others, ...mine]));
    } catch {
      /* storage full / blocked: scores just won't persist */
    }
    return idx;
  }

  /** Scores achieved today (for the daily ranking). */
  today(now = Date.now(), f?: ScoreFilter): ScoreEntry[] {
    const d = new Date(now).toDateString();
    return this.list(f).filter((e) => new Date(e.at).toDateString() === d);
  }
}
