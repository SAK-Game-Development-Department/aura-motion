// Shared ranking (mocked API): a play sends exactly the allowed fields to the
// same-origin /api, and the results screen shows the nationwide placement.
import { expect, test } from '@playwright/test';
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
    return r.fulfill({ json: { list: [{ name: '光るクラゲ', score: 99999, rank: 'S', stage: 'hoshi', stageName: '星空トンネル', region: '大阪', at: 0 }], total: 42 } });
  });
  await page.goto('/?source=autoplay&fast=1&flags=-particles&onlinetest=1');
  await waitFor(page, (s) => s.phase === 'results', 150_000);
  await expect(page.locator('.ranking .online')).toContainText('本日 1 位', { timeout: 10_000 });
  await expect(page.locator('.ranking .online')).toContainText('大阪');
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]!).sort()).toEqual([...SUBMISSION_KEYS].sort());
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
