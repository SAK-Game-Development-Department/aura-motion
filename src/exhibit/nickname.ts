// Auto-generated nicknames (no name entry). Original word lists.
import { Rng } from '../core/rng';

const ADJ = ['きらめく', 'ゆらめく', 'はばたく', 'またたく', 'かがやく', 'ひかる', 'そよぐ', 'はずむ', 'めぐる', 'ときめく', 'さざめく', 'まどろむ'];
const NOUN = ['ホタル', 'すいせい', 'オーロラ', 'ひかりのこ', 'ほしくず', 'しずく', 'つむじかぜ', 'ルミナ', 'こもれび', 'ほのお', 'ながれぼし', 'にじ'];

export function nickname(seed: number): string {
  const r = new Rng(seed);
  return `${r.pick(ADJ)}${r.pick(NOUN)}`;
}
