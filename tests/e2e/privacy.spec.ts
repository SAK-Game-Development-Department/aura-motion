// Privacy guarantees (CLAUDE.md): no request leaves the origin, nothing is
// POSTed, no audio is requested, the camera image is never shown.
import { expect, test } from '@playwright/test';
import { FAST, waitFor } from './helpers';

test('zero external requests and no uploads during a full camera boot + play', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  const nonGet: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
    if (r.method() !== 'GET') nonGet.push(`${r.method()} ${u}`);
  });
  page.on('websocket', (ws) => external.push(`ws ${ws.url()}`));
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    (window as unknown as { __gum: unknown[] }).__gum = [];
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      (window as unknown as { __gum: unknown[] }).__gum.push(JSON.parse(JSON.stringify(c ?? {})));
      return orig(c);
    };
  });
  // Real camera path with Chromium's fake device (MediaPipe loads from same origin).
  const resp = await page.goto('/?flags=-particles');
  const csp = resp?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'self'");
  await waitFor(page, (s) => s.phase === 'title' || s.phase === 'error', 150_000);
  const gum = await page.evaluate(() => (window as unknown as { __gum: Array<{ audio?: unknown }> }).__gum);
  expect(gum.length).toBeGreaterThan(0);
  for (const c of gum) expect(c.audio).toBe(false);
  // The <video> exists only as an invisible frame source.
  const vids = await page.$$eval('video', (vs) => vs.map((v) => ({ op: getComputedStyle(v).opacity, w: v.getBoundingClientRect().width })));
  for (const v of vids) {
    expect(Number(v.op)).toBe(0);
    expect(v.w).toBeLessThanOrEqual(2);
  }
  // Then a synthetic play session on the same page origin.
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'practice', 60_000);
  await page.waitForTimeout(5000);
  expect(external).toEqual([]);
  expect(nonGet).toEqual([]);
});

test('no audio APIs are used', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__audio = 0;
    const AC = w.AudioContext as (new () => unknown) | undefined;
    if (AC) {
      w.AudioContext = function () {
        (w.__audio as number)++;
        return new AC();
      };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) (w.__audio as number)++;
      return play.call(this);
    };
  });
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'practice', 60_000);
  expect(await page.evaluate(() => (window as unknown as { __audio: number }).__audio)).toBe(0);
});
