-- Online ranking (score + auto-generated nickname only; no personal data, no IP).
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  diff TEXT NOT NULL,          -- easy | normal | hard
  stage TEXT NOT NULL,         -- stage id (yoi, hoshi, …)
  score INTEGER NOT NULL,
  rank TEXT NOT NULL,          -- S / A / B / C
  name TEXT NOT NULL,          -- generated nickname (from fixed word lists)
  max_combo INTEGER NOT NULL,
  region TEXT,                 -- coarse place of the booth (Cloudflare region, e.g. Tokyo)
  device TEXT,                 -- random booth id (not a person)
  at INTEGER NOT NULL          -- unix ms
);
CREATE INDEX IF NOT EXISTS scores_diff_score ON scores (diff, score DESC);
CREATE INDEX IF NOT EXISTS scores_diff_at ON scores (diff, at);

-- Single-use play tokens (a score can be submitted once per play).
CREATE TABLE IF NOT EXISTS runs (
  nonce TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
