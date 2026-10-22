// Automatic quality governor. When frames are slow it lowers, in order:
// particle count → lens (chromatic aberration pass) → internal resolution → effects (bloom). When there is
// headroom for a while it raises them back in reverse order (hysteresis).
import { QUALITY, RENDER } from '../config';

export interface QualityState {
  particleLevel: number;
  resolutionLevel: number;
  /** Lens pass (chromatic aberration). */
  lens: boolean;
  effects: boolean;
}

export class QualityGovernor {
  state: QualityState;
  ema: number = QUALITY.targetFrameMs;
  private overSince: number | null = null;
  private underSince: number | null = null;
  readonly maxParticleLevel: number;
  private readonly particlesOn: boolean;
  changes = 0;

  constructor(opts: { webgl: boolean; startLevel?: number; particles?: boolean }) {
    this.particlesOn = opts.particles !== false;
    this.maxParticleLevel = opts.webgl ? RENDER.webglMaxLevel : RENDER.particleLevels.length - 1;
    this.state = {
      // Without particles, lowering their level gains nothing: start at the bottom.
      particleLevel: opts.particles === false ? 0 : Math.min(opts.startLevel ?? RENDER.startLevel, this.maxParticleLevel),
      resolutionLevel: RENDER.resolutionScales.length - 1,
      lens: true,
      effects: true,
    };
  }

  get particles(): number {
    return RENDER.particleLevels[this.state.particleLevel]!;
  }

  get resolutionScale(): number {
    return RENDER.resolutionScales[this.state.resolutionLevel]!;
  }

  /** Feed a frame interval (ms). Returns true if the state changed. */
  sample(now: number, frameMs: number): boolean {
    // Ignore huge gaps (tab hidden, GC pauses) for the EMA.
    const f = Math.min(frameMs, 100);
    this.ema += (f - this.ema) * QUALITY.emaAlpha;
    if (this.ema > QUALITY.downThresholdMs) {
      this.underSince = null;
      this.overSince ??= now;
      if (now - this.overSince > QUALITY.downAfterMs) {
        this.overSince = now;
        return this.down();
      }
    } else if (this.ema < QUALITY.upThresholdMs) {
      this.overSince = null;
      this.underSince ??= now;
      if (now - this.underSince > QUALITY.upAfterMs) {
        this.underSince = now;
        return this.up();
      }
    } else {
      this.overSince = null;
      this.underSince = null;
    }
    return false;
  }

  private down(): boolean {
    const s = this.state;
    if (s.particleLevel > 0) s.particleLevel--;
    else if (s.lens) s.lens = false;
    else if (s.resolutionLevel > 0) s.resolutionLevel--;
    else if (s.effects) s.effects = false;
    else return false;
    this.changes++;
    this.ema = QUALITY.targetFrameMs; // give the change time to show
    return true;
  }

  private up(): boolean {
    const s = this.state;
    if (!s.effects) s.effects = true;
    else if (s.resolutionLevel < RENDER.resolutionScales.length - 1) s.resolutionLevel++;
    else if (!s.lens) s.lens = true;
    else if (this.particlesOn && s.particleLevel < this.maxParticleLevel) s.particleLevel++;
    else return false;
    this.changes++;
    return true;
  }
}
