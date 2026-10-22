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
  await aud.goto('/audience.html');
  const game = await context.newPage();
  await game.goto(`/${FAST}`);
  await waitFor(game, (s) => s.phase === 'play' && (s.score ?? 0) > 0, 90_000);
  await expect(aud.locator('#score')).not.toHaveText('', { timeout: 10_000 });
  await expect(aud.locator('#section')).not.toHaveText('');
  await waitFor(game, (s) => s.phase === 'results', 90_000);
  await expect(aud.locator('#rank li').first()).toBeVisible({ timeout: 10_000 });
  await aud.screenshot({ path: 'test-results/audience.png' });
  expect(external).toEqual([]);
});
