-- Phase 6.6-B: Ingestion Gateway support
--
-- 1. Add metadata JSONB to scraper_runs for checkpoint persistence.
--    Stored shape: { checkpoint: IngestionCheckpoint[], pause_reason: string }
--
-- 2. Add property_detail_lookup pricing (REAPI /PropertyDetail — case number lookup).
--    5¢/call, no customer credits (supplementary background enrichment).

-- ─── scraper_runs: checkpoint column ─────────────────────────────────────────
ALTER TABLE scraper_runs
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ─── Feature pricing: property_detail_lookup ──────────────────────────────────
INSERT INTO feature_pricing_versions (
  feature_key, display_name, provider_key,
  expected_vendor_cost_cents, platform_overhead_cents, risk_buffer_cents,
  customer_credit_cost, is_enabled, disable_reason, requires_confirmed_cost,
  effective_from
)
VALUES (
  'property_detail_lookup', 'Property Detail Lookup', 'reapi',
  5, 0, 0, 0, true, null, false,
  '2026-01-01 00:00:00+00'
)
ON CONFLICT (feature_key, effective_from) DO UPDATE SET
  is_enabled     = EXCLUDED.is_enabled,
  disable_reason = EXCLUDED.disable_reason,
  updated_at     = now();
