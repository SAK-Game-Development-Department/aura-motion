import './audience.css';
import { CHANNEL, type AudienceState } from '../exhibit/broadcast';
import { HAND_BONES } from '../core/types';

const SECTION: Record<string, string> = { intro: '序盤', rush: 'ラッシュ', guard: '防御', boss: 'ボス', hidden: '隠しボス' };
const $ = (id: string) => document.getElementById(id)!;
const cv = $('mini') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
let state: AudienceState | null = null;
let lastMsg = 0;

const ch = new BroadcastChannel(CHANNEL);
ch.onmessage = (e: MessageEvent<AudienceState>) => {
  state = e.data;
  lastMsg = performance.now();
  render();
};

function render(): void {
  const s = state;
  $('status').textContent = !s || performance.now() - lastMsg > 3000 ? 'ゲーム画面と接続されていません（同じブラウザで開いてください）' : '';
  if (!s) return;
  $('score').textContent = s.phase === 'play' || s.phase === 'results' ? s.score.toLocaleString('ja-JP') : '';
  $('combo').textContent = s.phase === 'play' && s.combo >= 3 ? `${s.combo} コンボ` : '';
  $('section').textContent = s.section ? SECTION[s.section] ?? s.section : s.phase === 'title' ? (s.present ? 'まもなく開始' : '次の方をお待ちしています') : s.phase === 'results' ? '結果' : '';
  ($('bar') as HTMLElement).style.width = `${Math.round((s.phase === 'play' ? s.progress : 0) * 100)}%`;
  $('rank').innerHTML = s.ranking
    .slice(0, 8)
    .map((e, i) => `<li><span>${i + 1}. ${e.name.replace(/[<>&]/g, '')}</span><b>${e.score.toLocaleString('ja-JP')}</b></li>`)
    .join('');
  $('n-lat').textContent = `${Math.round(s.stats.latencyMs)} ms`;
  $('n-par').textContent = s.stats.particles.toLocaleString('ja-JP');
  $('n-fps').textContent = `${Math.round(s.stats.fps)} fps`;
  $('n-trk').textContent = `${Math.round(s.stats.trackFps)} fps`;
  $('n-be').textContent = s.stats.backend.split(' ')[0] ?? '';
}

function drawMini(): void {
  requestAnimationFrame(drawMini);
  const W = (cv.width = cv.clientWidth * devicePixelRatio);
  const H = (cv.height = cv.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, W, H);
  const hands = state?.hands;
  if (!hands) return;
  ctx.strokeStyle = '#3ff2ff';
  ctx.shadowColor = '#3ff2ff';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.lineCap = 'round';
  // Fit the 16:9 camera view into the canvas without distortion.
  const vw = Math.min(W, (H * 16) / 9);
  const vh = (vw * 9) / 16;
  const ox = (W - vw) / 2;
  const oy = (H - vh) / 2;
  for (const sk of hands) {
    for (const [a, b] of HAND_BONES) {
      const ax = sk[a * 2]!, ay = sk[a * 2 + 1]!, bx = sk[b * 2]!, by = sk[b * 2 + 1]!;
      ctx.beginPath();
      ctx.moveTo(ox + ax * vw, oy + ay * vh);
      ctx.lineTo(ox + bx * vw, oy + by * vh);
      ctx.stroke();
    }
  }
}
drawMini();
setInterval(render, 1000);
