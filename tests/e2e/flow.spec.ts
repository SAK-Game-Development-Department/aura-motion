// End-to-end exhibition loop with the autoplay bot (synthetic hands):
// title → calibrate (open, fist, beat) → practice (casts) → title.
import { expect, test } from '@playwright/test';
import { FAST, state, testHook, waitFor } from './helpers';

test('full loop: hand shown → stage selection → calibration → battle (all sections, boss ultimate) → results → title', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Fixed seed: the autoplay bot skips ~6 % of moves on purpose; this seed keeps the boss chain intact (the loop is what is tested).
  await page.goto(`/${FAST}&seed=11`);
  const seen: string[] = [];
  const s0 = await waitFor(page, (s) => s.phase === 'title', 60_000, seen);
  expect(['webgpu', 'webgl2']).toContain(s0.backend);
  await waitFor(page, (s) => s.phase === 'select', 30_000, seen);
  await waitFor(page, (s) => s.phase === 'calibrate', 30_000, seen);
  await waitFor(page, (s) => s.phase === 'play', 40_000, seen);
  const st = await state(page);
  expect(st.thresholdsCalibrated).toBe(true);
  expect(st.calibrated).toBe(true);
  expect(st.stage).toBe('hoshi'); // the bot picks 中級, then its first stage
  const sections = new Set<string>();
  let last = st;
  await waitFor(
    page,
    (s) => {
      if (s.section) sections.add(s.section);
      last = s;
      return s.phase === 'results';
    },
    90_000,
    seen,
  );
  expect([...sections]).toEqual(['intro', 'rush', 'guard', 'boss']);
  expect(last.kills).toBeGreaterThanOrEqual(3);
  expect(last.ultimates, JSON.stringify(last)).toBe(1);
  await page.screenshot({ path: 'test-results/results.png' });
  await waitFor(page, (s) => s.phase === 'title', 30_000, seen);
  expect(seen.filter((x) => x !== 'loading').slice(0, 6)).toEqual(['title', 'select', 'calibrate', 'play', 'results', 'title']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aura.highscores.v1') ?? '[]'));
  expect(stored[0].score).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('practice mode (?practice=1) still offers free play', async ({ page }) => {
  await page.goto(`/${FAST}&practice=1`);
  await waitFor(page, (s) => s.phase === 'practice', 60_000);
  await waitFor(page, (s) => s.casts >= 2, 30_000);
});

test('empty booth shows the ghost-hand attract demo', async ({ page }) => {
  await page.goto(`/?source=empty&fast=1&flags=-particles`);
  const s = await waitFor(page, (x) => x.demo, 30_000);
  expect(s.phase).toBe('title');
  await page.screenshot({ path: 'test-results/attract.png' });
});

test('hand leaving during the battle returns to the title', async ({ page }) => {
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'play', 60_000);
  await testHook(page, 'leave');
  await waitFor(page, (s) => s.phase === 'title', 20_000);
});

test('debug overlay (D) shows landmarks, features, confidences and the state machine', async ({ page }) => {
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.present, 60_000);
  await page.keyboard.press('d');
  const ov = page.locator('pre', { hasText: 'AURA debug' });
  await expect(ov).toBeVisible();
  await expect(ov).toContainText('capture→tracked');
  await expect(page.locator('pre', { hasText: 'state machine' })).toBeVisible();
  await page.screenshot({ path: 'test-results/debug-overlay.png' });
  await page.keyboard.press('d');
  await expect(ov).toBeHidden();
});

test('WebGL2 fallback runs the same app', async ({ page }) => {
  await page.goto(`/${FAST}&webgl=1`);
  const s = await waitFor(page, (x) => x.phase === 'play', 90_000);
  expect(s.backend).toBe('webgl2');
  expect((await state(page)).errors).toBe(0);
});

test('the exhibition build contains no recording tools', async () => {
  // Scan every built file: the gesture lab (and its landmark recorder) must not ship.
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  })('dist');
  expect(files.some((f) => f.includes('gesture-lab'))).toBe(false);
  for (const f of files.filter((x) => /\.(js|html)$/.test(x) && !x.includes('mediapipe'))) {
    const s = readFileSync(f, 'utf8');
    expect(s, f).not.toContain('aura-gesture-samples');
    expect(s, f).not.toContain('Gesture Lab');
  }
});
