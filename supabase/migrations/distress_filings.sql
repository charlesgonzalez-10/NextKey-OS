-- ─── distress_filings table ───────────────────────────────────────────────────
--
-- Stores one row per OR court filing ingested by the OR ingestion pipeline.
-- This is the official audit ledger of every Lis Pendens (or other distress
-- doc type) that has been pulled from the county clerk.
--
-- Relationship to other tables:
--   properties      → 1:many (one property can have multiple filings over time)
--   scraper_runs    → 1:many (each run inserts N filings)
--
-- NOTE: case_number is declared UNIQUE to be the primary dedup guard.
--       The ingestion engine queries this column before every insert.
--

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS distress_filings (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  property_id       UUID          NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  ingestion_run_id  UUID          REFERENCES scraper_runs(id) ON DELETE SET NULL,

  -- Court filing identity
  case_number       TEXT          NOT NULL,
  doc_type          TEXT          NOT NULL DEFAULT 'LIS_PENDENS',
  county            TEXT          NOT NULL CHECK (county IN ('broward', 'miami-dade', 'palm-beach')),
  recording_date    DATE,

  -- Parties (from OR index)
  plaintiff         TEXT,         -- lender / foreclosing party
  defendant         TEXT,         -- borrower / property owner at time of filing

  -- Financial & legal detail
  consideration     NUMERIC(14,2),
  legal_description TEXT,

  -- Raw source payload (for debugging / re-processing)
  raw_record        JSONB,

  -- Timestamps
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary dedup guard — enforced at DB level
CREATE UNIQUE INDEX IF NOT EXISTS distress_filings_case_number_unique
  ON distress_filings (case_number);

-- Fast lookup by property (property detail page lists all filings)
CREATE INDEX IF NOT EXISTS distress_filings_property_id_idx
  ON distress_filings (property_id);

-- Support date-range queries (dashboard reporting, backfill audits)
CREATE INDEX IF NOT EXISTS distress_filings_recording_date_idx
  ON distress_filings (recording_date DESC);

-- Support run-level audit queries
CREATE INDEX IF NOT EXISTS distress_filings_ingestion_run_id_idx
  ON distress_filings (ingestion_run_id);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_distress_filings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_distress_filings_updated_at ON distress_filings;
CREATE TRIGGER trg_distress_filings_updated_at
  BEFORE UPDATE ON distress_filings
  FOR EACH ROW EXECUTE FUNCTION update_distress_filings_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE distress_filings ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically (used by the ingestion engine).
-- Authenticated users can read all filings (they belong to the platform owner,
-- not individual tenants — update this policy if/when multi-tenant is added).

CREATE POLICY "distress_filings: authenticated read"
  ON distress_filings
  FOR SELECT
  TO authenticated
  USING (true);

-- Only the service role (backend API routes) may insert/update/delete.
-- No direct client-side writes allowed.
CREATE POLICY "distress_filings: service role write"
  ON distress_filings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── Properties table: ensure folio_number UNIQUE constraint exists ───────────
--
-- The engine upserts properties by folio_number. Without a UNIQUE constraint,
-- duplicate folios accumulate. This is a no-op if the constraint already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'properties'::regclass
    AND   contype  = 'u'
    AND   conname  = 'properties_folio_number_unique'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_folio_number_unique
      UNIQUE (folio_number);
  END IF;
END;
$$;

-- ─── scraper_runs: ensure skip_log column exists ──────────────────────────────
--
-- The OR ingestion engine writes skip_log (same as runner.ts). If the column
-- was not created in the original schema migration, add it now.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraper_runs'
    AND   column_name = 'skip_log'
  ) THEN
    ALTER TABLE scraper_runs ADD COLUMN skip_log JSONB DEFAULT '[]'::jsonb;
  END IF;
END;
$$;
