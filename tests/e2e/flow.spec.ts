// End-to-end exhibition loop with the autoplay bot (synthetic visitor):
// title → calibrate → play (all sections) → results → title.
import { expect, test } from '@playwright/test';
import { FAST, state, waitFor } from './helpers';

test('full loop: a visitor plays through and the booth resets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/${FAST}`);
  const seen: string[] = [];
  const s0 = await waitFor(page, (s) => s.phase === 'title', 60_000, seen);
  expect(['webgpu', 'webgl2']).toContain(s0.backend);
  await waitFor(page, (s) => s.phase === 'calibrate', 30_000, seen);
  const play = await waitFor(page, (s) => s.phase === 'play', 30_000, seen);
  expect(play.section).toBe('intro');
  const sections = new Set<string>();
  const res = await waitFor(
    page,
    (s) => {
      if (s.section) sections.add(s.section);
      return s.phase === 'results';
    },
    90_000,
    seen,
  );
  expect([...sections]).toEqual(['intro', 'flow', 'wall', 'dodge', 'finale']);
  expect(res.highscores).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/flow-results.png' });
  // The bot leaves after the results; the booth returns to the title by itself.
  await waitFor(page, (s) => s.phase === 'title', 30_000, seen);
  expect(seen.filter((p) => p !== 'loading').slice(0, 5)).toEqual(['title', 'calibrate', 'play', 'results', 'title']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aura.highscores.v1') ?? '[]'));
  expect(stored[0].score).toBeGreaterThanOrEqual(0);
  expect(typeof stored[0].name).toBe('string');
  expect(Object.keys(stored[0]).sort()).toEqual(['at', 'name', 'rank', 'score', 'seated']);
  expect(errors).toEqual([]);
});

test('visitor leaving mid-play returns to the title (absent timeout)', async ({ page }) => {
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'play', 60_000);
  await page.evaluate(() => (window as unknown as { __aura: { test(c: string): void } }).__aura.test('leave'));
  const t0 = Date.now();
  await waitFor(page, (s) => s.phase === 'title', 20_000);
  // fast mode: absentReturnMs = 3 s
  expect(Date.now() - t0).toBeGreaterThan(2500);
});

test('empty booth shows the attract demo', async ({ page }) => {
  await page.goto(`/?source=synth&fast=1&flags=-particles`);
  await waitFor(page, (s) => s.phase === 'title', 60_000);
  // Synthetic idle visitor is present → no demo; make them leave.
  await page.evaluate(() => (window as unknown as { __aura: { test(c: string): void } }).__aura.test('leave'));
  const s = await waitFor(page, (x) => x.demo, 15_000);
  expect(s.phase).toBe('title');
  await page.screenshot({ path: 'test-results/attract.png' });
  await page.evaluate(() => (window as unknown as { __aura: { test(c: string): void } }).__aura.test('return'));
  await waitFor(page, (x) => !x.demo && x.present, 15_000);
});

test('debug overlay toggles with D and shows latency/frame breakdown', async ({ page }) => {
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase !== 'loading', 60_000);
  await page.keyboard.press('d');
  const ov = page.locator('pre', { hasText: 'AURA debug' });
  await expect(ov).toBeVisible();
  await expect(ov).toContainText('capture→tracked');
  await expect(ov).toContainText('frame breakdown');
  await page.screenshot({ path: 'test-results/debug-overlay.png' });
  await page.keyboard.press('d');
  await expect(ov).toBeHidden();
});

test('WebGL2 fallback runs the same game', async ({ page }) => {
  await page.goto(`/${FAST}&webgl=1`);
  const s = await waitFor(page, (x) => x.phase === 'play', 90_000);
  expect(s.backend).toBe('webgl2');
  const st = await state(page);
  expect(st.errors).toBe(0);
});
