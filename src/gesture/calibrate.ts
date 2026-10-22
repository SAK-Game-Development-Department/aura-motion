// Per-player threshold calibration: watch the player's "open" and "fist"
// once each, then place the extended/curled thresholds between the two
// (relative to this player's own range — finger length, flexibility, gloves).
import { GESTURE } from '../config';
import { median } from '../core/math';
import { defaultThresholds, type Features, type Thresholds } from './features';

export class GestureCalibrator {
  private open: Features[] = [];
  private fist: Features[] = [];

  add(kind: 'open' | 'fist', f: Features): void {
    (kind === 'open' ? this.open : this.fist).push(f);
  }

  get counts(): { open: number; fist: number } {
    return { open: this.open.length, fist: this.fist.length };
  }

  /** Thresholds; falls back to defaults for anything not observed well. */
  result(minSamples = 8): { thresholds: Thresholds; ok: boolean } {
    const th = defaultThresholds();
    if (this.open.length < minSamples || this.fist.length < minSamples) return { thresholds: th, ok: false };
    let ok = true;
    for (let i = 0; i < 4; i++) {
      const o = median(this.open.map((f) => f.bend[i]!));
      const c = median(this.fist.map((f) => f.bend[i]!));
      if (c - o < 60) {
        ok = false; // not a convincing open/fist contrast for this finger
        continue;
      }
      th.bendLo[i] = Math.max(15, o + (c - o) * 0.25);
      th.bendHi[i] = Math.min(250, o + (c - o) * 0.7);
    }
    const tOpen = median(this.open.map((f) => Math.min(f.thumbOut, f.thumbAcross * 0.75)));
    const tFist = median(this.fist.map((f) => Math.min(f.thumbOut, f.thumbAcross * 0.75)));
    if (tOpen - tFist > 0.15) {
      th.thumbLo = tFist + (tOpen - tFist) * 0.3;
      th.thumbHi = tFist + (tOpen - tFist) * 0.75;
    }
    const fan = median(this.open.map((f) => f.fan));
    if (fan > GESTURE.fanHi * 0.8) {
      th.fanHi = Math.min(GESTURE.fanHi, fan * 0.8);
      th.fanLo = th.fanHi * 0.7;
    }
    return { thresholds: th, ok };
  }
}
