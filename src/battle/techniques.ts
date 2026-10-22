// Technique catalogue (術). All names are original. A technique is defined by
// what the player does (requirement) and how it looks (effect kind + colour).
import type { Flags } from '../config/flags';
import type { GestureEvent } from '../gesture/engine';
import { CORE_SHAPES, SHAPE_LABEL, type ShapeId } from '../gesture/handModel';
import type { MotionKind } from '../gesture/motion';
import type { SealKind } from '../gesture/seals';
import { SIGIL_LABEL, type SigilKind } from '../gesture/sigil';

export type Req =
  | { kind: 'shape'; shape: ShapeId }
  | { kind: 'motion'; shape: ShapeId; motion: 'swipe' | 'push' | 'pull' | 'flick' }
  | { kind: 'sigil'; sigil: SigilKind }
  | { kind: 'seal'; seal: SealKind }
  | { kind: 'spread' };

export type EffectKind = 'burst' | 'wave' | 'beam' | 'twinbeam' | 'bind' | 'lightning' | 'flare' | 'hook' | 'shock' | 'slash' | 'bullet' | 'cross' | 'barrier' | 'sigil' | 'seal' | 'nova';
export type Hue = 'cyan' | 'magenta' | 'amber';

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
  { id: 'saiko', name: '砕光', reading: 'さいこう', req: { kind: 'shape', shape: 'fist' }, effect: 'burst', hue: 'amber', tier: 0, busyMs: 750 },
  { id: 'hamon', name: '波紋', reading: 'はもん', req: { kind: 'shape', shape: 'open' }, effect: 'wave', hue: 'cyan', tier: 0, busyMs: 750 },
  { id: 'sen', name: '閃', reading: 'せん', req: { kind: 'shape', shape: 'point' }, effect: 'beam', hue: 'magenta', tier: 0, busyMs: 750 },
  { id: 'sosen', name: '双閃', reading: 'そうせん', req: { kind: 'shape', shape: 'two' }, effect: 'twinbeam', hue: 'magenta', tier: 1, busyMs: 750 },
  { id: 'nui', name: '縫', reading: 'ぬい', req: { kind: 'shape', shape: 'pinch' }, effect: 'bind', hue: 'cyan', tier: 1, busyMs: 750 },
  { id: 'kakurai', name: '角雷', reading: 'かくらい', req: { kind: 'shape', shape: 'horn' }, effect: 'lightning', hue: 'amber', tier: 1, busyMs: 750 },
  { id: 'tomoshibi', name: '灯', reading: 'ともしび', req: { kind: 'shape', shape: 'thumb' }, effect: 'flare', hue: 'amber', tier: 1, busyMs: 750 },
  { id: 'kagi', name: '鉤', reading: 'かぎ', req: { kind: 'shape', shape: 'ell' }, effect: 'hook', hue: 'magenta', tier: 1, busyMs: 750 },
  { id: 'sho', name: '衝', reading: 'しょう', req: { kind: 'motion', shape: 'fist', motion: 'push' }, effect: 'shock', hue: 'amber', tier: 1, busyMs: 950 },
  { id: 'nagi', name: '薙', reading: 'なぎ', req: { kind: 'motion', shape: 'open', motion: 'swipe' }, effect: 'slash', hue: 'cyan', tier: 1, busyMs: 950 },
  { id: 'hajiki', name: '弾', reading: 'はじき', req: { kind: 'motion', shape: 'fist', motion: 'flick' }, effect: 'bullet', hue: 'magenta', tier: 1, busyMs: 900 },
  { id: 'juji', name: '十字', reading: 'じゅうじ', req: { kind: 'motion', shape: 'two', motion: 'swipe' }, effect: 'cross', hue: 'magenta', tier: 1, busyMs: 950 },
  { id: 'heki', name: '障壁', reading: 'しょうへき', req: { kind: 'motion', shape: 'open', motion: 'push' }, effect: 'barrier', hue: 'cyan', tier: 0, busyMs: 950 },
  { id: 'enjin', name: '円陣', reading: 'えんじん', req: { kind: 'sigil', sigil: 'circle' }, effect: 'sigil', hue: 'amber', tier: 1, busyMs: 2300 },
  { id: 'sanjin', name: '三角陣', reading: 'さんかくじん', req: { kind: 'sigil', sigil: 'triangle' }, effect: 'sigil', hue: 'amber', tier: 1, busyMs: 2300 },
  { id: 'raijin', name: '稲妻陣', reading: 'いなずまじん', req: { kind: 'sigil', sigil: 'zigzag' }, effect: 'sigil', hue: 'amber', tier: 1, busyMs: 2300 },
  { id: 'uzujin', name: '渦陣', reading: 'うずじん', req: { kind: 'sigil', sigil: 'spiral' }, effect: 'sigil', hue: 'amber', tier: 1, busyMs: 2500 },
  { id: 'kaibyaku', name: '開闢', reading: 'かいびゃく', req: { kind: 'spread' }, effect: 'nova', hue: 'amber', tier: 1, busyMs: 1700, alt: { kind: 'motion', shape: 'open', motion: 'push' } },
  // Seals (印): two hands. Each has a one-hand alternative.
  { id: 'in-gassho', name: '合掌', reading: 'がっしょう', req: { kind: 'seal', seal: 'gassho' }, effect: 'seal', hue: 'amber', tier: 1, busyMs: 1100, alt: { kind: 'shape', shape: 'thumb' } },
  { id: 'in-kensho', name: '拳掌', reading: 'けんしょう', req: { kind: 'seal', seal: 'kensho' }, effect: 'seal', hue: 'amber', tier: 1, busyMs: 1100, alt: { kind: 'motion', shape: 'fist', motion: 'push' } },
  { id: 'in-soshi', name: '双指', reading: 'そうし', req: { kind: 'seal', seal: 'soshi' }, effect: 'seal', hue: 'magenta', tier: 1, busyMs: 1100, alt: { kind: 'motion', shape: 'fist', motion: 'flick' } },
  { id: 'in-kanmon', name: '環門', reading: 'かんもん', req: { kind: 'seal', seal: 'kanmon' }, effect: 'seal', hue: 'cyan', tier: 1, busyMs: 1100, alt: { kind: 'shape', shape: 'ell' } },
  { id: 'in-kosa', name: '交差', reading: 'こうさ', req: { kind: 'seal', seal: 'kosa' }, effect: 'seal', hue: 'magenta', tier: 1, busyMs: 1100, alt: { kind: 'motion', shape: 'two', motion: 'swipe' } },
];

export const TECH: Record<string, Technique> = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));

/** The ultimate (boss finisher) — shown as a cinematic, triggered by completing the seal chain. */
export const ULTIMATE = { name: '天輪結界', reading: 'てんりんけっかい' };

export interface TechniqueFilter {
  flags: Pick<Flags, 'shapes8' | 'motions' | 'sigils' | 'twoHand'>;
  oneHand: boolean;
  /** Dark-room fallback: only the three core shapes. */
  coreOnly: boolean;
}

/** Techniques allowed under the current flags / fallbacks. */
export function allowedTechniques(f: TechniqueFilter): Technique[] {
  return TECHNIQUES.filter((t) => {
    if (f.coreOnly) return t.tier === 0 && t.req.kind === 'shape' && CORE_SHAPES.includes(t.req.shape);
    const r = t.req;
    if (r.kind === 'shape' && !f.flags.shapes8 && !CORE_SHAPES.includes(r.shape)) return false;
    if (r.kind === 'motion' && (!f.flags.motions || (!f.flags.shapes8 && !CORE_SHAPES.includes(r.shape)))) return false;
    if (r.kind === 'sigil' && !f.flags.sigils) return false;
    if ((r.kind === 'seal' || r.kind === 'spread') && !f.flags.twoHand && !t.alt) return false;
    return true;
  });
}

/** The requirement the player must actually perform (one-hand mode uses the alternative). */
export function effectiveReq(t: Technique, oneHand: boolean, twoHandOk: boolean): Req {
  if ((t.req.kind === 'seal' || t.req.kind === 'spread') && (oneHand || !twoHandOk) && t.alt) return t.alt;
  return t.req;
}

/** Does a gesture event satisfy a requirement? (Lenient: a held shape also counts if it was released by a motion.) */
export function matches(req: Req, e: GestureEvent): boolean {
  switch (req.kind) {
    case 'shape':
      return e.type === 'cast' && e.shape === req.shape && e.release !== 'sigil';
    case 'motion': {
      if (e.type !== 'cast' || e.shape !== req.shape) return false;
      const m = e.release as MotionKind | string;
      if (req.motion === 'swipe') return m === 'swipeL' || m === 'swipeR' || m === 'swipeU' || m === 'swipeD';
      return m === req.motion;
    }
    case 'sigil':
      return e.type === 'cast' && e.release === 'sigil' && e.sigil === req.sigil;
    case 'seal':
      return e.type === 'seal' && e.kind === req.seal;
    case 'spread':
      return e.type === 'cast' && e.release === 'twoHand';
  }
}

const SEAL_NAME: Record<SealKind, string> = { gassho: '合掌', kensho: '拳掌', soshi: '双指', kanmon: '環門', kosa: '交差' };
const MOTION_VERB = { swipe: '払う', push: '押す', pull: '引く', flick: '弾く' } as const;

/** Short hint label for a requirement (shown under the weak-point mark). */
export function reqLabel(r: Req): string {
  switch (r.kind) {
    case 'shape':
      return SHAPE_LABEL[r.shape];
    case 'motion':
      return `${SHAPE_LABEL[r.shape]} → ${MOTION_VERB[r.motion]}`;
    case 'sigil':
      return `空中に「${SIGIL_LABEL[r.sigil]}」`;
    case 'seal':
      return `印「${SEAL_NAME[r.seal]}」`;
    case 'spread':
      return '両手を合わせ → 開く';
  }
}
