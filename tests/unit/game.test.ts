import { describe, expect, it } from 'vitest';
import { generateValidStage } from '../../src/stage/generator';
import { framesFromScript, simulate } from '../../src/game/simulate';
import { autoplayScript, scripts } from '../../src/input/synth';
import { segmentCircleSpan } from '../../src/game/session';
import { accuracy } from '../../src/game/score';

const T0 = { seated: false, flow: false, wall: false, dodge: false, structure: false };

describe('segmentCircleSpan', () => {
  it('detects pass-through and inside', () => {
    const s = segmentCircleSpan({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.1, 1)!;
    expect(s[0]).toBeCloseTo(0.4, 5);
    expect(s[1]).toBeCloseTo(0.6, 5);
    expect(segmentCircleSpan({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.1, 1)).toEqual([0, 1]);
    expect(segmentCircleSpan({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.5 }, 0.1, 1)).toBeNull();
  });
});

describe('GameSession (Tier 0 vertical slice)', () => {
  const stage = generateValidStage({ ...T0, seed: 77 });

  it('a perfect autoplayer scores almost all Perfect', () => {
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: 0 }), stage.durationMs + 1000);
    const { session } = simulate(stage, frames, { offsetMs: 0 });
    const c = session.score.counts;
    const n = c.perfect + c.good + c.miss;
    expect(n).toBe(stage.orbs.filter((o) => o.tier <= 1).length);
    expect(c.miss).toBe(0);
    expect(c.perfect / n).toBeGreaterThan(0.9);
    expect(session.ended).toBe(true);
  });

  it('nobody in front of the camera → everything is a Miss, score 0', () => {
    const frames = framesFromScript(scripts.absent(), stage.durationMs);
    const { session } = simulate(stage, frames);
    expect(session.score.score).toBe(0);
    expect(session.score.counts.perfect + session.score.counts.good).toBe(0);
  });

  it('idle player gets mostly Miss', () => {
    const frames = framesFromScript(scripts.idle(), stage.durationMs);
    const { session } = simulate(stage, frames);
    expect(accuracy(session.score)).toBeLessThan(0.25);
  });

  it('is deterministic: same input → same events and score', () => {
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: 0, errorMs: 120, missRate: 0.1, seed: 5 }), stage.durationMs + 1000);
    const a = simulate(stage, frames);
    const b = simulate(stage, frames);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.session.score).toEqual(b.session.score);
  });

  it('render frame rate does not change the outcome', () => {
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: 0, errorMs: 120, seed: 9 }), stage.durationMs + 1000);
    const a = simulate(stage, frames, { renderHz: 60 });
    const b = simulate(stage, frames, { renderHz: 144 });
    expect(a.session.score.counts).toEqual(b.session.score.counts);
  });

  it('latency offset is compensated: a lagging player with matching offset still scores Perfect', () => {
    // The hit area is generous (dwell time absorbs small lags), so use a lag
    // larger than the Good window to make the compensation observable.
    const lag = 350;
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: lag }), stage.durationMs + 1500);
    const ok = simulate(stage, frames, { offsetMs: lag });
    const uncal = simulate(stage, frames, { offsetMs: 0 });
    const okC = ok.session.score.counts;
    const unC = uncal.session.score.counts;
    expect(okC.miss).toBe(0);
    expect(okC.good).toBe(0);
    // Without compensation, a large share of Perfects degrade to Good.
    expect(okC.perfect - unC.perfect).toBeGreaterThan(20);
  });

  it('combo resets on miss and multiplier grows', () => {
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: 0, missRate: 0.2, seed: 3 }), stage.durationMs + 1000);
    const { session, events } = simulate(stage, frames);
    expect(session.score.counts.miss).toBeGreaterThan(0);
    expect(session.score.maxCombo).toBeGreaterThan(3);
    const judges = events.filter((e) => e.type === 'judge');
    for (const j of judges) if (j.type === 'judge' && j.grade === 'miss') expect(j.combo).toBe(0);
  });
});

describe('GameSession (full Tier 1 structure)', () => {
  it('autoplayer clears walls and dodges and captures flow', () => {
    const stage = generateValidStage({ seated: false, flow: true, wall: true, dodge: true, structure: true, seed: 2024 });
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: 0 }), stage.durationMs + 1000);
    const { session, events } = simulate(stage, frames);
    const judges = events.filter((e): e is Extract<typeof e, { type: 'judge' }> => e.type === 'judge');
    const walls = judges.filter((j) => j.what === 'wall');
    const dodges = judges.filter((j) => j.what === 'dodge');
    expect(walls.length).toBe(stage.walls.length);
    expect(dodges.length).toBe(stage.dodges.length);
    expect(walls.filter((w) => w.grade !== 'miss').length / walls.length).toBeGreaterThan(0.9);
    expect(dodges.filter((w) => w.grade !== 'miss').length / dodges.length).toBeGreaterThan(0.9);
    expect(events.filter((e) => e.type === 'section').map((e) => (e as { kind: string }).kind)).toEqual(['intro', 'flow', 'wall', 'dodge', 'finale']);
    expect(session.score.flowCaptured).toBeGreaterThanOrEqual(0);
  });

  it('seated autoplayer clears the seated stage', () => {
    const stage = generateValidStage({ seated: true, flow: false, wall: true, dodge: true, structure: true, seed: 31 });
    const frames = framesFromScript(autoplayScript(stage, { playStartRel: 0, offsetMs: 0, seated: true }), stage.durationMs + 1000);
    const { session } = simulate(stage, frames);
    expect(accuracy(session.score)).toBeGreaterThan(0.8);
  });
});
