// Feature flags. Every Tier 1/2 feature is independent and must fall back to
// the Tier 0 experience when off. Override with ?flags=+sigils,-particles.
export interface Flags {
  /** T1-1: all 8 static shapes + motions (off = the 3 core shapes only). */
  shapes8: boolean;
  /** T1-1: motion-released techniques (swipe / push / pull / flick). */
  motions: boolean;
  /** T1-2: two-hand techniques (join → spread). */
  twoHand: boolean;
  /** T1-3: air-drawn sigils. */
  sigils: boolean;
  /** T1-4: chained techniques (A → B → C). */
  chains: boolean;
  /** T1-5: stage structure Intro → Rush → Guard → Boss (off = Intro only). */
  structure: boolean;
  /** Dynamic difficulty. */
  dda: boolean;
  /** T1-6: hit stop, bursts, technique effects, background shader. */
  fx: boolean;
  /** GPU particle hands. */
  particles: boolean;
  /** T1-7 (optional): body silhouette particles from the Image Segmenter. */
  segmentation: boolean;
  /** Run tracking in a Web Worker when possible. */
  worker: boolean;
  /** T2: take-home QR result card. */
  qr: boolean;
}

export const DEFAULT_FLAGS: Flags = {
  shapes8: true,
  motions: true,
  twoHand: true,
  sigils: true,
  chains: true,
  structure: true,
  dda: true,
  fx: true,
  particles: true,
  segmentation: false,
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
