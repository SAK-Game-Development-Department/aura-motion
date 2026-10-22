// Auto-generated nicknames (no name entry). Original word lists.
import { Rng } from '../core/rng';

const ADJ = ['煌めく', '揺らめく', '羽ばたく', '瞬く', '輝く', '光る', '吹き抜ける', '弾む', '巡る', '燃え立つ', 'さざめく', '冴え渡る'];
const NOUN = ['蛍', '彗星', '極光', '光の子', '星屑', '雫', '旋風', '流星', '木漏れ日', '焔', '月光', '虹'];

export function nickname(seed: number): string {
  const r = new Rng(seed);
  return `${r.pick(ADJ)}${r.pick(NOUN)}`;
}
