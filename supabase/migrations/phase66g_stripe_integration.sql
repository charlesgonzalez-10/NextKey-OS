-- Phase 66g: Stripe Integration Schema (hardened)
-- stripe_events tracks per-event attempt state so Stripe can retry transient failures
-- without causing duplicate fulfillment on success.

-- ── stripe_events ─────────────────────────────────────────────────────────────
-- processing_status lifecycle:
--   received          → insert on first receipt (not yet dispatched)
--   processing        → handler running
--   processed         → fulfilled; duplicate events return 200 without re-running
--   permanent_failure → business-rule rejection; Stripe should NOT retry (return 200)
--   retryable_failure → transient DB/network error; Stripe SHOULD retry (return 500)

CREATE TABLE IF NOT EXISTS stripe_events (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id          text        NOT NULL UNIQUE,
  event_type        text        NOT NULL,
  account_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  processing_status text        NOT NULL DEFAULT 'received'
                    CHECK (processing_status IN (
                      'received', 'processing', 'processed',
                      'permanent_failure', 'retryable_failure'
                    )),
  attempt_count     integer     NOT NULL DEFAULT 0,
  last_error        text,
  payload           jsonb,
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at   timestamptz,
  processed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id
  ON stripe_events (event_id);

-- Fast scan for events that may need admin attention or reprocessing
CREATE INDEX IF NOT EXISTS idx_stripe_events_retryable
  ON stripe_events (processing_status, first_received_at DESC)
  WHERE processing_status IN ('received', 'processing', 'retryable_failure');

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- No user may read or write stripe_events — service role only
CREATE POLICY "service_role_only" ON stripe_events USING (false) WITH CHECK (false);

-- ── account_subscriptions: extend status CHECK for full Stripe lifecycle ──────
-- Drop old constraint first (idempotent — IF EXISTS)

ALTER TABLE account_subscriptions
  DROP CONSTRAINT IF EXISTS account_subscriptions_status_check;

ALTER TABLE account_subscriptions
  ADD CONSTRAINT account_subscriptions_status_check
  CHECK (status IN (
    'active',
    'trialing',
    'past_due',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'paused',
    'cancelled'
  ));

-- ── account_subscriptions: Stripe lifecycle columns ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'account_subscriptions' AND column_name = 'payment_provider'
  ) THEN
    ALTER TABLE account_subscriptions
      ADD COLUMN payment_provider         text,
      ADD COLUMN external_customer_id     text,
      ADD COLUMN external_subscription_id text,
      ADD COLUMN cancel_at_period_end     boolean NOT NULL DEFAULT false,
      ADD COLUMN cancelled_at             timestamptz;
  END IF;
END $$;

-- ── credit_products: display_order ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_products' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE credit_products ADD COLUMN display_order integer NOT NULL DEFAULT 0;
    UPDATE credit_products SET display_order = CASE product_key
      WHEN 'pack_250'  THEN 1
      WHEN 'pack_500'  THEN 2
      WHEN 'pack_1000' THEN 3
      WHEN 'pack_2500' THEN 4
      ELSE 99
    END;
  END IF;
END $$;

-- ── subscription_plans: Stripe price ID columns ───────────────────────────────
-- (Already in phase66_commerce_schema.sql — this is a no-op safety guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_plans' AND column_name = 'external_price_id_monthly'
  ) THEN
    ALTER TABLE subscription_plans
      ADD COLUMN external_price_id_monthly text,
      ADD COLUMN external_price_id_annual  text,
      ADD COLUMN external_product_id       text;
  END IF;
END $$;

-- ── credit_purchases: Stripe customer ID for portal lookup ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_purchases' AND column_name = 'payment_provider_customer_id'
  ) THEN
    ALTER TABLE credit_purchases ADD COLUMN payment_provider_customer_id text;
  END IF;
END $$;
