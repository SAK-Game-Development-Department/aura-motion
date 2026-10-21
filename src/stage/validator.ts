// Human-limit validation for generated stages (docs/decisions.md §stage-limits).
import { DODGE, HUMAN_LIMITS, JUDGE, POSE, STAGE } from '../config';
import type { Hand, Vec2 } from '../core/types';
import type { OrbNote, Stage } from './types';

export interface Violation {
  kind: 'handSpeed' | 'sameHand' | 'simultaneous' | 'poseTransition' | 'jumpInterval' | 'dodgeInterval' | 'crossType' | 'reach';
  id: number;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  playable: boolean;
  violations: Violation[];
}

/** Assign each orb to a hand ('any' → the hand that is closer / freer). */
export function assignHands(orbs: readonly OrbNote[]): Map<number, Hand> {
  const out = new Map<number, Hand>();
  const last: Record<Hand, { t: number; pos: Vec2 }> = {
    L: { t: -1e9, pos: { x: -1, y: 0.8 } },
    R: { t: -1e9, pos: { x: 1, y: 0.8 } },
  };
  const taken = new Map<number, Hand>(); // t -> hand used at that exact time
  for (const o of orbs) {
    let h: Hand;
    if (o.side !== 'any') h = o.side;
    else {
      const busy = taken.get(o.t);
      if (busy) h = busy === 'L' ? 'R' : 'L';
      else {
        const cost = (k: Hand) => Math.hypot(o.pos.x - last[k].pos.x, o.pos.y - last[k].pos.y) / Math.max(1, o.t - last[k].t);
        h = cost('L') <= cost('R') ? 'L' : 'R';
      }
    }
    taken.set(o.t, h);
    out.set(o.id, h);
    last[h] = { t: o.t, pos: o.pos };
  }
  return out;
}

/** Validate with every density tier active (worst case for the player). */
export function validateStage(s: Stage): ValidationResult {
  const v: Violation[] = [];
  const reach = s.seated ? STAGE.reachSeated : STAGE.reach;
  const hands = assignHands(s.orbs);
  const last: Partial<Record<Hand, OrbNote>> = {};
  const byTime = new Map<number, OrbNote[]>();

  for (const o of s.orbs) {
    if (o.pos.x < reach.xMin - 1e-6 || o.pos.x > reach.xMax + 1e-6 || o.pos.y < reach.yMin - 1e-6 || o.pos.y > reach.yMax + 1e-6) {
      v.push({ kind: 'reach', id: o.id, detail: `pos ${o.pos.x},${o.pos.y}` });
    }
    const h = hands.get(o.id)!;
    const prev = last[h];
    if (prev) {
      const dt = o.t - prev.t;
      const d = Math.hypot(o.pos.x - prev.pos.x, o.pos.y - prev.pos.y);
      if (dt < HUMAN_LIMITS.sameHandMinMs) v.push({ kind: 'sameHand', id: o.id, detail: `dt ${dt}` });
      // The hand only needs to reach the edge of the hit area.
      const travel = Math.max(0, d - (JUDGE.orbRadius + JUDGE.handRadius));
      if (dt > 0 && travel / (dt / 1000) > HUMAN_LIMITS.handSpeed) {
        v.push({ kind: 'handSpeed', id: o.id, detail: `${(travel / (dt / 1000)).toFixed(2)} u/s` });
      }
    }
    last[h] = o;
    const group = byTime.get(o.t) ?? [];
    group.push(o);
    byTime.set(o.t, group);
  }
  for (const group of byTime.values()) {
    if (group.length > HUMAN_LIMITS.maxSimultaneous) v.push({ kind: 'simultaneous', id: group[group.length - 1]!.id, detail: `${group.length} at once` });
    if (group.length === 2) {
      const [a, b] = group as [OrbNote, OrbNote];
      if (Math.abs(a.pos.x - b.pos.x) < HUMAN_LIMITS.simultaneousMinGap || hands.get(a.id) === hands.get(b.id)) {
        v.push({ kind: 'simultaneous', id: b.id, detail: 'pair too close / same hand' });
      }
    }
  }

  for (let i = 1; i < s.walls.length; i++) {
    const dt = s.walls[i]!.t - s.walls[i - 1]!.t;
    if (dt < HUMAN_LIMITS.poseTransitionMs) v.push({ kind: 'poseTransition', id: s.walls[i]!.id, detail: `dt ${dt}` });
  }
  let lastJump = -Infinity;
  for (let i = 0; i < s.dodges.length; i++) {
    const d = s.dodges[i]!;
    if (i > 0 && d.t - s.dodges[i - 1]!.t < HUMAN_LIMITS.dodgeIntervalMs) v.push({ kind: 'dodgeInterval', id: d.id, detail: `dt ${d.t - s.dodges[i - 1]!.t}` });
    if (d.kind === 'jump') {
      if (d.t - lastJump < HUMAN_LIMITS.jumpIntervalMs) v.push({ kind: 'jumpInterval', id: d.id, detail: `dt ${d.t - lastJump}` });
      lastJump = d.t;
    }
  }
  // Cross-type: orbs must not coincide with a wall or dodge arrival (body is busy).
  const busy = [
    ...s.walls.map((w) => ({ t: w.t, before: POSE.windowBeforeMs + 300, after: POSE.windowAfterMs + 250 })),
    ...s.dodges.map((d) => ({ t: d.t, before: DODGE.windowBeforeMs + 250, after: DODGE.windowAfterMs + 250 })),
  ];
  for (const o of s.orbs) {
    for (const b of busy) {
      if (o.t > b.t - b.before && o.t < b.t + b.after) {
        v.push({ kind: 'crossType', id: o.id, detail: `near ${b.t}` });
        break;
      }
    }
  }
  for (const w of s.walls) {
    for (const d of s.dodges) {
      if (Math.abs(w.t - d.t) < HUMAN_LIMITS.poseTransitionMs) v.push({ kind: 'crossType', id: d.id, detail: `wall ${w.t}` });
    }
  }

  const minOrbs = Math.floor((s.durationMs / 1000) * 0.35);
  const playable = s.orbs.length >= minOrbs;
  return { ok: v.length === 0, playable, violations: v };
}

/** Remove violating notes until the stage validates. */
export function repairStage(stage: Stage): Stage {
  let s = stage;
  for (let pass = 0; pass < 20; pass++) {
    const r = validateStage(s);
    if (r.ok) return s;
    const bad = new Set(r.violations.map((x) => x.id));
    s = {
      ...s,
      orbs: s.orbs.filter((o) => !bad.has(o.id)),
      walls: s.walls.filter((w) => !bad.has(w.id)),
      dodges: s.dodges.filter((d) => !bad.has(d.id)),
      repairs: s.repairs + bad.size,
    };
  }
  return s;
}
