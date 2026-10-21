import type { Vec2 } from './types';

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Easing set (docs/art-direction.md: every motion is eased). */
export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3),
  inCubic: (t: number) => Math.pow(clamp(t, 0, 1), 3),
  inOutSine: (t: number) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2,
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t, 0, 1))),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const u = clamp(t, 0, 1) - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  },
};

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Fixed-capacity ring buffer (no allocation after construction). */
export class Ring<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private n = 0;
  constructor(readonly capacity: number) {
    this.buf = new Array<T | undefined>(capacity);
  }
  push(v: T): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.n < this.capacity) this.n++;
  }
  get length(): number {
    return this.n;
  }
  /** i = 0 is oldest. */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.n) return undefined;
    return this.buf[(this.head - this.n + i + this.capacity) % this.capacity];
  }
  last(): T | undefined {
    return this.at(this.n - 1);
  }
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.n; i++) out.push(this.at(i)!);
    return out;
  }
  clear(): void {
    this.n = 0;
    this.head = 0;
    this.buf.fill(undefined);
  }
}
