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
  /** null when the kept best is from an earlier day. */
  placeToday: number | null;
  total: number;
  region: string;
  /** false: the name already had a better (or equal) score, which was kept. */
  updated: boolean;
  /** The name's best score now on the board. */
  best: number;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const DEVICE_KEY = 'aura.device.v1';
const TIMEOUT_MS = 8000;

export class OnlineRanking {
  /** Last result of a request: null = unknown yet. */
  online: boolean | null = null;
  /** Why the last request failed (for the results screen). */
  lastError: 'none' | 'disabled' | 'unreachable' | 'notfound' | 'server' | 'timeout' = 'none';
  private boards = new Map<string, OnlineBoard>();
  private inflight = new Map<string, Promise<OnlineBoard | null>>();
  /** Submissions that could not be sent (network down) — retried while their token is valid. */
  private pending: Array<{ sub: ScoreSubmission; at: number }> = [];

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
    if (!this.enabled) {
      this.lastError = 'disabled';
      return null;
    }
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, TIMEOUT_MS);
    try {
      const res = await this.fetchFn(path, { ...init, signal: ac.signal });
      if (!res.ok) {
        // 4xx = rejected request (still online); 5xx/404 = no ranking service here.
        this.online = res.status >= 400 && res.status < 500 && res.status !== 404;
        if (!this.online) this.lastError = res.status === 404 ? 'notfound' : 'server';
        return null;
      }
      this.online = true;
      this.lastError = 'none';
      return (await res.json()) as T;
    } catch {
      this.online = false;
      this.lastError = timedOut ? 'timeout' : 'unreachable';
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
    const r = await this.call<Placement>('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
    // Network trouble (not a rejection): keep it and try again later.
    if (!r && this.online === false && this.lastError !== 'notfound') this.pending.push({ sub: s, at: this.now() });
    return r;
  }

  /** Plays waiting to be sent. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Retry unsent plays (call now and then, e.g. on the title screen). Tokens expire after 20 minutes. */
  async flush(): Promise<void> {
    const keep = this.pending.filter((p) => this.now() - p.at < 19 * 60_000);
    this.pending = [];
    for (const p of keep) {
      const r = await this.call<Placement>('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.sub) });
      if (!r && this.online === false) this.pending.push(p);
    }
  }

  /** Cached board (may be stale or missing). */
  board(diff: Diff, period: 'today' | 'all'): OnlineBoard | null {
    return this.boards.get(`${diff}/${period}`) ?? null;
  }

  /** Refresh a board if older than maxAgeMs (fire-and-forget). */
  refresh(diff: Diff, period: 'today' | 'all', maxAgeMs = 60_000): Promise<OnlineBoard | null> {
    const key = `${diff}/${period}`;
    const b = this.boards.get(key);
    if (!this.enabled || (b && this.now() - b.at < maxAgeMs)) return Promise.resolve(b ?? null);
    // A request already on its way: wait for it instead of answering "nothing".
    const running = this.inflight.get(key);
    if (running) return running;
    const pr = this.call<{ list: OnlineEntry[]; total: number }>(`/api/scores?diff=${diff}&period=${period}&limit=10`).then((r) => {
      this.inflight.delete(key);
      if (!r) return b ?? null;
      const nb = { list: r.list, total: r.total, at: this.now() };
      this.boards.set(key, nb);
      return nb;
    });
    this.inflight.set(key, pr);
    return pr;
  }
}
