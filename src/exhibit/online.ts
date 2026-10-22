// Shared (nationwide / multi-device) ranking client. Talks only to this site's
// own Pages Functions (/api/*, same origin — CSP connect-src 'self').
// Sends nothing but the score payload in scorePolicy.ts. Never blocks the game:
// every call has a short timeout and failure just means "offline" (the local
// ranking keeps working).
import type { Diff, OnlineEntry, ScoreSubmission } from './scorePolicy';

export interface OnlineBoard {
  list: OnlineEntry[];
  total: number;
  /** When it was fetched (ms, performance clock). */
  at: number;
}

export interface Placement {
  placeAll: number;
  placeToday: number;
  total: number;
  region: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const DEVICE_KEY = 'aura.device.v1';
const TIMEOUT_MS = 4000;

export class OnlineRanking {
  /** Last result of a request: null = unknown yet. */
  online: boolean | null = null;
  private boards = new Map<string, OnlineBoard>();
  private inflight = new Set<string>();

  constructor(
    public enabled: boolean,
    private fetchFn: FetchFn = (i, init) => fetch(i, init),
    private now: () => number = () => performance.now(),
  ) {}

  /** Random booth id, kept in this browser (one per device, not per person). */
  static deviceId(): string {
    try {
      const v = localStorage.getItem(DEVICE_KEY);
      if (v && /^[a-z0-9]{6,16}$/.test(v)) return v;
      const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch {
      return 'booth00';
    }
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T | null> {
    if (!this.enabled) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchFn(path, { ...init, signal: ac.signal });
      if (!res.ok) {
        // 4xx = rejected request (still online); 5xx/404 = no ranking service here.
        this.online = res.status >= 400 && res.status < 500 && res.status !== 404;
        return null;
      }
      this.online = true;
      return (await res.json()) as T;
    } catch {
      this.online = false;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ask for a play token when a play starts (null when offline). */
  async startRun(stage: string): Promise<string | null> {
    const r = await this.call<{ token: string }>(`/api/run?stage=${encodeURIComponent(stage)}`, { cache: 'no-store' });
    return r?.token ?? null;
  }

  async submit(s: ScoreSubmission): Promise<Placement | null> {
    return this.call<Placement>('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
  }

  /** Cached board (may be stale or missing). */
  board(diff: Diff, period: 'today' | 'all'): OnlineBoard | null {
    return this.boards.get(`${diff}/${period}`) ?? null;
  }

  /** Refresh a board if older than maxAgeMs (fire-and-forget). */
  refresh(diff: Diff, period: 'today' | 'all', maxAgeMs = 60_000): Promise<OnlineBoard | null> {
    const key = `${diff}/${period}`;
    const b = this.boards.get(key);
    if (!this.enabled || (b && this.now() - b.at < maxAgeMs) || this.inflight.has(key)) return Promise.resolve(b ?? null);
    this.inflight.add(key);
    return this.call<{ list: OnlineEntry[]; total: number }>(`/api/scores?diff=${diff}&period=${period}&limit=10`).then((r) => {
      this.inflight.delete(key);
      if (!r) return b ?? null;
      const nb = { list: r.list, total: r.total, at: this.now() };
      this.boards.set(key, nb);
      return nb;
    });
  }
}
