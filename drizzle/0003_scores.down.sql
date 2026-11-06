DROP TABLE IF EXISTS scores;
DROP TYPE IF EXISTS score_status;
ALTER TABLE retention_policies DROP CONSTRAINT IF EXISTS retention_bad_score_range;
ALTER TABLE retention_policies DROP COLUMN IF EXISTS bad_score_below;
