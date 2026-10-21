/// <reference lib="webworker" />
// Tracking worker entry. See docs/decisions.md §tracking-thread.
import { TrackerCore } from './core';
import type { TrackerFrame, TrackerIn, TrackerOut } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const core = new TrackerCore((m: TrackerOut, transfer?: Transferable[]) => scope.postMessage(m, transfer ?? []));

// Latest-frame-wins: if frames arrive faster than inference, stale ones are
// closed unprocessed so latency never accumulates in the message queue.
let pending: TrackerFrame | null = null;
let scheduled = false;
function pump(): void {
  scheduled = false;
  const f = pending;
  pending = null;
  if (f) core.process(f);
}

scope.onmessage = async (e: MessageEvent<TrackerIn>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init':
        await core.init(m);
        break;
      case 'frame':
        if (pending) pending.bitmap.close();
        pending = m;
        if (!scheduled) {
          scheduled = true;
          setTimeout(pump, 0);
        }
        break;
      case 'reset':
        core.reset();
        break;
      case 'dispose':
        core.dispose();
        scope.close();
        break;
    }
  } catch (err) {
    scope.postMessage({ type: 'error', message: String((err as Error)?.message ?? err), fatal: m.type === 'init' } satisfies TrackerOut);
  }
};
