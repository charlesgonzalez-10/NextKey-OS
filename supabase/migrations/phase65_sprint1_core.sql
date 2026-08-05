-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 6.5 Sprint 1 — Core Intelligence Tables
--
-- Creates four new tables alongside existing schema. Zero changes to existing tables.
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- Tables:
--   listing_intelligence  — Structured MLS intelligence per property
--   listing_price_history — Price change event log
--   listing_photos        — Normalized photo URLs
--   opportunity_signals   — Universal property signal model (replaces siloed lead sources)
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── listing_intelligence ──────────────────────────────────────────────────────
-- Core MLS intelligence record. One current row per property (most recent fetch).
-- Historical snapshots live in property_snapshots (existing table).
-- Coexists with properties.mls_* columns — those remain for backward compat.

CREATE TABLE IF NOT EXISTS listing_intelligence (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  mls_number            text,
  source                text        NOT NULL DEFAULT 'reapi',
  -- 'reapi' | 'beaches-mls' | 'reso-direct'

  -- Listing vitals
  list_price            numeric,
  close_price           numeric,
  original_list_price   numeric,
  list_date             date,
  close_date            date,
  status                text,
  -- 'Active' | 'Pending' | 'Closed' | 'Expired' | 'Withdrawn' | 'Unknown'
  days_on_market        integer,
  cumulative_dom        integer,
  price_per_sqft        numeric,
  price_reduction_count integer DEFAULT 0,

  -- Intelligence scores (0–100, null when not yet computed)
  market_position_score      smallint CHECK (market_position_score BETWEEN 0 AND 100),
  acquisition_opportunity_score smallint CHECK (acquisition_opportunity_score BETWEEN 0 AND 100),

  -- Velocity signals (JSONB — structure defined in lib/graph/types.ts)
  -- { priceReductionCount, totalReductionPct, backOnMarket, domTrend }
  velocity_signals      jsonb       NOT NULL DEFAULT '{}',

  -- Pricing intelligence (JSONB)
  -- { avmSpreadPct, spLpRatio6mo, absorptionMonths, comparableCount }
  pricing_intelligence  jsonb       NOT NULL DEFAULT '{}',

  -- Agent / office info
  list_agent_name       text,
  list_agent_phone      text,
  list_agent_email      text,
  list_office_name      text,

  -- Remarks
  remarks               text,

  -- Photos: stored in listing_photos; count cached here for quick display
  photo_count           integer     DEFAULT 0,

  -- IDX compliance
  display_allowed       boolean     NOT NULL DEFAULT false,
  idx_feed_id           text,

  -- Raw payload for audit trail (kept 90 days, then archived)
  raw_source            jsonb,

  fetched_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- One active intelligence record per property
  UNIQUE (property_id)
);

CREATE INDEX IF NOT EXISTS idx_li_property_id ON listing_intelligence(property_id);
CREATE INDEX IF NOT EXISTS idx_li_mls_number  ON listing_intelligence(mls_number) WHERE mls_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_li_status      ON listing_intelligence(status)     WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_li_fetched_at  ON listing_intelligence(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_scores      ON listing_intelligence(acquisition_opportunity_score DESC)
  WHERE acquisition_opportunity_score IS NOT NULL;

ALTER TABLE listing_intelligence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'listing_intelligence' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON listing_intelligence
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION touch_listing_intelligence_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'listing_intelligence_updated_at'
  ) THEN
    CREATE TRIGGER listing_intelligence_updated_at
      BEFORE UPDATE ON listing_intelligence
      FOR EACH ROW EXECUTE FUNCTION touch_listing_intelligence_updated_at();
  END IF;
END $$;


-- ── listing_price_history ─────────────────────────────────────────────────────
-- Append-only log of every price event for a property.
-- Source of truth for price history charts in the UI.

CREATE TABLE IF NOT EXISTS listing_price_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  mls_number      text,
  event_type      text        NOT NULL,
  -- 'listed' | 'price_change' | 'relisted' | 'closed' | 'expired' | 'withdrawn'
  price           numeric     NOT NULL,
  previous_price  numeric,
  change_pct      numeric GENERATED ALWAYS AS (
    CASE
      WHEN previous_price IS NOT NULL AND previous_price <> 0
      THEN ROUND(((price - previous_price) / previous_price) * 100, 2)
      ELSE NULL
    END
  ) STORED,
  event_date      date        NOT NULL,
  source          text        NOT NULL DEFAULT 'reapi',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lph_property_id ON listing_price_history(property_id);
CREATE INDEX IF NOT EXISTS idx_lph_event_date  ON listing_price_history(property_id, event_date DESC);

ALTER TABLE listing_price_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'listing_price_history' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON listing_price_history
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;


-- ── listing_photos ────────────────────────────────────────────────────────────
-- Normalized MLS photo URLs. Separate from the main record to keep it lean.

CREATE TABLE IF NOT EXISTS listing_photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  mls_number      text,
  url             text        NOT NULL,
  sort_order      smallint    NOT NULL DEFAULT 0,
  caption         text,
  fetched_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_property_id ON listing_photos(property_id);
CREATE INDEX IF NOT EXISTS idx_lp_sort        ON listing_photos(property_id, sort_order);

ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'listing_photos' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON listing_photos
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;


-- ── opportunity_signals ───────────────────────────────────────────────────────
-- Universal property signal model. Every property accumulates signals.
-- Replaces siloed lead-source lists. A signal = a condition that is TRUE about a property.
-- Multiple signals coexist. Lead-source attribution (how the lead was found)
-- remains in leads.source — that is a CRM concept and stays separate.

CREATE TABLE IF NOT EXISTS opportunity_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  signal_type     text        NOT NULL,
  -- Public Records signals:
  --   'pre_foreclosure' | 'probate' | 'tax_deed' | 'surplus_funds' | 'lis_pendens'
  -- MLS signals:
  --   'mls_active' | 'mls_price_reduced' | 'high_dom' | 'back_on_market' | 'expired_listing'
  -- Ownership/Equity signals:
  --   'high_equity' | 'free_and_clear' | 'investor_owned' | 'non_owner_occupied'
  --   'vacant' | 'absentee_owner'
  -- Market signals:
  --   'no_hoa' | 'below_market'

  signal_source   text        NOT NULL,
  -- 'clerk_of_court' | 'tax_collector' | 'mls' | 'county_pa' | 'reapi' | 'manual'

  is_active       boolean     NOT NULL DEFAULT true,

  -- 0.0–1.0. 1.0 = confirmed from authoritative source.
  -- < 1.0 = inferred (e.g., no lease found → likely vacant at 0.7 confidence).
  confidence      numeric(4,3) NOT NULL DEFAULT 1.0
    CHECK (confidence BETWEEN 0 AND 1),

  -- Signal-specific detail payload. Examples:
  --   pre_foreclosure:    { case_number, filing_date, lender, amount_owed }
  --   mls_price_reduced:  { original_price, current_price, reduction_pct, reduction_count }
  --   high_equity:        { estimated_value, estimated_loan_balance, equity_pct }
  --   high_dom:           { days_on_market, area_median_dom }
  signal_data     jsonb       NOT NULL DEFAULT '{}',

  detected_at     timestamptz NOT NULL DEFAULT now(),

  -- Some signals have natural expiration:
  --   mls_active: expires when status changes to non-active
  --   pre_foreclosure: expires when resolved/sold
  --   high_dom: expires after 30 days (re-detected on next refresh)
  expires_at      timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One active signal of each type per property (upsert target)
  UNIQUE (property_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_os_property_id  ON opportunity_signals(property_id);
CREATE INDEX IF NOT EXISTS idx_os_signal_type  ON opportunity_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_os_is_active    ON opportunity_signals(property_id, is_active)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_os_expires_at   ON opportunity_signals(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_os_confidence   ON opportunity_signals(confidence DESC)
  WHERE is_active = true;

ALTER TABLE opportunity_signals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'opportunity_signals' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON opportunity_signals
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION touch_opportunity_signals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'opportunity_signals_updated_at'
  ) THEN
    CREATE TRIGGER opportunity_signals_updated_at
      BEFORE UPDATE ON opportunity_signals
      FOR EACH ROW EXECUTE FUNCTION touch_opportunity_signals_updated_at();
  END IF;
END $$;


-- ── Backfill: seed opportunity signals from existing property flags ───────────
-- Properties already have boolean flags (is_pre_foreclosure, high_equity, etc.)
-- Seed initial signals from those flags so existing data is signal-aware.

INSERT INTO opportunity_signals (property_id, signal_type, signal_source, confidence, signal_data, detected_at)
SELECT
  id,
  'pre_foreclosure',
  'county_pa',
  0.9,
  jsonb_build_object('filing_type', foreclosure_type),
  COALESCE(file_date::timestamptz, now())
FROM properties
WHERE is_pre_foreclosure = true
  AND id IS NOT NULL
ON CONFLICT (property_id, signal_type) DO NOTHING;

INSERT INTO opportunity_signals (property_id, signal_type, signal_source, confidence, signal_data, detected_at)
SELECT id, 'high_equity', 'county_pa', 0.8,
  jsonb_build_object('equity_pct', ROUND(equity_percentage::numeric, 1)),
  COALESCE(enriched_at, now())
FROM properties
WHERE high_equity = true AND id IS NOT NULL
ON CONFLICT (property_id, signal_type) DO NOTHING;

INSERT INTO opportunity_signals (property_id, signal_type, signal_source, confidence, signal_data, detected_at)
SELECT id, 'absentee_owner', 'county_pa', 1.0, '{}', COALESCE(enriched_at, now())
FROM properties
WHERE absentee_owner = true AND id IS NOT NULL
ON CONFLICT (property_id, signal_type) DO NOTHING;

INSERT INTO opportunity_signals (property_id, signal_type, signal_source, confidence, signal_data, detected_at)
SELECT id, 'mls_active', 'reapi', 1.0,
  jsonb_build_object('list_price', mls_listing_price, 'dom', mls_dom),
  COALESCE(updated_at, now())
FROM properties
WHERE mls_active = true AND id IS NOT NULL
ON CONFLICT (property_id, signal_type) DO NOTHING;
