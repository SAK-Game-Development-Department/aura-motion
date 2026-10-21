import { describe, expect, it } from 'vitest';
import { cardUrl, parseCard, qrAvailable } from '../../src/exhibit/card';

describe('result card', () => {
  const d = { score: 12345, rank: 'A', combo: 42, name: 'きらめくホタル', date: '2026-11-03' };
  it('round-trips through the URL fragment (never the query)', () => {
    const url = cardUrl('https://aura.example.pages.dev/', d);
    const u = new URL(url);
    expect(u.pathname).toBe('/card.html');
    expect(u.search).toBe('');
    expect(parseCard(u.hash)).toEqual(d);
  });
  it('rejects garbage and clamps fields', () => {
    expect(parseCard('#v=2&s=1&r=A')).toBeNull();
    expect(parseCard('#v=1&s=abc&r=A')).toBeNull();
    expect(parseCard('#v=1&s=10&r=Z')).toBeNull();
    const p = parseCard('#v=1&s=10&r=S&c=-5&n=' + 'x'.repeat(100) + '&d=nope')!;
    expect(p.combo).toBe(0);
    expect(p.name.length).toBe(24);
    expect(p.date).toBe('');
  });
  it('QR only on a public https origin', () => {
    expect(qrAvailable({ protocol: 'https:', hostname: 'aura.pages.dev' })).toBe(true);
    expect(qrAvailable({ protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(qrAvailable({ protocol: 'https:', hostname: 'localhost' })).toBe(false);
  });
});
