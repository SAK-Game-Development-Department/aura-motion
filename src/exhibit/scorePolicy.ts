// Shared ranking: what a score submission may contain and how it is checked.
// Used by the browser (to build the payload) and by the Pages Function (to
// validate it). Only the score, its breakdown, the auto-generated nickname,
// the stage and a random booth id are ever sent — never images or landmarks.
import { JUDGE } from '../config';
import { STAGES, type StageId } from '../battle/stages';
import { NICK_ADJ, NICK_NOUN } from './nickname';

export const DIFFS = ['easy', 'normal', 'hard'] as const;
export type Diff = (typeof DIFFS)[number];

export interface ScoreSubmission {
  token: string;
  stage: string;
  score: number;
  rank: string;
  name: string;
  maxCombo: number;
  perfect: number;
  good: number;
  miss: number;
  /** Random booth id (one per device, not per person). */
  device: string;
}

/** Exactly these keys are sent (checked by an E2E test). */
export const SUBMISSION_KEYS: ReadonlyArray<keyof ScoreSubmission> = ['token', 'stage', 'score', 'rank', 'name', 'maxCombo', 'perfect', 'good', 'miss', 'device'];

export interface OnlineEntry {
  name: string;
  score: number;
  rank: string;
  stage: string;
  stageName: string;
  /** Prefecture / region of the booth (Japanese when known). */
  region: string;
  at: number;
}

export function isNickname(name: string): boolean {
  for (const a of NICK_ADJ) if (name.startsWith(a) && NICK_NOUN.includes(name.slice(a.length))) return true;
  return false;
}

/** Bonus points a play can earn on top of the judged hits (ultimates, hidden boss). */
const BONUS_MAX = 3000 + 5000 + 3000;

/** The highest score a play with these counts could reach (generous). */
export function maxPlausibleScore(perfect: number, good: number): number {
  return Math.ceil((perfect * JUDGE.scorePerfect + good * JUDGE.scoreGood) * JUDGE.comboMaxMul + BONUS_MAX);
}

const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Returns an error string, or null when the submission is acceptable. */
export function checkSubmission(s: Partial<ScoreSubmission>): string | null {
  if (!s || typeof s !== 'object') return 'body';
  for (const k of Object.keys(s)) if (!(SUBMISSION_KEYS as readonly string[]).includes(k)) return `unexpected field ${k}`;
  if (typeof s.stage !== 'string' || !(s.stage in STAGES)) return 'stage';
  if (!int(s.perfect, 0, 400) || !int(s.good, 0, 400) || !int(s.miss, 0, 400)) return 'counts';
  if (s.perfect! + s.good! + s.miss! > 400) return 'counts';
  if (!int(s.maxCombo, 0, s.perfect! + s.good!)) return 'combo';
  if (!int(s.score, 0, 10_000_000) || s.score! > maxPlausibleScore(s.perfect!, s.good!)) return 'score';
  if (!['S', 'A', 'B', 'C'].includes(s.rank ?? '')) return 'rank';
  if (typeof s.name !== 'string' || !isNickname(s.name)) return 'name';
  if (typeof s.device !== 'string' || !/^[a-z0-9]{6,16}$/.test(s.device)) return 'device';
  if (typeof s.token !== 'string' || s.token.length > 300) return 'token';
  return null;
}

export function diffOfStage(stage: string): Diff {
  return STAGES[stage as StageId]?.difficulty ?? 'normal';
}

/** Start of "today" in Japan time (the ranking day), unix ms. */
export function jstDayStart(now: number): number {
  const JST = 9 * 3600_000;
  return Math.floor((now + JST) / 86_400_000) * 86_400_000 - JST;
}

// Cloudflare's region names (ISO 3166-2:JP subdivisions in English) → 都道府県.
const PREF: Record<string, string> = {
  hokkaido: '北海道', aomori: '青森', iwate: '岩手', miyagi: '宮城', akita: '秋田', yamagata: '山形', fukushima: '福島',
  ibaraki: '茨城', tochigi: '栃木', gunma: '群馬', saitama: '埼玉', chiba: '千葉', tokyo: '東京', kanagawa: '神奈川',
  niigata: '新潟', toyama: '富山', ishikawa: '石川', fukui: '福井', yamanashi: '山梨', nagano: '長野', gifu: '岐阜',
  shizuoka: '静岡', aichi: '愛知', mie: '三重', shiga: '滋賀', kyoto: '京都', osaka: '大阪', hyogo: '兵庫', nara: '奈良',
  wakayama: '和歌山', tottori: '鳥取', shimane: '島根', okayama: '岡山', hiroshima: '広島', yamaguchi: '山口',
  tokushima: '徳島', kagawa: '香川', ehime: '愛媛', kochi: '高知', fukuoka: '福岡', saga: '佐賀', nagasaki: '長崎',
  kumamoto: '熊本', oita: '大分', miyazaki: '宮崎', kagoshima: '鹿児島', okinawa: '沖縄',
};

/** "Tōkyō" / "Osaka Prefecture" → 東京 / 大阪; unknown → '' (shown as —). */
export function regionJa(region: string | null | undefined, country?: string | null): string {
  if (!region) return country && country !== 'JP' ? country : '';
  const k = region
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*(prefecture|-ken|-fu|-to|ken|fu)$/u, '')
    .replace(/[^a-z]/g, '');
  return PREF[k] ?? (country && country !== 'JP' ? country : '');
}
