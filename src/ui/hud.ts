// DOM HUD. Minimal, large text; information is carried by shape/colour/motion
// in the WebGL layer. All elements are created once and toggled (no leaks).
import type { Placement } from '../exhibit/presence';
import type { Grade } from '../game/score';
import type { ScoreEntry } from '../exhibit/highscores';
import type { SectionKind } from '../stage/types';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export type Screen = 'loading' | 'title' | 'calibrate' | 'play' | 'results' | 'error';

const SECTION_ICON: Record<SectionKind, string> = { intro: '●', flow: '≈', wall: '⌂', dodge: '⇅', finale: '✦' };
const SECTION_NAME: Record<SectionKind, string> = { intro: 'ふれる', flow: 'ながれ', wall: 'かたち', dodge: 'よける', finale: 'フィナーレ' };

const GUIDE_SVG = `
<svg viewBox="0 0 100 220" xmlns="http://www.w3.org/2000/svg">
  <circle class="head" cx="50" cy="20" r="13"/>
  <path d="M28 44 Q50 36 72 44 L78 98 M28 44 L22 98 M34 46 L36 118 L32 210 M66 46 L64 118 L68 210 M36 118 L64 118"/>
</svg>`;

export class Hud {
  readonly root: HTMLElement;
  private layers: Record<Screen, HTMLElement>;
  private loadBar: HTMLElement;
  private loadLabel: HTMLElement;
  private guide: HTMLElement;
  private guideFill: SVGPathElement | null = null;
  private callEl: HTMLElement;
  private hintEl: HTMLElement;
  private scoreEl: HTMLElement;
  private comboEl: HTMLElement;
  private timeEl: HTMLElement;
  private sectionsEl: HTMLElement;
  private bannerEl: HTMLElement;
  private warnEl: HTMLElement;
  private calibText: HTMLElement;
  private calibDots: HTMLElement;
  private resEl: HTMLElement;
  private rankingEl: HTMLElement;
  private qrEl: HTMLElement;
  private errEl: HTMLElement;
  private buttons = new Map<string, HTMLElement>();
  private judgePool: HTMLElement[] = [];
  private judgeIdx = 0;
  private screen: Screen | null = null;
  private lastScore = -1;
  private lastCombo = -1;
  private sectionKinds: SectionKind[] = [];

  constructor(parent: HTMLElement) {
    this.root = h('div');
    this.root.id = 'ui';
    parent.appendChild(this.root);
    const mk = (s: Screen) => {
      const l = h('div', `layer ${s}`);
      this.root.appendChild(l);
      return l;
    };
    this.layers = { loading: mk('loading'), title: mk('title'), calibrate: mk('calibrate'), play: mk('play'), results: mk('results'), error: mk('error') };

    // Shared privacy notice (title + loading + error).
    const privacy = '<b>映像は端末の外に出ず、保存されません。</b>&nbsp;カメラは姿勢と輪郭の推定だけに使います（顔の識別はしません）。';
    for (const s of ['loading', 'title', 'error'] as const) this.layers[s].appendChild(h('div', 'privacy', privacy));

    // Loading
    const lg = h('div', 'logo', 'AURA');
    this.layers.loading.appendChild(lg);
    const load = h('div', 'load');
    this.loadLabel = h('div', 'label', 'じゅんびちゅう…');
    const bar = h('div', 'bar');
    this.loadBar = h('i');
    bar.appendChild(this.loadBar);
    load.append(this.loadLabel, bar);
    this.layers.loading.appendChild(load);

    // Title
    this.layers.title.appendChild(h('div', 'logo', 'AURA'));
    this.guide = h('div', 'guide', GUIDE_SVG);
    this.layers.title.appendChild(this.guide);
    this.callEl = h('div', 'call glow-c', 'カメラのまえに たってね');
    this.hintEl = h('div', 'hint glow-a', '');
    this.layers.title.append(this.callEl, this.hintEl);
    const svg = this.guide.querySelector('svg');
    if (svg) {
      // Progress stroke that fills while holding position.
      const ns = 'http://www.w3.org/2000/svg';
      const fill = document.createElementNS(ns, 'path');
      fill.setAttribute('d', 'M50 7 A13 13 0 1 1 49.9 7');
      fill.setAttribute('class', 'fill');
      fill.setAttribute('pathLength', '1');
      fill.style.strokeDasharray = '1';
      fill.style.strokeDashoffset = '1';
      svg.appendChild(fill);
      this.guideFill = fill;
    }

    // Calibration
    this.calibText = h('div', 'calib-text glow-a', 'ひかりが あわさったら てを たたいて');
    this.calibDots = h('div', 'calib-dots');
    this.layers.calibrate.append(this.calibText, this.calibDots);

    // Play
    this.scoreEl = h('div', 'score glow-c', '0');
    this.comboEl = h('div', 'combo glow-a', '');
    const tb = h('div', 'timebar');
    this.timeEl = h('i');
    tb.appendChild(this.timeEl);
    this.sectionsEl = h('div', 'sections');
    this.bannerEl = h('div', 'banner glow-a');
    this.layers.play.append(this.scoreEl, this.comboEl, tb, this.sectionsEl, this.bannerEl);
    for (let i = 0; i < 10; i++) {
      const j = h('div', 'judge');
      j.style.display = 'none';
      this.layers.play.appendChild(j);
      this.judgePool.push(j);
    }
    this.warnEl = h('div', 'warn', '');
    this.root.appendChild(this.warnEl);

    // Results
    this.resEl = h('div', 'res');
    this.rankingEl = h('div', 'ranking');
    this.qrEl = h('div', 'qr');
    this.layers.results.append(this.resEl, this.rankingEl, this.qrEl);

    // Error
    this.errEl = h('div', 'err');
    this.layers.error.appendChild(this.errEl);
  }

  show(s: Screen): void {
    if (this.screen === s) return;
    this.screen = s;
    for (const [k, el] of Object.entries(this.layers)) el.classList.toggle('on', k === s);
    if (s !== 'play') this.clearJudges();
  }

  get current(): Screen | null {
    return this.screen;
  }

  // ── loading ──
  setLoading(frac: number, label: string): void {
    this.loadBar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    this.loadLabel.textContent = label;
  }

  // ── title ──
  setTitle(opts: { attract: boolean; placement: Placement; progress: number; seated: boolean; waitingNext?: boolean }): void {
    const { attract, placement, progress } = opts;
    if (opts.waitingNext) {
      this.guide.style.opacity = '0';
      this.callEl.textContent = 'ありがとう！ つぎの ひと どうぞ';
      this.hintEl.textContent = '';
      return;
    }
    this.guide.style.opacity = attract ? '0' : '1';
    this.guide.classList.toggle('tooClose', placement === 'tooClose');
    this.guide.classList.toggle('tooFar', placement === 'tooFar');
    if (this.guideFill) this.guideFill.style.strokeDashoffset = String(1 - progress);
    this.callEl.textContent = attract || placement === 'none' ? 'カメラのまえに たってね' : placement === 'ok' ? (progress > 0 ? 'そのまま…' : 'そのまま まってね') : '';
    this.hintEl.textContent =
      placement === 'tooClose' ? (opts.seated ? 'すこし さがってね' : 'うしろに さがってね') : placement === 'tooFar' ? 'もうすこし ちかくに' : placement === 'offCenter' ? 'まんなかに きてね' : '';
    this.hintEl.className = `hint ${placement === 'tooClose' ? 'glow-m' : 'glow-a'}`;
  }

  // ── hold buttons ──
  setButtons(specs: Array<{ id: string; label: string; x: number; y: number; r: number }>, layer: Screen): void {
    for (const [id, el] of this.buttons) {
      if (!specs.find((s) => s.id === id)) {
        el.remove();
        this.buttons.delete(id);
      }
    }
    for (const s of specs) {
      let el = this.buttons.get(s.id);
      if (!el) {
        el = h('div', 'hbtn', `<div class="prog"></div><span>${s.label}</span>`);
        this.buttons.set(s.id, el);
      }
      if (el.parentElement !== this.layers[layer]) this.layers[layer].appendChild(el);
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      el.style.width = el.style.height = `${s.r * 2}px`;
    }
  }

  setButtonProgress(id: string, p: number): void {
    this.buttons.get(id)?.style.setProperty('--p', p.toFixed(3));
  }

  // ── calibration ──
  setCalib(total: number, got: number, text?: string): void {
    if (this.calibDots.childElementCount !== total) {
      this.calibDots.innerHTML = '';
      for (let i = 0; i < total; i++) this.calibDots.appendChild(h('i'));
    }
    Array.from(this.calibDots.children).forEach((c, i) => c.classList.toggle('ok', i < got));
    if (text) this.calibText.textContent = text;
  }

  // ── play ──
  setSections(kinds: SectionKind[]): void {
    this.sectionKinds = kinds;
    this.sectionsEl.innerHTML = '';
    for (const k of kinds) {
      const s = h('span', '', SECTION_ICON[k]);
      s.title = SECTION_NAME[k];
      this.sectionsEl.appendChild(s);
    }
  }

  setSection(idx: number, kind: SectionKind, announce: boolean): void {
    Array.from(this.sectionsEl.children).forEach((c, i) => {
      c.classList.toggle('now', i === idx);
      c.classList.toggle('done', i < idx);
    });
    if (announce && this.sectionKinds.length > 1) {
      this.bannerEl.textContent = SECTION_NAME[kind];
      this.bannerEl.classList.remove('show');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('show');
    }
  }

  setPlay(score: number, combo: number, mul: number, progress: number): void {
    if (score !== this.lastScore) {
      this.scoreEl.textContent = score.toLocaleString('ja-JP');
      this.lastScore = score;
    }
    if (combo !== this.lastCombo) {
      this.comboEl.innerHTML = combo >= 3 ? `${combo}<small>コンボ${mul > 1 ? ` ×${mul.toFixed(1)}` : ''}</small>` : '';
      if (combo > this.lastCombo && combo >= 3) {
        this.comboEl.classList.remove('bump');
        void this.comboEl.offsetWidth;
        this.comboEl.classList.add('bump');
      }
      this.lastCombo = combo;
    }
    this.timeEl.style.width = `${(Math.max(0, Math.min(1, progress)) * 100).toFixed(2)}%`;
  }

  judge(grade: Grade, x: number, y: number): void {
    const el = this.judgePool[this.judgeIdx++ % this.judgePool.length]!;
    el.className = `judge ${grade}`;
    el.textContent = grade === 'perfect' ? 'PERFECT' : grade === 'good' ? 'GOOD' : 'miss';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.display = 'block';
    // Restart the animation.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  private clearJudges(): void {
    for (const j of this.judgePool) j.style.display = 'none';
  }

  setWarning(text: string | null): void {
    this.warnEl.classList.toggle('on', !!text);
    if (text) this.warnEl.textContent = text;
  }

  // ── results ──
  setResults(r: { score: number; rank: string; maxCombo: number; counts: Record<Grade, number>; nick: string; placed: number; ranking: ScoreEntry[]; flow: number; isBest: boolean; qrSvg?: string | null }): void {
    const rankClass = r.rank === 'S' ? 'glow-a' : r.rank === 'A' ? 'glow-c' : 'glow-m';
    this.resEl.innerHTML = `
      <div class="rank ${rankClass}">${r.rank}</div>
      <div class="big glow-c">${r.score.toLocaleString('ja-JP')}</div>
      <div class="row"><span>PERFECT <b>${r.counts.perfect}</b></span><span>GOOD <b>${r.counts.good}</b></span><span>MISS <b>${r.counts.miss}</b></span><span>MAX <b>${r.maxCombo}</b></span></div>
      <div class="nick">${r.nick}</div>
      ${r.isBest ? '<div class="newbest">きょうの ベスト！</div>' : ''}`;
    this.qrEl.innerHTML = r.qrSvg ? `${r.qrSvg}<div>スマホで よみとると<br>カードを もちかえれる</div>` : '';
    this.rankingEl.innerHTML = `<h3>RANKING</h3><ol>${r.ranking
      .slice(0, 7)
      .map((e, i) => `<li class="${i === r.placed ? 'me' : ''}"><span>${i + 1}. ${escapeHtml(e.name)}</span><span>${e.score.toLocaleString('ja-JP')}</span></li>`)
      .join('')}</ol>`;
  }

  // ── error ──
  setError(title: string, lines: string[], staff?: string): void {
    this.errEl.innerHTML = `<h2>${escapeHtml(title)}</h2>${lines.map((l) => `<p>${l}</p>`).join('')}${staff ? `<div class="staffnote">${escapeHtml(staff)}</div>` : ''}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
