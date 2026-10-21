// Runtime options from the URL (dev/staff) + derived tunables. `?fast=1`
// compresses all durations for E2E/soak tests without touching game logic.
import { EXHIBIT, LATENCY, STAGE } from './index';
import { DEFAULT_FLAGS, parseFlags, type Flags } from './flags';

export type SourceChoice = 'camera' | 'synth' | 'autoplay' | 'mouse' | 'replay';

export interface Runtime {
  source: SourceChoice;
  replayUrl: string | null;
  flags: Flags;
  seed: number | null;
  debug: boolean;
  calm: boolean;
  forceWebGL: boolean;
  quality: number | null;
  /** Fixed particle count override (tests / screenshots). */
  particles: number | null;
  /** Virtual time: every rendered frame advances exactly 1/60 s (screenshots on slow GPUs). */
  virtualTime: boolean;
  /** Benchmark: step through particle levels and record frame times (docs/perf.md). */
  bench: boolean;
  fast: boolean;
  dev: boolean;
  stageMs: number;
  absentReturnMs: number;
  resultsMs: number;
  attractDelayMs: number;
  preferStandingMs: number;
  calibPulses: number;
  calibIntervalMs: number;
}

export function readRuntime(search: string): Runtime {
  const q = new URLSearchParams(search);
  const fast = q.get('fast') === '1';
  const src = (q.get('source') ?? 'camera') as SourceChoice;
  const seed = q.get('seed');
  const quality = q.get('quality');
  return {
    source: ['camera', 'synth', 'autoplay', 'mouse', 'replay'].includes(src) ? src : 'camera',
    replayUrl: q.get('replay'),
    flags: parseFlags(q.get('flags'), DEFAULT_FLAGS),
    seed: seed !== null && seed !== '' ? Number(seed) >>> 0 : null,
    debug: q.get('debug') === '1',
    calm: q.get('calm') === '1',
    forceWebGL: q.get('webgl') === '1',
    quality: quality !== null ? Math.max(0, Math.min(5, Number(quality))) : null,
    particles: q.get('particles') !== null ? Math.max(0, Number(q.get('particles'))) : null,
    virtualTime: q.get('vt') === '1',
    bench: q.get('bench') === '1',
    fast,
    dev: q.get('dev') === '1' || fast,
    stageMs: fast ? 24_000 : STAGE.durationMs,
    absentReturnMs: fast ? 3000 : EXHIBIT.absentReturnMs,
    resultsMs: fast ? 4000 : EXHIBIT.resultsMs,
    attractDelayMs: fast ? 1500 : 3000,
    preferStandingMs: fast ? 1000 : EXHIBIT.preferStandingMs,
    calibPulses: fast ? 3 : LATENCY.calibPulses,
    calibIntervalMs: LATENCY.calibIntervalMs,
  };
}
