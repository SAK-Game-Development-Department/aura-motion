// Emergency input (camera unavailable): the mouse moves the hand (the index
// fingertip follows the cursor), number keys 1–8 make shapes, click = pinch,
// arrow keys = swipes, +/- = push/pull, F = flick, T = second hand (two-hand
// join/spread with the space bar). Staff-only fallback.
import type { PoseFrame, Vec2 } from '../core/types';
import { HL } from '../core/types';
import { buildHand, defaultHand, relaxedHand, SHAPE_IDS, withShape, type SynthHand } from '../gesture/handModel';
import { PulledSource } from './source';

export class MouseSource extends PulledSource {
  readonly kind = 'mouse' as const;
  private cursor: Vec2 = { x: 0.6, y: 0.5 };
  private down = false;
  private shape: number | null = 2; // point
  private present = true;
  private motion: { kind: string; at: number } | null = null;
  private spreadAt = -1e9;
  private off: Array<() => void> = [];

  constructor(private toView: (x: number, y: number) => Vec2) {
    super(30);
  }

  override async start(): Promise<void> {
    await super.start();
    const mm = (e: MouseEvent) => (this.cursor = this.toView(e.clientX, e.clientY));
    const md = () => (this.down = true);
    const mu = () => (this.down = false);
    const kd = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= SHAPE_IDS.length) this.shape = n - 1;
      else if (e.key === '0') this.shape = null;
      else if (e.key === 'ArrowLeft') this.motion = { kind: 'swipeL', at: performance.now() };
      else if (e.key === 'ArrowRight') this.motion = { kind: 'swipeR', at: performance.now() };
      else if (e.key === 'ArrowUp') this.motion = { kind: 'swipeU', at: performance.now() };
      else if (e.key === 'ArrowDown') this.motion = { kind: 'swipeD', at: performance.now() };
      else if (e.key === '+' || e.key === '=') this.motion = { kind: 'push', at: performance.now() };
      else if (e.key === '-') this.motion = { kind: 'pull', at: performance.now() };
      else if (e.key.toLowerCase() === 'g') this.motion = { kind: 'flick', at: performance.now() };
      else if (e.key === ' ') this.spreadAt = performance.now();
      else if (e.key.toLowerCase() === 'z') this.present = !this.present;
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('keydown', kd);
    this.off.push(
      () => window.removeEventListener('mousemove', mm),
      () => window.removeEventListener('mousedown', md),
      () => window.removeEventListener('mouseup', mu),
      () => window.removeEventListener('keydown', kd),
    );
  }

  override stop(): void {
    super.stop();
    for (const f of this.off) f();
    this.off = [];
  }

  protected produce(t: number): PoseFrame {
    if (!this.present) return { t, poses: [], hands: [], aspect: 16 / 9 };
    const now = performance.now();
    let h: SynthHand = { ...defaultHand('R'), wrist: { x: 0.5, y: 0.5 }, size: 0.15 };
    h = this.shape !== null ? withShape(h, SHAPE_IDS[this.shape]!) : relaxedHand(h, 0.2);
    if (this.down) h = withShape(h, 'pinch');
    const tip = buildHand(h)[HL.indexTip]!;
    h.wrist = { x: 0.5 + this.cursor.x - tip.x, y: 0.5 + this.cursor.y - tip.y };
    const m = this.motion;
    if (m) {
      const k = Math.min(1, (now - m.at) / 250);
      const d = h.size * 3.4;
      if (m.kind === 'swipeL') h.wrist.x -= (k * d) / (16 / 9);
      if (m.kind === 'swipeR') h.wrist.x += (k * d) / (16 / 9);
      if (m.kind === 'swipeU') h.wrist.y -= k * d;
      if (m.kind === 'swipeD') h.wrist.y += k * d;
      if (m.kind === 'push') h.size *= 1 + 0.45 * k;
      if (m.kind === 'pull') h.size *= 1 - 0.32 * k;
      if (m.kind === 'flick') h.curl = [h.curl[0], 1 - Math.min(1, (now - m.at) / 90), h.curl[2], h.curl[3], h.curl[4]];
      if (now - m.at > 500) this.motion = null;
    }
    const hands = [{ lm: buildHand(h), score: 1 }];
    // Space: a second hand joins the first, then both fly apart.
    const s = (now - this.spreadAt) / 1000;
    if (s >= 0 && s < 1.2) {
      const gap = s < 0.6 ? h.size * 0.5 : h.size * (0.5 + (s - 0.6) * 8);
      const a = { ...withShape({ ...defaultHand('L'), size: h.size }, 'open'), wrist: { x: 0.5 - gap / (16 / 9), y: 0.65 } };
      const b = { ...withShape({ ...defaultHand('R'), size: h.size }, 'open'), wrist: { x: 0.5 + gap / (16 / 9), y: 0.65 } };
      return { t, poses: [], hands: [{ lm: buildHand(a), score: 1 }, { lm: buildHand(b), score: 1 }], aspect: 16 / 9, luma: 0.4 };
    }
    return { t, poses: [], hands, aspect: 16 / 9, luma: 0.4 };
  }

  override status() {
    return { ready: this.running, detail: 'mouse mode: move=hand, 1-8=shape, click=pinch, arrows=swipe, +/-=push/pull, G=flick, space=two-hand, Z=leave' };
  }
}
