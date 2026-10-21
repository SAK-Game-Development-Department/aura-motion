// Pose wall templates. Angles use the skeleton convention: 0° = down,
// +90° = screen-right, ±180° = up. "L" = the player's left arm (screen-left).
import type { LimbAngles } from '../input/skeleton';

export type PoseId = 'T' | 'Y' | 'I' | 'goal' | 'Lleft' | 'Lright' | 'diag' | 'diag2' | 'star' | 'wing';

export interface PoseTemplate {
  id: PoseId;
  armL: LimbAngles;
  armR: LimbAngles;
  /** Leg targets; omitted = legs are not judged. */
  legL?: LimbAngles;
  legR?: LimbAngles;
  /** Can be done while seated (upper body only). */
  seatedOk: boolean;
}

export const POSES: Record<PoseId, PoseTemplate> = {
  T: { id: 'T', armL: { upper: -90, lower: -90 }, armR: { upper: 90, lower: 90 }, seatedOk: true },
  Y: { id: 'Y', armL: { upper: -140, lower: -145 }, armR: { upper: 140, lower: 145 }, seatedOk: true },
  I: { id: 'I', armL: { upper: -168, lower: -175 }, armR: { upper: 168, lower: 175 }, seatedOk: true },
  goal: { id: 'goal', armL: { upper: -90, lower: -178 }, armR: { upper: 90, lower: 178 }, seatedOk: true },
  Lleft: { id: 'Lleft', armL: { upper: -90, lower: -90 }, armR: { upper: 170, lower: 176 }, seatedOk: true },
  Lright: { id: 'Lright', armL: { upper: -170, lower: -176 }, armR: { upper: 90, lower: 90 }, seatedOk: true },
  diag: { id: 'diag', armL: { upper: -40, lower: -40 }, armR: { upper: 135, lower: 135 }, seatedOk: true },
  diag2: { id: 'diag2', armL: { upper: -135, lower: -135 }, armR: { upper: 40, lower: 40 }, seatedOk: true },
  star: {
    id: 'star',
    armL: { upper: -130, lower: -130 },
    armR: { upper: 130, lower: 130 },
    legL: { upper: -24, lower: -24 },
    legR: { upper: 24, lower: 24 },
    seatedOk: false,
  },
  wing: { id: 'wing', armL: { upper: -60, lower: -100 }, armR: { upper: 60, lower: 100 }, seatedOk: true },
};

export const POSE_IDS = Object.keys(POSES) as PoseId[];

/** Angular distance between two pose templates (mean over arm segments, degrees). */
export function poseDistance(a: PoseTemplate, b: PoseTemplate): number {
  const d = (x: number, y: number) => {
    let r = Math.abs(x - y) % 360;
    if (r > 180) r = 360 - r;
    return r;
  };
  return (d(a.armL.upper, b.armL.upper) + d(a.armL.lower, b.armL.lower) + d(a.armR.upper, b.armR.upper) + d(a.armR.lower, b.armR.lower)) / 4;
}
