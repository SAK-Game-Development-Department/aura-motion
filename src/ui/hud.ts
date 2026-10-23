// DOM HUD. Minimal, large text; information is carried by shape/colour/motion
// in the WebGL layer. All elements are created once and toggled (no leaks).
import type { Placement } from '../exhibit/presence';
import type { Grade } from '../game/score';
import type { ScoreEntry } from '../exhibit/highscores';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export type Screen = 'loading' | 'title' | 'select' | 'calibrate' | 'play' | 'results' | 'error';

export interface SelectCard {
  /** Small header (level) and its English line. */
  top: string;
  topSub: string;
  stars: number;
  /** Big title and its reading / sub line. */
  title: string;
  sub: string;
  desc: string;
  /** Line near the bottom (boss / stage list). */
  foot: string;
  best: number;
  hue: 'cyan' | 'magenta' | 'amber' | 'vermilion';
}

const SECTION_ICON: Record<string, string> = { intro: '●', flow: '≈', wall: '⌂', dodge: '⇅', finale: '✦', tap: '●', trace: '〰', shape: '✋', pinch: '◉' };
const SECTION_NAME: Record<string, string> = {
  intro: '序盤', rush: 'ラッシュ', guard: '防御', boss: 'ボス', hidden: '隠しボス',
};

// Open-hand outline (palm toward the camera) for the placement guide.
const GUIDE_SVG = `
<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <path d="M38 150 C30 128 26 112 24 98 L14 66 C12 58 22 54 26 62 L36 86 L36 30 C36 22 47 22 47 30 L48 74 L50 18 C50 10 62 10 62 18 L62 72 L66 24 C66 16 78 16 78 24 L76 76 L84 40 C86 32 97 34 95 42 L88 98 C86 122 80 138 76 150 Z"/>
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
  private localRankEl: HTMLElement;
  private onlineEl: HTMLElement;
  private qrEl: HTMLElement;
  private cutinEl: HTMLElement;
  private hurtEl: HTMLElement;
  private marksEl: HTMLElement;
  private markPool = new Map<string, HTMLElement>();
  private errEl: HTMLElement;
  private buttons = new Map<string, HTMLElement>();
  private judgePool: HTMLElement[] = [];
  private judgeIdx = 0;
  private screen: Screen | null = null;
  private lastScore = -1;
  private lastCombo = -1;
  private sectionKinds: string[] = [];
  private cards: HTMLElement[] = [];
  private selCursor: HTMLElement;
  private selHead: HTMLElement;
  private selHover = -2;

  constructor(parent: HTMLElement) {
    this.root = h('div');
    this.root.id = 'ui';
    parent.appendChild(this.root);
    const mk = (s: Screen) => {
      const l = h('div', `layer ${s}`);
      this.root.appendChild(l);
      return l;
    };
    this.layers = { loading: mk('loading'), title: mk('title'), select: mk('select'), calibrate: mk('calibrate'), play: mk('play'), results: mk('results'), error: mk('error') };

    // Shared privacy notice (title + loading + error).
    const privacy = '<b>映像は端末の外に出ず、保存されません。</b>&nbsp;カメラは手の形と動きの推定だけに使います（顔の認識・識別はしません）。全国ランキングに送るのはスコアと自動のニックネームだけです。';
    for (const s of ['loading', 'title', 'error'] as const) this.layers[s].appendChild(h('div', 'privacy', privacy));

    // Loading
    const lg = h('div', 'logo', 'AURA');
    this.layers.loading.appendChild(lg);
    const load = h('div', 'load');
    this.loadLabel = h('div', 'label', '準備中…');
    const bar = h('div', 'bar');
    this.loadBar = h('i');
    bar.appendChild(this.loadBar);
    load.append(this.loadLabel, bar);
    this.layers.loading.appendChild(load);

    // Title
    this.layers.title.appendChild(h('div', 'logo', 'AURA'));
    this.guide = h('div', 'guide', GUIDE_SVG);
    this.layers.title.appendChild(this.guide);
    this.callEl = h('div', 'call glow-c', 'カメラに手をかざして開始');
    this.hintEl = h('div', 'hint glow-a', '');
    this.layers.title.append(this.callEl, this.hintEl);
    const svg = this.guide.querySelector('svg');
    if (svg) {
      // Progress stroke that fills while holding position.
      const ns = 'http://www.w3.org/2000/svg';
      const fill = document.createElementNS(ns, 'path');
      fill.setAttribute('d', 'M60 88 A20 20 0 1 1 59.9 88');
      fill.setAttribute('class', 'fill');
      fill.setAttribute('pathLength', '1');
      fill.style.strokeDasharray = '1';
      fill.style.strokeDashoffset = '1';
      svg.appendChild(fill);
      this.guideFill = fill;
    }

    // Stage selection (cards are filled by setSelect)
    this.selHead = h('div', 'sel-head glow-c', '難易度を選ぶ');
    this.layers.select.appendChild(this.selHead);
    this.layers.select.appendChild(h('div', 'sel-sub', '選びたいカードの前に手をかざして、そのまま止める'));
    this.selCursor = h('div', 'sel-cursor');
    this.layers.select.appendChild(this.selCursor);

    // Calibration
    this.calibText = h('div', 'calib-text glow-a', '手を開いて');
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
    this.marksEl = h('div', 'marks');
    this.layers.play.appendChild(this.marksEl);
    this.hurtEl = h('div', 'hurt');
    this.root.appendChild(this.hurtEl);
    this.cutinEl = h('div', 'cutin', '<i class="bar t"></i><i class="bar b"></i><i class="ink"></i><div class="ct"><div class="kanji"></div><div class="read"></div></div>');
    this.root.appendChild(this.cutinEl);

    // Results
    this.resEl = h('div', 'res');
    this.rankingEl = h('div', 'ranking');
    this.localRankEl = h('div', 'local');
    this.onlineEl = h('div', 'online');
    this.rankingEl.append(this.localRankEl, this.onlineEl);
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
  setTitle(opts: { attract: boolean; placement: Placement; progress: number; waitingNext?: boolean }): void {
    const { attract, placement, progress } = opts;
    if (opts.waitingNext) {
      this.guide.style.opacity = '0';
      this.callEl.textContent = 'ありがとうございました！ 次の方どうぞ';
      this.hintEl.textContent = '';
      return;
    }
    this.guide.style.opacity = attract ? '0' : '1';
    this.guide.classList.toggle('tooClose', placement === 'tooClose');
    this.guide.classList.toggle('tooFar', placement === 'tooFar');
    if (this.guideFill) this.guideFill.style.strokeDashoffset = String(1 - progress);
    this.callEl.textContent = attract || placement === 'none' ? 'カメラに手をかざして開始' : placement === 'ok' ? (progress > 0 ? 'そのまま…' : 'そのまま静止') : '';
    this.hintEl.textContent = placement === 'tooClose' ? '少し手を離して' : placement === 'tooFar' ? 'もう少し近づけて' : '';
    this.hintEl.className = `hint ${placement === 'tooClose' ? 'glow-m' : 'glow-a'}`;
  }

  // ── stage selection ──
  setSelect(heading: string, cards: SelectCard[]): void {
    this.selHead.textContent = heading;
    for (const c of this.cards) c.remove();
    this.cards = cards.map((c) => {
      const el = h(
        'div',
        `sel-card hue-${c.hue}`,
        `<div class="prog"></div><div class="lv">${c.top}<small>${c.topSub}</small></div><div class="stars">${'★'.repeat(c.stars)}${'☆'.repeat(3 - c.stars)}</div>` +
          `<div class="nm">${c.title}</div><div class="rd">${c.sub}</div><div class="ds">${c.desc}</div>` +
          `<div class="boss">${c.foot}</div><div class="best">この端末の本日最高 <b>${c.best > 0 ? c.best.toLocaleString('ja-JP') : '―'}</b></div>`,
      );
      this.layers.select.appendChild(el);
      return el;
    });
    this.selHover = -2;
  }

  /** Card rects in CSS px (left, right), hover index, progress and the hand position. */
  updateSelect(rects: Array<{ l: number; r: number }>, hover: number | null, progress: number, hand: { x: number; y: number } | null): void {
    for (let i = 0; i < this.cards.length; i++) {
      const el = this.cards[i]!;
      const r = rects[i];
      if (r) {
        el.style.left = `${r.l.toFixed(0)}px`;
        el.style.width = `${(r.r - r.l).toFixed(0)}px`;
      }
      el.style.setProperty('--p', (hover === i ? progress : 0).toFixed(3));
    }
    const hv = hover ?? -1;
    if (hv !== this.selHover) {
      this.selHover = hv;
      this.cards.forEach((c, i) => c.classList.toggle('hover', i === hv));
    }
    this.selCursor.style.opacity = hand ? '1' : '0';
    if (hand) this.selCursor.style.transform = `translate(${hand.x.toFixed(0)}px, ${hand.y.toFixed(0)}px)`;
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
  setSections(kinds: string[]): void {
    this.sectionKinds = kinds;
    this.sectionsEl.innerHTML = '';
    for (const k of kinds) {
      const s = h('span', '', SECTION_ICON[k] ?? '●');
      s.title = SECTION_NAME[k] ?? k;
      this.sectionsEl.appendChild(s);
    }
  }

  setSection(idx: number, kind: string, announce: boolean): void {
    Array.from(this.sectionsEl.children).forEach((c, i) => {
      c.classList.toggle('now', i === idx);
      c.classList.toggle('done', i < idx);
    });
    if (announce && this.sectionKinds.length > 1) {
      this.bannerEl.textContent = SECTION_NAME[kind] ?? kind;
      this.bannerEl.classList.remove('show');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('show');
    }
  }

  /** Cinematic cut-in: letterbox bars, an ink stroke, the technique's name in huge kanji. */
  cutin(title: string, reading: string, hue: 'cyan' | 'magenta' | 'amber', big: boolean): void {
    const el = this.cutinEl;
    el.querySelector('.kanji')!.textContent = title;
    el.querySelector('.read')!.textContent = reading;
    el.className = `cutin ${hue}${big ? ' big' : ''}`;
    void el.offsetWidth;
    el.classList.add('show');
  }

  hurt(): void {
    this.hurtEl.classList.remove('on');
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('on');
  }

  /** Labels under weak-point marks (screen px). */
  setMarks(marks: Array<{ id: string; x: number; y: number; text: string; strong: boolean }>): void {
    const keep = new Set<string>();
    for (const m of marks) {
      keep.add(m.id);
      let el = this.markPool.get(m.id);
      if (!el) {
        el = h('div', 'mark');
        this.marksEl.appendChild(el);
        this.markPool.set(m.id, el);
      }
      if (el.textContent !== m.text) el.textContent = m.text;
      el.classList.toggle('strong', m.strong);
      el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px) translate(-50%, 0)`;
    }
    for (const [id, el] of this.markPool) {
      if (!keep.has(id)) {
        el.remove();
        this.markPool.delete(id);
      }
    }
  }

  /** Show/hide the battle score & combo (hidden in practice). */
  setScoreVisible(on: boolean): void {
    this.scoreEl.style.display = on ? '' : 'none';
    this.comboEl.style.display = on ? '' : 'none';
    this.timeEl.parentElement!.style.display = on ? '' : 'none';
  }

  /** Big transient label (technique name etc.). */
  announce(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
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
  setResults(r: { score: number; rank: string; maxCombo: number; counts: Record<Grade, number>; nick: string; placed: number; ranking: ScoreEntry[]; flow: number; isBest: boolean; qrSvg?: string | null; extra?: string; stage?: string }): void {
    const rankClass = r.rank === 'S' ? 'glow-a' : r.rank === 'A' ? 'glow-c' : 'glow-m';
    this.resEl.innerHTML = `
      ${r.stage ? `<div class="stage-name">${r.stage}</div>` : ''}
      <div class="rank ${rankClass}">${r.rank}</div>
      <div class="big glow-c">${r.score.toLocaleString('ja-JP')}</div>
      <div class="row"><span>PERFECT <b>${r.counts.perfect}</b></span><span>GOOD <b>${r.counts.good}</b></span><span>MISS <b>${r.counts.miss}</b></span><span>MAX <b>${r.maxCombo}</b></span></div>
      ${r.extra ? `<div class="row">${r.extra}</div>` : ''}
      <div class="nick">${r.nick}</div>
      ${r.isBest ? '<div class="newbest">本日のベスト！</div>' : ''}`;
    this.qrEl.innerHTML = r.qrSvg ? `${r.qrSvg}<div>スマホで読み取ると<br>記録カードを持ち帰れます</div>` : '';
    this.onlineEl.innerHTML = '';
    this.localRankEl.innerHTML = `<h3>この端末${r.stage ? ` <small>${r.stage}</small>` : ''}</h3><ol>${r.ranking
      .slice(0, 5)
      .map((e, i) => `<li class="${i === r.placed ? 'me' : ''}"><span>${i + 1}. ${escapeHtml(e.name)}</span><span>${e.score.toLocaleString('ja-JP')}</span></li>`)
      .join('')}</ol>`;
  }

  // ── error ──
  /** The results layer (the name entry lives in it). */
  get resultsLayer(): HTMLElement {
    return this.layers.results;
  }

  /** While naming, the score moves up and the rankings wait. */
  setNaming(on: boolean): void {
    this.layers.results.classList.toggle('naming', on);
  }

  /** Shared (nationwide) ranking on the results screen; filled in when the server answers. */
  setOnline(o: { state: 'loading' | 'ok' | 'offline'; level: string; reason?: string; list?: Array<{ name: string; score: number; region: string; stageName: string }>; me?: { name: string; score: number }; place?: { placeToday: number | null; placeAll: number; total: number; updated?: boolean; best?: number } | null }): void {
    if (o.state === 'offline') {
      this.onlineEl.innerHTML = `<h3>全国ランキング</h3><p class="off">オフライン（この端末の記録のみ）${o.reason ? `<br><small>${escapeHtml(o.reason)}</small>` : ''}</p>`;
      return;
    }
    if (o.state === 'loading') {
      this.onlineEl.innerHTML = `<h3>全国ランキング</h3><p class="off">送信中…</p>`;
      return;
    }
    const mine = (e: { name: string; score: number }) => !!o.me && e.name === o.me.name;
    const p = o.place;
    const kept = p && p.updated === false ? `<p class="off">この名前の記録 ${p.best?.toLocaleString('ja-JP')} 点の方が上なので、そのまま</p>` : '';
    const place = p ? `<p class="place">${p.placeToday !== null ? `本日 <b>${p.placeToday}</b> 位　` : ''}累計 <b>${p.placeAll}</b> 位 <small>/ ${p.total.toLocaleString('ja-JP')} 人</small></p>${kept}` : '';
    const empty = !o.list?.length ? '<p class="off">本日の記録はまだありません</p>' : '';
    this.onlineEl.innerHTML = `<h3>全国ランキング <small>${o.level}・本日</small></h3>${place}${empty}<ol>${(o.list ?? [])
      .slice(0, 5)
      .map((e, i) => `<li class="${mine(e) ? 'me' : ''}"><span>${i + 1}. ${escapeHtml(e.name)}<em>${escapeHtml(e.region || '―')}・${escapeHtml(e.stageName)}</em></span><span>${e.score.toLocaleString('ja-JP')}</span></li>`)
      .join('')}</ol>`;
  }

  setError(title: string, lines: string[], staff?: string): void {
    this.errEl.innerHTML = `<h2>${escapeHtml(title)}</h2>${lines.map((l) => `<p>${l}</p>`).join('')}${staff ? `<div class="staffnote">${escapeHtml(staff)}</div>` : ''}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
