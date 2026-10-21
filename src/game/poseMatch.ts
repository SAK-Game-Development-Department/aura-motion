// Pose similarity from limb direction angles (scale/position invariant).
import { LM, type Landmark } from '../core/types';
import { angleFromDir, type LimbAngles } from '../input/skeleton';
import type { PoseTemplate } from '../stage/poses';

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function segAngle(lm: Landmark[], a: number, b: number, aspect: number): number | null {
  const p = lm[a];
  const q = lm[b];
  if (!p || !q || p.v < 0.3 || q.v < 0.3) return null;
  return angleFromDir((q.x - p.x) * aspect, q.y - p.y);
}

export interface PoseScore {
  score: number;
  /** Per-segment scores (for visual feedback: which limb is off). */
  parts: { seg: string; score: number }[];
}

/** Score 0..1. 0° error → 1, ≥ 75° error → 0. */
export function poseSimilarity(lm: Landmark[], aspect: number, tpl: PoseTemplate, judgeLegs: boolean): PoseScore {
  const segs: Array<{ seg: string; a: number; b: number; target: number; w: number }> = [];
  const add = (seg: string, a: number, b: number, target: number, w: number) => segs.push({ seg, a, b, target, w });
  const arm = (side: 'L' | 'R', t: LimbAngles) => {
    const s = side === 'L' ? LM.leftShoulder : LM.rightShoulder;
    const e = side === 'L' ? LM.leftElbow : LM.rightElbow;
    const w = side === 'L' ? LM.leftWrist : LM.rightWrist;
    add(`upper${side}`, s, e, t.upper, 1.2);
    add(`lower${side}`, e, w, t.lower, 1.0);
  };
  arm('L', tpl.armL);
  arm('R', tpl.armR);
  if (judgeLegs && tpl.legL && tpl.legR) {
    add('thighL', LM.leftHip, LM.leftKnee, tpl.legL.upper, 0.6);
    add('shinL', LM.leftKnee, LM.leftAnkle, tpl.legL.lower, 0.4);
    add('thighR', LM.rightHip, LM.rightKnee, tpl.legR.upper, 0.6);
    add('shinR', LM.rightKnee, LM.rightAnkle, tpl.legR.lower, 0.4);
  }
  let sum = 0;
  let wsum = 0;
  const parts: PoseScore['parts'] = [];
  for (const s of segs) {
    const ang = segAngle(lm, s.a, s.b, aspect);
    const sc = ang === null ? 0 : Math.max(0, 1 - angDiff(ang, s.target) / 75);
    parts.push({ seg: s.seg, score: sc });
    sum += sc * s.w;
    wsum += s.w;
  }
  return { score: wsum > 0 ? sum / wsum : 0, parts };
}
