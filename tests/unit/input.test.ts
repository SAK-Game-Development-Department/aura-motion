import { describe, expect, it } from 'vitest';
import { BodyTracker } from '../../src/input/body';
import { PlayerLock } from '../../src/input/playerLock';
import { buildLandmarks, defaultBody } from '../../src/input/skeleton';
import { scripts } from '../../src/input/synth';
import { Recorder, decodeFrame, parseRecording } from '../../src/input/replay';
import { framesFromScript } from '../../src/game/simulate';
import { LatencyCalibrator } from '../../src/game/calibration';
import { poseSimilarity } from '../../src/game/poseMatch';
import { POSES, POSE_IDS } from '../../src/stage/poses';
import { Difficulty } from '../../src/game/difficulty';
import { LATENCY } from '../../src/config';

describe('skeleton', () => {
  it('builds 33 landmarks inside the frame for a default body', () => {
    const lm = buildLandmarks(defaultBody());
    expect(lm).toHaveLength(33);
    for (const p of lm) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
    // Person's left shoulder appears on screen-left (mirrored view).
    expect(lm[11]!.x).toBeLessThan(lm[12]!.x);
  });
});

describe('BodyTracker motion detection', () => {
  it('detects jump, crouch and leans from the synthetic move cycle', () => {
    const tr = new BodyTracker();
    const seen = { jump: [] as number[], crouch: [] as number[], left: [] as number[], right: [] as number[] };
    for (const f of framesFromScript(scripts.moves(), 16000)) {
      const s = tr.update(f);
      const c = f.t % 8000;
      if (s.motion.jumping) seen.jump.push(c);
      if (s.motion.crouching) seen.crouch.push(c);
      if (s.motion.lean === -1) seen.left.push(c);
      if (s.motion.lean === 1) seen.right.push(c);
    }
    const inRange = (xs: number[], a: number, b: number) => xs.length > 0 && xs.every((x) => x >= a && x <= b);
    expect(inRange(seen.jump, 2000, 2700)).toBe(true);
    expect(inRange(seen.crouch, 3500, 4600)).toBe(true);
    expect(inRange(seen.left, 5200, 6300)).toBe(true);
    expect(inRange(seen.right, 6600, 7700)).toBe(true);
  });

  it('idle body triggers nothing', () => {
    const tr = new BodyTracker();
    for (const f of framesFromScript(scripts.idle(), 6000)) {
      const m = tr.update(f).motion;
      expect(m.jumping || m.crouching || m.lean !== 0).toBe(false);
    }
  });

  it('reports lower body visibility (seated detection)', () => {
    const tr = new BodyTracker();
    const st = tr.update({ t: 0, poses: [buildLandmarks(defaultBody())], aspect: 16 / 9 });
    expect(st.lowerBodyVisible).toBe(true);
    const b = defaultBody();
    b.seated = true;
    const tr2 = new BodyTracker();
    expect(tr2.update({ t: 0, poses: [buildLandmarks(b)], aspect: 16 / 9 }).lowerBodyVisible).toBe(false);
  });
});

describe('PlayerLock', () => {
  const at = (cx: number, h = 0.78) => {
    const b = defaultBody();
    b.cx = cx;
    b.height = h;
    return buildLandmarks(b);
  };
  it('locks the central/larger person and keeps them when another walks in', () => {
    const lock = new PlayerLock();
    const r0 = lock.update(0, [at(0.2, 0.5), at(0.5)], 16 / 9);
    expect(r0.pose![11]!.x).toBeCloseTo(at(0.5)[11]!.x, 5);
    // A bigger person appears at the side; we stay locked on our player.
    const r1 = lock.update(33, [at(0.85, 0.9), at(0.51)], 16 / 9);
    expect(r1.pose![11]!.x).toBeCloseTo(at(0.51)[11]!.x, 5);
    expect(r1.others).toBe(1);
  });
  it('tolerates a short loss, then re-acquires; long gaps flag a new visitor', () => {
    const lock = new PlayerLock(800, 0.18, 2500);
    lock.update(0, [at(0.5)], 16 / 9);
    expect(lock.update(300, [], 16 / 9).pose).toBeNull();
    const back = lock.update(500, [at(0.5)], 16 / 9);
    expect(back.pose).not.toBeNull();
    expect(back.acquired).toBe(false);
    lock.update(600, [], 16 / 9);
    lock.update(2000, [], 16 / 9);
    const other = lock.update(6000, [at(0.45, 0.6)], 16 / 9);
    expect(other.acquired).toBe(true);
    expect(other.newVisitor).toBe(true);
  });
});

describe('Replay', () => {
  it('round-trips frames through JSON', () => {
    const frames = framesFromScript(scripts.wave(), 1000);
    const rec = new Recorder();
    for (const f of frames) rec.push(f);
    const json = JSON.stringify(rec.finish({ note: 'test' }));
    const back = parseRecording(json);
    expect(back.frames).toHaveLength(frames.length);
    const f0 = decodeFrame(back.frames[5]!, back.aspect);
    expect(f0.poses[0]![15]!.x).toBeCloseTo(frames[5]!.poses[0]![15]!.x, 3);
    expect(() => parseRecording('{"format":"x"}')).toThrow();
  });
});

describe('Latency calibration', () => {
  for (const lag of [0, 80, 180]) {
    it(`estimates a ${lag} ms lag from claps`, () => {
      const cal = new LatencyCalibrator(0);
      const tr = new BodyTracker();
      for (const f of framesFromScript(scripts.clapper(cal.pulses, lag), cal.endT + 500)) cal.feed(tr.update(f));
      const r = cal.result();
      expect(r.accepted).toBe(true);
      // Clap detection fires when the palms cross the threshold, slightly before full contact.
      expect(Math.abs(r.offsetMs - lag)).toBeLessThan(90);
    });
  }
  it('falls back to the default when the player does not clap', () => {
    const cal = new LatencyCalibrator(0);
    const tr = new BodyTracker();
    for (const f of framesFromScript(scripts.idle(), cal.endT + 500)) cal.feed(tr.update(f));
    expect(cal.result()).toMatchObject({ accepted: false, offsetMs: LATENCY.defaultOffsetMs });
  });
  it('relative: larger lag → larger estimate', () => {
    const est = (lag: number) => {
      const cal = new LatencyCalibrator(0);
      const tr = new BodyTracker();
      for (const f of framesFromScript(scripts.clapper(cal.pulses, lag), cal.endT + 500)) cal.feed(tr.update(f));
      return cal.result().offsetMs;
    };
    expect(est(200) - est(50)).toBeGreaterThan(110);
  });
});

describe('Pose similarity', () => {
  it('matching template scores high, others lower', () => {
    for (const id of POSE_IDS) {
      const tpl = POSES[id];
      const b = defaultBody();
      b.armL = { ...tpl.armL };
      b.armR = { ...tpl.armR };
      if (tpl.legL && tpl.legR) {
        b.legL = { ...tpl.legL };
        b.legR = { ...tpl.legR };
      }
      const lm = buildLandmarks(b);
      expect(poseSimilarity(lm, 16 / 9, tpl, true).score, id).toBeGreaterThan(0.97);
      const idle = buildLandmarks(defaultBody());
      expect(poseSimilarity(idle, 16 / 9, tpl, true).score, `idle vs ${id}`).toBeLessThan(0.6);
    }
  });
});

describe('Difficulty', () => {
  it('eases off after misses and ramps up after hits', () => {
    const d = new Difficulty(true);
    for (let i = 0; i < 12; i++) d.record('miss');
    expect(d.level).toBeLessThan(1);
    expect(d.approachScale).toBeGreaterThan(1);
    const e = new Difficulty(true);
    for (let i = 0; i < 30; i++) e.record('perfect');
    expect(e.level).toBeGreaterThan(1);
    expect(e.tierActive(2)).toBe(true);
    const off = new Difficulty(false);
    for (let i = 0; i < 30; i++) off.record('miss');
    expect(off.level).toBe(1);
  });
});
