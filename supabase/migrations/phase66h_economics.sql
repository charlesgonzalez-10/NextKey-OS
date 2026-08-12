-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 6.6-H — Economics layer hardening
--
-- Additive and idempotent. Safe to re-run.
-- Does NOT modify: fn_reserve_budget_and_credits, pool limits, global budget,
--   Stripe tables, existing vendor caps, or any existing feature pricing rows.
--
-- Changes:
--   1. Feature key fixes: property_detail_lookup, distress_ingestion_search
--   2. comps_refresh vendor cost correction (3 REAPI calls = 15¢)
--   3. partner_founder subscription plan
--   4. is_partner flag on subscription_plans
--   5. Provider wallet state on api_provider_health
--   6. admin_action_log table
--   7. Economics query indexes
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Feature key fixes ─────────────────────────────────────────────────────

-- property_detail_lookup: used by reapi-case-lookup.ts for /PropertyDetail calls.
-- Always background — credit_cost = 0. Fixes gate-6 blocker that silently blocked
-- all distress case number lookups.

INSERT INTO feature_pricing_versions (
  feature_key, display_name, provider_key,
  expected_vendor_cost_cents, platform_overhead_cents, risk_buffer_cents,
  customer_credit_cost, is_enabled, disable_reason, requires_confirmed_cost,
  effective_from
)
VALUES (
  'property_detail_lookup', 'Property Detail Lookup (Case/Foreclosure)', 'reapi',
  5, 0, 0, 0, true, null, false,
  '2026-01-01 00:00:00+00'
)
ON CONFLICT (feature_key, effective_from) DO UPDATE SET
  is_enabled     = EXCLUDED.is_enabled,
  disable_reason = EXCLUDED.disable_reason,
  updated_at     = now();

-- distress_ingestion_search: used by reapi-engine.ts for background bulk REAPI
-- search during distress record ingestion. Separated from property_search_criteria
-- so economics reporting can independently aggregate:
--   customer-triggered live searches (property_search_criteria)
--   background ingestion cost (distress_ingestion_search)

INSERT INTO feature_pricing_versions (
  feature_key, display_name, provider_key,
  expected_vendor_cost_cents, platform_overhead_cents, risk_buffer_cents,
  customer_credit_cost, is_enabled, disable_reason, requires_confirmed_cost,
  effective_from
)
VALUES (
  'distress_ingestion_search', 'Distress Ingestion Search (Background)', 'reapi',
  5, 0, 0, 0, true, null, false,
  '2026-01-01 00:00:00+00'
)
ON CONFLICT (feature_key, effective_from) DO UPDATE SET
  is_enabled     = EXCLUDED.is_enabled,
  disable_reason = EXCLUDED.disable_reason,
  updated_at     = now();

-- ─── 2. comps_refresh vendor cost correction ──────────────────────────────────
-- A full comps refresh makes 3 parallel REAPI /PropertyComps calls (active, pending, sold).
-- Each call is ~$0.05 (same tier as /PropertySearch). Total = ~$0.15 per refresh.
-- Update expected_vendor_cost_cents from 8 to 15 to reflect actual call multiplicity.
-- Credit cost remains 3 (one operation from the customer's perspective).
-- This is NOT a new pricing version — it corrects the seeded estimate before any
-- production usage has accumulated.

UPDATE feature_pricing_versions
SET expected_vendor_cost_cents = 15,
    updated_at                 = now()
WHERE feature_key      = 'comps_refresh'
  AND is_active        = true
  AND is_enabled       = true
  AND expected_vendor_cost_cents = 8;   -- only update if still at original value

-- ─── 3. is_partner flag on subscription_plans ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_plans' AND column_name = 'is_partner'
  ) THEN
    ALTER TABLE subscription_plans ADD COLUMN is_partner boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ─── 4. partner_founder subscription plan ────────────────────────────────────
-- Private beta plan. Assigned by admin only.
-- $10/month vendor cap (1,000 cents) — conservative for early testing.
-- 2,000 monthly credits.
-- NOT public. NOT visible in plan selection.
-- hard_stop_enabled = true — never bypasses gates.

INSERT INTO subscription_plans (
  plan_key, display_name, description,
  monthly_price_cents, annual_price_cents,
  included_monthly_credits, default_vendor_cost_cap_cents,
  rollover_policy, can_buy_credit_packs,
  hard_stop_enabled, is_public, is_active, is_partner
)
VALUES (
  'partner_founder',
  'Partner / Founder',
  'Private early-access plan for partners, testers, and strategic users. Assigned by admin only. Not available for public purchase.',
  NULL, NULL,
  2000, 1000,
  'no_rollover', true,
  true, false, true, true
)
ON CONFLICT (plan_key) DO UPDATE SET
  display_name                  = EXCLUDED.display_name,
  included_monthly_credits      = EXCLUDED.included_monthly_credits,
  default_vendor_cost_cap_cents = EXCLUDED.default_vendor_cost_cap_cents,
  is_partner                    = EXCLUDED.is_partner,
  updated_at                    = now();

-- ─── 5. Provider wallet state on api_providers ────────────────────────────────
-- api_providers is the single-row-per-provider state table. Wallet columns go here,
-- not on api_provider_health (which is a log table — one row per health event).
--
-- wallet_state is independent from call-outcome events (api_provider_health):
--   api_provider_health.status = derived from actual API call outcomes (recordHttpError)
--   api_providers.wallet_state = derived from manually entered balance (advisory)
--
-- HTTP 402 from REAPI drives a new api_provider_health row with status='depleted'
--   AND stamps api_providers.last_wallet_depleted_at (authoritative provider evidence).
-- Manual balance entry drives wallet_state transition (unknown/healthy/low/critical).
-- Only a confirmed HTTP 402 response sets wallet_state='depleted' via updateWalletBalance.
--
-- Manual balance entry does NOT set api_providers.is_enabled=false.
-- Admin must explicitly act after reviewing both status signals.

DO $$
BEGIN
  -- wallet_state: manual-balance-derived level, separate from call-outcome status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'wallet_state'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN wallet_state text
      NOT NULL DEFAULT 'unknown'
      CHECK (wallet_state IN ('unknown', 'healthy', 'low', 'critical', 'depleted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'known_balance_cents'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN known_balance_cents integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'balance_entered_at'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN balance_entered_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'balance_entered_by'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN balance_entered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'low_balance_threshold_cents'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN low_balance_threshold_cents integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'critical_balance_threshold_cents'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN critical_balance_threshold_cents integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'owner_reserve_cents'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN owner_reserve_cents integer;
  END IF;

  -- Computed: customer_usable = max(0, known_balance - owner_reserve)
  -- Only meaningful when known_balance_cents is not null.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'customer_usable_cents'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN customer_usable_cents
      integer GENERATED ALWAYS AS (
        CASE WHEN known_balance_cents IS NOT NULL
          THEN GREATEST(0, known_balance_cents - COALESCE(owner_reserve_cents, 0))
          ELSE NULL
        END
      ) STORED;
  END IF;

  -- Stamped by recordHttpError when a 402 is received — authoritative depleted evidence.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'last_wallet_depleted_at'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN last_wallet_depleted_at timestamptz;
  END IF;

  -- Stamped by admin action [Mark Refilled / Verify Provider] on the dashboard.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'last_refill_verified_at'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN last_refill_verified_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_providers' AND column_name = 'last_refill_verified_by'
  ) THEN
    ALTER TABLE api_providers ADD COLUMN last_refill_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 6. admin_action_log ─────────────────────────────────────────────────────
-- Immutable audit trail for all admin economic mutations.
-- Never UPDATE rows — new actions are always INSERTs.
-- Covers: pricing changes, feature enable/disable, provider disable, balance updates,
--   account cap overrides, bonus credit grants, partner plan assignments,
--   promotion creation/changes, budget changes.

CREATE TABLE IF NOT EXISTS admin_action_log (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id      uuid        NOT NULL REFERENCES auth.users(id),
  action_type   text        NOT NULL,
  entity_type   text        NOT NULL,
  entity_id     text,
  entity_label  text,
  before_value  jsonb,
  after_value   jsonb,
  reason        text,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aal_actor ON admin_action_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_entity ON admin_action_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_created ON admin_action_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_action ON admin_action_log(action_type, created_at DESC);

ALTER TABLE admin_action_log ENABLE ROW LEVEL SECURITY;
-- Admins can read; no one can write directly (service-role only)
CREATE POLICY IF NOT EXISTS "service_role_only" ON admin_action_log USING (false) WITH CHECK (false);

-- ─── 7. Economics query indexes ───────────────────────────────────────────────
-- Support efficient aggregation of api_usage_events by feature, provider, account.
-- Only create if they don't already exist (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_aue_provider_feature_occurred
  ON api_usage_events(provider_key, feature_key, occurred_at DESC)
  WHERE provider_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aue_success_cost
  ON api_usage_events(feature_key, success, cache_hit, actual_cost_cents, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_aue_account_month
  ON api_usage_events(account_id, occurred_at DESC)
  WHERE account_id IS NOT NULL AND provider_called = true;

-- ─── 8. Verification queries (comment only — run manually if needed) ──────────
-- SELECT feature_key, is_enabled FROM feature_pricing_versions
--   WHERE feature_key IN ('property_detail_lookup','distress_ingestion_search','comps_refresh')
--   AND is_active = true;
-- Expected: 3 rows, all enabled.

-- SELECT plan_key, included_monthly_credits, default_vendor_cost_cap_cents, is_partner
--   FROM subscription_plans WHERE plan_key = 'partner_founder';
-- Expected: 1 row, credits=2000, cap=1000, is_partner=true.

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='api_providers' AND column_name IN
--   ('wallet_state','known_balance_cents','customer_usable_cents','last_wallet_depleted_at');
-- Expected: 4 rows.

-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='admin_action_log';
-- Expected: 1 row.
