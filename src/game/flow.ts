// Deterministic CPU tracer simulation for the Flow mini-game. The GPU draws
// hundreds of thousands of particles following the same forces; this small
// set is the scoring truth (replay-safe, no GPU readback).
import { FLOW } from '../config';
import { Rng } from '../core/rng';
import { LM, type Landmark, type Vec2 } from '../core/types';

/** Body segments that push the stream (metric plane: x * aspect). */
const PUSH_SEGS: ReadonlyArray<readonly [number, number]> = [
  [LM.leftShoulder, LM.leftElbow], [LM.leftElbow, LM.leftWrist], [LM.leftWrist, LM.leftIndex],
  [LM.rightShoulder, LM.rightElbow], [LM.rightElbow, LM.rightWrist], [LM.rightWrist, LM.rightIndex],
  [LM.leftShoulder, LM.leftHip], [LM.rightShoulder, LM.rightHip], [LM.leftShoulder, LM.rightShoulder],
];

export interface PushSeg {
  ax: number; ay: number; bx: number; by: number;
  avx: number; avy: number; bvx: number; bvy: number;
}

export function bodySegments(lm: Landmark[], prev: Landmark[] | null, dtSec: number, aspect: number): PushSeg[] {
  const out: PushSeg[] = [];
  for (const [i, j] of PUSH_SEGS) {
    const a = lm[i];
    const b = lm[j];
    if (!a || !b || a.v < 0.3 || b.v < 0.3) continue;
    const pa = prev?.[i];
    const pb = prev?.[j];
    const k = dtSec > 0 ? 1 / dtSec : 0;
    out.push({
      ax: a.x * aspect, ay: a.y, bx: b.x * aspect, by: b.y,
      avx: pa ? (a.x - pa.x) * aspect * k : 0, avy: pa ? (a.y - pa.y) * k : 0,
      bvx: pb ? (b.x - pb.x) * aspect * k : 0, bvy: pb ? (b.y - pb.y) * k : 0,
    });
  }
  return out;
}

export class FlowSim {
  readonly cap = FLOW.tracers;
  readonly px = new Float32Array(this.cap);
  readonly py = new Float32Array(this.cap);
  readonly vx = new Float32Array(this.cap);
  readonly vy = new Float32Array(this.cap);
  readonly alive = new Uint8Array(this.cap);
  private age = new Float32Array(this.cap);
  private emitAcc = 0;
  private rng: Rng;
  captured = 0;
  /** Metric-plane emitter/goal. */
  emitter: Vec2;
  goal: Vec2;

  constructor(
    seed: number,
    emitterView: Vec2,
    private emitDir: Vec2,
    goalView: Vec2,
    readonly aspect: number,
  ) {
    this.rng = new Rng(seed);
    this.emitter = { x: emitterView.x * aspect, y: emitterView.y };
    this.goal = { x: goalView.x * aspect, y: goalView.y };
  }

  /** Advance one fixed step. Returns number captured this step. */
  step(dt: number, segs: readonly PushSeg[], emitting: boolean): number {
    if (emitting) {
      this.emitAcc += FLOW.emitPerSec * dt;
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        this.spawn();
      }
    }
    let got = 0;
    const R = FLOW.pushRadius;
    const gR2 = FLOW.goalRadius * FLOW.goalRadius;
    const bx = this.emitDir.x * FLOW.baseSpeed;
    const by = this.emitDir.y * FLOW.baseSpeed;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      const x = this.px[i]!;
      const y = this.py[i]!;
      // Relax toward the base stream.
      vx += (bx - vx) * 1.2 * dt;
      vy += (by - vy) * 1.2 * dt;
      // Gentle pull toward the goal when close (makes aiming feel "magnetic").
      const gx = this.goal.x - x;
      const gy = this.goal.y - y;
      const gd = Math.hypot(gx, gy);
      if (gd < FLOW.goalRadius * 3) {
        vx += (gx / (gd + 1e-6)) * 0.6 * dt;
        vy += (gy / (gd + 1e-6)) * 0.6 * dt;
      }
      for (const s of segs) {
        const ex = s.bx - s.ax;
        const ey = s.by - s.ay;
        const l2 = ex * ex + ey * ey;
        const u = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2)) : 0;
        const cx = s.ax + ex * u;
        const cy = s.ay + ey * u;
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < R) {
          const f = 1 - d / R;
          const nx = d > 1e-6 ? dx / d : 0;
          const ny = d > 1e-6 ? dy / d : -1;
          vx += nx * FLOW.pushStrength * f * dt * 6;
          vy += ny * FLOW.pushStrength * f * dt * 6;
          const svx = s.avx + (s.bvx - s.avx) * u;
          const svy = s.avy + (s.bvy - s.avy) * u;
          vx += (svx - vx) * FLOW.dragFactor * f;
          vy += (svy - vy) * FLOW.dragFactor * f;
        }
      }
      const sp = Math.hypot(vx, vy);
      if (sp > 3) {
        vx *= 3 / sp;
        vy *= 3 / sp;
      }
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      this.px[i] = nx;
      this.py[i] = ny;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.age[i] = this.age[i]! + dt;
      const ddx = nx - this.goal.x;
      const ddy = ny - this.goal.y;
      if (ddx * ddx + ddy * ddy < gR2) {
        this.alive[i] = 0;
        got++;
      } else if (this.age[i]! > 8 || nx < -0.3 || nx > this.aspect + 0.3 || ny < -0.3 || ny > 1.3) {
        this.alive[i] = 0;
      }
    }
    this.captured += got;
    return got;
  }

  private spawn(): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.alive[i]) continue;
      this.alive[i] = 1;
      this.age[i] = 0;
      this.px[i] = this.emitter.x;
      this.py[i] = this.emitter.y + this.rng.range(-0.05, 0.05);
      const spread = this.rng.range(-0.25, 0.25);
      this.vx[i] = this.emitDir.x * FLOW.baseSpeed - this.emitDir.y * spread * FLOW.baseSpeed;
      this.vy[i] = this.emitDir.y * FLOW.baseSpeed + this.emitDir.x * spread * FLOW.baseSpeed;
      return;
    }
  }

  get aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) n += this.alive[i]!;
    return n;
  }
}
