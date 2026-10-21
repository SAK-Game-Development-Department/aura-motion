// InputSource: every way of producing body data (real camera, recorded replay,
// synthetic motion, mouse emergency mode) implements this one interface. The
// game only ever sees PoseFrames (and optional silhouette FieldFrames).
import { Emitter } from '../core/emitter';
import type { FieldFrame, PoseFrame } from '../core/types';

export type SourceKind = 'camera' | 'replay' | 'synth' | 'mouse';

export interface SourceStatus {
  ready: boolean;
  /** Human readable state for the debug overlay. */
  detail: string;
  error?: string;
  /** Tracking backend info (camera only). */
  backend?: string;
}

export interface InputSource {
  readonly kind: SourceKind;
  readonly frames: Emitter<PoseFrame>;
  /** Silhouette fields; sources without segmentation never emit (the app builds capsule fields). */
  readonly fields: Emitter<FieldFrame>;
  start(): Promise<void>;
  stop(): void;
  /** Called once per animation frame with the app clock. Pull-based sources emit from here. */
  tick(now: number): void;
  status(): SourceStatus;
}

/** Base for sources that generate frames at a fixed rate from tick(). */
export abstract class PulledSource implements InputSource {
  abstract readonly kind: SourceKind;
  readonly frames = new Emitter<PoseFrame>();
  readonly fields = new Emitter<FieldFrame>();
  protected nextT = -1;
  protected running = false;

  constructor(protected readonly fps = 30) {}

  async start(): Promise<void> {
    this.running = true;
    this.nextT = -1;
  }

  stop(): void {
    this.running = false;
  }

  tick(now: number): void {
    if (!this.running) return;
    if (this.nextT < 0) this.nextT = now;
    const step = 1000 / this.fps;
    // Emit at most a few frames per tick (if the tab stalled, skip ahead).
    if (now - this.nextT > step * 5) this.nextT = now - step;
    while (this.nextT <= now) {
      const f = this.produce(this.nextT);
      if (f) this.frames.emit(f);
      this.nextT += step;
    }
  }

  protected abstract produce(t: number): PoseFrame | null;

  status(): SourceStatus {
    return { ready: this.running, detail: `${this.kind} @${this.fps}fps` };
  }
}
