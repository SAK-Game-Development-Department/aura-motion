// Player names typed on the results screen (shared by the browser and the
// ranking API). Short, printable, and filtered for obviously bad words. Two
// entries with the same normalized name in the same difficulty are one player:
// the better score is kept.

export const NAME_MAX = 8;
/** Name used when the player skips the entry (kept on this device only). */
export const GUEST_NAME = 'ゲスト';

// Hiragana, katakana (incl. ー・), CJK ideographs, ASCII letters/digits, a space.
const ALLOWED = /^[ぁ-ゖ゛-゜ァ-ヺー・一-鿿々A-Za-z0-9 ]+$/u;

// Minimal list of words that must not appear on a public board (lower-case,
// katakana-normalized). Matching is a substring check on the normalized name.
const NG = [
  'しね', 'シネ', 'ころす', 'コロス', 'ちんこ', 'チンコ', 'ちんぽ', 'チンポ', 'まんこ', 'マンコ', 'うんこ', 'ウンコ', 'せっくす', 'セックス', 'おっぱい', 'オッパイ',
  'きちがい', 'キチガイ', 'がいじ', 'ガイジ', 'ぶす', 'ブス', 'かす', 'カス', 'ばか', 'バカ', 'あほ', 'アホ', 'れいぷ', 'レイプ', 'ちょん', 'チョン',
  'fuck', 'shit', 'sex', 'dick', 'cock', 'pussy', 'nigg', 'bitch', 'kill', 'rape', 'porn', 'cunt',
  '死ね', '殺す', '氏ね', '糞', '犯す',
];

/** NFKC, trimmed, inner spaces collapsed (ｶﾀｶﾅ → カタカナ, Ａ → A). */
export function normalizeName(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Key used to decide "same player": case-insensitive, hiragana → katakana, no spaces. */
export function nameKey(name: string): string {
  return normalizeName(name)
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/ /g, '');
}

/** Error message for the player, or null if the name is fine. */
export function checkName(raw: string): string | null {
  const n = normalizeName(raw);
  if (!n) return '名前を入れてください';
  if ([...n].length > NAME_MAX) return `${NAME_MAX}文字までです`;
  if (!ALLOWED.test(n)) return '使えない文字があります';
  const key = nameKey(n);
  const hira = key.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const w of NG) {
    const wl = w.toLowerCase();
    if (key.includes(wl) || hira.includes(wl)) return 'その名前は使えません';
  }
  return null;
}
