-- Phase 6.5 Sprint 2 — Canonical MLS store schema additions
-- All changes are additive. No columns removed. No destructive migrations.
--
-- Purpose:
--   1. Add scoring_breakdown to listing_intelligence (score explainability)
--   2. Add hoa_amount to listing_intelligence (for no_hoa signal)
--   3. Add listing_cycle to listing_intelligence (active cycle counter)
--   4. Add opened_at / closed_at / back_on_market to listing_history (cycle tracking)
--   5. Add mls_sync_at to properties (audit trail for one-way sync)
--   6. Add unique constraint to listing_price_history (duplicate prevention)
--   7. Backfill listing_intelligence from properties.mls_* (production-safe, idempotent)

-- ─── listing_intelligence additions ─────────────────────────────────────────

ALTER TABLE listing_intelligence
  ADD COLUMN IF NOT EXISTS scoring_breakdown   jsonb,
  ADD COLUMN IF NOT EXISTS hoa_amount          numeric,
  ADD COLUMN IF NOT EXISTS listing_cycle       smallint DEFAULT 1 CHECK (listing_cycle >= 1);

COMMENT ON COLUMN listing_intelligence.scoring_breakdown IS
  'Full scoring explanation: {version, scoredAt, inputs, components, clampedFrom, total}. '
  'Never present a score without this breakdown. Updated by scoring engine on every fetch.';

COMMENT ON COLUMN listing_intelligence.listing_cycle IS
  'Current listing cycle number. Starts at 1, incremented each time this '
  'property is relisted after expiry or withdrawal. Maintained by listingCycle.ts.';

COMMENT ON COLUMN listing_intelligence.hoa_amount IS
  'HOA monthly amount from MLS. NULL = not provided by MLS. '
  '0 = explicitly reported as $0/no HOA. Used for no_hoa signal detection.';

-- ─── listing_history additions ───────────────────────────────────────────────

ALTER TABLE listing_history
  ADD COLUMN IF NOT EXISTS opened_at       timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS back_on_market  boolean  NOT NULL DEFAULT false;

COMMENT ON COLUMN listing_history.back_on_market IS
  'True if this cycle started after a prior closed/expired/withdrawn cycle '
  'for the same property. Set by listingCycle.ts relist detection.';

-- ─── properties audit column ─────────────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS mls_sync_at timestamptz;

COMMENT ON COLUMN properties.mls_sync_at IS
  'Timestamp of the last one-way sync from listing_intelligence → properties.mls_* '
  'columns. NULL means properties.mls_* was written directly (pre-Sprint 2). '
  'This column tracks progress toward full canonical store migration.';

-- ─── listing_price_history: unique constraint for duplicate prevention ───────
-- (property_id, event_type, event_date) must be unique.
-- If price_change fires twice on the same day for the same property, we want
-- the first write to win (idempotent inserts use ON CONFLICT DO NOTHING).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listing_price_history_no_duplicate_events'
      AND conrelid = 'listing_price_history'::regclass
  ) THEN
    ALTER TABLE listing_price_history
      ADD CONSTRAINT listing_price_history_no_duplicate_events
        UNIQUE (property_id, event_type, event_date);
  END IF;
END $$;

-- ─── Production-safe backfill ─────────────────────────────────────────────────
-- Populate listing_intelligence for every property that has MLS data in
-- properties.mls_* columns but no listing_intelligence row yet.
--
-- Safety: ON CONFLICT (property_id) DO NOTHING — never overwrites a row
-- that was already written by the Sprint 1+ intelligence stack.
-- Idempotent: safe to run multiple times.

INSERT INTO listing_intelligence (
  property_id,
  mls_number,
  source,
  list_price,
  original_list_price,
  status,
  days_on_market,
  cumulative_dom,
  price_reduction_count,
  list_agent_name,
  list_agent_phone,
  list_agent_email,
  list_office_name,
  remarks,
  hoa_amount,
  velocity_signals,
  pricing_intelligence,
  raw_source,
  fetched_at,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.mls_number,
  'reapi',
  p.mls_listing_price,
  p.mls_original_price,
  p.mls_status,
  p.mls_dom,
  p.mls_cdom,
  COALESCE(p.mls_price_reductions, 0),
  p.mls_agent_name,
  p.mls_agent_phone,
  p.mls_agent_email,
  p.mls_broker_name,
  p.mls_remarks_public,
  p.mls_hoa_amount,
  jsonb_build_object(
    'priceReductionCount', COALESCE(p.mls_price_reductions, 0),
    'backOnMarket',        false,
    'domTrend',            CASE
                             WHEN p.mls_dom IS NULL THEN 'normal'
                             WHEN p.mls_dom > 90    THEN 'stalling'
                             WHEN p.mls_dom <= 14   THEN 'accelerating'
                             ELSE                        'normal'
                           END,
    'totalReductionPct',   CASE
                             WHEN p.mls_original_price IS NOT NULL
                               AND p.mls_listing_price IS NOT NULL
                               AND p.mls_original_price > 0
                               AND p.mls_listing_price < p.mls_original_price
                             THEN ROUND(
                               (p.mls_original_price - p.mls_listing_price)::numeric
                               / p.mls_original_price * 100, 2
                             )
                             ELSE 0
                           END
  ),
  '{}',
  p.raw_reapi,
  COALESCE(p.updated_at, now()),
  now(),
  now()
FROM properties p
WHERE
  -- Only backfill where there is MLS data to migrate
  (p.mls_status IS NOT NULL OR p.mls_listing_price IS NOT NULL OR p.mls_active = true)
  -- Only if the property_id doesn't have a row yet
ON CONFLICT (property_id) DO NOTHING;

-- ─── Sync mls_sync_at for properties that had mls_* data already ─────────────
-- Mark pre-Sprint-2 mls_* writes as "direct" (not synced through canonical store).
-- mls_sync_at = NULL means "was written directly"; this query leaves them NULL
-- since they weren't written through the sync path. Only the canonical sync path
-- sets this column going forward.

-- Index to make the sync audit query fast
CREATE INDEX IF NOT EXISTS idx_properties_mls_sync_at
  ON properties(mls_sync_at)
  WHERE mls_sync_at IS NOT NULL;
