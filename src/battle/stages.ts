// Stages: three difficulties × three stages. Short katakana names (the plain
// Japanese name goes in `reading`, shown under the title); designs are original.
// Each stage has its own spirits (look and colour), boss, backgrounds and a
// flavour (which kind of technique it favours). The numbers that set how hard a
// difficulty is live in src/config/game.ts (STAGE_TUNE).
import type { DifficultyId } from '../config';
import type { SectionKind } from './stage';
import type { Req } from './techniques';

export type StageId = 'yoi' | 'shinkai' | 'setsugetsu' | 'hoshi' | 'raimei' | 'hanagasumi' | 'guren' | 'gesshoku' | 'kokuu';
/** How the stage's spirits look: shadow blobs, crystals, flames, jellyfish. */
export type EnemyStyle = 'shade' | 'crystal' | 'flame' | 'jelly';
/** Extra ornaments drawn on the spirits. */
export type EnemyDecor = 'none' | 'arcs' | 'petals' | 'snow';
export type StageTheme = 'lake' | 'stars' | 'crystal' | 'eclipse' | 'storm' | 'ember' | 'sea' | 'snow' | 'thunder' | 'petal';
export type RimColor = 'cyan' | 'magenta' | 'amber' | 'white' | 'vermilion';

export interface DifficultyDef {
  id: DifficultyId;
  level: string;
  levelEn: string;
  stars: number;
  desc: string;
  hue: 'magenta' | 'cyan' | 'vermilion';
}

export interface StageDef {
  id: StageId;
  difficulty: DifficultyId;
  name: string;
  reading: string;
  /** One line for the selection card. */
  desc: string;
  style: EnemyStyle;
  decor: EnemyDecor;
  /** Rim colour of ordinary spirits and of shielded ones. */
  rim: RimColor;
  rimWarden: RimColor;
  boss: { name: string; reading: string };
  /** Background per section. */
  themes: Record<SectionKind, StageTheme>;
  /** Section call-outs (the boss line is the boss name). */
  calls: Record<Exclude<SectionKind, 'boss' | 'hidden'>, string>;
  /** Which kind of single technique this stage leans on (the rest still appear). */
  favor: Array<Req['kind']>;
}

export const DIFFICULTY_IDS: readonly DifficultyId[] = ['easy', 'normal', 'hard'];

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: { id: 'easy', level: '初級', levelEn: 'EASY', stars: 1, desc: 'グー・パー・指さしと手の動き、かんたんな両手ポーズ。ゆっくりのテンポで慣れよう。', hue: 'magenta' },
  normal: { id: 'normal', level: '中級', levelEn: 'NORMAL', stars: 2, desc: '8つの手の形、両手ポーズ、指で描く図形。テンポも上がる。', hue: 'cyan' },
  hard: { id: 'hard', level: '上級', levelEn: 'HARD', stars: 3, desc: '全部の技。速いテンポと短い判定、3段の盾。ボスは両手ポーズ4連続。', hue: 'vermilion' },
};

const BASE_THEMES = (main: StageTheme, guard: StageTheme, boss: StageTheme): Record<SectionKind, StageTheme> => ({ intro: main, rush: main, guard, boss, hidden: 'storm' });

export const STAGES: Record<StageId, StageDef> = {
  // ── 初級 ──
  yoi: {
    id: 'yoi', difficulty: 'easy', name: 'ミラーレイク', reading: '月夜の湖',
    desc: '静かな湖に影がゆらゆら。まずはここから。',
    style: 'shade', decor: 'none', rim: 'magenta', rimWarden: 'cyan',
    boss: { name: 'ミラージュ', reading: '湖の幻' },
    themes: BASE_THEMES('lake', 'stars', 'eclipse'),
    calls: { intro: '湖から影が出てきた', rush: '影がたくさん来る！', guard: 'パーで押して攻撃を防ごう' },
    favor: ['shape'],
  },
  shinkai: {
    id: 'shinkai', difficulty: 'easy', name: 'ディープブルー', reading: '深海',
    desc: '光の届かない海の底。ふわふわ漂うクラゲを、押す・払うで追い返そう。',
    style: 'jelly', decor: 'none', rim: 'cyan', rimWarden: 'white',
    boss: { name: 'メデューサ', reading: '巨大クラゲ' },
    themes: BASE_THEMES('sea', 'sea', 'sea'),
    calls: { intro: 'クラゲが近づいてくる', rush: 'クラゲの大群！', guard: 'パーで押して触手を防ごう' },
    favor: ['motion'],
  },
  setsugetsu: {
    id: 'setsugetsu', difficulty: 'easy', name: 'フロストガーデン', reading: '白銀の庭',
    desc: '月明かりの雪の庭。氷の結晶がゆっくり降りてくる。',
    style: 'crystal', decor: 'snow', rim: 'white', rimWarden: 'cyan',
    boss: { name: 'スノークイーン', reading: '氷の女王' },
    themes: BASE_THEMES('snow', 'snow', 'eclipse'),
    calls: { intro: '雪の中に何かいる', rush: '吹雪といっしょに来る！', guard: 'パーで押して氷を防ごう' },
    favor: ['shape', 'seal'],
  },
  // ── 中級 ──
  hoshi: {
    id: 'hoshi', difficulty: 'normal', name: 'スターロード', reading: '星の回廊',
    desc: '光が流れるトンネル。結晶の敵が列を作って向かってくる。',
    style: 'crystal', decor: 'none', rim: 'cyan', rimWarden: 'white',
    boss: { name: 'ゲートキーパー', reading: '星の門番' },
    themes: BASE_THEMES('stars', 'crystal', 'crystal'),
    calls: { intro: '結晶が動き出した', rush: '列になって来る！', guard: '突進してくる！パーで押して防ごう' },
    favor: ['shape', 'motion'],
  },
  raimei: {
    id: 'raimei', difficulty: 'normal', name: 'サンダーピーク', reading: '雷鳴の峰',
    desc: '雷雲の山。ビリビリした敵には、払う・弾くの速い技で。',
    style: 'crystal', decor: 'arcs', rim: 'amber', rimWarden: 'white',
    boss: { name: 'ストームクラウド', reading: '雷雲' },
    themes: BASE_THEMES('thunder', 'thunder', 'storm'),
    calls: { intro: '雷雲の中に何かいる', rush: '稲妻みたいに速いぞ！', guard: '落雷！パーで押して防ごう' },
    favor: ['motion'],
  },
  hanagasumi: {
    id: 'hanagasumi', difficulty: 'normal', name: 'ブロッサムヒル', reading: '花吹雪の丘',
    desc: '花びらが舞う丘。両手ポーズと指で描く図形で戦う。',
    style: 'shade', decor: 'petals', rim: 'magenta', rimWarden: 'amber',
    boss: { name: '千年桜', reading: 'せんねんざくら' },
    themes: BASE_THEMES('petal', 'petal', 'eclipse'),
    calls: { intro: '花の向こうに影がいる', rush: '花吹雪といっしょに来る！', guard: 'パーで押して受け止めよう' },
    favor: ['seal', 'sigil'],
  },
  // ── 上級 ──
  guren: {
    id: 'guren', difficulty: 'hard', name: 'インフェルノ', reading: '灼熱の荒野',
    desc: '燃えさかる荒野。火の玉の大群と、炎をまとう巨人。',
    style: 'flame', decor: 'none', rim: 'vermilion', rimWarden: 'magenta',
    boss: { name: 'ボルケーノ', reading: '炎の巨人' },
    themes: BASE_THEMES('ember', 'storm', 'ember'),
    calls: { intro: '炎の中から出てきた', rush: '火の玉の大群！', guard: '突進！パーで押して防ごう' },
    favor: ['shape', 'motion'],
  },
  gesshoku: {
    id: 'gesshoku', difficulty: 'hard', name: 'エクリプス', reading: '月食の夜',
    desc: '黒い月の下。白く光る影が、両手ポーズを次々に求めてくる。',
    style: 'shade', decor: 'none', rim: 'white', rimWarden: 'amber',
    boss: { name: 'ブラックムーン', reading: '黒い月' },
    themes: BASE_THEMES('eclipse', 'stars', 'eclipse'),
    calls: { intro: '月が欠けてきた…', rush: '影の群れ！', guard: 'パーで押して防ごう' },
    favor: ['seal', 'shape'],
  },
  kokuu: {
    id: 'kokuu', difficulty: 'hard', name: 'ストームアイ', reading: '嵐の中心',
    desc: '全部を吸い込む渦の中。いちばん速い戦い。',
    style: 'jelly', decor: 'arcs', rim: 'magenta', rimWarden: 'cyan',
    boss: { name: 'ボルテックス', reading: '渦の王' },
    themes: BASE_THEMES('storm', 'thunder', 'storm'),
    calls: { intro: '渦から何か出てくる', rush: '渦に乗って大群が来る！', guard: 'パーで押して防ごう' },
    favor: ['sigil', 'motion'],
  },
};

export const STAGE_IDS = Object.keys(STAGES) as StageId[];

export function stagesOf(d: DifficultyId): StageDef[] {
  return STAGE_IDS.map((id) => STAGES[id]).filter((s) => s.difficulty === d);
}

export const HIDDEN_BOSS = { name: 'ボイド', reading: '隠しボス' } as const;
/** The finishing move on a boss, and on the hidden boss. */
export const FINISH = { name: 'ゼニス', reading: 'ボスにとどめ' } as const;
export const FINISH_HIDDEN = { name: 'ビッグバン', reading: '隠しボスにとどめ' } as const;
