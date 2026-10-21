import type { Side, Vec2 } from '../core/types';
import type { PoseId } from './poses';

export type SectionKind = 'intro' | 'flow' | 'wall' | 'dodge' | 'finale';

export interface Section {
  kind: SectionKind;
  start: number;
  end: number;
}

/** Orb to touch. `pos` is in body units relative to the player's anchor. */
export interface OrbNote {
  id: number;
  t: number;
  pos: Vec2;
  side: Side;
  /** Density tier: 0 always active; 1/2 only at higher dynamic difficulty. */
  tier: 0 | 1 | 2;
}

export interface WallNote {
  id: number;
  t: number;
  pose: PoseId;
}

export type DodgeKind = 'jump' | 'crouch' | 'leanL' | 'leanR' | 'duck';

export interface DodgeNote {
  id: number;
  t: number;
  kind: DodgeKind;
}

export interface FlowPhase {
  id: number;
  start: number;
  end: number;
  /** Emitter / goal in body units relative to the anchor at phase start. */
  emitter: Vec2;
  emitDir: Vec2;
  goal: Vec2;
}

export interface Stage {
  seed: number;
  seated: boolean;
  bpm: number;
  beatMs: number;
  durationMs: number;
  sections: Section[];
  orbs: OrbNote[];
  walls: WallNote[];
  dodges: DodgeNote[];
  flows: FlowPhase[];
  /** Number of notes removed by the repair pass. */
  repairs: number;
}

export interface StageOptions {
  seed: number;
  seated: boolean;
  flow: boolean;
  wall: boolean;
  dodge: boolean;
  structure: boolean;
  durationMs?: number;
}
