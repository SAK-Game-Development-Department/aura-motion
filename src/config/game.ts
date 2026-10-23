// Battle judgement & scoring. "手応え" lives here — tweak and playtest.
export const JUDGE = {
  /** Timing window around an enemy's opening (ms). */
  perfectMs: 200,
  /**
   * How late a move still counts (GOOD). Early moves already count up to
   * EARLY_MS; people react to the ring, so they are late far more often than
   * early, and the camera adds its own lag on top.
   */
  goodMs: 720,
  /**
   * How long a step stays open after its window closes. A held shape only
   * casts after the charge and the camera adds its own lag, so the cast that
   * proves the player was on time arrives well after the window — expiring at
   * the window's edge turned those into misses (real plays: almost all rank C).
   */
  lateGraceMs: 750,
  /** Held-shape casts are judged this fraction of the charge time earlier (when the shape was formed). */
  holdLeadFraction: 0.8,
  /** Window multiplier when tracking is unstable (dark room etc.). */
  unstableWindowScale: 1.5,
  /** Two-hand seals: wider timing window, and the engine's seal assist starts this early. */
  sealWindowScale: 1.6,
  sealAssistLeadMs: 1600,
  scorePerfect: 300,
  scoreGood: 120,
  /** Rank: weighted accuracy (GOOD counts this much of a PERFECT) needed for S / A / B. */
  goodWeight: 0.75,
  rankAt: [0.85, 0.65, 0.45] as readonly [number, number, number],
  /** Combo multiplier: 1 + floor(combo / step) * add, capped. */
  comboStep: 8,
  comboAdd: 0.1,
  comboMaxMul: 2.0,
} as const;

export const DIFFICULTY = {
  window: 10,
  min: 0.7,
  max: 1.3,
  start: 1.0,
  targetMissRate: 0.2,
  rate: 0.06,
} as const;

/**
 * Stages by difficulty (初級・中級・上級). Each stage is its own place with its
 * own spirits, boss and backgrounds (src/battle/stages.ts); the numbers that
 * set how hard it is live here.
 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface StageTune {
  /** Tempo range (BPM) — enemies arrive on beats. */
  bpm: readonly [number, number];
  /** Horizon → striking distance (ms). Shorter = less time to read the mark. */
  approachMs: number;
  /** Ghost-hand tutorial spirits at the start (max 3). */
  tutorials: number;
  /** Spirits per swarm in the rush. */
  swarm: readonly [number, number];
  /** Beats between spirits of a swarm / between swarms. */
  swarmGapBeats: number;
  restBeats: number;
  /** Shielded spirits in the rush and how many techniques each needs. */
  wardens: number;
  wardenSteps: number;
  /** Seal chain length of the boss (before the drawn finisher). */
  chain: number;
  /** Timing window multiplier (1 = JUDGE.*Ms). */
  window: number;
  /** Techniques that may appear (ids from src/battle/techniques.ts). */
  techniques: readonly string[] | 'all';
  /** A generated stage must have at least this many scoreable steps per second. */
  minDensity: number;
}

export const STAGE_TUNE: Record<DifficultyId, StageTune> = {
  easy: {
    bpm: [72, 80],
    approachMs: 2900,
    tutorials: 3,
    swarm: [1, 2],
    swarmGapBeats: 3,
    restBeats: 3,
    wardens: 1,
    wardenSteps: 2,
    chain: 2,
    window: 1.3,
    minDensity: 0.15,
    techniques: ['saiko', 'hamon', 'sen', 'sho', 'nagi', 'heki', 'enjin', 'kaibyaku', 'in-gassho', 'in-kensho'],
  },
  normal: {
    bpm: [84, 96],
    approachMs: 2400,
    tutorials: 3,
    swarm: [2, 3],
    swarmGapBeats: 2,
    restBeats: 1,
    wardens: 2,
    wardenSteps: 2,
    chain: 3,
    window: 1,
    minDensity: 0.25,
    techniques: ['saiko', 'hamon', 'sen', 'sosen', 'kakurai', 'kagi', 'sho', 'nagi', 'hajiki', 'juji', 'heki', 'enjin', 'sanjin', 'raijin', 'kaibyaku', 'in-gassho', 'in-kensho', 'in-soshi', 'in-kanmon', 'in-kosa'],
  },
  hard: {
    bpm: [100, 110],
    approachMs: 2000,
    tutorials: 1,
    swarm: [3, 4],
    swarmGapBeats: 2,
    restBeats: 1,
    wardens: 3,
    wardenSteps: 3,
    chain: 4,
    window: 0.85,
    minDensity: 0.3,
    techniques: 'all',
  },
};
