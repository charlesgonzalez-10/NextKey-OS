-- Phase 6.6-B: Background system account billing gate upgrade
--
-- Replaces fn_reserve_budget_and_credits with a version that correctly handles
-- the background system account (00000000-0000-0000-0000-000000000001).
--
-- Previously, background calls passed estimated_cost_cents=0 to avoid gate 2
-- (per-account cap) failing — the background account has no row in
-- account_vendor_cost_caps (which requires auth.users FK). This violated
-- the Phase 6.6 hard-stop invariant: every metered paid-provider call must
-- reserve a non-zero conservative vendor-cost estimate before the provider executes.
--
-- Corrected background account gate flow:
--   Gate 6 (provider/feature enabled): enforced — unknown/disabled features block
--   Gate 3 (pool capacity):            enforced — background_operations pool = 500¢/month
--   Gate 5 (protected pool):           enforced — background_operations is NOT protected
--   Gate 2 (per-account cap):          BYPASSED — no account_vendor_cost_caps row
--   Gate 1 (credit balance):           BYPASSED — credit_cost is always 0 for background
--
-- Budget reservation:  created with account_id = NULL (nullable FK allows this)
-- Credit reservation:  NOT created for background account
-- Pool spend:          updated exactly as for regular accounts
--
-- For all regular (non-background) accounts, behavior is identical to before.

CREATE OR REPLACE FUNCTION fn_reserve_budget_and_credits(
  p_request_id           text,
  p_account_id           uuid,
  p_feature_key          text,
  p_provider_key         text,
  p_pool_key             text,
  p_estimated_cost_cents integer,
  p_credit_cost          integer,
  p_is_zero_cost_feature boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  c_bg_account constant uuid := '00000000-0000-0000-0000-000000000001';
  v_pool            api_budget_pools%ROWTYPE;
  v_cost_cap        account_vendor_cost_caps%ROWTYPE;
  v_wallet          credit_wallets%ROWTYPE;
  v_feature         feature_pricing_versions%ROWTYPE;
  v_provider        api_providers%ROWTYPE;
  v_available_credits integer;
  v_budget_res_id   uuid;
  v_credit_res_id   uuid;
BEGIN
  -- ── Gate 6: Provider enabled ─────────────────────────────────────────────────
  SELECT * INTO v_provider FROM api_providers WHERE provider_key = p_provider_key;
  IF NOT FOUND OR NOT v_provider.is_enabled THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 6, 'error_code', 'provider_disabled',
      'error_message', 'Provider is disabled or not registered'
    );
  END IF;

  -- ── Gate 6: Feature enabled ───────────────────────────────────────────────────
  SELECT * INTO v_feature
  FROM feature_pricing_versions
  WHERE feature_key = p_feature_key
    AND is_active = true
    AND is_enabled = true
    AND effective_from <= now()
    AND (effective_to IS NULL OR effective_to > now())
  ORDER BY effective_from DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 6, 'error_code', 'feature_disabled',
      'error_message', 'Feature is not enabled or no active pricing version found'
    );
  END IF;

  -- Zero-cost features: no budget or credit reservation needed
  IF p_is_zero_cost_feature THEN
    RETURN jsonb_build_object(
      'success', true, 'zero_cost', true,
      'budget_reservation_id', null, 'credit_reservation_id', null
    );
  END IF;

  -- ── Gate 3: Pool capacity (FOR UPDATE acquires the serialization lock) ────────
  SELECT * INTO v_pool FROM api_budget_pools WHERE pool_key = p_pool_key FOR UPDATE;
  IF NOT FOUND OR NOT v_pool.is_active THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 3, 'error_code', 'pool_not_found',
      'error_message', 'Budget pool not found or inactive'
    );
  END IF;

  -- Gate 4: Global budget is enforced at config time (updatePoolLimit checks total ≤ 10,000¢).
  -- Gate 3: Pool monthly limit.
  IF (v_pool.spent_this_period_cents + p_estimated_cost_cents) > v_pool.monthly_limit_cents THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 3, 'error_code', 'pool_exhausted',
      'error_message', 'Budget pool is at capacity'
    );
  END IF;

  -- Gate 5: Protected pool isolation
  IF v_pool.is_protected THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 5, 'error_code', 'protected_pool',
      'error_message', 'Cannot draw from a protected pool without an explicit override'
    );
  END IF;

  -- ── Background system account: skip gates 2 and 1 ───────────────────────────
  -- Gate 3 (pool capacity) is the sole throttle for background spend.
  -- The background account has no account_vendor_cost_caps or credit_wallets row
  -- (both require auth.users FK). Budget reservation uses account_id = NULL.
  IF p_account_id = c_bg_account THEN
    v_budget_res_id := gen_random_uuid();
    INSERT INTO api_budget_reservations (
      id, request_id, pool_key, account_id, provider_key, feature_key,
      estimated_cost_cents, status
    ) VALUES (
      v_budget_res_id, p_request_id, p_pool_key, NULL, p_provider_key, p_feature_key,
      p_estimated_cost_cents, 'reserved'
    );
    UPDATE api_budget_pools
    SET spent_this_period_cents = spent_this_period_cents + p_estimated_cost_cents,
        updated_at = now()
    WHERE pool_key = p_pool_key;
    RETURN jsonb_build_object(
      'success', true,
      'budget_reservation_id', v_budget_res_id,
      'credit_reservation_id', null,
      'pool_remaining_before', v_pool.monthly_limit_cents - v_pool.spent_this_period_cents
    );
  END IF;

  -- ── Gate 2: Per-account vendor cost cap ──────────────────────────────────────
  SELECT * INTO v_cost_cap FROM account_vendor_cost_caps WHERE account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 2, 'error_code', 'no_cost_cap',
      'error_message', 'Account has no cost cap record. Run ensureCapExists first.'
    );
  END IF;

  IF (v_cost_cap.spent_this_period_cents + p_estimated_cost_cents) > v_cost_cap.effective_cap_cents THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 2, 'error_code', 'account_cap_exceeded',
      'error_message', 'Account internal vendor cost cap reached for this billing period'
    );
  END IF;

  -- ── Gate 1: Credit wallet balance ────────────────────────────────────────────
  SELECT * INTO v_wallet FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 1, 'error_code', 'no_wallet',
      'error_message', 'Account has no credit wallet. Run ensureWalletExists first.'
    );
  END IF;

  IF v_wallet.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 1, 'error_code', 'wallet_frozen',
      'error_message', 'Account wallet is not active'
    );
  END IF;

  v_available_credits :=
    v_wallet.available_monthly_credits +
    v_wallet.available_purchased_credits +
    v_wallet.available_bonus_credits -
    v_wallet.reserved_credits;

  IF v_available_credits < p_credit_cost THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 1, 'error_code', 'insufficient_credits',
      'error_message', 'Insufficient Premium Credits'
    );
  END IF;

  -- ── All gates passed: create reservations ────────────────────────────────────
  v_budget_res_id := gen_random_uuid();
  INSERT INTO api_budget_reservations (
    id, request_id, pool_key, account_id, provider_key, feature_key,
    estimated_cost_cents, status
  ) VALUES (
    v_budget_res_id, p_request_id, p_pool_key, p_account_id, p_provider_key, p_feature_key,
    p_estimated_cost_cents, 'reserved'
  );

  UPDATE api_budget_pools
  SET spent_this_period_cents = spent_this_period_cents + p_estimated_cost_cents,
      updated_at = now()
  WHERE pool_key = p_pool_key;

  UPDATE account_vendor_cost_caps
  SET spent_this_period_cents = spent_this_period_cents + p_estimated_cost_cents,
      updated_at = now()
  WHERE account_id = p_account_id;

  v_credit_res_id := gen_random_uuid();
  INSERT INTO credit_reservations (
    id, request_id, wallet_id, account_id, feature_key, reserved_credits, status
  ) VALUES (
    v_credit_res_id, p_request_id, v_wallet.id, p_account_id, p_feature_key, p_credit_cost, 'reserved'
  );

  UPDATE credit_wallets
  SET reserved_credits = reserved_credits + p_credit_cost,
      updated_at = now()
  WHERE account_id = p_account_id;

  RETURN jsonb_build_object(
    'success', true,
    'budget_reservation_id', v_budget_res_id,
    'credit_reservation_id', v_credit_res_id,
    'available_credits_before', v_available_credits,
    'pool_remaining_before', v_pool.monthly_limit_cents - v_pool.spent_this_period_cents,
    'cap_remaining_before', v_cost_cap.effective_cap_cents - v_cost_cap.spent_this_period_cents
  );
END;
$$;
