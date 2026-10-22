import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, sanitize, saveSettings } from '../../src/exhibit/settings';
import { SETTINGS } from '../../src/config';

describe('staff settings', () => {
  it('defaults are a little darker than full brightness', () => {
    const d = defaultSettings();
    expect(d.brightness).toBeLessThan(1);
    expect(d.glow).toBeLessThan(1);
    expect(d.effects).toBeLessThan(1);
  });

  it('out-of-range, wrong-type and unknown values fall back safely', () => {
    const s = sanitize({ brightness: 9, glow: -1, background: 'x', effects: NaN, particles: 'ultra', techLens: 'on', lens: 'yes', evil: 1 });
    expect(s.brightness).toBe(SETTINGS.ranges.brightness[1]);
    expect(s.glow).toBe(0);
    expect(s.background).toBe(SETTINGS.defaults.background);
    expect(s.effects).toBe(SETTINGS.defaults.effects);
    expect(s.particles).toBe('auto');
    expect(s.techLens).toBe('on');
    expect(s.lens).toBe(true);
    expect('evil' in s).toBe(false);
  });

  it('round-trips through storage; broken storage gives the defaults', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveSettings({ ...defaultSettings(), brightness: 0.6, particles: 'low' }, st);
    expect(loadSettings(st)).toMatchObject({ brightness: 0.6, particles: 'low' });
    expect(loadSettings({ getItem: () => '{not json' })).toEqual(defaultSettings());
  });
});
