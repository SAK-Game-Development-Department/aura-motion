// Technique catalogue. Short katakana names from light / astronomy / physics words (no made-up kanji compounds). A technique is defined by
// what the player does (requirement) and how it looks (effect kind + colour).
import type { Flags } from "../config/flags";
import type { GestureEvent } from "../gesture/engine";
import { CORE_SHAPES, SHAPE_LABEL, type ShapeId } from "../gesture/handModel";
import type { MotionKind } from "../gesture/motion";
import type { SealKind } from "../gesture/seals";
import { SIGIL_LABEL, type SigilKind } from "../gesture/sigil";

export type Req =
  | { kind: "shape"; shape: ShapeId }
  | {
      kind: "motion";
      shape: ShapeId;
      motion: "swipe" | "push" | "pull" | "flick";
    }
  | { kind: "sigil"; sigil: SigilKind }
  | { kind: "seal"; seal: SealKind }
  | { kind: "spread" };

export type EffectKind =
  | "burst"
  | "wave"
  | "beam"
  | "twinbeam"
  | "bind"
  | "lightning"
  | "flare"
  | "hook"
  | "shock"
  | "slash"
  | "bullet"
  | "cross"
  | "barrier"
  | "sigil"
  | "seal"
  | "nova";
export type Hue = "cyan" | "magenta" | "amber";

export interface Technique {
  id: string;
  /** Display name (original), and its reading. */
  name: string;
  reading: string;
  req: Req;
  effect: EffectKind;
  hue: Hue;
  /** Tier: 0 = the three core shapes; 1 = everything else. */
  tier: 0 | 1;
  /** One-hand alternative (for two-hand requirements). */
  alt?: Req;
  /** Seconds of the player's time this technique occupies (form + charge + release). */
  busyMs: number;
}

export const TECHNIQUES: Technique[] = [
  {
    id: "saiko",
    name: "フレア",
    reading: "握る",
    req: { kind: "shape", shape: "fist" },
    effect: "burst",
    hue: "amber",
    tier: 0,
    busyMs: 750,
  },
  {
    id: "hamon",
    name: "パルス",
    reading: "開く",
    req: { kind: "shape", shape: "open" },
    effect: "wave",
    hue: "cyan",
    tier: 0,
    busyMs: 750,
  },
  {
    id: "sen",
    name: "レーザー",
    reading: "指す",
    req: { kind: "shape", shape: "point" },
    effect: "beam",
    hue: "magenta",
    tier: 0,
    busyMs: 750,
  },
  {
    id: "sosen",
    name: "ツインレーザー",
    reading: "二指",
    req: { kind: "shape", shape: "two" },
    effect: "twinbeam",
    hue: "magenta",
    tier: 1,
    busyMs: 750,
  },
  {
    id: "nui",
    name: "ラッソ",
    reading: "摘む",
    req: { kind: "shape", shape: "pinch" },
    effect: "bind",
    hue: "cyan",
    tier: 1,
    busyMs: 750,
  },
  {
    id: "kakurai",
    name: "ライトニング",
    reading: "角",
    req: { kind: "shape", shape: "horn" },
    effect: "lightning",
    hue: "amber",
    tier: 1,
    busyMs: 750,
  },
  {
    id: "tomoshibi",
    name: "オーブ",
    reading: "親指",
    req: { kind: "shape", shape: "thumb" },
    effect: "flare",
    hue: "amber",
    tier: 1,
    busyMs: 750,
  },
  {
    id: "kagi",
    name: "グラップル",
    reading: "鉤",
    req: { kind: "shape", shape: "ell" },
    effect: "hook",
    hue: "magenta",
    tier: 1,
    busyMs: 750,
  },
  {
    id: "sho",
    name: "インパクト",
    reading: "握る → 押す",
    req: { kind: "motion", shape: "fist", motion: "push" },
    effect: "shock",
    hue: "amber",
    tier: 1,
    busyMs: 950,
  },
  {
    id: "nagi",
    name: "クレセント",
    reading: "開く → 払う",
    req: { kind: "motion", shape: "open", motion: "swipe" },
    effect: "slash",
    hue: "cyan",
    tier: 1,
    busyMs: 950,
  },
  {
    id: "hajiki",
    name: "スナイプ",
    reading: "握る → 弾く",
    req: { kind: "motion", shape: "fist", motion: "flick" },
    effect: "bullet",
    hue: "magenta",
    tier: 1,
    busyMs: 900,
  },
  {
    id: "juji",
    name: "ツインエッジ",
    reading: "二指 → 払う",
    req: { kind: "motion", shape: "two", motion: "swipe" },
    effect: "cross",
    hue: "magenta",
    tier: 1,
    busyMs: 950,
  },
  {
    id: "heki",
    name: "シールド",
    reading: "開く → 押す",
    req: { kind: "motion", shape: "open", motion: "push" },
    effect: "barrier",
    hue: "cyan",
    tier: 0,
    busyMs: 950,
  },
  {
    id: "enjin",
    name: "オービット",
    reading: "指で円を描く",
    req: { kind: "sigil", sigil: "circle" },
    effect: "sigil",
    hue: "amber",
    tier: 1,
    busyMs: 2300,
  },
  {
    id: "sanjin",
    name: "プリズム",
    reading: "指で三角を描く",
    req: { kind: "sigil", sigil: "triangle" },
    effect: "sigil",
    hue: "amber",
    tier: 1,
    busyMs: 2300,
  },
  {
    id: "raijin",
    name: "アーク",
    reading: "指でジグザグを描く",
    req: { kind: "sigil", sigil: "zigzag" },
    effect: "sigil",
    hue: "amber",
    tier: 1,
    busyMs: 2300,
  },
  {
    id: "uzujin",
    name: "サイクロン",
    reading: "指で渦を描く",
    req: { kind: "sigil", sigil: "spiral" },
    effect: "sigil",
    hue: "amber",
    tier: 1,
    busyMs: 2500,
  },
  {
    id: "kaibyaku",
    name: "スーパーノヴァ",
    reading: "両手を合わせて開く",
    req: { kind: "spread" },
    effect: "nova",
    hue: "amber",
    tier: 1,
    busyMs: 1700,
    alt: { kind: "motion", shape: "open", motion: "push" },
  },
  // Two-hand poses (seals). Each has a one-hand alternative.
  {
    id: "in-gassho",
    name: "ユニゾン",
    reading: "両手を合わせる",
    req: { kind: "seal", seal: "gassho" },
    effect: "seal",
    hue: "amber",
    tier: 1,
    busyMs: 1100,
    alt: { kind: "shape", shape: "thumb" },
  },
  {
    id: "in-kensho",
    name: "アンヴィル",
    reading: "グーを手のひらに当てる",
    req: { kind: "seal", seal: "kensho" },
    effect: "seal",
    hue: "amber",
    tier: 1,
    busyMs: 1100,
    alt: { kind: "motion", shape: "fist", motion: "push" },
  },
  {
    id: "in-soshi",
    name: "サーキット",
    reading: "人差し指の先を合わせる",
    req: { kind: "seal", seal: "soshi" },
    effect: "seal",
    hue: "magenta",
    tier: 1,
    busyMs: 1100,
    alt: { kind: "motion", shape: "fist", motion: "flick" },
  },
  {
    id: "in-kanmon",
    name: "フォーカス",
    reading: "L字で窓を作る",
    req: { kind: "seal", seal: "kanmon" },
    effect: "seal",
    hue: "cyan",
    tier: 1,
    busyMs: 1100,
    alt: { kind: "shape", shape: "ell" },
  },
  {
    id: "in-kosa",
    name: "クロスファイア",
    reading: "チョキを交差させる",
    req: { kind: "seal", seal: "kosa" },
    effect: "seal",
    hue: "magenta",
    tier: 1,
    busyMs: 1100,
    alt: { kind: "motion", shape: "two", motion: "swipe" },
  },
];

export const TECH: Record<string, Technique> = Object.fromEntries(
  TECHNIQUES.map((t) => [t.id, t]),
);


export interface TechniqueFilter {
  flags: Pick<Flags, "shapes8" | "motions" | "sigils" | "twoHand">;
  oneHand: boolean;
  /** Dark-room fallback: only the three core shapes. */
  coreOnly: boolean;
}

/** Techniques allowed under the current flags / fallbacks. */
export function allowedTechniques(f: TechniqueFilter): Technique[] {
  return TECHNIQUES.filter((t) => {
    if (f.coreOnly)
      return (
        t.tier === 0 &&
        t.req.kind === "shape" &&
        CORE_SHAPES.includes(t.req.shape)
      );
    const r = t.req;
    if (
      r.kind === "shape" &&
      !f.flags.shapes8 &&
      !CORE_SHAPES.includes(r.shape)
    )
      return false;
    if (
      r.kind === "motion" &&
      (!f.flags.motions || (!f.flags.shapes8 && !CORE_SHAPES.includes(r.shape)))
    )
      return false;
    if (r.kind === "sigil" && !f.flags.sigils) return false;
    if (
      (r.kind === "seal" || r.kind === "spread") &&
      !f.flags.twoHand &&
      !t.alt
    )
      return false;
    return true;
  });
}

/** The requirement the player must actually perform (one-hand mode uses the alternative). */
export function effectiveReq(
  t: Technique,
  oneHand: boolean,
  twoHandOk: boolean,
): Req {
  if (
    (t.req.kind === "seal" || t.req.kind === "spread") &&
    (oneHand || !twoHandOk) &&
    t.alt
  )
    return t.alt;
  return t.req;
}

/** Does a gesture event satisfy a requirement? (Lenient: a held shape also counts if it was released by a motion.) */
export function matches(req: Req, e: GestureEvent): boolean {
  switch (req.kind) {
    case "shape":
      return (
        e.type === "cast" && e.shape === req.shape && e.release !== "sigil"
      );
    case "motion": {
      if (e.type !== "cast" || e.shape !== req.shape) return false;
      const m = e.release as MotionKind | string;
      if (req.motion === "swipe")
        return (
          m === "swipeL" || m === "swipeR" || m === "swipeU" || m === "swipeD"
        );
      return m === req.motion;
    }
    case "sigil":
      return (
        e.type === "cast" && e.release === "sigil" && e.sigil === req.sigil
      );
    case "seal":
      return e.type === "seal" && e.kind === req.seal;
    case "spread":
      return e.type === "cast" && e.release === "twoHand";
  }
}

const SEAL_NAME: Record<SealKind, string> = { gassho: 'ユニゾン', kensho: 'アンヴィル', soshi: 'サーキット', kanmon: 'フォーカス', kosa: 'クロスファイア' };
const MOTION_VERB = {
  swipe: "払う",
  push: "押す",
  pull: "引く",
  flick: "弾く",
} as const;

/** Short hint label for a requirement (shown under the weak-point mark). */
export function reqLabel(r: Req): string {
  switch (r.kind) {
    case "shape":
      return SHAPE_LABEL[r.shape];
    case "motion":
      return `${SHAPE_LABEL[r.shape]} → ${MOTION_VERB[r.motion]}`;
    case "sigil":
      return `指で「${SIGIL_LABEL[r.sigil]}」`;
    case "seal":
      return `両手「${SEAL_NAME[r.seal]}」`;
    case "spread":
      return "両手を合わせ → 開く";
  }
}
