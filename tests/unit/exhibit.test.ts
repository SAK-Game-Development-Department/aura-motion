import { describe, expect, it } from 'vitest';
import { FlashLimiter, Shake } from '../../src/render/fx/safety';
import { QualityGovernor } from '../../src/render/quality';
import { HoldButtons } from '../../src/exhibit/holdButton';
import { HighScores, type KV } from '../../src/exhibit/highscores';
import { nickname } from '../../src/exhibit/nickname';
import { PresenceTracker, judgePlacement } from '../../src/exhibit/presence';
import { Watchdog, canReload } from '../../src/exhibit/watchdog';
import { HandTracker } from '../../src/gesture/tracker';
import { buildHand, defaultHand } from '../../src/gesture/handModel';
import { SAFETY, EXHIBIT, RENDER, HAND } from '../../src/config';
import { FieldBuilder, chamfer } from '../../src/input/tracking/field';

describe('FlashLimiter (photosensitivity)', () => {
  it('never allows more than 3 flash onsets in any 1 s window', () => {
    const f = new FlashLimiter(1);
    const accepted: number[] = [];
    for (let t = 0; t < 10_000; t += 16) if (f.request(t, 1)) accepted.push(t);
    for (let i = 0; i < accepted.length; i++) {
      const inWindow = accepted.filter((t) => t >= accepted[i]! && t < accepted[i]! + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(SAFETY.maxFlashesPerSecond);
    }
  });
  it('amplitude is capped and scaled by intensity; decays smoothly', () => {
    const f = new FlashLimiter(0.5);
    f.request(0, 1);
    let peak = 0;
    let prev = 0;
    for (let t = 0; t < 1000; t += 5) {
      const v = f.value(t);
      peak = Math.max(peak, v);
      if (t > 60) expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(peak).toBeLessThanOrEqual(SAFETY.maxFlashAmplitude * 0.5 + 1e-9);
    expect(f.value(1000)).toBeLessThan(0.01);
  });
  it('calm mode (intensity 0) produces no flash and no shake', () => {
    const f = new FlashLimiter(0);
    expect(f.request(0, 1)).toBe(false);
    const s = new Shake(0);
    s.kick(1);
    expect(s.offset(16)).toEqual({ x: 0, y: 0 });
  });
});

describe('QualityGovernor', () => {
  it('drops particles first, then resolution, then effects; recovers later', () => {
    const q = new QualityGovernor({ webgl: false, startLevel: 1 });
    let t = 0;
    const run = (ms: number, dur: number) => {
      for (const end = t + dur; t < end; t += ms) q.sample(t, ms);
    };
    run(30, 3000);
    expect(q.state.particleLevel).toBe(0);
    run(30, 20000);
    expect(q.state.resolutionLevel).toBe(0);
    expect(q.state.effects).toBe(false);
    run(8, 120000);
    expect(q.state.effects).toBe(true);
    expect(q.state.particleLevel).toBeGreaterThan(0);
  });
  it('WebGL2 fallback caps the particle level', () => {
    const q = new QualityGovernor({ webgl: true, startLevel: 5 });
    expect(q.state.particleLevel).toBe(RENDER.webglMaxLevel);
  });
});

describe('HoldButtons', () => {
  it('fires once after a 1 s hold, not on a brief pass', () => {
    const hb = new HoldButtons([{ id: 'go', pos: { x: 0.5, y: 0.5 } }]);
    let fired: string | null = null;
    for (let t = 0; t <= 400; t += 16) fired = hb.update(t, [{ x: 0.5, y: 0.5 }], 16 / 9) ?? fired;
    for (let t = 416; t <= 1200; t += 16) fired = hb.update(t, [{ x: 0.1, y: 0.1 }], 16 / 9) ?? fired;
    expect(fired).toBeNull();
    let count = 0;
    for (let t = 1216; t <= 1216 + HAND.buttonHoldMs + 600; t += 16) if (hb.update(t, [{ x: 0.51, y: 0.5 }], 16 / 9)) count++;
    expect(count).toBe(1);
  });
});

describe('HighScores & nickname', () => {
  const mem = (): KV => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };
  it('keeps the top N sorted', () => {
    const hs = new HighScores(mem());
    for (let i = 0; i < 15; i++) hs.add({ score: i * 100, name: 'x', rank: 'A', at: i, seated: false });
    const l = hs.list();
    expect(l).toHaveLength(EXHIBIT.highscores);
    expect(l[0]!.score).toBe(1400);
    expect(hs.add({ score: 5, name: 'y', rank: 'C', at: 99, seated: false })).toBe(-1);
  });
  it('survives corrupt storage', () => {
    const kv = mem();
    kv.setItem('aura.highscores.v1', '{not json');
    expect(new HighScores(kv).list()).toEqual([]);
  });
  it('nicknames are deterministic and non-empty', () => {
    expect(nickname(5)).toBe(nickname(5));
    expect(nickname(5).length).toBeGreaterThan(2);
  });
});

describe('Presence (hands)', () => {
  const frame = (size: number | null) =>
    new HandTracker().update({ t: 0, poses: [], aspect: 16 / 9, hands: size === null ? [] : [{ lm: buildHand({ ...defaultHand('R'), size }), score: 1 }] });
  it('judges placement by hand size', () => {
    expect(judgePlacement(frame(0.15))).toBe('ok');
    expect(judgePlacement(frame(0.04))).toBe('tooFar');
    expect(judgePlacement(frame(0.45))).toBe('tooClose');
    expect(judgePlacement(frame(null))).toBe('none');
    expect(judgePlacement(null)).toBe('none');
  });
  it('ready after the hold; empty after the absence timeout', () => {
    const p = new PresenceTracker();
    for (let t = 0; t < HAND.startHoldMs - 100; t += 33) p.update(t, true, 'ok');
    expect(p.ready(HAND.startHoldMs - 100)).toBe(false);
    p.update(HAND.startHoldMs + 50, true, 'ok');
    expect(p.ready(HAND.startHoldMs + 50)).toBe(true);
    p.update(2000, false, 'none');
    expect(p.empty(HAND.startHoldMs + 50 + EXHIBIT.absentReturnMs - 600)).toBe(false);
    expect(p.empty(HAND.startHoldMs + 50 + EXHIBIT.absentReturnMs + 1)).toBe(true);
  });
});

describe('Watchdog', () => {
  it('escalates: tracking stall → restart; rAF stall → reload; error storm → soft reset', () => {
    const w = new Watchdog();
    expect(w.check({ now: 10000, lastFrameAt: 9990, trackingAge: 100, trackingExpected: true, cameraTrackEnded: false })).toBe('none');
    expect(w.check({ now: 20000, lastFrameAt: 19990, trackingAge: 5000, trackingExpected: true, cameraTrackEnded: false })).toBe('restartTracking');
    expect(w.check({ now: 21000, lastFrameAt: 20990, trackingAge: 6000, trackingExpected: true, cameraTrackEnded: false })).toBe('none');
    expect(w.check({ now: 30000, lastFrameAt: 20000, trackingAge: 0, trackingExpected: false, cameraTrackEnded: false })).toBe('reload');
    for (let i = 0; i < EXHIBIT.watchdog.maxErrorsPerMinute; i++) w.recordError(40000 + i);
    expect(w.check({ now: 40100, lastFrameAt: 40090, trackingAge: 0, trackingExpected: false, cameraTrackEnded: false })).toBe('softReset');
  });
  it('reload backoff prevents loops', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(canReload(100_000, s)).toBe(true);
    expect(canReload(110_000, s)).toBe(false);
    expect(canReload(100_000 + EXHIBIT.watchdog.reloadBackoffMs + 1, s)).toBe(true);
  });
});

describe('Silhouette field', () => {
  it('chamfer distance approximates Euclidean', () => {
    const w = 41;
    const h = 41;
    const d = new Float32Array(w * h).fill(1e9);
    d[20 * w + 20] = 0;
    chamfer(d, w, h);
    expect(d[20 * w + 30]).toBeCloseTo(10, 5);
    expect(Math.abs(d[30 * w + 30]! - Math.hypot(10, 10))).toBeLessThan(0.5);
  });
  it('sdf is positive inside a disc, negative outside, ~0 at the contour', () => {
    const fb = new FieldBuilder(64, 36);
    const m = new Float32Array(64 * 36);
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) m[y * 64 + x] = Math.hypot(x - 32, y - 18) < 10 ? 1 : 0;
    fb.build(m, null, 0);
    expect(fb.sdfAt(32, 18)).toBeGreaterThan(0.2);
    expect(fb.sdfAt(2, 2)).toBeLessThan(-0.2);
    expect(Math.abs(fb.sdfAt(42, 18))).toBeLessThan(0.04);
  });
  it('a moving mask produces velocity in the direction of motion', () => {
    const fb = new FieldBuilder(64, 36);
    const disc = (cx: number) => {
      const m = new Float32Array(64 * 36);
      for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) m[y * 64 + x] = Math.hypot(x - cx, y - 18) < 8 ? 1 : 0;
      return m;
    };
    fb.build(disc(28), null, 0);
    fb.build(disc(31), null, 33);
    const [vx] = fb.velAt(39, 18); // leading edge
    expect(vx).toBeGreaterThan(0.1);
  });
  it('hand capsule mask covers the palm and fingertips, not the corners', () => {
    const fb = new FieldBuilder(192, 108);
    const lm = buildHand({ ...defaultHand('R'), size: 0.2, wrist: { x: 0.5, y: 0.8 } });
    const m = fb.maskFromHands([lm]);
    const at = (x: number, y: number) => m[Math.floor(y * 108) * 192 + Math.floor(x * 192)]!;
    expect(at((lm[0]!.x + lm[9]!.x) / 2, (lm[0]!.y + lm[9]!.y) / 2)).toBeGreaterThan(0.9);
    expect(at(lm[8]!.x, lm[8]!.y)).toBeGreaterThan(0.3);
    expect(at(0.02, 0.02)).toBe(0);
  });
});
