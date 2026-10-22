// Display prediction: the drawn hand is extrapolated from the capture time of
// its landmarks to "now" (render time) with each landmark's filtered velocity.
// This hides the camera → inference latency and the gap between tracking
// frames (30–60 Hz) and render frames. Recognition never uses this — only the
// picture does. Buffers are reused per hand slot (no per-frame allocation).
import { LATENCY } from '../config';
import type { Landmark, Vec2 } from '../core/types';
import type { TrackedHand } from './tracker';

export interface PredictedHand {
  lm: Landmark[];
  palm: Vec2;
  tip: Vec2;
}

export class HandPredictor {
  private bufs = new Map<number, PredictedHand>();
  /** Extra look-ahead for the display itself (ms; half a frame + scan-out). */
  displayMs = 8;
  enabled = true;

  /** Extrapolated landmarks for `h` at render time `now`. */
  predict(h: TrackedHand, now: number): PredictedHand {
    let b = this.bufs.get(h.slot);
    if (!b) {
      b = { lm: h.lm.map((p) => ({ ...p })), palm: { x: 0, y: 0 }, tip: { x: 0, y: 0 } };
      this.bufs.set(h.slot, b);
      if (this.bufs.size > 8) this.bufs.delete(this.bufs.keys().next().value!);
    }
    const ahead = this.enabled ? Math.max(0, Math.min(LATENCY.maxPredictMs, now - h.t + this.displayMs)) : 0;
    // Damped: velocities lag on sudden stops, so never fully trust them.
    const dt = (ahead / 1000) * LATENCY.displayPredictGain;
    let px = 0;
    let py = 0;
    for (let i = 0; i < h.lm.length; i++) {
      const p = h.lm[i]!;
      const v = h.vel[i] ?? { x: 0, y: 0 };
      const o = b.lm[i]!;
      o.x = p.x + clampV(v.x) * dt;
      o.y = p.y + clampV(v.y) * dt;
      o.z = p.z;
    }
    for (const i of [0, 5, 9, 13, 17]) {
      px += b.lm[i]!.x;
      py += b.lm[i]!.y;
    }
    b.palm.x = px / 5;
    b.palm.y = py / 5;
    b.tip.x = b.lm[8]!.x;
    b.tip.y = b.lm[8]!.y;
    return b;
  }

  forget(slot: number): void {
    this.bufs.delete(slot);
  }
}

/** Cap absurd velocities (tracking glitches) — 6 view units / s is a very fast hand. */
const clampV = (v: number) => (v > 6 ? 6 : v < -6 ? -6 : v);
