import './card.css';
import { parseCard } from '../exhibit/card';

const root = document.getElementById('card')!;
const d = parseCard(location.hash);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
if (!d) {
  root.innerHTML = '<p class="bad">カードの情報が読み取れませんでした。</p>';
} else {
  root.innerHTML = `
    <div class="logo">AURA</div>
    <div class="rank r${d.rank}">${d.rank}</div>
    <div class="score">${d.score.toLocaleString('ja-JP')}</div>
    <div class="meta">MAX COMBO <b>${d.combo}</b></div>
    <div class="name">${esc(d.name)}</div>
    <div class="date">${esc(d.date)}</div>
    <p class="save">スクリーンショットで保存できます</p>`;
  document.title = `AURA ${d.score}`;
}
