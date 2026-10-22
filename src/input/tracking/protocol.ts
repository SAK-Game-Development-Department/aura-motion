// Messages between the main thread and the tracking core (worker or inline).
import type { Landmark } from '../../core/types';

export interface TrackerInit {
  type: 'init';
  numHands: number;
  /** Absolute base URL of the app (worker needs absolute URLs). */
  baseUrl: string;
  segmentation: boolean;
  delegate: 'GPU' | 'CPU';
  fieldW: number;
  fieldH: number;
  minHandDetectionConfidence: number;
  minHandPresenceConfidence: number;
  minTrackingConfidence: number;
}

export interface TrackerFrame {
  type: 'frame';
  id: number;
  /** Capture time (performance clock of the main thread, ms). */
  t: number;
  bitmap: ImageBitmap;
  /** Run segmentation this frame (quality governor may skip). */
  segment: boolean;
}

export type TrackerIn = TrackerInit | TrackerFrame | { type: 'reset' } | { type: 'dispose' };

export interface TrackerResult {
  type: 'result';
  id: number;
  t: number;
  /** Time spent in inference (ms, worker clock delta). */
  inferMs: number;
  segMs: number;
  fieldMs: number;
  hands: Array<{ lm: Landmark[]; score: number }>;
  luma: number;
  field: Uint8Array | null;
  fieldW: number;
  fieldH: number;
}

export type TrackerOut =
  | { type: 'progress'; stage: string; loaded: number; total: number }
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; segmentation: boolean }
  | TrackerResult
  | { type: 'error'; message: string; fatal: boolean };
