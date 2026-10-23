-- One row per player name and difficulty: a better score overwrites the old one.
-- Keep only the best row of any existing duplicates, then enforce uniqueness.
DELETE FROM scores WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY diff, name ORDER BY score DESC, at ASC) AS rn FROM scores
  ) WHERE rn = 1
);
ALTER TABLE scores ADD COLUMN name_key TEXT;
UPDATE scores SET name_key = lower(name);
CREATE UNIQUE INDEX IF NOT EXISTS scores_diff_name ON scores (diff, name_key);
