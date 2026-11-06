-- Fatia 2: calls, transcripts, webhook inbox, retention.
-- At most one call per organization + source + external id when the provider id is present.

CREATE TYPE call_source AS ENUM ('upload', 'paste', 'meet', 'zoom', 'fireflies');
CREATE TYPE call_status AS ENUM ('pending', 'processing', 'ready', 'failed');
CREATE TYPE segment_speaker AS ENUM ('seller', 'prospect', 'unknown');
CREATE TYPE webhook_provider AS ENUM ('meet', 'zoom', 'fireflies');

CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  playbook_id uuid REFERENCES playbooks (id) ON DELETE SET NULL,
  title text NOT NULL,
  source call_source NOT NULL,
  external_id text,
  status call_status NOT NULL DEFAULT 'pending',
  audio_url text,
  audio_content_type text,
  duration_sec integer,
  consent_recorded_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calls_org_created_idx ON calls (org_id, created_at DESC);

CREATE UNIQUE INDEX calls_org_source_external_unique
  ON calls (org_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES calls (id) ON DELETE CASCADE,
  provider text NOT NULL,
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
  idx integer NOT NULL,
  t_start_ms integer NOT NULL,
  t_end_ms integer NOT NULL,
  speaker segment_speaker NOT NULL,
  text text NOT NULL,
  CONSTRAINT transcript_segments_idx_unique UNIQUE (transcript_id, idx)
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider webhook_provider NOT NULL,
  org_id uuid REFERENCES organizations (id) ON DELETE SET NULL,
  headers_hash text NOT NULL,
  payload jsonb NOT NULL,
  signature_ok boolean NOT NULL,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_inbox_created_idx ON webhook_inbox (created_at DESC);

CREATE TABLE retention_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  audio_days integer NOT NULL DEFAULT 30,
  transcript_days integer NOT NULL DEFAULT 90,
  CONSTRAINT retention_audio_days_positive CHECK (audio_days > 0),
  CONSTRAINT retention_transcript_days_positive CHECK (transcript_days > 0)
);
