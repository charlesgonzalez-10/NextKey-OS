-- Phase 6.6-B: property_search_criteria feature pricing
--
-- Used for live multi-result REAPI criteria searches (the "search map" UI).
-- Vendor cost: 5¢/page — identical to property_lookup_basic.
-- Customer credit cost: 1 credit per search ACTION (not per page).
--   Page 1 of a search charges the credit. Pages 2+ charge 0 credits.
-- Max paid pages per action: 2 (enforced in executeGatewaySearch config).

INSERT INTO feature_pricing_versions (
  feature_key, display_name, provider_key,
  expected_vendor_cost_cents, platform_overhead_cents, risk_buffer_cents,
  customer_credit_cost, is_enabled, disable_reason, requires_confirmed_cost,
  effective_from
)
VALUES (
  'property_search_criteria', 'Live Property Search', 'reapi',
  5, 0, 0, 1, true, null, false,
  '2026-01-01 00:00:00+00'
)
ON CONFLICT (feature_key, effective_from) DO UPDATE SET
  is_enabled     = EXCLUDED.is_enabled,
  disable_reason = EXCLUDED.disable_reason,
  updated_at     = now();
