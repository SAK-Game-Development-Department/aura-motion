// Latency calibration: the player makes a fist on each light pulse; the median
// offset between the detected moments (capture clock) and the pulses is the
// system + human latency used to shift judgement.
import { LATENCY } from "../config";
import { clamp, median } from "../core/math";

export interface CalibrationResult {
  offsetMs: number;
  samples: number[];
  accepted: boolean;
}

export class LatencyCalibrator {
  readonly pulses: number[];
  private events: number[] = [];

  /** startT: source-clock time when calibration begins. */
  constructor(
    readonly startT: number,
    readonly pulseCount: number = LATENCY.calibPulses,
    readonly intervalMs: number = LATENCY.calibIntervalMs,
  ) {
    this.pulses = [];
    for (let i = 0; i < pulseCount; i++)
      this.pulses.push(startT + LATENCY.calibLeadInMs + i * intervalMs);
  }

  get endT(): number {
    return this.pulses[this.pulses.length - 1]! + this.intervalMs;
  }

  /** Feed a detected timing event (e.g. the moment a fist is formed). */
  addEvent(t: number): void {
    this.events.push(t);
  }

  get lastEvent(): number | null {
    return this.events.length ? this.events[this.events.length - 1]! : null;
  }

  /** Number of pulses that already have a matching event (live feedback). */
  matched(): number {
    return this.pulses.filter((p) =>
      this.events.some((c) => Math.abs(c - p) <= LATENCY.calibAcceptMs),
    ).length;
  }

  result(): CalibrationResult {
    const samples: number[] = [];
    for (const p of this.pulses) {
      let best: number | null = null;
      for (const c of this.events) {
        const d = c - p;
        if (
          Math.abs(d) <= LATENCY.calibAcceptMs &&
          (best === null || Math.abs(d) < Math.abs(best))
        )
          best = d;
      }
      if (best !== null) samples.push(best);
    }
    if (samples.length < Math.min(LATENCY.calibMinSamples, this.pulseCount))
      return { offsetMs: LATENCY.defaultOffsetMs, samples, accepted: false };
    return {
      offsetMs: clamp(
        median(samples),
        LATENCY.minOffsetMs,
        LATENCY.maxOffsetMs,
      ),
      samples,
      accepted: true,
    };
  }
}
