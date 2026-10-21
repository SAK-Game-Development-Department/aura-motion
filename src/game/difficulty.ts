// Dynamic difficulty: level in [min,max] driven by the recent miss rate.
import { DIFFICULTY } from '../config';
import { clamp } from '../core/math';
import type { Grade } from './score';

export class Difficulty {
  level: number = DIFFICULTY.start;
  private recent: Grade[] = [];

  constructor(private enabled: boolean) {}

  record(g: Grade): void {
    this.recent.push(g);
    if (this.recent.length > DIFFICULTY.window) this.recent.shift();
    if (!this.enabled || this.recent.length < 4) return;
    const missRate = this.recent.filter((x) => x === 'miss').length / this.recent.length;
    // Misses above target → easier; below → harder.
    this.level = clamp(this.level + (DIFFICULTY.targetMissRate - missRate) * DIFFICULTY.rate * 2, DIFFICULTY.min, DIFFICULTY.max);
  }

  get missRate(): number {
    if (this.recent.length === 0) return 0;
    return this.recent.filter((x) => x === 'miss').length / this.recent.length;
  }

  /** Ring shrink duration multiplier (harder = faster). */
  get approachScale(): number {
    return 1 / Math.sqrt(this.level);
  }

  /** Timing window multiplier (harder = tighter). */
  get windowScale(): number {
    return 1 + (1 - this.level) * 0.6;
  }

  /** Which density tiers are active. */
  tierActive(tier: 0 | 1 | 2): boolean {
    if (tier === 0) return true;
    if (tier === 1) return this.level >= 0.95;
    return this.level >= 1.15;
  }

  /** Pose threshold offset (harder = stricter). */
  get poseThresholdOffset(): number {
    return (this.level - 1) * 0.12;
  }
}
