// Sound (all synthesized with Web Audio — see src/audio/sound.ts).
export const SOUND = {
  masterGain: 0.8,
  /** Cave reverb: tail length (s) and wet level. */
  reverbSeconds: 2.8,
  reverbMix: 0.35,
  /** Never more than this many sounds at once. */
  maxVoices: 14,
  /** The attract demo plays quieter than a real play. */
  attractDuck: 0.4,
  /** Minimum gap between two of the same sound (ms) — swarms must not machine-gun. */
  minGapMs: { cast: 60, hitPerfect: 40, hitGood: 40, kill: 50, spawn: 180, key: 30, select: 80 } as Partial<Record<string, number>>,
} as const;
