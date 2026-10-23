import { describe, expect, it } from 'vitest';
import { checkSubmission, isValidName, jstDayStart, maxPlausibleScore, regionJa, SUBMISSION_KEYS, type ScoreSubmission } from '../../src/exhibit/scorePolicy';
import { newNonce, signRun, verifyRun } from '../../src/exhibit/runToken';
import { OnlineRanking } from '../../src/exhibit/online';

const good: ScoreSubmission = { token: 'x.1.hoshi.y', stage: 'hoshi', score: 12000, rank: 'A', name: 'タツヤ', maxCombo: 20, perfect: 30, good: 8, miss: 4, device: 'abc123def0' };

describe('shared ranking: submission policy', () => {
  it('accepts a normal play and only the allowed fields', () => {
    expect(checkSubmission(good)).toBeNull();
    expect(Object.keys(good).sort()).toEqual([...SUBMISSION_KEYS].sort());
    expect(checkSubmission({ ...good, landmarks: [[0, 0]] } as unknown as ScoreSubmission)).toMatch(/unexpected/);
  });

  it('rejects impossible scores, free-text names and unknown stages', () => {
    expect(checkSubmission({ ...good, score: maxPlausibleScore(30, 8) + 1 })).toBe('score');
    expect(checkSubmission({ ...good, name: '<script>' })).toBe('name');
    expect(checkSubmission({ ...good, name: 'ながすぎるなまえですよ' })).toBe('name');
    expect(checkSubmission({ ...good, name: 'ゲスト' })).toBe('name');
    expect(checkSubmission({ ...good, stage: 'nowhere' })).toBe('stage');
    expect(checkSubmission({ ...good, maxCombo: 99 })).toBe('combo');
    expect(checkSubmission({ ...good, rank: 'SSS' })).toBe('rank');
    expect(checkSubmission({ ...good, device: 'DROP TABLE' })).toBe('device');
  });

  it('typed names: kana, kanji and letters pass; bad words do not', () => {
    for (const n of ['タツヤ', 'たつや', '達也', 'Tatsu99', 'ミラー ズ']) expect(isValidName(n), n).toBe(true);
    for (const n of ['ばか', 'ﾊﾞｶ', 'FUCK', 'しねしね', '']) expect(isValidName(n), n).toBe(false);
  });

  it('maps Cloudflare regions to prefectures', () => {
    expect(regionJa('Tokyo', 'JP')).toBe('東京');
    expect(regionJa('Hyōgo', 'JP')).toBe('兵庫');
    expect(regionJa('Ōita Prefecture', 'JP')).toBe('大分');
    expect(regionJa(null, 'JP')).toBe('');
    expect(regionJa('California', 'US')).toBe('US');
  });

  it('the ranking day starts at midnight in Japan', () => {
    const t = Date.UTC(2026, 9, 22, 14, 59); // 23:59 JST
    expect(jstDayStart(t)).toBe(Date.UTC(2026, 9, 21, 15, 0));
    expect(jstDayStart(t + 60_000)).toBe(Date.UTC(2026, 9, 22, 15, 0));
  });
});

describe('shared ranking: play tokens', () => {
  it('a signed token verifies; a tampered one does not', async () => {
    const tok = await signRun('secret', { nonce: newNonce(), at: 1000, stage: 'yoi' });
    expect(await verifyRun('secret', tok)).toMatchObject({ at: 1000, stage: 'yoi' });
    expect(await verifyRun('other', tok)).toBeNull();
    expect(await verifyRun('secret', tok.replace('.yoi.', '.guren.'))).toBeNull();
    expect(await verifyRun('secret', 'nonsense')).toBeNull();
  });
});

describe('shared ranking: client', () => {
  it('is offline-tolerant: failures return null and never throw', async () => {
    const o = new OnlineRanking(true, async () => {
      throw new Error('network down');
    });
    expect(await o.startRun('yoi')).toBeNull();
    expect(await o.submit(good)).toBeNull();
    expect(await o.refresh('easy', 'today')).toBeNull();
    expect(o.online).toBe(false);
  });

  it('caches boards and only talks to /api on this origin', async () => {
    const urls: string[] = [];
    const o = new OnlineRanking(true, async (u) => {
      urls.push(u);
      return new Response(JSON.stringify({ list: [{ name: 'a', score: 1, rank: 'A', stage: 'yoi', stageName: 'ミラーレイク', region: '東京', at: 0 }], total: 1 }), { status: 200 });
    }, () => 1000);
    const b = await o.refresh('easy', 'today');
    await o.refresh('easy', 'today');
    expect(b?.list[0]?.region).toBe('東京');
    expect(urls).toEqual(['/api/scores?diff=easy&period=today&limit=10']);
  });

  it('disabled (flag off) makes no requests at all', async () => {
    let n = 0;
    const o = new OnlineRanking(false, async () => {
      n++;
      return new Response('{}');
    });
    await o.startRun('yoi');
    await o.refresh('easy', 'today');
    expect(n).toBe(0);
  });
});
