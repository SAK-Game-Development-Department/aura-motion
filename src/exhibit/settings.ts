// Staff settings: picture brightness, glow, effects, particles, features.
// Saved per browser (localStorage); invalid or missing values fall back to
// the defaults in src/config/exhibit.ts (SETTINGS).
import { SETTINGS } from '../config';

export type Settings = {
  brightness: number;
  glow: number;
  background: number;
  effects: number;
  lens: boolean;
  particles: 'auto' | 'low' | 'mid' | 'high';
  techLens: 'auto' | 'on' | 'off';
  sealAssist: boolean;
  online: boolean;
  sound: boolean;
  sfxVolume: number;
  ambientVolume: number;
};

const KEY = 'aura.settings.v1';

export function defaultSettings(): Settings {
  return { ...SETTINGS.defaults };
}

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validate any object into Settings (unknown keys dropped, ranges enforced). */
export function sanitize(raw: unknown): Settings {
  const d = defaultSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const R = SETTINGS.ranges;
  return {
    brightness: clamp(r.brightness, R.brightness, d.brightness),
    glow: clamp(r.glow, R.glow, d.glow),
    background: clamp(r.background, R.background, d.background),
    effects: clamp(r.effects, R.effects, d.effects),
    lens: bool(r.lens, d.lens),
    particles: oneOf(r.particles, ['auto', 'low', 'mid', 'high'] as const, d.particles),
    techLens: oneOf(r.techLens, ['auto', 'on', 'off'] as const, d.techLens),
    sealAssist: bool(r.sealAssist, d.sealAssist),
    online: bool(r.online, d.online),
    sound: bool(r.sound, d.sound),
    sfxVolume: clamp(r.sfxVolume, R.sfxVolume, d.sfxVolume),
    ambientVolume: clamp(r.ambientVolume, R.ambientVolume, d.ambientVolume),
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* blocked storage: settings just won't persist */
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
