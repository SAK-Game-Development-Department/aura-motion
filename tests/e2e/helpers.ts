import type { Page } from '@playwright/test';

export interface AuraState {
  t: number;
  gameT: number | null;
  phase: string;
  backend: string;
  source: string;
  present: boolean;
  score: number | null;
  counts: { perfect: number; good: number; miss: number } | null;
  section: string | null;
  particles: number;
  fps: number;
  demo: boolean;
  highscores: number;
  heap: number | null;
  dom: number;
  errors: number;
  rendererInfo: Record<string, number> | null;
}

export async function state(page: Page): Promise<AuraState> {
  return page.evaluate(() => (window as unknown as { __aura: { inspect(): unknown } }).__aura.inspect()) as Promise<AuraState>;
}

/** Poll until predicate is true; returns the matching state. Records the phases seen. */
export async function waitFor(page: Page, pred: (s: AuraState) => boolean, timeoutMs = 90_000, seen?: string[]): Promise<AuraState> {
  const t0 = Date.now();
  for (;;) {
    const s = await state(page).catch(() => null);
    if (s) {
      if (seen && seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      if (pred(s)) return s;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor timed out; last state ${JSON.stringify(s)}`);
    await page.waitForTimeout(250);
  }
}

export const FAST = '?source=autoplay&fast=1&flags=-particles';
