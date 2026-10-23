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
  await waitFor(page, (s) => s.phase === 'play', 60_000);
  await page.waitForTimeout(5000);
  expect(external).toEqual([]);
  expect(nonGet).toEqual([]);
});

// Sound is synthesized live (Web Audio): one AudioContext, no <audio>, no
// audio files fetched, never the microphone — and none at all when the staff
// switch sound off.
async function countAudio(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__ac = 0;
    w.__audioEl = 0;
    const AC = w.AudioContext as (new (o?: unknown) => unknown) | undefined;
    if (AC) {
      const Wrapped = function (this: unknown, o?: unknown) {
        (w.__ac as number)++;
        return new AC(o);
      } as unknown as typeof AudioContext;
      w.AudioContext = Wrapped;
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) (w.__audioEl as number)++;
      return play.call(this);
    };
  });
}

test('sound: synthesized only (one AudioContext, no audio files, no <audio>)', async ({ page }) => {
  const audioFiles: string[] = [];
  page.on('request', (r) => /\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?|$)/i.test(r.url()) && audioFiles.push(r.url()));
  await countAudio(page);
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'play', 60_000);
  await page.keyboard.press('Shift'); // a user gesture unlocks audio
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ ac: (window as unknown as { __ac: number }).__ac, el: (window as unknown as { __audioEl: number }).__audioEl, tags: document.querySelectorAll('audio').length }));
  expect(r.ac).toBeLessThanOrEqual(1);
  expect(r.el).toBe(0);
  expect(r.tags).toBe(0);
  expect(audioFiles).toEqual([]);
});

test('sound off in the settings → no audio at all', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aura.settings.v1', JSON.stringify({ sound: false })));
  await countAudio(page);
  await page.goto(`/${FAST}`);
  await waitFor(page, (s) => s.phase === 'play', 60_000);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __ac: number }).__ac)).toBe(0);
});
