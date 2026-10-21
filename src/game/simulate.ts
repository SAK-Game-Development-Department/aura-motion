// Headless deterministic simulation: drives a GameSession from a frame stream
// at a fixed rate. Used by tests, the stage fuzzer and the determinism check.
import type { PoseFrame } from '../core/types';
import { BodyTracker } from '../input/body';
import type { SynthScript } from '../input/synth';
import { buildLandmarks } from '../input/skeleton';
import type { Stage } from '../stage/types';
import { GameSession, type GameEvent } from './session';

export interface SimResult {
  session: GameSession;
  events: GameEvent[];
}

export function framesFromScript(script: SynthScript, durationMs: number, fps = 30): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    const b = script(t);
    out.push({ t, poses: b ? [buildLandmarks(b)] : [], aspect: 16 / 9, luma: 0.4 });
  }
  return out;
}

export function simulate(
  stage: Stage,
  frames: Iterable<PoseFrame>,
  opts: { offsetMs?: number; dda?: boolean; renderHz?: number } = {},
): SimResult {
  const tracker = new BodyTracker();
  const session = new GameSession({ stage, dda: opts.dda ?? false });
  const events: GameEvent[] = [];
  const offset = opts.offsetMs ?? 0;
  const renderStep = 1000 / (opts.renderHz ?? 60);
  let renderT = 0;
  for (const f of frames) {
    // Render ticks up to this frame's arrival.
    while (renderT < f.t) {
      events.push(...session.update(renderT));
      renderT += renderStep;
    }
    const snap = tracker.update(f);
    session.pushInput(f.t - offset, snap);
  }
  const end = stage.durationMs + 1500;
  while (renderT <= end) {
    events.push(...session.update(renderT));
    renderT += renderStep;
  }
  return { session, events };
}
