// Feature flags for Tier 1 / Tier 2 features. Each feature is independent and
// must degrade to the Tier 0 experience when off. Override at runtime with
// ?flags=+wall,-particles  (see docs/operations.md).
export interface Flags {
  /** T1-1: GPU particle silhouette from segmentation. */
  particles: boolean;
  /** T1-2: Flow mini-game (push the particle stream into the goal). */
  flow: boolean;
  /** T1-3: Pose walls. */
  wall: boolean;
  /** T1-4: Dodge part. */
  dodge: boolean;
  /** T1-5: Full stage structure (Intro→Flow→Wall→Dodge→Finale). Off = orbs only. */
  structure: boolean;
  /** T1-6: Dynamic difficulty. */
  dda: boolean;
  /** T1-7: Hit stop, bursts, background shader, shake. */
  fx: boolean;
  /** Use segmentation (else silhouette is built from skeleton capsules). */
  segmentation: boolean;
  /** Run tracking in a Web Worker when possible. */
  worker: boolean;
  /** T2: QR result card. */
  qr: boolean;
}

export const DEFAULT_FLAGS: Flags = {
  particles: true,
  flow: true,
  wall: true,
  dodge: true,
  structure: true,
  dda: true,
  fx: true,
  segmentation: true,
  worker: true,
  qr: false,
};

export function parseFlags(query: string | null | undefined, base: Flags = DEFAULT_FLAGS): Flags {
  const out: Flags = { ...base };
  if (!query) return out;
  for (const raw of query.split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    const on = !tok.startsWith('-');
    const name = tok.replace(/^[+-]/, '') as keyof Flags;
    if (name in out) out[name] = on;
  }
  return out;
}
