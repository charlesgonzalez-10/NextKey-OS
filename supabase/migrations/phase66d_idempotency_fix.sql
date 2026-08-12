-- phase66d_idempotency_fix.sql
--
-- Root cause: fn_reserve_budget_and_credits inserts into api_budget_reservations
-- which has UNIQUE(request_id). When the same request_id arrives twice (e.g. a
-- page reload within the same session minute), Postgres throws SQLSTATE 23505
-- before returning a structured JSON response. The JavaScript caller cannot
-- distinguish 23505 from a real infrastructure failure and was mapping it to
-- 'authorization_unavailable'.
--
-- Fix: add an idempotency check at the top of the function.
--   • finalized  → return success:false / error_code:'idempotent_duplicate'
--   • reserved   → return success:false / error_code:'idempotent_in_flight'
--   • released | expired → fall through and allow a new reservation
--
-- The primary prevention (per-request UUID in searchSessionId) is in
-- app/api/property-search/live/route.ts. This migration is the DB-level defence.

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
  v_pool            api_budget_pools%ROWTYPE;
  v_cost_cap        account_vendor_cost_caps%ROWTYPE;
  v_wallet          credit_wallets%ROWTYPE;
  v_feature         feature_pricing_versions%ROWTYPE;
  v_provider        api_providers%ROWTYPE;
  v_available_credits integer;
  v_budget_res_id   uuid;
  v_credit_res_id   uuid;
  v_existing_status text;
BEGIN

  -- ── Idempotency check ────────────────────────────────────────────────────────
  -- If this request_id already has a reservation, return a structured response
  -- instead of letting the UNIQUE constraint throw an untyped exception.
  SELECT status INTO v_existing_status
  FROM api_budget_reservations
  WHERE request_id = p_request_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_status = 'finalized' THEN
      RETURN jsonb_build_object(
        'success', false, 'gate_failed', 0,
        'error_code', 'idempotent_duplicate',
        'error_message', 'Request already completed. Use cached results.'
      );
    ELSIF v_existing_status = 'reserved' THEN
      RETURN jsonb_build_object(
        'success', false, 'gate_failed', 0,
        'error_code', 'idempotent_in_flight',
        'error_message', 'Request is already in progress.'
      );
    END IF;
    -- released or expired: fall through and allow a new reservation
  END IF;

  -- ── Check provider enabled ────────────────────────────────────────────────
  SELECT * INTO v_provider FROM api_providers WHERE provider_key = p_provider_key;
  IF NOT FOUND OR NOT v_provider.is_enabled THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 6, 'error_code', 'provider_disabled',
      'error_message', 'Provider is disabled or not registered'
    );
  END IF;

  -- ── Check feature enabled ─────────────────────────────────────────────────
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

  -- For zero-cost features: no budget or credit reservation needed
  IF p_is_zero_cost_feature THEN
    RETURN jsonb_build_object(
      'success', true, 'zero_cost', true,
      'budget_reservation_id', null, 'credit_reservation_id', null
    );
  END IF;

  -- ── Lock pool row (gate 3: pool capacity) ─────────────────────────────────
  SELECT * INTO v_pool FROM api_budget_pools WHERE pool_key = p_pool_key FOR UPDATE;
  IF NOT FOUND OR NOT v_pool.is_active THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 3, 'error_code', 'pool_not_found',
      'error_message', 'Budget pool not found or inactive'
    );
  END IF;

  IF (v_pool.spent_this_period_cents + p_estimated_cost_cents) > v_pool.monthly_limit_cents THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 3, 'error_code', 'pool_exhausted',
      'error_message', 'Customer shared budget pool is at capacity'
    );
  END IF;

  -- Gate 5: protected reserve isolation
  IF v_pool.is_protected THEN
    RETURN jsonb_build_object(
      'success', false, 'gate_failed', 5, 'error_code', 'protected_pool',
      'error_message', 'Cannot draw from a protected pool without an explicit override'
    );
  END IF;

  -- ── Lock account cost cap row (gate 2) ────────────────────────────────────
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

  -- ── Lock wallet row (gate 1) ──────────────────────────────────────────────
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

  -- ── All gates passed: create reservations ────────────────────────────────

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

GRANT EXECUTE ON FUNCTION fn_reserve_budget_and_credits(text, uuid, text, text, text, integer, integer, boolean)
  TO service_role;
