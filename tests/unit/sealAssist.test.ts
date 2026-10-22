import { describe, expect, it } from 'vitest';
import { GestureEngine } from '../../src/gesture/engine';
import { buildHand, defaultHand, relaxedHand, sealHands, withShape, type SynthHand } from '../../src/gesture/handModel';
import { SEAL_IDS, type SealKind } from '../../src/gesture/seals';
import { Rng } from '../../src/core/rng';

function run(hands: (t: number) => SynthHand[], expect: SealKind[] = [], ms = 1500, jitter = 0, seed = 1) {
  const eng = new GestureEngine({ seals: true, twoHand: true });
  eng.expectSeals = new Set(expect);
  const rng = new Rng(seed);
  const seals: SealKind[] = [];
  for (let t = 0; t < ms; t += 33) {
    const hs = hands(t).map((h) => ({ lm: buildHand(h).map((p) => ({ ...p, x: p.x + rng.range(-jitter, jitter), y: p.y + rng.range(-jitter, jitter) })), score: 0.95 }));
    for (const e of eng.update({ t, poses: [], aspect: 16 / 9, hands: hs }).events) if (e.type === 'seal') seals.push(e.kind);
  }
  return seals;
}

/** A sloppy seal: hands a bit apart and the fingers half-relaxed (what a first-timer does). */
function sloppy(kind: SealKind): SynthHand[] {
  return sealHands(kind, { x: 0.5, y: 0.6 }, 0.14).map((h, i) => {
    const r = relaxedHand(h, 0.15);
    return { ...h, wrist: { x: h.wrist.x + (i ? 0.025 : -0.025), y: h.wrist.y }, curl: h.curl.map((c, j) => c + (r.curl[j]! - c) * 0.45) as SynthHand['curl'] };
  });
}

describe('seal assist (the game waits for a seal)', () => {
  it('clean seals are recognised with or without assist', () => {
    for (const k of SEAL_IDS) {
      expect(run(() => sealHands(k, { x: 0.5, y: 0.6 }, 0.14)), k).toContain(k);
      expect(run(() => sealHands(k, { x: 0.5, y: 0.6 }, 0.14), [k]), k).toContain(k);
    }
  });

  it('sloppy seals all pass when awaited (not all do without)', () => {
    let without = 0;
    for (const k of SEAL_IDS) {
      if (run(() => sloppy(k)).includes(k)) without++;
      expect(run(() => sloppy(k), [k], 1500, 0.002), k).toContain(k);
    }
    console.log('sloppy seals recognised without assist:', without, '/', SEAL_IDS.length);
    expect(without).toBeLessThan(SEAL_IDS.length);
  });

  it('a seal still forms when one hand drops out for a moment (pressed hands occlude)', () => {
    const hs = sealHands('gassho', { x: 0.5, y: 0.6 }, 0.14);
    const seals = run((t) => (t > 100 && t < 300 ? [hs[0]!] : t < 100 ? hs : hs), ['gassho'], 600);
    expect(seals).toContain('gassho');
  });

  it('assist does not fire from idle hands apart or one hand alone', () => {
    const apart = () => [withShape({ ...defaultHand('L'), size: 0.14, wrist: { x: 0.3, y: 0.7 } }, 'open'), withShape({ ...defaultHand('R'), size: 0.14, wrist: { x: 0.7, y: 0.7 } }, 'open')];
    expect(run(apart, [...SEAL_IDS], 4000, 0.003)).toEqual([]);
    const one = () => [relaxedHand({ ...defaultHand('R'), size: 0.14, wrist: { x: 0.55, y: 0.7 } }, 0.2)];
    expect(run(one, [...SEAL_IDS], 4000, 0.003)).toEqual([]);
  });
});
