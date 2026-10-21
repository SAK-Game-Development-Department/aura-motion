// Procedural stage generation + human-limit validation.
export const STAGE = {
  durationMs: 90_000,
  bpmMin: 96,
  bpmMax: 124,
  /** Section boundaries (fractions of total) when all Tier 1 sections are on. */
  sections: [
    { kind: 'intro', len: 0.22 },
    { kind: 'flow', len: 0.16 },
    { kind: 'wall', len: 0.2 },
    { kind: 'dodge', len: 0.18 },
    { kind: 'finale', len: 0.24 },
  ],
  /** Orb lead-in: first orb not before this time (ms). */
  leadInMs: 2500,
  /** Reach zone in body units (x: shoulder widths from mid-shoulder, y: up is negative). */
  reach: { xMin: -2.3, xMax: 2.3, yMin: -2.4, yMax: 1.4 },
  reachSeated: { xMin: -2.0, xMax: 2.0, yMin: -2.2, yMax: 0.6 },
  /** Centre dead-zone half-width; orbs here may be hit by either hand. */
  centreBand: 0.35,
} as const;

/** Human limits used by the validator (docs/decisions.md §stage-limits). */
export const HUMAN_LIMITS = {
  /** Max hand travel speed, body units per second (≈ 2.5 m/s at 0.4 m shoulder width ×… conservative). */
  handSpeed: 4.2,
  /** Min interval between orbs assigned to the same hand (ms). */
  sameHandMinMs: 300,
  /** Min time between two pose walls (ms). */
  poseTransitionMs: 1800,
  /** Min interval between jumps (ms). */
  jumpIntervalMs: 2000,
  /** Min interval between any two dodges (ms). */
  dodgeIntervalMs: 1200,
  /** Max simultaneous orbs (one per hand). */
  maxSimultaneous: 2,
  /** Simultaneous orbs must be on opposite sides with at least this gap (body units). */
  simultaneousMinGap: 1.2,
} as const;

export const POSE = {
  /** Similarity threshold to pass a wall at difficulty 1.0 (0..1). */
  passThreshold: 0.78,
  /** Perfect threshold. */
  perfectThreshold: 0.9,
  /** Wall approach duration (ms). */
  approachMs: 3200,
  /** Judge window: best score over [t - before, t + after]. */
  windowBeforeMs: 500,
  windowAfterMs: 150,
} as const;

export const DODGE = {
  approachMs: 1800,
  /** Jump: hip rises by this fraction of torso length. */
  jumpRise: 0.12,
  /** Crouch: shoulders drop by this fraction of torso length. */
  crouchDrop: 0.22,
  /** Lean: shoulder-mid x offset from baseline, in shoulder widths. */
  leanOffset: 0.55,
  /** Seated "duck": head drops by this fraction of torso length. */
  seatedDuckDrop: 0.18,
  /** How long before/after arrival the evasive state counts (ms). */
  windowBeforeMs: 350,
  windowAfterMs: 200,
} as const;

export const FLOW = {
  /** CPU tracer count used for scoring (deterministic). */
  tracers: 600,
  emitPerSec: 120,
  baseSpeed: 0.35, // normalized screen units / s
  /** Body push strength and radius (normalized units). */
  pushRadius: 0.06,
  pushStrength: 2.2,
  /** Limb velocity transfer factor. */
  dragFactor: 0.9,
  goalRadius: 0.09,
  /** Particles entering goal -> points. */
  pointsPerTracer: 5,
} as const;

export const DIFFICULTY = {
  /** Rolling window of recent judgements. */
  window: 12,
  min: 0.7,
  max: 1.3,
  start: 1.0,
  /** Target miss rate. Above -> easier, below -> harder. */
  targetMissRate: 0.2,
  /** Adaptation rate per judgement. */
  rate: 0.06,
} as const;
