import { JUDGE } from "../config";

export type Grade = "perfect" | "good" | "miss";

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  flowCaptured: number;
}

export function newScore(): ScoreState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, miss: 0 },
    flowCaptured: 0,
  };
}

export function multiplier(combo: number): number {
  return Math.min(
    JUDGE.comboMaxMul,
    1 + Math.floor(combo / JUDGE.comboStep) * JUDGE.comboAdd,
  );
}

/** Apply a judgement; returns points gained. */
export function applyGrade(s: ScoreState, g: Grade, weight = 1): number {
  s.counts[g]++;
  if (g === "miss") {
    s.combo = 0;
    return 0;
  }
  const base = g === "perfect" ? JUDGE.scorePerfect : JUDGE.scoreGood;
  const pts = Math.round(base * weight * multiplier(s.combo));
  s.combo++;
  s.maxCombo = Math.max(s.maxCombo, s.combo);
  s.score += pts;
  return pts;
}

export function accuracy(s: ScoreState): number {
  const n = s.counts.perfect + s.counts.good + s.counts.miss;
  if (n === 0) return 0;
  return (s.counts.perfect + s.counts.good * 0.5) / n;
}

export type Rank = "S" | "A" | "B" | "C";
export function rankOf(s: ScoreState): Rank {
  const a = accuracy(s);
  return a >= 0.9 ? "S" : a >= 0.75 ? "A" : a >= 0.5 ? "B" : "C";
}
