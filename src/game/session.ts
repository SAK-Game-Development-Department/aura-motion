// GameSession: the deterministic heart of AURA.
//
// It depends only on (a) the Stage, (b) a stream of timestamped BodySnapshots
// pushed via pushInput(), and (c) the game time passed to update(). It never
// reads clocks, the DOM or the GPU. Feeding the same calls in the same order
// produces the same events and score — replays and tests rely on this.
import { DODGE, FLOW, JUDGE, POSE } from '../config';
import { clamp } from '../core/math';
import type { Hand, Landmark, Vec2 } from '../core/types';
import { fromBody, type Anchor, type BodySnapshot } from '../input/body';
import { POSES, type PoseId } from '../stage/poses';
import type { DodgeNote, FlowPhase, OrbNote, SectionKind, Stage, WallNote } from '../stage/types';
import { Difficulty } from './difficulty';
import { FlowSim, bodySegments } from './flow';
import { poseSimilarity, type PoseScore } from './poseMatch';
import { applyGrade, newScore, type Grade, type ScoreState } from './score';

export interface SessionOptions {
  stage: Stage;
  dda: boolean;
  /** Judgement window multiplier provider (e.g. 1.5 while tracking is unstable). */
  windowScale?: () => number;
  strictHands?: boolean;
}

export interface ActiveOrb {
  note: OrbNote;
  /** Resolved view-space position (frozen at spawn). */
  view: Vec2;
  /** Radius in view-height units. */
  radius: number;
  spawnT: number;
  approachMs: number;
  /** Latest time the hand was inside the circle before the Perfect window. */
  earlyT: number | null;
}

export interface ActiveWall {
  note: WallNote;
  spawnT: number;
  approachMs: number;
  /** Anchor frozen at spawn: the hole is drawn around the player. */
  anchor: Anchor;
  best: number;
  current: PoseScore | null;
}

export interface ActiveDodge {
  note: DodgeNote;
  spawnT: number;
  approachMs: number;
  /** Satisfied at least once inside the window (and when). */
  okAt: number | null;
  anchor: Anchor;
}

export interface ActiveFlow {
  phase: FlowPhase;
  sim: FlowSim;
  emitterView: Vec2;
  goalView: Vec2;
}

export type GameEvent =
  | { type: 'judge'; what: 'orb' | 'wall' | 'dodge'; id: number; grade: Grade; t: number; dt?: number; hand?: Hand; view: Vec2; points: number; combo: number }
  | { type: 'flowCapture'; t: number; count: number; view: Vec2; points: number }
  | { type: 'section'; t: number; kind: SectionKind }
  | { type: 'end'; t: number };

const FIXED_DT = 1000 / 60;

export class GameSession {
  readonly stage: Stage;
  readonly score: ScoreState = newScore();
  readonly difficulty: Difficulty;
  orbs: ActiveOrb[] = [];
  walls: ActiveWall[] = [];
  dodges: ActiveDodge[] = [];
  flow: ActiveFlow | null = null;
  section: SectionKind | null = null;
  ended = false;
  /** Game time of the latest update(). */
  now = 0;

  private orbIdx = 0;
  private wallIdx = 0;
  private dodgeIdx = 0;
  private flowIdx = 0;
  private sectionIdx = -1;
  private stepT = 0;
  private lastInputT = -Infinity;
  private body: BodySnapshot | null = null;
  private prevBody: { t: number; lm: Landmark[]; hands: Record<Hand, Vec2> } | null = null;
  private lastAnchor: Anchor = { x: 0.5, y: 0.38, unit: 0.17 };
  private aspect = 16 / 9;
  private queue: Array<{ t: number; body: BodySnapshot }> = [];
  private events: GameEvent[] = [];
  private flowSegs: ReturnType<typeof bodySegments> = [];
  private flowSegPrev: { t: number; lm: Landmark[] } | null = null;

  constructor(private opts: SessionOptions) {
    this.stage = opts.stage;
    this.difficulty = new Difficulty(opts.dda);
  }

  /** Push a body sample. `tGame` = capture time mapped to game time, minus calibrated latency. */
  pushInput(tGame: number, body: BodySnapshot): void {
    this.queue.push({ t: tGame, body });
  }

  get totalNotes(): number {
    return this.stage.orbs.length + this.stage.walls.length + this.stage.dodges.length;
  }

  get windowScale(): number {
    return (this.opts.windowScale?.() ?? 1) * this.difficulty.windowScale;
  }

  /** Advance to game time `now` and return events produced since the last call. */
  update(now: number): GameEvent[] {
    this.events = [];
    if (this.ended) return this.events;
    this.queue.sort((a, b) => a.t - b.t);
    for (const q of this.queue) {
      this.advanceFixed(Math.min(q.t, now));
      this.processInput(q.t, q.body);
    }
    this.queue.length = 0;
    this.advanceFixed(now);
    this.now = now;
    this.spawn(now);
    this.expire(now);
    if (now >= this.stage.durationMs && !this.ended) {
      this.ended = true;
      this.events.push({ type: 'end', t: now });
    }
    return this.events;
  }

  // ───────────────────────── spawning ─────────────────────────

  private spawn(now: number): void {
    const st = this.stage;
    while (this.sectionIdx + 1 < st.sections.length && st.sections[this.sectionIdx + 1]!.start <= now) {
      this.sectionIdx++;
      this.section = st.sections[this.sectionIdx]!.kind;
      this.events.push({ type: 'section', t: now, kind: this.section });
    }
    const anchor = this.lastAnchor;
    const approach = JUDGE.approachMs * this.difficulty.approachScale;
    while (this.orbIdx < st.orbs.length && st.orbs[this.orbIdx]!.t - approach <= now) {
      const note = st.orbs[this.orbIdx++]!;
      if (!this.difficulty.tierActive(note.tier)) continue;
      const v = fromBody(note.pos, anchor, this.aspect);
      const view = { x: clamp(v.x, 0.04, 0.96), y: clamp(v.y, 0.05, 0.95) };
      const radius = JUDGE.orbRadius * anchor.unit * (st.seated ? JUDGE.seatedRadiusScale : 1);
      this.orbs.push({ note, view, radius, spawnT: now, approachMs: Math.max(1, note.t - now), earlyT: null });
    }
    while (this.wallIdx < st.walls.length && st.walls[this.wallIdx]!.t - POSE.approachMs <= now) {
      const note = st.walls[this.wallIdx++]!;
      this.walls.push({ note, spawnT: now, approachMs: Math.max(1, note.t - now), anchor: { ...anchor }, best: 0, current: null });
    }
    while (this.dodgeIdx < st.dodges.length && st.dodges[this.dodgeIdx]!.t - DODGE.approachMs <= now) {
      const note = st.dodges[this.dodgeIdx++]!;
      this.dodges.push({ note, spawnT: now, approachMs: Math.max(1, note.t - now), okAt: null, anchor: { ...anchor } });
    }
    if (this.flow && now >= this.flow.phase.end + 2500) this.flow = null;
    while (this.flowIdx < st.flows.length && st.flows[this.flowIdx]!.start <= now) {
      const phase = st.flows[this.flowIdx++]!;
      const e = fromBody(phase.emitter, anchor, this.aspect);
      const g = fromBody(phase.goal, anchor, this.aspect);
      const emitterView = { x: clamp(e.x, 0.01, 0.99), y: clamp(e.y, 0.1, 0.9) };
      const goalView = { x: clamp(g.x, 0.08, 0.92), y: clamp(g.y, 0.1, 0.85) };
      this.flow = {
        phase,
        emitterView,
        goalView,
        sim: new FlowSim(st.seed ^ phase.id, emitterView, phase.emitDir, goalView, this.aspect),
      };
    }
  }

  // ───────────────────────── fixed step (flow) ─────────────────────────

  private advanceFixed(to: number): void {
    while (this.stepT + FIXED_DT <= to) {
      this.stepT += FIXED_DT;
      const f = this.flow;
      if (!f) continue;
      const emitting = this.stepT >= f.phase.start && this.stepT < f.phase.end;
      const got = f.sim.step(FIXED_DT / 1000, this.flowSegs, emitting);
      if (got > 0) {
        const points = got * FLOW.pointsPerTracer;
        this.score.score += points;
        this.score.flowCaptured += got;
        this.events.push({ type: 'flowCapture', t: this.stepT, count: got, view: f.goalView, points });
      }
    }
  }

  // ───────────────────────── input & judgement ─────────────────────────

  private processInput(t: number, body: BodySnapshot): void {
    this.aspect = body.aspect;
    if (!body.present) {
      this.body = body;
      this.prevBody = null;
      return;
    }
    this.lastAnchor = body.anchor;
    this.lastInputT = Math.max(this.lastInputT, t);
    const prev = this.prevBody;
    this.body = body;

    // Flow push segments (velocity from consecutive samples).
    const segDt = this.flowSegPrev ? (t - this.flowSegPrev.t) / 1000 : 0;
    this.flowSegs = bodySegments(body.lm, this.flowSegPrev && segDt > 0 && segDt < 0.2 ? this.flowSegPrev.lm : null, segDt, body.aspect);
    this.flowSegPrev = { t, lm: body.lm };

    const ws = this.windowScale;
    const goodW = JUDGE.goodMs * ws;
    const perfW = JUDGE.perfectMs * ws;
    const strict = this.opts.strictHands ?? JUDGE.strictHands;
    const handR = JUDGE.handRadius * body.anchor.unit;

    // Orbs: the swept hand segment (prev → cur) gives the time interval the
    // hand spent inside the hit circle. Overlap with the Perfect window →
    // Perfect; touching late → Good; arriving early is remembered and becomes
    // Perfect if the hand is still there when the window opens (forgiving for
    // first-time players), otherwise Good.
    for (const orb of this.orbs) {
      if (t < orb.note.t - goodW) continue;
      const T = orb.note.t;
      let best: { grade: Grade; dt: number; hand: Hand } | null = null;
      for (const h of ['L', 'R'] as const) {
        if (strict && orb.note.side !== 'any' && orb.note.side !== h) continue;
        const cur = body.hands[h];
        const hasPrev = prev !== null && t - prev.t < 200;
        const p0 = hasPrev ? prev.hands[h] : cur;
        const t0 = hasPrev ? prev.t : t;
        const span = segmentCircleSpan(p0, cur, orb.view, orb.radius + handR, body.aspect);
        if (!span) continue;
        const a = t0 + (t - t0) * span[0];
        const b = t0 + (t - t0) * span[1];
        let cand: { grade: Grade; dt: number } | null = null;
        if (b >= T - perfW && a <= T + perfW) cand = { grade: 'perfect', dt: clamp(T, a, b) - T };
        else if (a > T + perfW && a <= T + goodW) cand = { grade: 'good', dt: a - T };
        else if (b < T - perfW && b >= T - goodW) orb.earlyT = Math.max(orb.earlyT ?? -Infinity, b);
        if (cand && (!best || Math.abs(cand.dt) < Math.abs(best.dt))) best = { ...cand, hand: h };
      }
      if (best) this.judgeOrb(orb, best.grade, t, best.dt, best.hand);
      else if (orb.earlyT !== null && t > T - perfW) this.judgeOrb(orb, 'good', t, orb.earlyT - T);
    }
    this.orbs = this.orbs.filter((o) => o.note.id >= 0);

    // Walls: track best similarity inside the window.
    const judgeLegs = !this.stage.seated && body.lowerBodyVisible;
    for (const w of this.walls) {
      const sc = poseSimilarity(body.lm, body.aspect, POSES[w.note.pose as PoseId], judgeLegs);
      w.current = sc;
      if (t >= w.note.t - POSE.windowBeforeMs && t <= w.note.t + POSE.windowAfterMs) w.best = Math.max(w.best, sc.score);
    }

    // Dodges: is the required evasive state held inside the window?
    for (const d of this.dodges) {
      if (d.okAt !== null) continue;
      if (t < d.note.t - DODGE.windowBeforeMs * ws || t > d.note.t + DODGE.windowAfterMs * ws) continue;
      if (dodgeSatisfied(d.note.kind, body)) d.okAt = t;
    }

    this.prevBody = { t, lm: body.lm, hands: body.hands };
  }

  private judgeOrb(orb: ActiveOrb, grade: Grade, t: number, dt: number | undefined, hand?: Hand): void {
    const points = applyGrade(this.score, grade);
    this.difficulty.record(grade);
    const ev: GameEvent = { type: 'judge', what: 'orb', id: orb.note.id, grade, t, view: orb.view, points, combo: this.score.combo };
    if (dt !== undefined) ev.dt = dt;
    if (hand) ev.hand = hand;
    this.events.push(ev);
    orb.note = { ...orb.note, id: -1 }; // mark consumed; filtered by caller loop
  }

  /** Miss / finalize notes whose windows have closed. */
  private expire(now: number): void {
    const ws = this.windowScale;
    // A window is closed once input past it has been seen, or (no input) after a grace period.
    const closed = (end: number) => this.lastInputT > end || now > end + 700;

    for (const orb of this.orbs) {
      if (orb.note.id < 0 || !closed(orb.note.t + JUDGE.goodMs * ws)) continue;
      if (orb.earlyT !== null) this.judgeOrb(orb, 'good', now, orb.earlyT - orb.note.t);
      else this.judgeOrb(orb, 'miss', now, undefined);
    }
    this.orbs = this.orbs.filter((o) => o.note.id >= 0);

    const keepW: ActiveWall[] = [];
    for (const w of this.walls) {
      if (!closed(w.note.t + POSE.windowAfterMs)) {
        keepW.push(w);
        continue;
      }
      const off = this.difficulty.poseThresholdOffset - (ws > 1.2 ? 0.08 : 0);
      const grade: Grade = w.best >= POSE.perfectThreshold + off ? 'perfect' : w.best >= POSE.passThreshold + off ? 'good' : 'miss';
      const points = applyGrade(this.score, grade, 2);
      this.difficulty.record(grade);
      const view = { x: w.anchor.x, y: w.anchor.y + w.anchor.unit };
      this.events.push({ type: 'judge', what: 'wall', id: w.note.id, grade, t: now, view, points, combo: this.score.combo });
    }
    this.walls = keepW;

    const keepD: ActiveDodge[] = [];
    for (const d of this.dodges) {
      if (!closed(d.note.t + DODGE.windowAfterMs * ws)) {
        keepD.push(d);
        continue;
      }
      const grade: Grade = d.okAt === null ? 'miss' : d.okAt >= d.note.t - 150 * ws ? 'perfect' : 'good';
      const points = applyGrade(this.score, grade, 1.5);
      this.difficulty.record(grade);
      const view = { x: d.anchor.x, y: d.anchor.y };
      this.events.push({ type: 'judge', what: 'dodge', id: d.note.id, grade, t: now, view, points, combo: this.score.combo });
    }
    this.dodges = keepD;
  }

  get latestBody(): BodySnapshot | null {
    return this.body;
  }
}

export function dodgeSatisfied(kind: DodgeNote['kind'], b: BodySnapshot): boolean {
  const m = b.motion;
  switch (kind) {
    case 'jump':
      return m.jumping;
    case 'crouch':
      return m.crouching || m.ducking;
    case 'duck':
      return m.ducking || m.crouching;
    case 'leanL':
      return m.lean === -1;
    case 'leanR':
      return m.lean === 1;
  }
}

/**
 * Parametric interval [s0, s1] ⊆ [0, 1] of segment p0→p1 lying inside circle
 * (c, r), computed in the metric plane (x scaled by aspect). null = no contact.
 */
export function segmentCircleSpan(p0: Vec2, p1: Vec2, c: Vec2, r: number, aspect: number): [number, number] | null {
  const ax = (p0.x - c.x) * aspect;
  const ay = p0.y - c.y;
  const dx = (p1.x - p0.x) * aspect;
  const dy = p1.y - p0.y;
  const A = dx * dx + dy * dy;
  const C = ax * ax + ay * ay - r * r;
  if (A < 1e-12) return C <= 0 ? [0, 1] : null;
  const B = 2 * (ax * dx + ay * dy);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const s0 = Math.max(0, (-B - sq) / (2 * A));
  const s1 = Math.min(1, (-B + sq) / (2 * A));
  return s0 <= s1 ? [s0, s1] : null;
}
