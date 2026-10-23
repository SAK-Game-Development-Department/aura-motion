// Name entry on the results screen. Three ways to type, all at once:
//   - hands-free: hold the index fingertip over a key (dwell) — the camera booth way
//   - mouse: click the keys
//   - a physical keyboard: the name box is a real <input> (IME works, Enter = OK)
// Katakana (with ゛゜ and small kana) and A–Z/0–9 layouts.
import { HAND } from '../config';
import { checkName, NAME_MAX, normalizeName } from '../exhibit/playerName';

const KANA_COLS = ['アイウエオ', 'カキクケコ', 'サシスセソ', 'タチツテト', 'ナニヌネノ', 'ハヒフヘホ', 'マミムメモ', 'ヤ ユ ヨ', 'ラリルレロ', 'ワヲン  ', '゛゜小ー '];
const ABC_ROWS = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ0123', '456789    '];

const DAKU: Record<string, string> = { カ: 'ガ', キ: 'ギ', ク: 'グ', ケ: 'ゲ', コ: 'ゴ', サ: 'ザ', シ: 'ジ', ス: 'ズ', セ: 'ゼ', ソ: 'ゾ', タ: 'ダ', チ: 'ヂ', ツ: 'ヅ', テ: 'デ', ト: 'ド', ハ: 'バ', ヒ: 'ビ', フ: 'ブ', ヘ: 'ベ', ホ: 'ボ', ウ: 'ヴ' };
const HANDAKU: Record<string, string> = { ハ: 'パ', ヒ: 'ピ', フ: 'プ', ヘ: 'ペ', ホ: 'ポ' };
const SMALL: Record<string, string> = { ア: 'ァ', イ: 'ィ', ウ: 'ゥ', エ: 'ェ', オ: 'ォ', ツ: 'ッ', ヤ: 'ャ', ユ: 'ュ', ヨ: 'ョ', ワ: 'ヮ' };
const invert = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a]));
const UNDAKU = { ...invert(DAKU), ...invert(HANDAKU) };
const UNSMALL = invert(SMALL);

/** Apply a modifier key (゛ ゜ 小) to the last character. */
export function applyModifier(name: string, mod: '゛' | '゜' | '小'): string {
  if (!name) return name;
  const chars = [...name];
  const last = chars.pop()!;
  const base = UNDAKU[last] ?? last;
  let out = last;
  if (mod === '゛') out = last === DAKU[base] ? base : (DAKU[base] ?? last);
  else if (mod === '゜') out = last === HANDAKU[base] ? base : (HANDAKU[base] ?? last);
  else out = UNSMALL[last] ?? SMALL[last] ?? last;
  return chars.join('') + out;
}

interface KeyRect {
  el: HTMLElement;
  key: string;
  l: number;
  t: number;
  r: number;
  b: number;
}

export class NameEntry {
  readonly root: HTMLElement;
  private input: HTMLInputElement;
  private msg: HTMLElement;
  private kbd: HTMLElement;
  private cursor: HTMLElement;
  private mode: 'kana' | 'abc' = 'kana';
  private rects: KeyRect[] = [];
  private hover: KeyRect | null = null;
  private hoverSince = 0;
  private cooldownUntil = 0;
  private open = false;
  /** Last time the player did anything here (typed, hovered a key). */
  lastActivity = 0;

  constructor(
    parent: HTMLElement,
    private onDone: (name: string | null) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'name-entry';
    this.root.innerHTML = `<div class="ne-head">名前を入れてランキングに登録</div>
      <div class="ne-box"><input type="text" class="ne-input" maxlength="${NAME_MAX * 2}" autocomplete="off" spellcheck="false" aria-label="名前"><span class="ne-count"></span></div>
      <div class="ne-msg"></div><div class="ne-kbd"></div>
      <div class="ne-hint">指先をキーの上で止めると入力 ・ キーボードでも入力できます（Enter で決定）</div>`;
    this.input = this.root.querySelector('.ne-input')!;
    this.msg = this.root.querySelector('.ne-msg')!;
    this.kbd = this.root.querySelector('.ne-kbd')!;
    this.cursor = document.createElement('div');
    this.cursor.className = 'ne-cursor';
    this.root.appendChild(this.cursor);
    this.input.addEventListener('input', () => {
      this.lastActivity = performance.now();
      this.refresh();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger the staff keys
      if (e.key === 'Enter' && !e.isComposing) this.submit();
    });
    this.kbd.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      if (k) this.press(k.dataset.key!);
    });
    parent.appendChild(this.root);
    this.build();
  }

  get visible(): boolean {
    return this.open;
  }

  show(now: number): void {
    this.open = true;
    this.input.value = '';
    this.msg.textContent = '';
    this.mode = 'kana';
    this.build();
    this.root.classList.add('on');
    this.lastActivity = now;
    this.refresh();
    // Physical keyboard: type straight away.
    setTimeout(() => this.input.focus({ preventScroll: true }), 50);
    requestAnimationFrame(() => this.measure());
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('on');
    this.input.blur();
    this.hover = null;
  }

  get value(): string {
    return this.input.value;
  }

  private build(): void {
    const key = (k: string, cls = '') => (k.trim() ? `<button type="button" class="ne-key ${cls}" data-key="${k}">${k}</button>` : '<span class="ne-key blank"></span>');
    let html = '';
    if (this.mode === 'kana') {
      // Columns of the kana table, read right-to-left like a 50-on chart.
      const cols = [...KANA_COLS].reverse();
      html += '<div class="ne-grid kana">';
      for (let r = 0; r < 5; r++) for (const c of cols) html += key([...c][r] ?? ' ', c === '゛゜小ー ' ? 'mod' : '');
      html += '</div>';
    } else {
      html += '<div class="ne-grid abc">';
      for (const row of ABC_ROWS) for (const ch of row) html += key(ch);
      html += '</div>';
    }
    html += `<div class="ne-ctrl">${key(this.mode === 'kana' ? 'ABC' : 'カナ', 'wide')}${key('けす', 'wide')}${key('決定', 'wide ok')}</div>`;
    this.kbd.innerHTML = html;
    if (this.open) requestAnimationFrame(() => this.measure());
  }

  /** Cache key rectangles (the hand pointer hit-tests against these). */
  measure(): void {
    this.rects = [...this.kbd.querySelectorAll<HTMLElement>('[data-key]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { el, key: el.dataset.key!, l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
  }

  private press(k: string): void {
    this.lastActivity = performance.now();
    let v = this.input.value;
    if (k === '決定') return this.submit();
    if (k === 'けす') v = [...v].slice(0, -1).join('');
    else if (k === 'ABC' || k === 'カナ') {
      this.mode = k === 'ABC' ? 'abc' : 'kana';
      this.build();
      return;
    } else if (k === '゛' || k === '゜' || k === '小') v = applyModifier(v, k);
    else if ([...normalizeName(v)].length < NAME_MAX) v += k;
    this.input.value = v;
    this.refresh();
  }

  private refresh(): void {
    const n = [...normalizeName(this.input.value)].length;
    (this.root.querySelector('.ne-count') as HTMLElement).textContent = `${n}/${NAME_MAX}`;
    if (this.msg.dataset.err && !checkName(this.input.value)) this.msg.textContent = '';
  }

  private submit(): void {
    const err = checkName(this.input.value);
    if (err) {
      this.msg.textContent = err;
      this.msg.dataset.err = '1';
      return;
    }
    const name = normalizeName(this.input.value);
    this.hide();
    this.onDone(name);
  }

  /** Skip (timeout / player left): no name. */
  skip(): void {
    if (!this.open) return;
    this.hide();
    this.onDone(null);
  }

  /** Hands-free pointer: the index fingertip in CSS pixels (null = no hand). */
  pointer(p: { x: number; y: number } | null, now: number): void {
    if (!this.open) return;
    this.cursor.style.opacity = p ? '1' : '0';
    if (!p) {
      this.setHover(null, now);
      return;
    }
    this.cursor.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    const hit = this.rects.find((r) => p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b) ?? null;
    this.setHover(hit, now);
    if (hit) {
      this.lastActivity = now;
      const k = Math.min(1, (now - this.hoverSince) / HAND.keyDwellMs);
      hit.el.style.setProperty('--p', k.toFixed(3));
      if (k >= 1 && now >= this.cooldownUntil) {
        this.press(hit.key);
        // Same key again needs a fresh dwell.
        this.hoverSince = now;
        this.cooldownUntil = now + HAND.keyRepeatMs;
        if (this.rects.length && !this.rects.includes(hit)) this.hover = null;
      }
    }
  }

  private setHover(r: KeyRect | null, now: number): void {
    if (r === this.hover) return;
    this.hover?.el.classList.remove('hover');
    this.hover?.el.style.setProperty('--p', '0');
    this.hover = r;
    this.hoverSince = now;
    r?.el.classList.add('hover');
  }
}
