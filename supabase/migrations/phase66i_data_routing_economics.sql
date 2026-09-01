-- Phase 6.6-I: Data Routing + Economics — Architecture Safety Guards
--
-- Context: Phase 6.6 simplified NextKey OS from county-PA-first routing to
-- national-provider-first (REAPI as the single paid external provider for
-- single-property lookup). This migration ensures the DB config reflects
-- that architecture and provides idempotent guards against accidental
-- re-enablement of gated features.
--
-- All statements are idempotent and additive — safe to re-run.
-- No new tables or columns. No data is deleted.
--
-- Applied after:
--   phase66h_economics.sql     (Stripe catalog + vendor caps)
--   phase66c_partner_credits.sql (partner_founder zero monthly credits)

-- ─── 1. Skip-trace feature gate — confirm disabled ─────────────────────────
-- contact_enrichment must stay DB-disabled until a skip-trace provider is
-- selected and priced. The gateway enforces this at gate 6; this is a
-- belt-and-suspenders guard so a bad migration cannot accidentally unlock it.

UPDATE feature_pricing_versions
SET
  is_enabled      = false,
  disable_reason  = 'Disabled: skip trace provider and pricing not yet selected. Enable only after vendor contract and credit pricing are finalized.',
  updated_at      = now()
WHERE feature_key = 'contact_enrichment'
  AND is_enabled  = true;   -- no-op if already false

-- ─── 2. Partner / Founder plan — confirm private and zero monthly credits ──
-- partner_founder is an admin-assigned private beta plan. It must never
-- appear in the public plan selection UI.

UPDATE subscription_plans
SET
  is_public  = false,
  updated_at = now()
WHERE plan_key  = 'partner_founder'
  AND is_public = true;   -- no-op if already false

-- belt-and-suspenders for zero monthly credits (also in phase66c)
UPDATE subscription_plans
SET
  included_monthly_credits = 0,
  updated_at               = now()
WHERE plan_key                = 'partner_founder'
  AND included_monthly_credits != 0;   -- no-op if already 0

-- ─── 3. Architecture notes ────────────────────────────────────────────────
-- The following architecture decisions are recorded as code comments only;
-- no system_config table exists yet (future work if diagnostics need it).
--
-- Routing strategy (national_provider_first_v1):
--   DB-first cache → REAPI (single paid provider for single-property lookup)
--   → distress overlay. County PA adapters removed from all hot paths.
--
-- MLS comps credit rule: platform_cost_no_user_credit
--   Comps fetches (Rentcast / Beaches MLS) are platform costs.
--   Not charged to user credit wallets. Gated by subscription plan only.
--
-- Default pagination: maxPaidPages=1, maxTotalRecords=50, maxVendorCostCents=10
--   Enforced in code at lib/search/reapi-search.ts DEFAULT_SEARCH_CONFIG.
