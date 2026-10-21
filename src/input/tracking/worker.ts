/// <reference lib="webworker" />
// Tracking worker entry. See docs/decisions.md §tracking-thread.
import { TrackerCore } from './core';
import type { TrackerIn, TrackerOut } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const core = new TrackerCore((m: TrackerOut, transfer?: Transferable[]) => scope.postMessage(m, transfer ?? []));

scope.onmessage = async (e: MessageEvent<TrackerIn>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init':
        await core.init(m);
        break;
      case 'frame':
        core.process(m);
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
