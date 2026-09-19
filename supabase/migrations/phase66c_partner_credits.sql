-- Phase 6.6-C: Set partner_founder included_monthly_credits to 0
--
-- Architecture decision (2026-08-17): NextKey OS operates on a credit-purchase
-- model. Partners and founders do NOT receive a meaningful monthly credit
-- subsidy for paid third-party vendor usage. Vendor costs (REAPI, skip trace)
-- must be covered by purchased credits, not internal subsidy.
--
-- This migration zeroes out the monthly credit grant for partner_founder so that:
--   1. Activating a partner_founder subscription does not grant free monthly credits.
--   2. Existing partner_founder subscriptions will not generate credits on renewal.
--   3. Partners who need credits must purchase them via credit packs.
--
-- Subscription pricing (display price, discount) is unchanged.
-- The is_active and is_public flags are unchanged.
-- The vendor cost cap (account_vendor_cost_caps) is unchanged — it stays at
-- the plan-level cap synced during subscription activation.

UPDATE subscription_plans
SET
  included_monthly_credits = 0,
  updated_at = now()
WHERE plan_key = 'partner_founder';
