// TrackerHost: runs TrackerCore in a module Worker (preferred) or inline on the
// main thread. createTrackerHost() tries, in order: worker+GPU, worker+CPU,
// inline+GPU, inline+CPU, each with a timeout.
import { Emitter } from '../../core/emitter';
import type { TrackerFrame, TrackerInit, TrackerOut, TrackerResult } from './protocol';

export interface TrackerHost {
  readonly mode: 'worker' | 'inline';
  readonly delegate: 'GPU' | 'CPU';
  readonly results: Emitter<TrackerResult>;
  readonly errors: Emitter<string>;
  /** True while a frame is being processed (the camera drops frames meanwhile). */
  readonly busy: boolean;
  submit(f: TrackerFrame): void;
  reset(): void;
  dispose(): void;
}

type Progress = (stage: string, loaded: number, total: number) => void;

class WorkerHost implements TrackerHost {
  readonly mode = 'worker' as const;
  readonly results = new Emitter<TrackerResult>();
  readonly errors = new Emitter<string>();
  busy = false;
  delegate: 'GPU' | 'CPU' = 'GPU';
  private w: Worker;

  constructor() {
    this.w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'aura-tracking' });
  }

  init(cfg: TrackerInit, onProgress: Progress): Promise<void> {
    this.delegate = cfg.delegate;
    return new Promise((resolve, reject) => {
      this.w.onmessage = (e: MessageEvent<TrackerOut>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.stage, m.loaded, m.total);
        else if (m.type === 'ready') resolve();
        else if (m.type === 'error') {
          if (m.fatal) reject(new Error(m.message));
          else {
            this.busy = false;
            this.errors.emit(m.message);
          }
        } else if (m.type === 'result') {
          this.busy = false;
          this.results.emit(m);
        }
      };
      this.w.onerror = (e) => reject(new Error(e.message || 'worker error'));
      this.w.postMessage(cfg);
    });
  }

  submit(f: TrackerFrame): void {
    this.busy = true;
    this.w.postMessage(f, [f.bitmap]);
  }

  reset(): void {
    this.w.postMessage({ type: 'reset' });
  }

  dispose(): void {
    this.w.terminate();
    this.results.clear();
    this.errors.clear();
  }
}

class InlineHost implements TrackerHost {
  readonly mode = 'inline' as const;
  readonly results = new Emitter<TrackerResult>();
  readonly errors = new Emitter<string>();
  busy = false;
  delegate: 'GPU' | 'CPU' = 'GPU';
  private core: import('./core').TrackerCore | null = null;

  async init(cfg: TrackerInit, onProgress: Progress): Promise<void> {
    this.delegate = cfg.delegate;
    const { TrackerCore } = await import('./core');
    this.core = new TrackerCore((m) => {
      if (m.type === 'progress') onProgress(m.stage, m.loaded, m.total);
      else if (m.type === 'result') {
        this.busy = false;
        this.results.emit(m);
      } else if (m.type === 'error') {
        this.busy = false;
        this.errors.emit(m.message);
      }
    });
    await this.core.init(cfg);
  }

  submit(f: TrackerFrame): void {
    this.busy = true;
    // Yield so the render frame is not blocked by the same task.
    setTimeout(() => this.core?.process(f), 0);
  }

  reset(): void {
    this.core?.reset();
  }

  dispose(): void {
    this.core?.dispose();
    this.results.clear();
    this.errors.clear();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((res, rej) => {
    const id = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        res(v);
      },
      (e) => {
        clearTimeout(id);
        rej(e);
      },
    );
  });
}

export interface HostAttempt {
  mode: 'worker' | 'inline';
  delegate: 'GPU' | 'CPU';
  ok: boolean;
  error?: string;
  ms: number;
}

export async function createTrackerHost(
  cfg: Omit<TrackerInit, 'delegate' | 'type'>,
  opts: { preferWorker: boolean; timeoutMs: number; onProgress: Progress },
): Promise<{ host: TrackerHost; attempts: HostAttempt[] }> {
  const order: Array<['worker' | 'inline', 'GPU' | 'CPU']> = opts.preferWorker
    ? [['worker', 'GPU'], ['worker', 'CPU'], ['inline', 'GPU'], ['inline', 'CPU']]
    : [['inline', 'GPU'], ['inline', 'CPU']];
  const attempts: HostAttempt[] = [];
  for (const [mode, delegate] of order) {
    const t0 = performance.now();
    const host = mode === 'worker' ? new WorkerHost() : new InlineHost();
    try {
      await withTimeout(host.init({ ...cfg, type: 'init', delegate }, opts.onProgress), opts.timeoutMs, `${mode}/${delegate}`);
      attempts.push({ mode, delegate, ok: true, ms: performance.now() - t0 });
      return { host, attempts };
    } catch (e) {
      host.dispose();
      attempts.push({ mode, delegate, ok: false, error: String((e as Error).message ?? e), ms: performance.now() - t0 });
    }
  }
  throw new Error(`tracking init failed: ${attempts.map((a) => `${a.mode}/${a.delegate}: ${a.error}`).join(' | ')}`);
}
