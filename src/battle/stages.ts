// The three stages (one per difficulty). Names and designs are original.
// Each stage has its own spirits (look), boss and backgrounds; the numbers
// that set the difficulty are in src/config/game.ts (STAGE_TUNE).
import type { DifficultyId } from '../config';
import type { SectionKind } from './stage';

export type StageId = DifficultyId;
/** How the stage's spirits look: shadow blobs, crystals, flames. */
export type EnemyStyle = 'shade' | 'crystal' | 'flame';
export type StageTheme = 'lake' | 'stars' | 'crystal' | 'eclipse' | 'storm' | 'ember';

export interface StageDef {
  id: StageId;
  /** 初級・中級・上級 */
  level: string;
  levelEn: string;
  stars: number;
  name: string;
  reading: string;
  /** One line for the selection card. */
  desc: string;
  style: EnemyStyle;
  boss: { name: string; reading: string };
  /** Background per section. */
  themes: Record<SectionKind, StageTheme>;
  /** Section call-outs (the boss line is the boss name). */
  calls: Record<Exclude<SectionKind, 'boss' | 'hidden'>, string>;
}

export const STAGE_IDS: readonly StageId[] = ['easy', 'normal', 'hard'];

export const STAGES: Record<StageId, StageDef> = {
  easy: {
    id: 'easy',
    level: '初級',
    levelEn: 'EASY',
    stars: 1,
    name: '宵ノ湖',
    reading: 'よいのうみ',
    desc: '基本の三つの形と手の動き、やさしい両手の印。ゆったりした拍子で術を覚える。',
    style: 'shade',
    boss: { name: '夜ノ主', reading: 'よるのぬし' },
    themes: { intro: 'lake', rush: 'lake', guard: 'stars', boss: 'eclipse', hidden: 'storm' },
    calls: { intro: '湖面に影が現れた', rush: '影の群れが来る！', guard: '掌を開いて押し出し、攻撃を防げ' },
  },
  normal: {
    id: 'normal',
    level: '中級',
    levelEn: 'NORMAL',
    stars: 2,
    name: '星ノ回廊',
    reading: 'ほしのかいろう',
    desc: '八つの形・両手の印・空中の印。結晶の兵が隊列を組んで迫る。',
    style: 'crystal',
    boss: { name: '星喰ノ番人', reading: 'ほしばみのばんにん' },
    themes: { intro: 'stars', rush: 'stars', guard: 'crystal', boss: 'crystal', hidden: 'storm' },
    calls: { intro: '回廊の奥で結晶が目覚めた', rush: '結晶の隊列、接近！', guard: '突撃に備えよ ── 掌で防げ' },
  },
  hard: {
    id: 'hard',
    level: '上級',
    levelEn: 'HARD',
    stars: 3,
    name: '紅蓮ノ原',
    reading: 'ぐれんのはら',
    desc: '全ての術。速い拍子と短い猶予、三段の盾。印の四連から奥義へ。',
    style: 'flame',
    boss: { name: '緋焔ノ王', reading: 'ひえんのおう' },
    themes: { intro: 'ember', rush: 'ember', guard: 'storm', boss: 'ember', hidden: 'storm' },
    calls: { intro: '焔の原に火の霊が立つ', rush: '火の霊の大群！', guard: '炎の突進 ── 掌で受け止めろ' },
  },
};

export const HIDDEN_BOSS = { name: '暁ノ影', reading: 'あかつきのかげ' } as const;
