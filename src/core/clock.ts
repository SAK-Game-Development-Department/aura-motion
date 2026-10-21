// Injectable clock: game logic never reads performance.now() directly so that
// replays and tests are deterministic.
export interface Clock {
  now(): number;
}

export const realClock: Clock = {
  now: () => performance.now(),
};

export class ManualClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  advance(dt: number): number {
    this.t += dt;
    return this.t;
  }
}
