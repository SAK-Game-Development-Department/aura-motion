// Photosensitivity safety limiter. Every full-screen flash and every shake
// goes through here. Guarantees (unit-tested):
//  - at most SAFETY.maxFlashesPerSecond flash onsets in any 1 s window
//  - amplitude ≤ maxFlashAmplitude × intensity setting
//  - smooth decay (no hard on/off edges)
import { SAFETY } from '../../config';

export class FlashLimiter {
  private onsets: number[] = [];
  private level = 0;
  private peak = 0;
  private peakAt = -Infinity;

  constructor(public intensity: number = SAFETY.defaultFlashIntensity) {}

  /** Request a flash of strength 0..1. Returns whether it was accepted. */
  request(now: number, strength: number): boolean {
    this.onsets = this.onsets.filter((t) => now - t < 1000);
    if (this.onsets.length >= SAFETY.maxFlashesPerSecond) return false;
    const minGap = 1000 / SAFETY.maxFlashesPerSecond;
    const last = this.onsets[this.onsets.length - 1];
    if (last !== undefined && now - last < minGap) return false;
    const amp = Math.min(1, Math.max(0, strength)) * SAFETY.maxFlashAmplitude * this.intensity;
    if (amp <= 0.001) return false;
    this.onsets.push(now);
    this.peak = Math.max(amp, this.value(now));
    this.peakAt = now;
    return true;
  }

  /** Current flash level (0..maxAmplitude): 40 ms attack, exponential decay. */
  value(now: number): number {
    const dt = now - this.peakAt;
    if (dt < 0) return 0;
    const attack = 40;
    if (dt < attack) this.level = this.peak * (dt / attack);
    else this.level = this.peak * Math.exp(-(dt - attack) / SAFETY.minFlashDecayMs);
    return this.level;
  }
}

export class Shake {
  private energy = 0;
  private lastT = 0;
  constructor(public intensity: number = SAFETY.defaultShakeIntensity) {}

  kick(amount: number): void {
    this.energy = Math.min(1, this.energy + amount * this.intensity);
  }

  /** Offset in world units (small, smooth, decaying). */
  offset(now: number): { x: number; y: number } {
    const dt = Math.min(100, now - this.lastT);
    this.lastT = now;
    this.energy *= Math.exp(-dt / 120);
    const a = this.energy * 0.012;
    return { x: Math.sin(now * 0.061) * a, y: Math.cos(now * 0.047) * a };
  }
}
