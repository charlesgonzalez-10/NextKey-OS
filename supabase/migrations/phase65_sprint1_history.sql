-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 6.5 Sprint 1 — History + Events Tables
--
-- Creates three tables. Zero changes to existing tables.
-- All idempotent (IF NOT EXISTS).
--
-- Tables:
--   listing_history  — Each listing cycle (relists get a new row)
--   listing_events   — Append-only event stream per property
--   refresh_jobs     — Lightweight background refresh queue
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── listing_history ───────────────────────────────────────────────────────────
-- One row per listing cycle. When a property expires and relists, listing_cycle
-- increments. Enables: "how many times has this property failed to sell?"

CREATE TABLE IF NOT EXISTS listing_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  mls_number      text,
  listing_cycle   smallint    NOT NULL DEFAULT 1,

  list_price      numeric,
  close_price     numeric,
  original_list_price numeric,
  list_date       date,
  close_date      date,
  status          text,
  days_on_market  integer,
  price_reduction_count integer DEFAULT 0,

  list_agent_name  text,
  list_agent_phone text,
  list_office_name text,

  source          text        NOT NULL DEFAULT 'reapi',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lh_property_id    ON listing_history(property_id);
CREATE INDEX IF NOT EXISTS idx_lh_mls_number     ON listing_history(mls_number) WHERE mls_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lh_listing_cycle  ON listing_history(property_id, listing_cycle DESC);

ALTER TABLE listing_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'listing_history' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON listing_history
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;


-- ── listing_events ────────────────────────────────────────────────────────────
-- Append-only stream of significant listing events.
-- Fed by: MLS webhook (real-time), DSOE refresh (polled), manual agent actions.
-- Powers the Timeline tab in the Property Workspace.
-- Note: property_events already exists (Phase 5) and covers general events.
-- listing_events is MLS/intelligence-specific.

CREATE TABLE IF NOT EXISTS listing_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  mls_number      text,

  event_type      text        NOT NULL,
  -- MLS lifecycle:    'listed' | 'status_change' | 'price_reduction' | 'back_on_market'
  --                   'contract_received' | 'expired' | 'withdrawn' | 'relisted' | 'closed'
  -- Intelligence:     'tier_change' | 'score_updated' | 'signal_detected' | 'signal_expired'
  -- Internal:         'offer_submitted' | 'offer_accepted' | 'offer_rejected'

  -- Human-readable title for the Timeline UI
  title           text        NOT NULL,

  -- Optional narrative detail
  description     text,

  -- Monetary amount (for price events, offer amounts)
  amount          numeric,
  previous_amount numeric,

  event_data      jsonb       NOT NULL DEFAULT '{}',

  occurred_at     timestamptz NOT NULL,
  source          text        NOT NULL DEFAULT 'reapi',

  -- 'agent' = agent-only. 'shared' = can be shown to client via Spesio.
  visibility      text        NOT NULL DEFAULT 'agent'
    CHECK (visibility IN ('agent', 'shared')),

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_le_property_id  ON listing_events(property_id);
CREATE INDEX IF NOT EXISTS idx_le_occurred_at  ON listing_events(property_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_event_type   ON listing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_le_visibility   ON listing_events(property_id, visibility, occurred_at DESC);

ALTER TABLE listing_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'listing_events' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON listing_events
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;


-- ── refresh_jobs ──────────────────────────────────────────────────────────────
-- Lightweight refresh queue. Avoids a full BullMQ dependency for now.
-- Workers (cron edge functions) claim jobs by setting started_at.
-- On success: set completed_at. On failure: set error.

CREATE TABLE IF NOT EXISTS refresh_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        REFERENCES properties(id) ON DELETE CASCADE,

  job_type        text        NOT NULL,
  -- 'listing_intelligence' | 'opportunity_signals' | 'comps' | 'market_stats'
  -- 'full_profile' | 'ownership'

  -- Refresh tier from the Refresh Tier System (0=webhook, 1–4 standard)
  tier            smallint    NOT NULL DEFAULT 2
    CHECK (tier BETWEEN 0 AND 4),

  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,

  -- Error message if job failed
  error           text,

  -- Retry count (max 3 attempts before marking dead)
  attempts        smallint    NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rj_property_id    ON refresh_jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_rj_scheduled_at   ON refresh_jobs(scheduled_at)
  WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rj_tier_pending   ON refresh_jobs(tier, scheduled_at)
  WHERE completed_at IS NULL AND error IS NULL;

ALTER TABLE refresh_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'refresh_jobs' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON refresh_jobs
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;
