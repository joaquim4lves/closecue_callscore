-- Fase 1b: CloseCue overlay sessions and cues.

CREATE TYPE cue_session_status AS ENUM ('idle', 'live', 'ended');

CREATE TABLE cue_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  call_id uuid REFERENCES calls (id) ON DELETE SET NULL,
  playbook_id uuid REFERENCES playbooks (id) ON DELETE SET NULL,
  playbook_version integer,
  status cue_session_status NOT NULL DEFAULT 'idle',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX cue_sessions_org_seller_idx ON cue_sessions (org_id, seller_id, started_at DESC);

CREATE TABLE cue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cue_sessions (id) ON DELETE CASCADE,
  phase_id uuid REFERENCES playbook_phases (id) ON DELETE SET NULL,
  objection_id uuid REFERENCES playbook_objections (id) ON DELETE SET NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fired_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  dismissed_at timestamptz,
  CONSTRAINT cue_events_kind_check CHECK (kind IN ('tick', 'phase', 'objection'))
);

CREATE INDEX cue_events_session_fired_idx ON cue_events (session_id, fired_at);
