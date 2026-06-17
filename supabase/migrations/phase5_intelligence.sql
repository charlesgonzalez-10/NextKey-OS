-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 5 — PROPERTY INTELLIGENCE ENGINE
--
-- Adds infrastructure tables alongside the existing CRM tables.
-- NO existing tables are modified. NO existing data is removed.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══ PROPERTY FRESHNESS ════════════════════════════════════════════════════════
-- Module-level freshness tracking. One row per (property, module).
-- Written after every successful external API fetch.
-- Read before every external API call — if fresh, skip the call.

CREATE TABLE IF NOT EXISTS property_freshness (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  module        text        NOT NULL,
  -- 'details'|'ownership'|'valuation'|'mortgage'|'tax'|'foreclosure'
  -- 'mls'|'rental'|'comps'|'ai'
  source        text,
  -- 'miami-dade-pa'|'reapi'|'rentcast'|'claude'|'manual'
  refreshed_at  timestamptz NOT NULL DEFAULT NOW(),
  ttl_days      smallint,
  -- stored at write time for diagnostics; authoritative TTL is in code
  created_at    timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE(property_id, module)
);

CREATE INDEX IF NOT EXISTS property_freshness_property_idx
  ON property_freshness(property_id);

CREATE INDEX IF NOT EXISTS property_freshness_module_age_idx
  ON property_freshness(module, refreshed_at DESC);


-- ═══ PROPERTY SNAPSHOTS ════════════════════════════════════════════════════════
-- Append-only historical record of changing field values.
-- A snapshot is written BEFORE a field is overwritten.
-- Enables trend analysis, AI learning, and full audit trail.
-- Never delete rows from this table.

CREATE TABLE IF NOT EXISTS property_snapshots (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  snapshot_key  text        NOT NULL,
  -- e.g. 'market_value', 'mls_listing_price', 'owner_name', 'rent_estimate'
  value_numeric numeric,
  value_text    text,
  value_json    jsonb,
  source        text        NOT NULL,
  -- system that produced this value: 'reapi', 'miami-dade-pa', 'rentcast', 'user'
  captured_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS property_snapshots_lookup_idx
  ON property_snapshots(property_id, snapshot_key, captured_at DESC);

CREATE INDEX IF NOT EXISTS property_snapshots_timeline_idx
  ON property_snapshots(property_id, captured_at DESC);


-- ═══ PROPERTY SEARCH HISTORY ══════════════════════════════════════════════════
-- Internal only. Never exposed in the CRM.
-- One row per property. search_count increments atomically via SQL function.
-- Used to optimize refresh priority: high-frequency properties refresh sooner.

CREATE TABLE IF NOT EXISTS property_search_history (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id       uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  search_count      integer     NOT NULL DEFAULT 1,
  first_searched_at timestamptz NOT NULL DEFAULT NOW(),
  last_searched_at  timestamptz NOT NULL DEFAULT NOW(),
  last_refreshed_at timestamptz,
  search_frequency  text GENERATED ALWAYS AS (
    CASE
      WHEN search_count >= 10 THEN 'high'
      WHEN search_count >= 3  THEN 'medium'
      ELSE 'low'
    END
  ) STORED,

  UNIQUE(property_id)
);

CREATE INDEX IF NOT EXISTS property_search_history_recent_idx
  ON property_search_history(last_searched_at DESC);

CREATE INDEX IF NOT EXISTS property_search_history_freq_idx
  ON property_search_history(search_frequency, last_searched_at DESC);


-- ═══ MARKET INTELLIGENCE EVENTS ═══════════════════════════════════════════════
-- Append-only stream of market data points.
-- Every enriched property quietly contributes market statistics.
-- Accumulates over time without any dashboard yet.

CREATE TABLE IF NOT EXISTS market_intelligence_events (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  geography_type  text        NOT NULL,
  -- 'zip' | 'city' | 'neighborhood' | 'county'
  geography_value text        NOT NULL,
  -- '33101' | 'Miami' | 'Brickell' | 'miami-dade'
  stat_type       text        NOT NULL,
  -- 'market_value' | 'rent_estimate' | 'dom' | 'list_price' | 'sale_price'
  -- 'price_reduction_count' | 'mls_active'
  value_numeric   numeric     NOT NULL,
  property_id     uuid        REFERENCES properties(id) ON DELETE SET NULL,
  source          text,
  recorded_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mkt_intel_geography_stat_idx
  ON market_intelligence_events(geography_type, geography_value, stat_type, recorded_at DESC);

CREATE INDEX IF NOT EXISTS mkt_intel_recent_idx
  ON market_intelligence_events(recorded_at DESC);


-- ═══ FUTURE EVENT ENGINE — ARCHITECTURE ONLY ══════════════════════════════════
-- Table designed to receive future event listeners.
-- No functionality built yet. Schema designed for forward compatibility.
--
-- Future event types:
--   ownership_change | property_sold | new_listing | price_reduction
--   foreclosure_filing | probate_filed | mortgage_recorded | tax_delinquency

CREATE TABLE IF NOT EXISTS property_events (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_type    text        NOT NULL,
  event_data    jsonb,
  detected_at   timestamptz NOT NULL DEFAULT NOW(),
  processed_at  timestamptz,
  -- NULL = not yet processed by event handlers
  source        text
);

CREATE INDEX IF NOT EXISTS property_events_property_idx
  ON property_events(property_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS property_events_unprocessed_idx
  ON property_events(processed_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS property_events_type_idx
  ON property_events(event_type, detected_at DESC);


-- ═══ SQL FUNCTIONS ═════════════════════════════════════════════════════════════

-- Atomic upsert for search history with counter increment.
-- Called from propertyService.recordPropertySearch().
CREATE OR REPLACE FUNCTION record_property_search(p_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO property_search_history
    (property_id, search_count, first_searched_at, last_searched_at)
  VALUES
    (p_property_id, 1, NOW(), NOW())
  ON CONFLICT (property_id) DO UPDATE
    SET search_count     = property_search_history.search_count + 1,
        last_searched_at = NOW();
END;
$$;


-- ═══ BACKFILLS ═════════════════════════════════════════════════════════════════
-- Seed property_freshness from existing enrichment data so existing properties
-- are not unnecessarily re-enriched after this migration deploys.

-- Ownership module: seed from enriched_at for PA-enriched properties
INSERT INTO property_freshness (property_id, module, source, refreshed_at, ttl_days)
SELECT
  id,
  'ownership',
  enrichment_src,
  enriched_at,
  120
FROM properties
WHERE enriched_at IS NOT NULL
  AND enrichment_src IS NOT NULL
ON CONFLICT (property_id, module) DO NOTHING;

-- Valuation module: same source — PA enrichment also brings valuation
INSERT INTO property_freshness (property_id, module, source, refreshed_at, ttl_days)
SELECT
  id,
  'valuation',
  enrichment_src,
  enriched_at,
  90
FROM properties
WHERE enriched_at IS NOT NULL
  AND enrichment_src IS NOT NULL
ON CONFLICT (property_id, module) DO NOTHING;

-- Rental module: seed from rent_fetched_at
INSERT INTO property_freshness (property_id, module, source, refreshed_at, ttl_days)
SELECT
  id,
  'rental',
  'rentcast',
  rent_fetched_at,
  7
FROM properties
WHERE rent_fetched_at IS NOT NULL
ON CONFLICT (property_id, module) DO NOTHING;

-- MLS module: seed properties that have MLS data
INSERT INTO property_freshness (property_id, module, source, refreshed_at, ttl_days)
SELECT
  id,
  'mls',
  'reapi',
  COALESCE(updated_at, enriched_at, created_at),
  7
FROM properties
WHERE mls_status IS NOT NULL
   OR mls_listing_price IS NOT NULL
   OR mls_active = true
ON CONFLICT (property_id, module) DO NOTHING;
