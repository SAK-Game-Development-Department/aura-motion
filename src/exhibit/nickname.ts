// Auto-generated nicknames (no name entry). Original word lists.
import { Rng } from "../core/rng";

export const NICK_ADJ = ["元気な", "眠そうな", "素早い", "まるい", "ふわふわの", "光る", "強い", "静かな", "のんびりした", "きらきらの", "ご機嫌な", "まっすぐな"];
export const NICK_NOUN = ["ホタル", "流れ星", "クラゲ", "ペンギン", "ネコ", "タヌキ", "キツネ", "フクロウ", "イルカ", "リス", "ウサギ", "カメ"];

export function nickname(seed: number): string {
  const r = new Rng(seed);
  return `${r.pick(NICK_ADJ)}${r.pick(NICK_NOUN)}`;
}
