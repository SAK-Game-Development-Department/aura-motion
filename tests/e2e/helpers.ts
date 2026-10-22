import type { Page } from '@playwright/test';

export interface AuraState {
  t: number;
  stage: string;
  phase: string;
  calibStep: string | null;
  backend: string;
  source: string;
  present: boolean;
  hands: number;
  shape: string | null;
  stance: string | null;
  casts: number;
  lastCast: string | null;
  calibrated: boolean;
  gameT: number | null;
  score: number | null;
  section: string | null;
  kills: number;
  ultimates: number;
  highscores: number;
  thresholdsCalibrated: boolean;
  particles: number;
  fps: number;
  demo: boolean;
  heap: number | null;
  dom: number;
  errors: number;
  rendererInfo: Record<string, number> | null;
}

export async function state(page: Page): Promise<AuraState> {
  return page.evaluate(() => (window as unknown as { __aura: { inspect(): unknown } }).__aura.inspect()) as Promise<AuraState>;
}

export async function waitFor(page: Page, pred: (s: AuraState) => boolean, timeoutMs = 90_000, seen?: string[]): Promise<AuraState> {
  const t0 = Date.now();
  for (;;) {
    const s = await state(page).catch(() => null);
    if (s) {
      if (seen && seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      if (pred(s)) return s;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor timed out; last state ${JSON.stringify(s)}`);
    await page.waitForTimeout(200);
  }
}

export const FAST = '?source=autoplay&fast=1&flags=-particles';

export async function testHook(page: Page, cmd: 'leave' | 'return'): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __aura: { test(c: string): void } }).__aura.test(c), cmd);
}
