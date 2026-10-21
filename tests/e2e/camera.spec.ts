// Camera path with Chromium's fake device (no person in the image): the
// permission flow, model loading and tracker initialisation must succeed.
import { expect, test } from '@playwright/test';
import { state, waitFor } from './helpers';

test('camera boot: loading progress → title, tracking backend selected', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto('/?flags=-particles&debug=1');
  await expect(page.locator('.loading.on')).toBeVisible();
  const s = await waitFor(page, (x) => x.phase !== 'loading', 150_000);
  expect(s.phase).toBe('title');
  expect(s.source).toBe('camera');
  const dbg = await page.locator('pre', { hasText: 'AURA debug' }).textContent();
  const m = /tracking (\S+)/.exec(dbg ?? '');
  console.log('tracking backend:', m?.[1], '| attempts:', /attempts: (.*)/.exec(dbg ?? '')?.[1]);
  expect(m?.[1]).toMatch(/^(worker|inline)\/(GPU|CPU)$/);
  await page.screenshot({ path: 'test-results/camera-title.png' });
  // Nobody in the fake video → attract demo after a while.
  await page.waitForTimeout(5000);
  expect((await state(page)).present).toBe(false);
});

test('camera denied → error screen → mouse emergency mode', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.goto('/?flags=-particles');
  await waitFor(page, (s) => s.phase === 'error', 60_000);
  await expect(page.locator('.err h2')).toContainText('カメラ');
  await page.screenshot({ path: 'test-results/camera-error.png' });
  const s = await waitFor(page, (x) => x.source === 'mouse' && x.phase === 'title', 20_000);
  expect(s.present).toBe(true);
  await ctx.close();
});
