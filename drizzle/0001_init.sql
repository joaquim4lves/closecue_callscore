-- Fatia 1: organizations, users, memberships, playbooks.
-- At most one playbook with status = active per organization.

CREATE TYPE membership_role AS ENUM ('seller', 'manager');
CREATE TYPE playbook_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role membership_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX memberships_user_id_idx ON memberships (user_id);

CREATE TABLE playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status playbook_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES users (id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playbooks_version_positive CHECK (version >= 1)
);

CREATE INDEX playbooks_org_id_idx ON playbooks (org_id);

CREATE UNIQUE INDEX playbooks_one_active_per_org
  ON playbooks (org_id)
  WHERE status = 'active';

CREATE TABLE playbook_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid NOT NULL REFERENCES playbooks (id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  name text NOT NULL,
  trigger_text text NOT NULL DEFAULT '',
  script text NOT NULL DEFAULT '',
  checklist_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT playbook_phases_sort_unique UNIQUE (playbook_id, sort_order),
  CONSTRAINT playbook_phases_checklist_array CHECK (jsonb_typeof(checklist_items) = 'array')
);

CREATE TABLE playbook_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid NOT NULL REFERENCES playbooks (id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  label text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_response text NOT NULL DEFAULT '',
  CONSTRAINT playbook_objections_sort_unique UNIQUE (playbook_id, sort_order),
  CONSTRAINT playbook_objections_signals_array CHECK (jsonb_typeof(signals) = 'array')
);
