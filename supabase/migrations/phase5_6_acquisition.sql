-- ─── Phase 5.6 — Acquisition Operations ──────────────────────────────────────
--
-- Goals:
--   1. Configurable acquisition pipelines (Wholesale, Retail, Pre-FC, Surplus, Probate)
--   2. Add acquisition_pipeline, surplus_status, follow_up_at, assigned_to to leads
--   3. Lead tags
--   4. Import sessions (track import history)
--   5. Call log (structured call outcomes)
--
-- Idempotent: all statements use IF NOT EXISTS / IF EXISTS / ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Acquisition Pipelines ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acquisition_pipelines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        UNIQUE NOT NULL,
  color       text        NOT NULL DEFAULT '#7B8FD4',
  icon        text,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  smallint    NOT NULL DEFAULT 0,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO acquisition_pipelines (name, slug, color, icon, description, sort_order)
VALUES
  ('Wholesale',       'wholesale',       '#C9A84C', '🏠', 'Off-market wholesale deals',     10),
  ('Retail',          'retail',          '#6ABDE0', '🏡', 'Retail purchase opportunities',  20),
  ('Pre-Foreclosure', 'pre-foreclosure', '#f59e0b', '⚠️', 'Pre-foreclosure leads',          30),
  ('Surplus Funds',   'surplus-funds',   '#4CAF9A', '💰', 'Tax deed surplus funds claims',  40),
  ('Probate',         'probate',         '#a78bfa', '📋', 'Probate estate acquisitions',    50)
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Leads — acquisition fields ────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS acquisition_pipeline text,
  ADD COLUMN IF NOT EXISTS surplus_status       text
    CHECK (surplus_status IN (
      'new','researching','owner_found','contacted','claim_filed','paid','archived'
    )),
  ADD COLUMN IF NOT EXISTS assigned_to          uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS follow_up_at         timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_acquisition_pipeline ON leads(acquisition_pipeline) WHERE acquisition_pipeline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_surplus_status       ON leads(surplus_status)        WHERE surplus_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_at         ON leads(follow_up_at)           WHERE follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to          ON leads(assigned_to)            WHERE assigned_to IS NOT NULL;

-- Auto-assign surplus-funds pipeline to existing surplus imports
UPDATE leads l
SET acquisition_pipeline = 'surplus-funds'
FROM properties p
WHERE l.property_id = p.id
  AND p.data_source = 'surplus-funds-import'
  AND l.acquisition_pipeline IS NULL;

-- ── 3. Lead Tags ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_tags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tag        text        NOT NULL,
  color      text        NOT NULL DEFAULT '#9ca3af',
  created_by uuid        REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_lead_tags_lead ON lead_tags(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag  ON lead_tags(tag);

-- ── 4. Import Sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text,
  pipeline      text,
  source_type   text        NOT NULL DEFAULT 'csv'
                CHECK (source_type IN ('csv','tsv','excel','manual')),
  file_name     text,
  file_size     bigint,
  county        text,
  total_rows    integer     NOT NULL DEFAULT 0,
  imported      integer     NOT NULL DEFAULT 0,
  skipped       integer     NOT NULL DEFAULT 0,
  errors        integer     NOT NULL DEFAULT 0,
  field_mapping jsonb,
  status        text        NOT NULL DEFAULT 'complete'
                CHECK (status IN ('pending','running','complete','failed')),
  error_log     jsonb,
  created_by    uuid        REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_created    ON import_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_sessions_created_by ON import_sessions(created_by);

-- ── 5. Call Log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS call_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id    uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  outcome       text        NOT NULL
                CHECK (outcome IN (
                  'no_answer','voicemail','wrong_number',
                  'talked','callback_scheduled','disconnected','not_in_service'
                )),
  notes         text,
  phone_used    text,
  duration_secs integer,
  follow_up_at  timestamptz,
  created_by    uuid        REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_log_lead    ON call_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_log_created ON call_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_log_user    ON call_log(created_by);

-- ── 6. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE acquisition_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_log               ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='acquisition_pipelines' AND policyname='pipelines_read') THEN
    CREATE POLICY "pipelines_read"   ON acquisition_pipelines FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='acquisition_pipelines' AND policyname='pipelines_manage') THEN
    CREATE POLICY "pipelines_manage" ON acquisition_pipelines FOR ALL TO authenticated
      USING (created_by = auth.uid() OR created_by IS NULL)
      WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_tags' AND policyname='lead_tags_auth') THEN
    CREATE POLICY "lead_tags_auth"   ON lead_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='import_sessions' AND policyname='import_sessions_own') THEN
    CREATE POLICY "import_sessions_own" ON import_sessions FOR ALL TO authenticated
      USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='call_log' AND policyname='call_log_own') THEN
    CREATE POLICY "call_log_own" ON call_log FOR ALL TO authenticated
      USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
  END IF;
END $$;
