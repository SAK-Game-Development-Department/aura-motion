// Staff settings panel (S key). Mouse-operated; the game keeps running behind
// it so every change is visible at once. Elements are built once.
import { SETTINGS } from '../config';
import { defaultSettings, type Settings } from '../exhibit/settings';

type Num = 'brightness' | 'glow' | 'background' | 'effects' | 'sfxVolume' | 'ambientVolume' | 'musicVolume';
type Choice = 'particles' | 'techLens' | 'resolution';
type Flag = 'lens' | 'sealAssist' | 'online' | 'sound';

const NUMS: Array<{ k: Num; label: string; hint: string }> = [
  { k: 'brightness', label: '明るさ', hint: '画面全体。眩しいときは下げる' },
  { k: 'glow', label: '光のにじみ', hint: '光がぼやけて広がる強さ（ブルーム）' },
  { k: 'background', label: '背景の明るさ', hint: '背景の模様・色の強さ' },
  { k: 'effects', label: '演出の強さ', hint: 'フラッシュ・揺れ・ズーム・色ずれ' },
  { k: 'sfxVolume', label: '効果音の音量', hint: '技・命中・撃破・ボスなど' },
  { k: 'musicVolume', label: 'BGM の音量', hint: 'ステージごとの音楽（敵が来る拍に合わせて鳴る）' },
  { k: 'ambientVolume', label: '環境音の音量', hint: 'ステージごとの静かな背景の音' },
];
const CHOICES: Array<{ k: Choice; label: string; opts: Array<[string, string]> }> = [
  { k: 'resolution', label: '画質（重いときは下げる）', opts: [['low', '軽い'], ['standard', '標準'], ['high', '高精細']] },
  { k: 'particles', label: '粒子の数', opts: [['auto', '自動'], ['low', '少なめ'], ['mid', 'ふつう'], ['high', '多め']] },
  { k: 'techLens', label: 'テックレンズ', opts: [['auto', '自動'], ['on', '常に表示'], ['off', '表示しない']] },
];
const FLAGS: Array<{ k: Flag; label: string; hint: string }> = [
  { k: 'sound', label: '音を出す', hint: 'ブラウザの制限で、最初にクリックかキーを押すまで鳴らないことがある' },
  { k: 'lens', label: '色ずれ（レンズ効果）', hint: '大技で画面の端の色がずれる' },
  { k: 'sealAssist', label: '手のポーズのアシスト', hint: '敵が待っている手の形・動き・両手ポーズを決めやすくする' },
  { k: 'online', label: '全国ランキングに送る', hint: 'スコアと入れた名前だけを送信' },
];

export class SettingsPanel {
  readonly root: HTMLElement;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private outs = new Map<string, HTMLElement>();
  private open = false;
  /** Always-visible button that opens/closes the panel (mouse / touch). */
  readonly button: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private get: () => Settings,
    private set: (s: Settings) => void,
  ) {
    const el = document.createElement('div');
    el.className = 'settings';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '設定');
    const rows: string[] = ['<h2>設定 <small>S キーでも開閉・この端末に保存</small><button type="button" class="x" data-act="close" aria-label="閉じる">×</button></h2>'];
    for (const n of NUMS) {
      const [lo, hi] = SETTINGS.ranges[n.k];
      rows.push(`<label class="row"><span class="lb">${n.label}<em>${n.hint}</em></span><input type="range" data-k="${n.k}" min="${lo}" max="${hi}" step="0.05"><output data-k="${n.k}"></output></label>`);
    }
    for (const c of CHOICES) rows.push(`<label class="row"><span class="lb">${c.label}</span><select data-k="${c.k}">${c.opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`);
    for (const f of FLAGS) rows.push(`<label class="row chk"><span class="lb">${f.label}<em>${f.hint}</em></span><input type="checkbox" data-k="${f.k}"></label>`);
    rows.push('<div class="btns"><button type="button" data-act="reset">初期値に戻す</button><button type="button" data-act="close">閉じる</button></div>');
    el.innerHTML = rows.join('');
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((i) => {
      if (i.tagName === 'OUTPUT') this.outs.set(i.dataset.k!, i);
      else this.inputs.set(i.dataset.k!, i);
    });
    el.addEventListener('input', () => this.commit());
    el.addEventListener('change', () => this.commit());
    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === 'reset') {
        this.set(defaultSettings());
        this.sync();
      } else if (act === 'close') this.toggle(false);
    });
    // Keys typed into the panel must not reach the game (except S to close).
    el.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 's') e.stopPropagation();
    });
    parent.appendChild(el);
    this.root = el;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'settings-btn';
    b.setAttribute('aria-label', '設定を開く');
    b.innerHTML = '<span aria-hidden="true">⚙</span>設定';
    b.addEventListener('click', () => this.toggle());
    parent.appendChild(b);
    this.button = b;
  }

  get visible(): boolean {
    return this.open;
  }

  toggle(on = !this.open): void {
    this.open = on;
    this.root.classList.toggle('on', on);
    this.button.classList.toggle('on', on);
    document.body.classList.toggle('cursor', on);
    if (on) this.sync();
  }

  /** Inputs ← current settings. */
  private sync(): void {
    const s = this.get();
    for (const [k, i] of this.inputs) {
      const v = s[k as keyof Settings];
      if (i instanceof HTMLInputElement && i.type === 'checkbox') i.checked = !!v;
      else i.value = String(v);
    }
    this.showValues(s);
  }

  private showValues(s: Settings): void {
    for (const n of NUMS) this.outs.get(n.k)!.textContent = `${Math.round(s[n.k] * 100)}%`;
  }

  /** Settings ← inputs. */
  private commit(): void {
    const s = { ...this.get() } as Record<string, unknown>;
    for (const [k, i] of this.inputs) {
      if (i instanceof HTMLInputElement && i.type === 'checkbox') s[k] = i.checked;
      else if (i instanceof HTMLInputElement) s[k] = Number(i.value);
      else s[k] = i.value;
    }
    this.set(s as Settings);
    this.showValues(this.get());
  }
}
