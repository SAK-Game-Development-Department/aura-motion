// Shared ranking (mocked API): a play sends exactly the allowed fields to the
// same-origin /api, and the results screen shows the nationwide placement.
import { expect, test } from '@playwright/test';

// Full plays: give each test room under parallel load.
test.describe.configure({ timeout: 240_000 });
import { waitFor } from './helpers';
import { SUBMISSION_KEYS } from '../../src/exhibit/scorePolicy';

test('results submit only the score payload and show the nationwide ranking', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const posts: Array<Record<string, unknown>> = [];
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await page.route('**/api/run**', (r) => r.fulfill({ json: { token: 'n.1.hoshi.sig' } }));
  await page.route('**/api/scores**', async (r) => {
    if (r.request().method() === 'POST') {
      posts.push(JSON.parse(r.request().postData() ?? '{}'));
      return r.fulfill({ json: { placeAll: 3, placeToday: 1, total: 42, region: '東京' } });
    }
    return r.fulfill({ json: { list: [{ name: '光るクラゲ', score: 99999, rank: 'S', stage: 'hoshi', stageName: 'スターロード', region: '大阪', at: 0 }], total: 42 } });
  });
  await page.goto('/?source=autoplay&fast=1&flags=-particles&onlinetest=1');
  await waitFor(page, (s) => s.phase === 'results', 150_000);
  // The player types a name (physical keyboard path) and confirms with Enter.
  await expect(page.locator('.name-entry')).toBeVisible();
  await page.locator('.ne-input').fill('タツヤ');
  await page.locator('.ne-input').press('Enter');
  await expect(page.locator('.ranking .online')).toContainText('本日 1 位', { timeout: 10_000 });
  await expect(page.locator('.ranking .online')).toContainText('大阪');
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([...SUBMISSION_KEYS].sort());
  expect(posts[0]!.name).toBe('タツヤ');
  expect(JSON.stringify(posts[0])).not.toMatch(/lm|landmark|image|video/i);
  expect(external).toEqual([]);
});

test('without onlinetest, synthetic plays never submit (only real camera plays do)', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
  await page.goto('/?source=autoplay&fast=1&flags=-particles');
  await waitFor(page, (s) => s.phase === 'results', 150_000);
  await page.waitForTimeout(1500);
  expect(posts).toEqual([]);
});

test('the on-screen keys type a name (゛ modifies the last kana); a bad word is refused', async ({ page }) => {
  await page.goto('/?source=autoplay&fast=1&flags=-particles&onlinetest=1');
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, body: '' }));
  await waitFor(page, (s) => s.phase === 'results', 150_000);
  // Wait until the bot's hand has left (it would type with its fingertip otherwise).
  await waitFor(page, (s) => !s.present, 20_000);
  const key = (k: string) => page.locator(`.ne-key[data-key="${k}"]`).click();
  for (const k of ['バ', 'カ']) {
    if (k === 'バ') {
      await key('ハ');
      await key('゛');
    } else await key(k);
  }
  await expect(page.locator('.ne-input')).toHaveValue('バカ');
  await key('決定');
  await expect(page.locator('.ne-msg')).toContainText('使えません');
  await key('けす');
  await key('けす');
  for (const k of ['タ', 'ツ', 'ヤ']) await key(k);
  await key('決定');
  await expect(page.locator('.name-entry')).toBeHidden();
  await expect(page.locator('.res .nick')).toHaveText('タツヤ');
});

test('lowering the hands does not end the name entry (regression)', async ({ page }) => {
  await page.goto('/?source=autoplay&fast=1&flags=-particles');
  await waitFor(page, (s) => s.phase === 'results', 150_000);
  await expect(page.locator('.name-entry')).toBeVisible();
  // The bot's hand leaves after ~1 s; the old code skipped 3 s later.
  await page.waitForTimeout(5000);
  expect((await page.evaluate(() => (window as unknown as { __aura: { inspect(): { present: boolean } } }).__aura.inspect().present))).toBe(false);
  await expect(page.locator('.name-entry')).toBeVisible();
  await page.locator('.ne-input').fill('ミラ');
  await page.locator('.ne-input').press('Enter');
  await expect(page.locator('.res .nick')).toHaveText('ミラ');
});
