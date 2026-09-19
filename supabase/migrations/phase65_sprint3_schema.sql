-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 6.5 Sprint 3 — Comparable Intelligence + Market Statistics Extensions
--
-- All changes are additive. Existing rows, indexes, policies are untouched.
-- Run order is safe to re-execute (IF NOT EXISTS / DO blocks throughout).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── Fix: listing_price_history unique constraint ──────────────────────────────
-- Old key: (property_id, event_type, event_date)
-- Problem: suppresses two legitimate price changes to different amounts on the
--          same day (e.g., MLS corrects an error, price drops twice intraday).
-- New key: (property_id, event_type, event_date, price) — same-day, same-price
--          events are still deduplicated; different prices are distinct events.

DO $$
BEGIN
  -- Drop old constraint if it exists under either possible name
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listing_price_history_property_id_event_type_event_date_key'
      AND conrelid = 'listing_price_history'::regclass
  ) THEN
    ALTER TABLE listing_price_history
      DROP CONSTRAINT listing_price_history_property_id_event_type_event_date_key;
  END IF;

  -- Also handle the idx-based unique index from the Sprint 2 migration
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'listing_price_history'
      AND indexname = 'uq_listing_price_history'
  ) THEN
    DROP INDEX uq_listing_price_history;
  END IF;

  -- Add new unique index including price
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'listing_price_history'
      AND indexname = 'uq_listing_price_history_v2'
  ) THEN
    CREATE UNIQUE INDEX uq_listing_price_history_v2
      ON listing_price_history (property_id, event_type, event_date, price);
  END IF;
END $$;


-- ── Extend: property_comparables ──────────────────────────────────────────────
-- Add fields needed for Sprint 3 comp engine.

ALTER TABLE property_comparables
  ADD COLUMN IF NOT EXISTS comp_status          text,
  -- 'active' | 'pending' | 'sold' | 'rental' | 'expired'
  ADD COLUMN IF NOT EXISTS subdivision          text,
  ADD COLUMN IF NOT EXISTS property_type        text,
  ADD COLUMN IF NOT EXISTS similarity_score     numeric,
  -- 0–100 deterministic score
  ADD COLUMN IF NOT EXISTS similarity_breakdown jsonb    NOT NULL DEFAULT '{}',
  -- { version, components: {distance, sqft, type, beds_baths, year_built, recency, status, subdivision} }
  ADD COLUMN IF NOT EXISTS selection_version    text     NOT NULL DEFAULT 'v1.0',
  ADD COLUMN IF NOT EXISTS source_timestamp     timestamptz,
  -- when the provider data was originally captured (not our fetch time)
  ADD COLUMN IF NOT EXISTS provenance_id        text;
  -- provider-specific listing identifier for deduplication (MLS number or internal ID)


-- Deduplication index: one row per subject property + provenance ID.
-- Prevents re-ingesting the same comp from the same provider.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'property_comparables'
      AND indexname = 'uq_pc_subject_provenance'
  ) THEN
    CREATE UNIQUE INDEX uq_pc_subject_provenance
      ON property_comparables (subject_property_id, provenance_id)
      WHERE provenance_id IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pc_comp_status
  ON property_comparables (subject_property_id, comp_status);

CREATE INDEX IF NOT EXISTS idx_pc_similarity
  ON property_comparables (subject_property_id, similarity_score DESC NULLS LAST);


-- ── Extend: market_statistics ─────────────────────────────────────────────────
-- Add fields required by the Sprint 3 aggregation engine.

ALTER TABLE market_statistics
  ADD COLUMN IF NOT EXISTS calculation_version  text     NOT NULL DEFAULT 'v1.0',
  ADD COLUMN IF NOT EXISTS sample_size          integer,
  -- number of listings used in the calculation
  ADD COLUMN IF NOT EXISTS confidence           text,
  -- 'high' (n≥30) | 'medium' (n≥10) | 'low' (n<10)
  ADD COLUMN IF NOT EXISTS price_reduction_rate numeric,
  -- fraction of active listings with ≥1 price reduction (0–1)
  ADD COLUMN IF NOT EXISTS pending_count        integer,
  ADD COLUMN IF NOT EXISTS sold_count           integer,
  ADD COLUMN IF NOT EXISTS months_of_supply     numeric;
  -- Only populated when data supports a defensible calc (≥3 months of closed data)


-- ── Index: mls_sync_at for repair job ─────────────────────────────────────────
-- Enables efficient detection of stale projections by repairStaleMlsProjections().

CREATE INDEX IF NOT EXISTS idx_properties_mls_sync_at_null
  ON properties (id)
  WHERE mls_sync_at IS NULL;
