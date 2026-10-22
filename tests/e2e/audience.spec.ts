// Tier 2 audience window: receives live state from the game tab via
// BroadcastChannel (same browser, no network).
import { expect, test } from '@playwright/test';
import { FAST, waitFor } from './helpers';

test('audience window mirrors live score and ranking', async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  context.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  const aud = await context.newPage();
  await aud.goto('/audience');
  const game = await context.newPage();
  await game.goto(`/${FAST}`);
  await waitFor(game, (s) => s.phase === 'play' && s.casts > 0, 90_000);
  await expect(aud.locator('#status')).toHaveText('', { timeout: 10_000 });
  await expect(aud.locator('#n-fps')).not.toHaveText('-');
  await aud.screenshot({ path: 'test-results/audience.png' });
  expect(external).toEqual([]);
});
