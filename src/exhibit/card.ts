// Tier 2: take-home result card. The QR encodes a URL to the static card page
// with the result in the URL *fragment* (never sent to any server). Score,
// rank, combo, nickname and date only — no images, no personal data.
export interface CardData {
  score: number;
  rank: string;
  combo: number;
  name: string;
  date: string; // YYYY-MM-DD
}

export function cardUrl(base: string, d: CardData): string {
  const p = new URLSearchParams({ v: '1', s: String(d.score), r: d.rank, c: String(d.combo), n: d.name, d: d.date });
  return `${new URL('card.html', base).href}#${p.toString()}`;
}

export function parseCard(hash: string): CardData | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (p.get('v') !== '1') return null;
  const score = Number(p.get('s'));
  const combo = Number(p.get('c'));
  const rank = p.get('r') ?? '';
  if (!Number.isFinite(score) || score < 0 || score > 10_000_000 || !/^[SABC]$/.test(rank)) return null;
  return {
    score: Math.floor(score),
    rank,
    combo: Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0,
    name: (p.get('n') ?? '').slice(0, 24),
    date: /^\d{4}-\d{2}-\d{2}$/.test(p.get('d') ?? '') ? p.get('d')! : '',
  };
}

/** The card QR only makes sense when served from a public https origin. */
export function qrAvailable(loc: { protocol: string; hostname: string }): boolean {
  return loc.protocol === 'https:' && loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1';
}
