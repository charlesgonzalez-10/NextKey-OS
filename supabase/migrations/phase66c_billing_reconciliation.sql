-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 6.6-C — Billing Reconciliation RPCs
--
-- Provides three helper functions called by providerGateway.finalize() to
-- reconcile actual vs estimated costs after a provider call completes.
--
-- Required by all variable-cost providers (AI, OCR, future MLS lookups, any
-- provider where actual cost may differ from the pre-call estimate).
--
-- All functions are safe to run multiple times (CREATE OR REPLACE).
--
-- fn_adjust_pool_spent(p_pool_key, p_delta_cents)
--   Adds p_delta_cents to api_budget_pools.spent_this_period_cents.
--   Called when actual_cost ≠ estimated_cost to reconcile the pool after finalization.
--   p_delta_cents is signed: positive = cost overrun, negative = partial refund.
--   Clamps spent_this_period_cents to [0, monthly_limit_cents].
--
-- fn_adjust_account_cost(p_account_id, p_delta_cents)
--   Adds p_delta_cents to account_vendor_cost_caps.spent_this_period_cents.
--   Mirrors pool adjustment at the per-account level.
--   Clamps to [0, effective_cap_cents] (cannot exceed cap in reconciliation).
--
-- fn_adjust_reserved_credits(p_account_id, p_delta)
--   Adds p_delta to credit_wallets.reserved_credits.
--   Called when a provider call fails to release the reserved credits.
--   p_delta is signed negative to release (e.g. -1 releases 1 reserved credit).
--   Clamps to [0, ∞).
--
-- Security: all functions are SECURITY DEFINER with search_path locked to
-- public so they execute as the role that created them (service role).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── fn_adjust_pool_spent ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_adjust_pool_spent(
  p_pool_key    text,
  p_delta_cents integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE api_budget_pools
  SET
    spent_this_period_cents = GREATEST(
      0,
      LEAST(monthly_limit_cents, spent_this_period_cents + p_delta_cents)
    ),
    updated_at = now()
  WHERE pool_key = p_pool_key;

  IF NOT FOUND THEN
    RAISE WARNING 'fn_adjust_pool_spent: pool_key % not found', p_pool_key;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_adjust_pool_spent IS
  'Reconcile api_budget_pools.spent_this_period_cents after actual cost is known. '
  'p_delta_cents is signed: positive = overrun, negative = refund. '
  'Clamps to [0, monthly_limit_cents].';

-- ─── fn_adjust_account_cost ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_adjust_account_cost(
  p_account_id  uuid,
  p_delta_cents integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap account_vendor_cost_caps%ROWTYPE;
BEGIN
  SELECT * INTO v_cap
  FROM account_vendor_cost_caps
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE WARNING 'fn_adjust_account_cost: no cost cap row for account %', p_account_id;
    RETURN;
  END IF;

  UPDATE account_vendor_cost_caps
  SET
    spent_this_period_cents = GREATEST(
      0,
      -- Allow reconciliation up to effective_cap; never let a reconciliation
      -- push spend above the cap (it was reserved under the cap at authorize time).
      LEAST(v_cap.effective_cap_cents, v_cap.spent_this_period_cents + p_delta_cents)
    ),
    updated_at = now()
  WHERE account_id = p_account_id;
END;
$$;

COMMENT ON FUNCTION fn_adjust_account_cost IS
  'Reconcile account_vendor_cost_caps.spent_this_period_cents after actual cost is known. '
  'p_delta_cents is signed: positive = overrun, negative = refund. '
  'Clamps to [0, effective_cap_cents].';

-- ─── fn_adjust_reserved_credits ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_adjust_reserved_credits(
  p_account_id uuid,
  p_delta      integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE credit_wallets
  SET
    reserved_credits = GREATEST(0, reserved_credits + p_delta),
    updated_at       = now()
  WHERE account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE WARNING 'fn_adjust_reserved_credits: no wallet for account %', p_account_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_adjust_reserved_credits IS
  'Adjust credit_wallets.reserved_credits. '
  'Called on provider failure to release reserved credits (p_delta is negative). '
  'Clamps to 0 — reserved_credits cannot go below zero.';

-- ─── Grant execute to service role ───────────────────────────────────────────
-- The service role is used by all server-side billing operations.
-- These functions are not exposed to authenticated users directly.

DO $$
DECLARE
  svc_role text;
BEGIN
  -- Detect the service role name (varies by Supabase project)
  SELECT rolname INTO svc_role
  FROM pg_roles
  WHERE rolname IN ('service_role', 'supabase_service_role')
  LIMIT 1;

  IF svc_role IS NOT NULL THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION fn_adjust_pool_spent(text, integer) TO %I', svc_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION fn_adjust_account_cost(uuid, integer) TO %I', svc_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION fn_adjust_reserved_credits(uuid, integer) TO %I', svc_role);
  END IF;
END $$;
