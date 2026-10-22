// Pose recordings: JSON serialisation + playback source.
import type { Landmark, PoseFrame } from '../core/types';
import { PulledSource } from './source';

export interface Recording {
  format: 'aura-pose';
  version: 1;
  aspect: number;
  /** Frames with t relative to recording start (ms). */
  frames: Array<{ t: number; p: number[][]; l?: number; h?: Array<{ s: number; p: number[] }> }>;
  meta?: Record<string, unknown>;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function encodeFrame(f: PoseFrame, t0: number): Recording['frames'][number] {
  const out: Recording['frames'][number] = {
    t: Math.round((f.t - t0) * 10) / 10,
    p: f.poses.map((pose) => pose.flatMap((l) => [r4(l.x), r4(l.y), r4(l.z), r4(l.v)])),
  };
  if (f.luma !== undefined) out.l = r4(f.luma);
  if (f.hands?.length) out.h = f.hands.map((h) => ({ s: r4(h.score), p: h.lm.flatMap((l) => [r4(l.x), r4(l.y), r4(l.z), r4(l.v)]) }));
  return out;
}

export function decodeFrame(fr: Recording['frames'][number], aspect: number, tOffset = 0): PoseFrame {
  const poses: Landmark[][] = fr.p.map((flat) => {
    const lm: Landmark[] = [];
    for (let i = 0; i + 3 < flat.length; i += 4) lm.push({ x: flat[i]!, y: flat[i + 1]!, z: flat[i + 2]!, v: flat[i + 3]! });
    return lm;
  });
  const f: PoseFrame = { t: fr.t + tOffset, poses, aspect };
  if (fr.l !== undefined) f.luma = fr.l;
  if (fr.h) f.hands = fr.h.map((h) => ({ score: h.s, lm: unflat(h.p) }));
  return f;
}

function unflat(flat: number[]): Landmark[] {
  const lm: Landmark[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) lm.push({ x: flat[i]!, y: flat[i + 1]!, z: flat[i + 2]!, v: flat[i + 3]! });
  return lm;
}

export function parseRecording(json: string | unknown): Recording {
  const r = (typeof json === 'string' ? JSON.parse(json) : json) as Recording;
  if (r?.format !== 'aura-pose' || r.version !== 1 || !Array.isArray(r.frames)) throw new Error('not an aura-pose v1 recording');
  return r;
}

/** Records frames from any source (landmarks only — never images). */
export class Recorder {
  private frames: Recording['frames'] = [];
  private t0: number | null = null;
  private aspect = 16 / 9;
  constructor(private maxFrames = 30 * 60 * 5) {}
  push(f: PoseFrame): void {
    if (this.t0 === null) this.t0 = f.t;
    this.aspect = f.aspect;
    if (this.frames.length < this.maxFrames) this.frames.push(encodeFrame(f, this.t0));
  }
  get length(): number {
    return this.frames.length;
  }
  finish(meta?: Record<string, unknown>): Recording {
    const r: Recording = { format: 'aura-pose', version: 1, aspect: this.aspect, frames: this.frames };
    if (meta) r.meta = meta;
    return r;
  }
}

/** Plays a recording in real time (optionally looping), re-stamped to the app clock. */
export class ReplaySource extends PulledSource {
  readonly kind = 'replay' as const;
  private start0 = -1;
  private i = 0;
  private loops = 0;
  constructor(
    private rec: Recording,
    private loop = true,
  ) {
    super(60);
  }

  override tick(now: number): void {
    if (!this.running) return;
    if (this.start0 < 0) this.start0 = now;
    const frames = this.rec.frames;
    const dur = (frames[frames.length - 1]?.t ?? 0) + 33;
    for (;;) {
      if (this.i >= frames.length) {
        if (!this.loop) return;
        this.i = 0;
        this.loops++;
      }
      const fr = frames[this.i]!;
      const ts = this.start0 + this.loops * dur + fr.t;
      if (ts > now) return;
      this.frames.emit(decodeFrame(fr, this.rec.aspect, this.start0 + this.loops * dur));
      this.i++;
    }
  }

  protected produce(): PoseFrame | null {
    return null;
  }

  override status() {
    return { ready: this.running, detail: `replay ${this.i}/${this.rec.frames.length} loop ${this.loops}` };
  }
}
