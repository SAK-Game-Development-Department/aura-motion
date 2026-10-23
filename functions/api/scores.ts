// Shared ranking (Cloudflare D1).
//   GET  /api/scores?diff=normal&period=today|all&limit=10 → { list, total }
//   POST /api/scores  (ScoreSubmission)                    → { placeAll, placeToday, total }
// One row per (difficulty, player name): a better score overwrites the old one.
// Stored: score, breakdown, the typed name, stage, booth id and the coarse
// region Cloudflare already knows (prefecture). No IP address, no images, no landmarks.
import { STAGES, type StageId } from '../../src/battle/stages';
import { RUN_MAX_AGE_MS, RUN_MIN_AGE_MS, verifyRun } from '../../src/exhibit/runToken';
import { checkSubmission, diffOfStage, DIFFS, jstDayStart, regionJa, type OnlineEntry, type ScoreSubmission } from '../../src/exhibit/scorePolicy';
import { nameKey } from '../../src/exhibit/playerName';

interface D1Result<T> {
  results: T[];
}
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1 {
  prepare(sql: string): D1Stmt;
}
interface Env {
  DB: D1;
  RUN_SECRET?: string;
}
type Ctx = { request: Request & { cf?: { region?: string; country?: string } }; env: Env };

const json = (v: unknown, status = 200, cache = 'no-store') => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });

interface Row {
  name: string;
  score: number;
  rank: string;
  stage: string;
  region: string | null;
  at: number;
}

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const q = new URL(request.url).searchParams;
  const diff = q.get('diff') ?? 'normal';
  if (!(DIFFS as readonly string[]).includes(diff)) return json({ error: 'diff' }, 400);
  const today = q.get('period') !== 'all';
  const limit = Math.max(1, Math.min(50, Number(q.get('limit') ?? 10) || 10));
  const since = today ? jstDayStart(Date.now()) : 0;
  const rows = await env.DB.prepare('SELECT name, score, rank, stage, region, at FROM scores WHERE diff = ? AND at >= ? ORDER BY score DESC, at ASC LIMIT ?').bind(diff, since, limit).all<Row>();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE diff = ? AND at >= ?').bind(diff, since).first<{ n: number }>();
  const list: OnlineEntry[] = rows.results.map((r) => ({ ...r, region: r.region ?? '', stageName: STAGES[r.stage as StageId]?.name ?? '' }));
  return json({ list, total: total?.n ?? 0 }, 200, 'public, max-age=10');
};

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  if (!env.RUN_SECRET) return json({ error: 'ranking disabled' }, 503);
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > 2000) return json({ error: 'too large' }, 413);
  let s: ScoreSubmission;
  try {
    s = (await request.json()) as ScoreSubmission;
  } catch {
    return json({ error: 'json' }, 400);
  }
  const bad = checkSubmission(s);
  if (bad) return json({ error: bad }, 400);
  const claims = await verifyRun(env.RUN_SECRET, s.token);
  const now = Date.now();
  if (!claims || claims.stage !== s.stage) return json({ error: 'token' }, 403);
  const age = now - claims.at;
  if (age < RUN_MIN_AGE_MS || age > RUN_MAX_AGE_MS) return json({ error: 'token age' }, 403);
  // Single use: the nonce can be redeemed once.
  try {
    await env.DB.prepare('INSERT INTO runs (nonce, at) VALUES (?, ?)').bind(claims.nonce, now).run();
  } catch {
    return json({ error: 'token used' }, 409);
  }
  const diff = diffOfStage(s.stage);
  const region = regionJa(request.cf?.region, request.cf?.country);
  // One row per name and difficulty: a better score overwrites, a lower one is not stored.
  const key = nameKey(s.name);
  const prev = await env.DB.prepare('SELECT id, score, at FROM scores WHERE diff = ? AND name_key = ?').bind(diff, key).first<{ id: number; score: number; at: number }>();
  let updated = false;
  if (!prev) {
    await env.DB.prepare('INSERT INTO scores (diff, stage, score, rank, name, name_key, max_combo, region, device, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(diff, s.stage, s.score, s.rank, s.name, key, s.maxCombo, region, s.device, now)
      .run();
    updated = true;
  } else if (s.score > prev.score) {
    await env.DB.prepare('UPDATE scores SET stage = ?, score = ?, rank = ?, name = ?, max_combo = ?, region = ?, device = ?, at = ? WHERE id = ?')
      .bind(s.stage, s.score, s.rank, s.name, s.maxCombo, region, s.device, now, prev.id)
      .run();
    updated = true;
  }
  const best = updated ? s.score : prev!.score;
  const bestAt = updated ? now : prev!.at;
  const today = jstDayStart(now);
  const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE diff = ? AND score > ?').bind(diff, best).first<{ n: number }>();
  const aboveToday = bestAt >= today ? await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE diff = ? AND score > ? AND at >= ?').bind(diff, best, today).first<{ n: number }>() : null;
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE diff = ?').bind(diff).first<{ n: number }>();
  // Old tokens are of no use: keep the runs table small.
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM runs WHERE at < ?').bind(now - 2 * RUN_MAX_AGE_MS).run();
  return json({ placeAll: (above?.n ?? 0) + 1, placeToday: aboveToday ? aboveToday.n + 1 : null, total: total?.n ?? 0, region, updated, best });
};
