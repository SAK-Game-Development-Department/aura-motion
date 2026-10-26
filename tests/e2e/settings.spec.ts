// Staff settings panel: S opens it, changes apply at once and persist.
import { expect, test } from '@playwright/test';
import { FAST, state, waitFor } from './helpers';

test('S opens the settings; brightness applies immediately and is remembered', async ({ page }) => {
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'title' || s.phase === 'select', 60_000);
  await expect(page.locator('.settings')).toBeHidden();
  await page.keyboard.press('s');
  await expect(page.locator('.settings')).toBeVisible();
  const slider = page.locator('.settings input[data-k="brightness"]');
  await slider.fill('0.5');
  await expect(page.locator('.settings output[data-k="brightness"]')).toHaveText('50%');
  expect(((await state(page)) as unknown as { exposure: number }).exposure).toBeCloseTo(0.5);
  await page.locator('.settings select[data-k="particles"]').selectOption('low');
  await page.locator('.settings .btns button[data-act="close"]').click();
  await expect(page.locator('.settings')).toBeHidden();
  await page.reload();
  await waitFor(page, (s) => s.phase === 'title' || s.phase === 'select', 60_000);
  const st = (await state(page)) as unknown as { settings: { brightness: number; particles: string }; exposure: number };
  expect(st.settings.brightness).toBeCloseTo(0.5);
  expect(st.settings.particles).toBe('low');
  expect(st.exposure).toBeCloseTo(0.5);
});

test('the settings button opens the panel and × closes it (no keyboard needed)', async ({ page }) => {
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'title' || s.phase === 'select', 60_000);
  await page.locator('.settings-btn').click();
  await expect(page.locator('.settings')).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-open.png' });
  await page.locator('.settings h2 .x').click();
  await expect(page.locator('.settings')).toBeHidden();
  await expect(page.locator('.settings-btn')).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-closed.png' });
});
