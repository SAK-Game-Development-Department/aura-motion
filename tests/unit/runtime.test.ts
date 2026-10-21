import { describe, expect, it } from 'vitest';
import { readRuntime } from '../../src/config/runtime';
import { hexToLinear, PALETTE } from '../../src/config/palette';
import { CSP, SECURITY_HEADERS } from '../../src/config/headers';
import { EXHIBIT, STAGE } from '../../src/config';

describe('runtime options', () => {
  it('defaults to the exhibition setup', () => {
    const r = readRuntime('');
    expect(r.source).toBe('camera');
    expect(r.flags.particles).toBe(true);
    expect(r.stageMs).toBe(STAGE.durationMs);
    expect(r.absentReturnMs).toBe(EXHIBIT.absentReturnMs);
    expect(r.dev).toBe(false);
  });
  it('parses dev/test options and rejects unknown sources', () => {
    const r = readRuntime('?source=autoplay&fast=1&flags=-wall&seed=42&webgl=1&quality=9&particles=1000&vt=1');
    expect(r.source).toBe('autoplay');
    expect(r.fast && r.dev).toBe(true);
    expect(r.flags.wall).toBe(false);
    expect(r.seed).toBe(42);
    expect(r.forceWebGL).toBe(true);
    expect(r.quality).toBe(5);
    expect(r.particles).toBe(1000);
    expect(r.virtualTime).toBe(true);
    expect(readRuntime('?source=evil').source).toBe('camera');
  });
});

describe('palette', () => {
  it('converts sRGB to linear (dark colours get darker)', () => {
    const [r, g, b] = hexToLinear(PALETTE.void);
    expect(r).toBeLessThan(0.003);
    expect(b).toBeLessThan(0.01);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(g).toBeGreaterThanOrEqual(0);
  });
});

describe('security headers', () => {
  it('CSP forbids external connections and remote scripts', () => {
    expect(CSP).toContain("connect-src 'self'");
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).not.toMatch(/https?:\/\//);
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('microphone=()');
  });
});
