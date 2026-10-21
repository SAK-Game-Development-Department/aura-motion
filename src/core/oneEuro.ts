// One Euro filter (Casiez, Roussel, Vogel 2012). Timestamps in ms.
export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

function alpha(cutoff: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSec);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private tPrev = 0;

  constructor(private p: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  /** Current derivative estimate (units / second). */
  get velocity(): number {
    return this.dx;
  }

  get value(): number | null {
    return this.x;
  }

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.tPrev = tMs;
      this.dx = 0;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** 2D convenience wrapper. */
export class OneEuro2 {
  readonly fx: OneEuro;
  readonly fy: OneEuro;
  constructor(p: OneEuroParams) {
    this.fx = new OneEuro(p);
    this.fy = new OneEuro(p);
  }
  filter(x: number, y: number, t: number): { x: number; y: number } {
    return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) };
  }
  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
  get vx(): number {
    return this.fx.velocity;
  }
  get vy(): number {
    return this.fy.velocity;
  }
}
