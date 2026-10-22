// AURA Gesture Lab — developer tool (not part of the exhibition build).
// Live recognition view, landmark-only sample recording (JSON download),
// replay evaluation (confusion matrix, rule vs kNN) and threshold tuning.
import './lab.css';
import { TRACKING } from '../../src/config';
import { HAND_BONES, type PoseFrame } from '../../src/core/types';
import { GestureCalibrator } from '../../src/gesture/calibrate';
import { GestureEngine, type GestureEvent, type GestureFrame } from '../../src/gesture/engine';
import { defaultThresholds, FINGER_NAMES, type Thresholds } from '../../src/gesture/features';
import { CORE_SHAPES, defaultHand, SHAPE_IDS, SHAPE_LABEL, withShape, type ShapeId } from '../../src/gesture/handModel';
import { MOTION_IDS, MOTION_LABEL, type MotionKind } from '../../src/gesture/motion';
import { HandSynthSource, perform } from '../../src/gesture/performer';
import { SIGIL_IDS, SIGIL_LABEL, type SigilKind } from '../../src/gesture/sigil';
import { CameraSource } from '../../src/input/camera';
import { MouseSource } from '../../src/input/mouse';
import type { InputSource } from '../../src/input/source';
import { evalKnn, evalRule, LABELS, parseSampleFile, toSample, type Confusion, type Label, type Sample, type SampleFile } from './samples';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $<HTMLCanvasElement>('view');
const vctx = view.getContext('2d')!;
const norm = $<HTMLCanvasElement>('norm');
const nctx = norm.getContext('2d')!;

let engine = new GestureEngine();
let source: InputSource | null = null;
let off: Array<() => void> = [];
let last: GestureFrame | null = null;
const log: string[] = [];
let samples: Sample[] = [];
let recording = false;
let recLeft = 0;
let th: Thresholds = defaultThresholds();
let calib: { step: 'open' | 'fist'; until: number; cal: GestureCalibrator } | null = null;
let fps = 0;
let fpsN = 0;
let fpsT = performance.now();
let lastLatency = 0;

// ── synthetic controls ──
const syn = { shape: 'open' as ShapeId, noise: 0.004, rot: 0, yaw: 0, size: 0.15, motionAt: -1e9, motion: 'push' as MotionKind, sigilAt: -1e9, sigil: 'circle' as SigilKind };
for (const s of SHAPE_IDS) $('synShape').insertAdjacentHTML('beforeend', `<option value="${s}">${SHAPE_LABEL[s]} (${s})</option>`);
for (const m of MOTION_IDS) $('synMotionKind').insertAdjacentHTML('beforeend', `<option value="${m}">${MOTION_LABEL[m]}</option>`);
for (const s of SIGIL_IDS) $('synSigilKind').insertAdjacentHTML('beforeend', `<option value="${s}">${SIGIL_LABEL[s]}</option>`);
for (const l of LABELS) $('label').insertAdjacentHTML('beforeend', `<option value="${l}">${l === 'none' ? 'なし（自然な手・誤発動の確認用）' : `${SHAPE_LABEL[l]} (${l})`}</option>`);

function synthScript() {
  return (t: number) => {
    if (t - syn.sigilAt < 2400) {
      return perform([{ at: syn.sigilAt, shape: 'point', holdMs: 1900, sigil: syn.sigil }], 'R', syn.size)(t);
    }
    if (t - syn.motionAt < 1600) {
      return perform([{ at: syn.motionAt, shape: syn.shape, holdMs: 900, motion: syn.motion }], 'R', syn.size)(t);
    }
    const h = withShape({ ...defaultHand('R'), wrist: { x: 0.55, y: 0.72 }, size: syn.size, rot: syn.rot, yaw: syn.yaw }, syn.shape);
    return [h];
  };
}

async function setSource(kind: string): Promise<void> {
  for (const f of off) f();
  off = [];
  source?.stop();
  engine = new GestureEngine({ shapes: ($<HTMLSelectElement>('shapeSet').value === 'core' ? CORE_SHAPES : SHAPE_IDS) as ShapeId[] });
  engine.thresholds = th;
  $('synthBar').hidden = kind !== 'synth';
  $('status').textContent = '準備中…';
  try {
    if (kind === 'camera') {
      source = new CameraSource({ segmentation: false, preferWorker: true, onProgress: (st, a, b) => ($('status').textContent = `${st} ${b ? Math.round((a / b) * 100) : 0}%`) });
    } else if (kind === 'mouse') {
      source = new MouseSource((x, y) => {
        const r = view.getBoundingClientRect();
        return { x: (x - r.left) / r.width, y: (y - r.top) / r.height };
      });
    } else {
      source = new HandSynthSource(synthScript());
    }
    off.push(source.frames.on(onFrame));
    await source.start();
    $('status').textContent = source.status().detail;
  } catch (e) {
    $('status').textContent = `エラー: ${String((e as Error).message ?? e)}`;
  }
}

function onFrame(f: PoseFrame): void {
  const g = engine.update(f);
  last = g;
  lastLatency = f.timing ? f.timing.inferEnd - f.t : 0;
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 1000) {
    fps = (fpsN * 1000) / (now - fpsT);
    fpsN = 0;
    fpsT = now;
  }
  for (const e of g.events) logEvent(e);
  const h = g.hands[0];
  if (h && (recording || recLeft > 0)) {
    samples.push(toSample($<HTMLSelectElement>('label').value as Label, h.raw, g.aspect, $<HTMLInputElement>('who').value || 'p1'));
    if (recLeft > 0 && --recLeft === 0) $('rec60').classList.remove('on');
    renderCounts();
  }
  if (calib && h) {
    if (performance.now() > calib.until - 1400) calib.cal.add(calib.step, h.feat);
    if (performance.now() > calib.until) {
      if (calib.step === 'open') calib = { step: 'fist', until: performance.now() + 2000, cal: calib.cal };
      else {
        const r = calib.cal.result();
        $('calibStatus').textContent = r.ok ? '校正 OK（閾値を更新しました）' : '校正できませんでした（ひらく／にぎる の差が小さい指があります）。既定値の一部を使います';
        setThresholds(r.thresholds);
        calib = null;
      }
    }
    $('calibStatus').textContent = calib ? (calib.step === 'open' ? '手を大きく ひらいて…' : 'ぎゅっと にぎって…') : $('calibStatus').textContent;
  }
}

function logEvent(e: GestureEvent): void {
  if (e.type === 'handIn' || e.type === 'handOut') return;
  const t = (e.t / 1000).toFixed(2);
  let s = `${t}s ${e.type}`;
  if ('shape' in e) s += ` ${SHAPE_LABEL[e.shape]}`;
  if (e.type === 'cast') s += ` ← ${e.release}${e.sigil ? `:${e.sigil}` : ''} q=${e.quality.toFixed(2)}`;
  if (e.type === 'motion') s += ` ${MOTION_LABEL[e.kind]} q=${e.quality.toFixed(2)}`;
  if (e.type === 'sigil') s += ` ${SIGIL_LABEL[e.kind]} ${e.score.toFixed(2)}`;
  if (e.type === 'twoHand') s += ` ${e.kind}`;
  log.unshift(s);
  if (log.length > 60) log.pop();
  $('log').textContent = log.join('\n');
}

// ── drawing ──
function draw(): void {
  requestAnimationFrame(draw);
  source?.tick(performance.now());
  const W = view.width;
  const H = view.height;
  vctx.fillStyle = '#000';
  vctx.fillRect(0, 0, W, H);
  const cam = source instanceof CameraSource ? source : null;
  const video = cam?.videoElement;
  if ($<HTMLInputElement>('video').checked && video && video.readyState >= 2) {
    vctx.save();
    vctx.globalAlpha = 0.35;
    vctx.translate(W, 0);
    vctx.scale(-1, 1);
    vctx.drawImage(video, 0, 0, W, H);
    vctx.restore();
  }
  const g = last;
  if (g) {
    g.hands.forEach((h) => {
      vctx.lineWidth = 2;
      vctx.strokeStyle = h.stance ? '#ffb43f' : '#3ff2ff';
      for (const [a, b] of HAND_BONES) {
        vctx.beginPath();
        vctx.moveTo(h.lm[a]!.x * W, h.lm[a]!.y * H);
        vctx.lineTo(h.lm[b]!.x * W, h.lm[b]!.y * H);
        vctx.stroke();
      }
      vctx.fillStyle = '#fff';
      for (const p of h.lm) vctx.fillRect(p.x * W - 2, p.y * H - 2, 4, 4);
      if (h.stroke.length > 1) {
        vctx.strokeStyle = '#ff3fb4';
        vctx.beginPath();
        h.stroke.forEach((p, i) => (i ? vctx.lineTo(p.x * W, p.y * H) : vctx.moveTo(p.x * W, p.y * H)));
        vctx.stroke();
      }
      const lbl = h.stance ? `${SHAPE_LABEL[h.stance]} ${Math.round(h.charge * 100)}%` : h.decision.best ? `(${SHAPE_LABEL[h.decision.best]}? ${h.decision.bestConf.toFixed(2)})` : '';
      vctx.fillStyle = h.stance ? '#ffb43f' : 'rgba(244,247,255,.6)';
      vctx.font = '20px system-ui';
      vctx.fillText(`#${h.slot} ${lbl}`, h.palm.x * W - 40, h.palm.y * H + h.size * H * 2.4);
    });
  }
  vctx.fillStyle = 'rgba(244,247,255,.7)';
  vctx.font = '12px ui-monospace, monospace';
  vctx.fillText(`tracking ${fps.toFixed(0)} fps   capture→result ${lastLatency.toFixed(0)} ms   hands ${g?.hands.length ?? 0}   ignored ${g?.frame.ignored ?? 0}   ${recording ? '● REC' : ''}`, 10, H - 10);
  drawPanels();
}

function drawPanels(): void {
  const h = last?.hands[0];
  const W = norm.width;
  const H = norm.height;
  nctx.fillStyle = '#05060f';
  nctx.fillRect(0, 0, W, H);
  if (!h) {
    $('feat').textContent = '手が見つかりません';
    $('bars').innerHTML = '';
    $('fsm').textContent = '';
    return;
  }
  const P = h.norm.pts;
  const s = 56;
  nctx.strokeStyle = '#3ff2ff';
  nctx.lineWidth = 2;
  for (const [a, b] of HAND_BONES) {
    nctx.beginPath();
    nctx.moveTo(W / 2 + P[a]!.x * s, H - 30 + P[a]!.y * s);
    nctx.lineTo(W / 2 + P[b]!.x * s, H - 30 + P[b]!.y * s);
    nctx.stroke();
  }
  const f = h.feat;
  $('feat').textContent = [
    `size ${h.size.toFixed(3)}  facing ${f.facing.toFixed(2)}`,
    ...f.bend.map((b, i) => `${FINGER_NAMES[i + 1]!.padEnd(6)} bend ${b.toFixed(0).padStart(3)}°  reach ${f.reach[i]!.toFixed(2)}`),
    `thumb out ${f.thumbOut.toFixed(2)} across ${f.thumbAcross.toFixed(2)}`,
    `pinch ${f.pinch.toFixed(2)}  fan ${f.fan.toFixed(0)}°`,
  ].join('\n');
  const sc = Object.entries(h.decision.scores).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  $('bars').innerHTML = sc
    .map(([k, v]) => `<div class="barrow ${k === h.decision.shape ? 'sel' : ''}"><span>${SHAPE_LABEL[k as ShapeId]}</span><i style="width:${Math.round((v ?? 0) * 100)}%"></i><span>${(v ?? 0).toFixed(2)}</span></div>`)
    .join('');
  $('fsm').textContent = `state ${h.state}   stance ${h.stance ? SHAPE_LABEL[h.stance] : '-'}   charge ${Math.round(h.charge * 100)}%   stroke ${h.stroke.length}pt`;
}

function renderCounts(): void {
  const c: Record<string, number> = {};
  const who = new Set<string>();
  for (const s of samples) {
    c[s.label] = (c[s.label] ?? 0) + 1;
    who.add(s.who);
  }
  $('counts').textContent = `${samples.length} 件 / 記録者 ${[...who].join(', ') || '-'}\n` + LABELS.map((l) => `${(l === 'none' ? 'なし' : SHAPE_LABEL[l]).padEnd(6, '　')} ${String(c[l] ?? 0).padStart(5)}`).join('\n');
}

function renderConfusion(title: string, c: Confusion): void {
  const ls = c.labels.filter((l) => c.labels.some((x) => c.m[l][x] > 0) || c.labels.some((x) => c.m[x][l] > 0));
  const head = `<tr><th>正解＼判定</th>${ls.map((l) => `<th>${l}</th>`).join('')}<th>再現率</th></tr>`;
  const rows = ls
    .map((a) => {
      const row = ls.reduce((x, b) => x + c.m[a][b], 0);
      return `<tr><th>${a}</th>${ls.map((b) => `<td class="${a === b ? 'diag' : c.m[a][b] > 0 && b !== 'none' ? 'bad' : ''}">${c.m[a][b] || ''}</td>`).join('')}<td>${row ? ((c.m[a][a] / row) * 100).toFixed(1) + '%' : '-'}</td></tr>`;
    })
    .join('');
  const wrong = ls.filter((l) => l !== 'none').reduce((x, a) => x + ls.filter((b) => b !== a && b !== 'none').reduce((y, b) => y + c.m[a][b], 0), 0);
  const shapeTotal = ls.filter((l) => l !== 'none').reduce((x, a) => x + ls.reduce((y, b) => y + c.m[a][b], 0), 0);
  const noneFp = c.labels.includes('none') ? ls.filter((b) => b !== 'none').reduce((x, b) => x + c.m.none[b], 0) : 0;
  const noneTotal = ls.reduce((x, b) => x + c.m.none[b], 0);
  $('confusion').innerHTML = `<h2>${title}（フレーム単位、${c.n} 件）</h2><table>${head}${rows}</table>
    <pre>正解率 ${(c.accuracy * 100).toFixed(1)}%   別の形への誤認識 ${shapeTotal ? ((wrong / shapeTotal) * 100).toFixed(2) : '-'}%   「なし」が形と判定 ${noneTotal ? ((noneFp / noneTotal) * 100).toFixed(2) : '-'}%</pre>`;
}

// ── thresholds ──
type ThKey = 'bendLo' | 'bendHi' | 'thumbLo' | 'thumbHi' | 'fanLo' | 'fanHi' | 'pinchOn' | 'pinchOff';
const SLIDERS: Array<[ThKey, number, number, number]> = [
  ['bendLo', 0, 180, 1],
  ['bendHi', 60, 260, 1],
  ['thumbLo', 0.2, 1.2, 0.01],
  ['thumbHi', 0.3, 1.5, 0.01],
  ['fanLo', 5, 60, 1],
  ['fanHi', 10, 80, 1],
  ['pinchOn', 0.05, 0.8, 0.01],
  ['pinchOff', 0.1, 1.0, 0.01],
];
function thValue(k: ThKey): number {
  const v = th[k];
  return Array.isArray(v) ? v.reduce((a, x) => a + x, 0) / v.length : v;
}
function setThresholds(t: Thresholds): void {
  th = t;
  engine.thresholds = th;
  renderSliders();
}
function renderSliders(): void {
  $('sliders').innerHTML = SLIDERS.map(([k, a, b, st]) => `<div class="slider"><span>${k}</span><input type="range" data-k="${k}" min="${a}" max="${b}" step="${st}" value="${thValue(k)}" /><span id="sv-${k}">${thValue(k).toFixed(2)}</span></div>`).join('');
  $('sliders').querySelectorAll('input').forEach((el) =>
    el.addEventListener('input', () => {
      const k = el.dataset.k as ThKey;
      const v = Number(el.value);
      const t = { ...th, bendLo: [...th.bendLo], bendHi: [...th.bendHi] } as Thresholds;
      if (k === 'bendLo' || k === 'bendHi') t[k] = [v, v, v, v];
      else t[k] = v;
      th = t;
      engine.thresholds = th;
      $(`sv-${k}`).textContent = v.toFixed(2);
    }),
  );
}

// ── wiring ──
function download(name: string, data: unknown): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('src').addEventListener('change', (e) => void setSource((e.target as HTMLSelectElement).value));
$('shapeSet').addEventListener('change', () => void setSource($<HTMLSelectElement>('src').value));
$('synShape').addEventListener('change', (e) => (syn.shape = (e.target as HTMLSelectElement).value as ShapeId));
$('synNoise').addEventListener('input', (e) => (syn.noise = Number((e.target as HTMLInputElement).value)));
$('synRot').addEventListener('input', (e) => (syn.rot = Number((e.target as HTMLInputElement).value)));
$('synYaw').addEventListener('input', (e) => (syn.yaw = Number((e.target as HTMLInputElement).value)));
$('synSize').addEventListener('input', (e) => (syn.size = Number((e.target as HTMLInputElement).value)));
$('synMotionKind').addEventListener('change', (e) => (syn.motion = (e.target as HTMLSelectElement).value as MotionKind));
$('synSigilKind').addEventListener('change', (e) => (syn.sigil = (e.target as HTMLSelectElement).value as SigilKind));
$('synMotion').addEventListener('click', () => (syn.motionAt = performance.now()));
$('synSigil').addEventListener('click', () => (syn.sigilAt = performance.now()));
$('rec').addEventListener('click', () => {
  recording = !recording;
  $('rec').classList.toggle('on', recording);
});
$('rec60').addEventListener('click', () => {
  recLeft = 60;
  $('rec60').classList.add('on');
});
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && !(e.target instanceof HTMLInputElement)) $('rec').click();
});
$('save').addEventListener('click', () => {
  const f: SampleFile = { format: 'aura-gesture-samples', version: 1, createdAt: new Date().toISOString(), samples };
  download(`aura-gesture-samples-${Date.now()}.json`, f);
});
$<HTMLInputElement>('load').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    samples = [...samples, ...parseSampleFile(await file.text()).samples];
    renderCounts();
  } catch (err) {
    alert(String((err as Error).message));
  }
});
$('clear').addEventListener('click', () => {
  if (confirm('記録したサンプルをすべて消しますか？')) {
    samples = [];
    renderCounts();
  }
});
const shapesInUse = () => ($<HTMLSelectElement>('shapeSet').value === 'core' ? CORE_SHAPES : SHAPE_IDS);
$('evalRule').addEventListener('click', () => renderConfusion('規則ベース', evalRule(samples, th, shapesInUse())));
$('evalKnn').addEventListener('click', () => renderConfusion('kNN（k=5）', evalKnn(samples, th, 5, shapesInUse())));
$('calib').addEventListener('click', () => {
  calib = { step: 'open', until: performance.now() + 2000, cal: new GestureCalibrator() };
});
$('resetTh').addEventListener('click', () => setThresholds(defaultThresholds()));
$('exportTh').addEventListener('click', () => download('aura-thresholds.json', th));

renderSliders();
renderCounts();
const initial = new URLSearchParams(location.search).get('source') ?? 'camera';
$<HTMLSelectElement>('src').value = initial;
void setSource(initial);
draw();
void TRACKING;
