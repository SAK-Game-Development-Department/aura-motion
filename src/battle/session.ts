// BattleSession: deterministic battle logic. Depends only on the stage, the
// GestureEvent stream (pushEvent, with times already mapped to game time and
// latency-corrected) and update(now).
import { JUDGE } from '../config';
import type { GestureEvent } from '../gesture/engine';
import { Difficulty } from '../game/difficulty';
import { applyGrade, newScore, type Grade, type ScoreState } from '../game/score';
import { Rng } from '../core/rng';
import type { BattleStage, Enemy, SectionKind, Step } from './stage';
import { effectiveReq, matches, TECH, TECHNIQUES, type Req, type Technique } from './techniques';

export interface ActiveEnemy {
  e: Enemy;
  /** Index of the next step to perform. */
  step: number;
  state: 'alive' | 'dead' | 'gone';
  /** Time of death / departure (for fade-outs). */
  endT: number;
  /** Steps hit so far (for the boss chain). */
  hits: number;
  /** Hurt flash (a step was missed). */
  lastMissT: number;
}

export type BattleEvent =
  | { type: 'section'; t: number; kind: SectionKind }
  | { type: 'cast'; t: number; tech: Technique | null; hand: number; matched: boolean; ev: GestureEvent }
  | { type: 'hit'; t: number; enemy: number; tech: Technique; grade: Grade; kill: boolean; points: number; combo: number; hand: number; dt: number; boss: boolean }
  | { type: 'miss'; t: number; enemy: number; tech: Technique }
  | { type: 'hurt'; t: number; enemy: number }
  | { type: 'blocked'; t: number; enemy: number }
  | { type: 'ultimate'; t: number; enemy: number; chain: number; hidden: boolean }
  | { type: 'hiddenBoss'; t: number; enemy: number }
  | { type: 'remnant'; t: number }
  | { type: 'tutorialSkip'; t: number; enemy: number }
  | { type: 'end'; t: number };

export interface BattleOptions {
  stage: BattleStage;
  /** Spawn the hidden boss / remnant waves when the boss falls early (no dead time). */
  hidden?: boolean;
  dda: boolean;
  oneHand: boolean;
  twoHandOk: boolean;
  windowScale?: () => number;
}

/** Minimum time left after the boss for the hidden boss to appear (ms). */
export const HIDDEN_MIN_MS = 9000;

/** How early (ms) before a step's time a matching cast still counts (Good). */
const EARLY_MS = 900;

export class BattleSession {
  readonly stage: BattleStage;
  readonly score: ScoreState = newScore();
  readonly difficulty: Difficulty;
  enemies: ActiveEnemy[] = [];
  section: SectionKind | null = null;
  ended = false;
  now = 0;
  kills = 0;
  ultimates = 0;
  hurts = 0;
  /** Hidden boss state: when it appeared, and the remnant wave clock. */
  hiddenAt: number | null = null;
  private remnantNext: number | null = null;
  private dynId = 10_000;
  private ei = 0;
  private si = -1;
  private queue: Array<{ t: number; ev: GestureEvent }> = [];
  private events: BattleEvent[] = [];

  constructor(private o: BattleOptions) {
    this.stage = o.stage;
    this.difficulty = new Difficulty(o.dda);
  }

  get windowScale(): number {
    return (this.o.windowScale?.() ?? 1) * this.difficulty.windowScale;
  }

  /** The requirement the player must perform for a technique (one-hand alternatives applied). */
  req(techId: string): Req {
    return effectiveReq(TECH[techId]!, this.o.oneHand, this.o.twoHandOk);
  }

  pushEvent(tGame: number, ev: GestureEvent): void {
    if (ev.type === 'cast' || ev.type === 'seal') this.queue.push({ t: tGame, ev });
  }

  update(now: number): BattleEvent[] {
    this.events = [];
    if (this.ended) return this.events;
    this.queue.sort((a, b) => a.t - b.t);
    for (const q of this.queue) {
      this.spawn(Math.max(this.now, Math.min(now, q.t)));
      this.onCast(q.t, q.ev);
    }
    this.queue.length = 0;
    this.now = now;
    this.spawn(now);
    this.spawnRemnants(now);
    this.expire(now);
    if (now >= this.stage.durationMs) {
      this.ended = true;
      this.events.push({ type: 'end', t: now });
    }
    return this.events;
  }

  private spawn(now: number): void {
    const st = this.stage;
    while (this.si + 1 < st.sections.length && st.sections[this.si + 1]!.start <= now) {
      this.si++;
      this.section = st.sections[this.si]!.kind;
      this.events.push({ type: 'section', t: now, kind: this.section });
    }
    while (this.ei < st.enemies.length && st.enemies[this.ei]!.spawn <= now) {
      const e = st.enemies[this.ei++]!;
      if (e.tier > 0 && !this.difficulty.tierActive(1)) continue;
      this.enemies.push({ e, step: 0, state: 'alive', endT: 0, hits: 0, lastMissT: -1e9 });
    }
  }

  /** Identify which technique a gesture event performs (for visuals, even if nothing is hit). */
  identify(ev: GestureEvent): Technique | null {
    // Most specific first: seals/spread/sigils, motions, then shapes.
    const order = ['seal', 'spread', 'sigil', 'motion', 'shape'];
    for (const k of order) {
      for (const t of TECHNIQUES) {
        if (t.req.kind !== k) continue;
        if (matches(t.req, ev)) return t;
      }
    }
    return null;
  }

  private onCast(t: number, ev: GestureEvent): void {
    const ws = this.windowScale;
    const goodW = JUDGE.goodMs * ws;
    const perfW = JUDGE.perfectMs * ws;
    const hand = ev.type === 'cast' ? ev.hand : -1;
    // Candidate enemies whose current step this event satisfies, within the timing window.
    let best: { a: ActiveEnemy; dt: number } | null = null;
    for (const a of this.enemies) {
      if (a.state !== 'alive') continue;
      const step = a.e.steps[a.step];
      if (!step) continue;
      if (!matches(this.req(step.tech), ev)) continue;
      let dt: number;
      if (step.t === null) {
        if (t < a.e.arrive - 300) continue; // tutorial: once it has arrived
        dt = 0;
      } else {
        dt = t - step.t;
        if (dt < -EARLY_MS * ws || dt > goodW) continue;
      }
      if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { a, dt };
    }
    const asTech = this.identify(ev);
    if (!best) {
      this.events.push({ type: 'cast', t, tech: asTech, hand, matched: false, ev });
      return;
    }
    const a = best.a;
    const step = a.e.steps[a.step]!;
    const tech = TECH[step.tech]!;
    this.events.push({ type: 'cast', t, tech, hand, matched: true, ev });
    const grade: Grade = step.t === null || Math.abs(best.dt) <= perfW ? 'perfect' : 'good';
    if (tech.id === 'heki') {
      this.events.push({ type: 'blocked', t, enemy: a.e.id });
    }
    this.resolveStep(a, t, grade, best.dt, hand);
  }

  private resolveStep(a: ActiveEnemy, t: number, grade: Grade, dt: number, hand: number): void {
    const step = a.e.steps[a.step]!;
    const tech = TECH[step.tech]!;
    const boss = a.e.kind === 'lord';
    const weight = boss ? 2 : a.e.kind === 'breaker' ? 1.6 : a.e.kind === 'warden' ? 1.2 : 1;
    const points = grade === 'miss' ? 0 : applyGrade(this.score, grade, weight);
    if (grade === 'miss') applyGrade(this.score, 'miss');
    this.difficulty.record(grade);
    if (grade !== 'miss') a.hits++;
    a.step++;
    const kill = a.step >= a.e.steps.length;
    if (grade !== 'miss') this.events.push({ type: 'hit', t, enemy: a.e.id, tech, grade, kill: kill && (a.hits > 0 || !boss), points, combo: this.score.combo, hand, dt, boss });
    if (kill) {
      a.state = a.hits > 0 ? 'dead' : 'gone';
      a.endT = t;
      if (a.state === 'dead') this.kills++;
      if (boss && a.hits >= Math.min(3, a.e.steps.length)) {
        this.ultimates++;
        this.score.score += 3000;
        this.events.push({ type: 'ultimate', t, enemy: a.e.id, chain: a.hits, hidden: false });
      }
      if (a.e.kind === 'eclipse' && a.hits >= Math.ceil(a.e.steps.length * 0.6)) {
        this.ultimates++;
        this.score.score += 5000;
        this.events.push({ type: 'ultimate', t, enemy: a.e.id, chain: a.hits, hidden: true });
      }
      if ((boss || a.e.kind === 'eclipse') && this.o.hidden !== false) this.afterBoss(t, a.e.kind === 'eclipse', a.state === 'dead');
    }
  }

  /**
   * The boss fell: if there is enough time left, the hidden boss appears;
   * after it (or if time is short) remnant spirits keep coming to the end.
   */
  private afterBoss(t: number, wasHidden: boolean, defeated: boolean): void {
    const left = this.stage.durationMs - t;
    // The hidden boss only answers to a *defeated* Night Lord.
    if (!wasHidden && defeated && left >= HIDDEN_MIN_MS && this.hiddenAt === null) {
      this.spawnHidden(t);
      return;
    }
    if (left >= 2500) this.remnantNext = t + 1800;
  }

  private spawnHidden(t: number): void {
    const rng = new Rng((this.stage.seed ^ 0x5eed) >>> 0);
    const pool = this.stage.pool;
    const pick = (ids: string[]) => (ids.length ? rng.pick(ids) : 'saiko');
    const steps: Step[] = [];
    const arrive = t + 3200; // entrance cinematic first
    let at = arrive;
    const room = this.stage.durationMs - 600;
    // Phase 1: a quick flurry; phase 2: seals; phase 3: a drawn sigil.
    const plan: string[] = [pick(pool.singles), pick(pool.singles), pick(pool.singles), ...(pool.seals.length ? [pick(pool.seals), pick(pool.seals)] : [pick(pool.singles)]), pool.sigils.length ? pick(pool.sigils) : pick(pool.singles)];
    for (const id of plan) {
      const busy = TECH[id]!.busyMs;
      if (steps.length) at += Math.max(busy + 500, 1500);
      if (at > room) break;
      steps.push({ tech: id, t: Math.round(at) });
    }
    if (!steps.length) {
      this.remnantNext = t + 1800;
      return;
    }
    const e: Enemy = { id: this.dynId++, kind: 'eclipse', spawn: t + 800, arrive, deadline: Infinity, x: 0.5, y: 0.32, steps, tutorial: false, tier: 0 };
    this.enemies.push({ e, step: 0, state: 'alive', endT: 0, hits: 0, lastMissT: -1e9 });
    this.hiddenAt = t;
    this.section = 'hidden';
    this.events.push({ type: 'hiddenBoss', t, enemy: e.id });
    this.events.push({ type: 'section', t, kind: 'hidden' });
  }

  private spawnRemnants(now: number): void {
    if (this.remnantNext === null || now < this.remnantNext) return;
    const left = this.stage.durationMs - now;
    if (left < 2400 + 600) {
      this.remnantNext = null;
      return;
    }
    const rng = new Rng((this.stage.seed ^ Math.floor(now)) >>> 0);
    const tech = this.stage.pool.singles.length ? rng.pick(this.stage.pool.singles) : 'saiko';
    const arrive = Math.round(now + 2000);
    const e: Enemy = { id: this.dynId++, kind: 'wisp', spawn: now, arrive, deadline: Infinity, x: 0.25 + rng.next() * 0.5, y: 0.3 + rng.next() * 0.12, steps: [{ tech, t: arrive }], tutorial: false, tier: 0 };
    this.enemies.push({ e, step: 0, state: 'alive', endT: 0, hits: 0, lastMissT: -1e9 });
    if (this.remnantNext === now || this.events.every((x) => x.type !== 'remnant')) this.events.push({ type: 'remnant', t: now });
    this.remnantNext = now + Math.max(TECH[tech]!.busyMs, 1500);
  }

  private expire(now: number): void {
    const ws = this.windowScale;
    for (const a of this.enemies) {
      if (a.state !== 'alive') continue;
      const step = a.e.steps[a.step];
      if (!step) continue;
      if (step.t === null) {
        if (now > a.e.deadline) {
          a.state = 'gone';
          a.endT = now;
          this.events.push({ type: 'tutorialSkip', t: now, enemy: a.e.id });
        }
        continue;
      }
      if (now <= step.t + JUDGE.goodMs * ws + 120) continue;
      const tech = TECH[step.tech]!;
      this.events.push({ type: 'miss', t: now, enemy: a.e.id, tech });
      a.lastMissT = now;
      // A missed block or an escaping spirit hurts the player (combo break).
      if (tech.id === 'heki' || a.e.kind === 'wisp') {
        this.hurts++;
        this.events.push({ type: 'hurt', t: now, enemy: a.e.id });
      }
      this.resolveStep(a, now, 'miss', 0, -1);
    }
    this.enemies = this.enemies.filter((a) => a.state === 'alive' || now - a.endT < 1500);
  }
}
