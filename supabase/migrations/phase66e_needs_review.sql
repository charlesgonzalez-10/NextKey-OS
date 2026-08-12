-- ─── phase66e_needs_review.sql ────────────────────────────────────────────────
--
-- Adds 'needs_review' status to billing reservation tables so the reconciliation
-- service can flag reservations where the provider outcome is ambiguous.
--
-- Apply manually at:
--   https://supabase.com/dashboard/project/osueksootkjhhgjdpqyy/sql/new
--
-- After applying, run:  NOTIFY pgrst, 'reload schema';
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Extend api_budget_reservations status to include 'needs_review'
ALTER TABLE api_budget_reservations
  DROP CONSTRAINT IF EXISTS api_budget_reservations_status_check;

ALTER TABLE api_budget_reservations
  ADD CONSTRAINT api_budget_reservations_status_check
  CHECK (status IN ('reserved', 'finalized', 'released', 'expired', 'needs_review'));

-- 2. Extend credit_reservations status to include 'needs_review'
ALTER TABLE credit_reservations
  DROP CONSTRAINT IF EXISTS credit_reservations_status_check;

ALTER TABLE credit_reservations
  ADD CONSTRAINT credit_reservations_status_check
  CHECK (status IN ('reserved', 'finalized', 'released', 'expired', 'needs_review'));

-- 3. Read-only billing health check function (for diagnostics endpoint)
--    Returns a snapshot of reservation state and wallet drift. Zero side effects.
CREATE OR REPLACE FUNCTION fn_billing_diagnostics_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget_by_status   jsonb;
  v_credit_by_status   jsonb;
  v_stale_budget       integer;
  v_stale_credit       integer;
  v_drift_credits      integer := 0;
  v_drift_accounts     integer := 0;
  v_now                timestamptz := now();
BEGIN
  -- Budget reservation counts by status
  SELECT jsonb_object_agg(status, cnt)
  INTO v_budget_by_status
  FROM (
    SELECT status, COUNT(*) AS cnt
    FROM api_budget_reservations
    GROUP BY status
  ) s;

  -- Credit reservation counts by status
  SELECT jsonb_object_agg(status, cnt)
  INTO v_credit_by_status
  FROM (
    SELECT status, COUNT(*) AS cnt
    FROM credit_reservations
    GROUP BY status
  ) s;

  -- Stale in-flight counts
  SELECT COUNT(*) INTO v_stale_budget
  FROM api_budget_reservations
  WHERE status = 'reserved' AND expires_at < v_now;

  SELECT COUNT(*) INTO v_stale_credit
  FROM credit_reservations
  WHERE status = 'reserved' AND expires_at < v_now;

  -- Wallet reserved_credits drift
  SELECT
    COUNT(CASE WHEN w.reserved_credits <> COALESCE(a.actual, 0) THEN 1 END),
    SUM(w.reserved_credits - COALESCE(a.actual, 0))
  INTO v_drift_accounts, v_drift_credits
  FROM credit_wallets w
  LEFT JOIN (
    SELECT wallet_id, SUM(reserved_credits) AS actual
    FROM credit_reservations
    WHERE status = 'reserved' AND expires_at > v_now
    GROUP BY wallet_id
  ) a ON a.wallet_id = w.id;

  RETURN jsonb_build_object(
    'budget_by_status',      COALESCE(v_budget_by_status, '{}'),
    'credit_by_status',      COALESCE(v_credit_by_status, '{}'),
    'stale_budget',          v_stale_budget,
    'stale_credit',          v_stale_credit,
    'drift_credits',         COALESCE(v_drift_credits, 0),
    'drift_accounts',        COALESCE(v_drift_accounts, 0),
    'needs_reconciliation',  (v_stale_budget > 0 OR v_stale_credit > 0 OR COALESCE(v_drift_credits, 0) > 0),
    'checked_at',            v_now
  );
END;
$$;

COMMENT ON FUNCTION fn_billing_diagnostics_check IS
  'Read-only billing health snapshot. Zero side effects. Safe for polling.';

-- 4. Grant execute to service role
DO $$
DECLARE svc_role text;
BEGIN
  SELECT rolname INTO svc_role FROM pg_roles WHERE rolname ILIKE '%service_role%' LIMIT 1;
  IF svc_role IS NOT NULL THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION fn_billing_diagnostics_check() TO %I', svc_role);
  END IF;
END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
