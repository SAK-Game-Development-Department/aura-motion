// Latency calibration: the player claps on visual pulses; the median offset
// between detected clap times (capture clock) and pulse times is the system +
// human latency used to shift judgement.
import { LATENCY } from '../config';
import { clamp, median } from '../core/math';
import type { BodySnapshot } from '../input/body';

export interface CalibrationResult {
  offsetMs: number;
  samples: number[];
  accepted: boolean;
}

export class ClapDetector {
  private prevD: number | null = null;
  private prevT = 0;
  private armed = true;

  /** Returns clap time (interpolated) or null. Distance threshold in body units. */
  update(b: BodySnapshot, closeTh = 0.75, openTh = 1.2): number | null {
    if (!b.present) {
      this.prevD = null;
      return null;
    }
    const d = (Math.hypot((b.hands.L.x - b.hands.R.x) * b.aspect, b.hands.L.y - b.hands.R.y)) / b.anchor.unit;
    let clap: number | null = null;
    if (this.prevD !== null && this.armed && this.prevD > closeTh && d <= closeTh) {
      const f = (this.prevD - closeTh) / Math.max(1e-6, this.prevD - d);
      clap = this.prevT + (b.t - this.prevT) * f;
      this.armed = false;
    }
    if (d > openTh) this.armed = true;
    this.prevD = d;
    this.prevT = b.t;
    return clap;
  }
}

export class LatencyCalibrator {
  readonly pulses: number[];
  private claps: number[] = [];
  private det = new ClapDetector();

  /** startT: source-clock time when calibration begins. */
  constructor(readonly startT: number) {
    this.pulses = [];
    for (let i = 0; i < LATENCY.calibPulses; i++) this.pulses.push(startT + LATENCY.calibLeadInMs + i * LATENCY.calibIntervalMs);
  }

  get endT(): number {
    return this.pulses[this.pulses.length - 1]! + LATENCY.calibIntervalMs;
  }

  feed(b: BodySnapshot): number | null {
    const c = this.det.update(b);
    if (c !== null) this.claps.push(c);
    return c;
  }

  result(): CalibrationResult {
    const samples: number[] = [];
    for (const p of this.pulses) {
      let best: number | null = null;
      for (const c of this.claps) {
        const d = c - p;
        if (Math.abs(d) <= LATENCY.calibAcceptMs && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
      if (best !== null) samples.push(best);
    }
    if (samples.length < LATENCY.calibMinSamples) {
      return { offsetMs: LATENCY.defaultOffsetMs, samples, accepted: false };
    }
    return { offsetMs: clamp(median(samples), LATENCY.minOffsetMs, LATENCY.maxOffsetMs), samples, accepted: true };
  }
}
