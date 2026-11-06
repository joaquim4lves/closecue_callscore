-- Fatia 3: thin CallScore against the active playbook.
-- bad_score_below is the org threshold (default overall < 60).

ALTER TABLE retention_policies
  ADD COLUMN bad_score_below integer NOT NULL DEFAULT 60;

ALTER TABLE retention_policies
  ADD CONSTRAINT retention_bad_score_range CHECK (bad_score_below >= 0 AND bad_score_below <= 100);

CREATE TYPE score_status AS ENUM ('ok', 'failed');

CREATE TABLE scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES calls (id) ON DELETE CASCADE,
  playbook_id uuid REFERENCES playbooks (id) ON DELETE SET NULL,
  playbook_version integer NOT NULL,
  overall integer,
  bad_flag boolean NOT NULL DEFAULT false,
  short_reason text,
  phase_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  objection_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  prompt_version text,
  status score_status NOT NULL,
  error_message text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scores_overall_range CHECK (overall IS NULL OR (overall >= 0 AND overall <= 100)),
  CONSTRAINT scores_ok_has_overall CHECK (status <> 'ok' OR overall IS NOT NULL),
  CONSTRAINT scores_reasons_len CHECK (
    status <> 'ok'
    OR (jsonb_typeof(reasons) = 'array' AND jsonb_array_length(reasons) BETWEEN 1 AND 3)
  )
);
