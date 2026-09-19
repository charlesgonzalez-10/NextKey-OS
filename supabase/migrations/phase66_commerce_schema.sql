-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 6.6 — API Budget, Premium Credits, Commerce, and Promotion Codes
--
-- Three-layer model:
--   Layer 1: Platform budget + pool isolation + per-account vendor cost caps
--   Layer 2: Customer Premium Credits (wallet, grants, ledger, reservations)
--   Layer 3: Commerce (subscription plans, credit packs, promotion codes)
--
-- All changes are purely additive.
-- Safe to run against any existing database state.
--
-- Approved configuration (all values DB-configurable after deploy):
--   Global budget:     $100/month
--   owner_reserved:    $30
--   customer_shared:   $50
--   emergency_reserved:$15
--   background_operations: $5
--
-- Per-plan vendor cost caps (monthly):
--   free_trial:    $0.50   starter:   $5    professional: $15
--   investor:      $25     enterprise: configurable   owner: $30
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. api_providers ────────────────────────────────────────────────────────
-- Registry of all external data providers used by the platform.
-- billing_model controls whether calls count against the $100 metered budget.

CREATE TABLE IF NOT EXISTS api_providers (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key                 text        NOT NULL UNIQUE,
  display_name                 text        NOT NULL,
  category                     text        NOT NULL DEFAULT 'property',
  is_paid                      boolean     NOT NULL DEFAULT true,
  billing_model                text        NOT NULL DEFAULT 'per_call'
                               CHECK (billing_model IN (
                                 'per_call', 'token', 'subscription', 'included_access'
                               )),
  default_estimated_cost_cents integer     NOT NULL DEFAULT 0,
  is_enabled                   boolean     NOT NULL DEFAULT true,
  base_url                     text,
  notes                        text,
  metadata                     jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_providers_key
  ON api_providers(provider_key);

-- ─── 2. api_budget_pools ─────────────────────────────────────────────────────
-- Named pools within the global $100/month platform budget.
-- is_protected = true means customer requests cannot draw from this pool.

CREATE TABLE IF NOT EXISTS api_budget_pools (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_key                text        NOT NULL UNIQUE,
  display_name            text        NOT NULL,
  description             text,
  monthly_limit_cents     integer     NOT NULL CHECK (monthly_limit_cents >= 0),
  spent_this_period_cents integer     NOT NULL DEFAULT 0 CHECK (spent_this_period_cents >= 0),
  period_start            timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  period_end              timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  is_protected            boolean     NOT NULL DEFAULT false,
  requires_owner_override boolean     NOT NULL DEFAULT false,
  priority                integer     NOT NULL DEFAULT 0,
  is_active               boolean     NOT NULL DEFAULT true,
  metadata                jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. api_budget_policies ──────────────────────────────────────────────────
-- Spend caps per provider within a pool.

CREATE TABLE IF NOT EXISTS api_budget_policies (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_key             text        NOT NULL REFERENCES api_budget_pools(pool_key) ON DELETE CASCADE,
  provider_key         text        REFERENCES api_providers(provider_key) ON DELETE CASCADE,
  feature_key          text,
  monthly_limit_cents  integer     NOT NULL CHECK (monthly_limit_cents >= 0),
  is_enabled           boolean     NOT NULL DEFAULT true,
  kill_switch_reason   text,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pool_key, provider_key, feature_key)
);

-- ─── 4. api_budget_reservations ──────────────────────────────────────────────
-- Pre-call budget holds. Created before the provider call, finalized after.

CREATE TABLE IF NOT EXISTS api_budget_reservations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id             text        NOT NULL UNIQUE,
  pool_key               text        NOT NULL REFERENCES api_budget_pools(pool_key),
  account_id             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_key           text        REFERENCES api_providers(provider_key),
  feature_key            text,
  estimated_cost_cents   integer     NOT NULL DEFAULT 0,
  actual_cost_cents      integer,
  status                 text        NOT NULL DEFAULT 'reserved'
                         CHECK (status IN ('reserved', 'finalized', 'released', 'expired')),
  expires_at             timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  finalized_at           timestamptz,
  metadata               jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abr_request_id ON api_budget_reservations(request_id);
CREATE INDEX IF NOT EXISTS idx_abr_pool_status ON api_budget_reservations(pool_key, status);
CREATE INDEX IF NOT EXISTS idx_abr_account ON api_budget_reservations(account_id) WHERE account_id IS NOT NULL;

-- ─── 5. api_usage_events ─────────────────────────────────────────────────────
-- Post-call log entry. Created after the provider call completes.

CREATE TABLE IF NOT EXISTS api_usage_events (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                 text        NOT NULL UNIQUE,
  pool_key                   text        REFERENCES api_budget_pools(pool_key),
  account_id                 uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_key               text        REFERENCES api_providers(provider_key),
  feature_key                text,
  reservation_id             uuid        REFERENCES api_budget_reservations(id),
  credit_transaction_id      uuid,
  actual_cost_cents          integer     NOT NULL DEFAULT 0,
  estimated_cost_cents       integer     NOT NULL DEFAULT 0,
  account_vendor_cost_cents  integer     NOT NULL DEFAULT 0,
  duration_ms                integer,
  cache_hit                  boolean     NOT NULL DEFAULT false,
  provider_called            boolean     NOT NULL DEFAULT false,
  success                    boolean     NOT NULL DEFAULT true,
  error_code                 text,
  response_metadata          jsonb,
  occurred_at                timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aue_account ON api_usage_events(account_id, occurred_at DESC) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aue_pool ON api_usage_events(pool_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_aue_feature ON api_usage_events(feature_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_aue_occurred ON api_usage_events(occurred_at DESC);

-- ─── 6. api_budget_overrides ─────────────────────────────────────────────────
-- Explicit owner authorizations to unlock a protected pool or exceed a limit.

CREATE TABLE IF NOT EXISTS api_budget_overrides (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_key     text        REFERENCES api_budget_pools(pool_key),
  provider_key text        REFERENCES api_providers(provider_key),
  account_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  override_type text       NOT NULL CHECK (override_type IN (
                             'unlock_pool', 'increase_limit', 'unlock_account'
                           )),
  reason       text        NOT NULL,
  granted_by   uuid        NOT NULL REFERENCES auth.users(id),
  expires_at   timestamptz,
  is_active    boolean     NOT NULL DEFAULT true,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── 7. subscription_plans ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key                      text        NOT NULL UNIQUE,
  display_name                  text        NOT NULL,
  description                   text,
  monthly_price_cents           integer,
  annual_price_cents            integer,
  currency                      text        NOT NULL DEFAULT 'USD',
  included_monthly_credits      integer     NOT NULL DEFAULT 0,
  default_vendor_cost_cap_cents integer     NOT NULL DEFAULT 0,
  rollover_policy               text        NOT NULL DEFAULT 'no_rollover'
                                CHECK (rollover_policy IN ('no_rollover', 'rollover_all', 'rollover_purchased')),
  can_buy_credit_packs          boolean     NOT NULL DEFAULT true,
  hard_stop_enabled             boolean     NOT NULL DEFAULT true,
  is_public                     boolean     NOT NULL DEFAULT false,
  is_active                     boolean     NOT NULL DEFAULT true,
  payment_provider              text,
  external_product_id           text,
  external_price_id_monthly     text,
  external_price_id_annual      text,
  effective_from                timestamptz,
  effective_to                  timestamptz,
  metadata                      jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- ─── 8. account_subscriptions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS account_subscriptions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id                  uuid        NOT NULL REFERENCES subscription_plans(id),
  status                   text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'paused')),
  payment_provider         text,
  external_customer_id     text,
  external_subscription_id text,
  billing_period_start     timestamptz,
  billing_period_end       timestamptz,
  trial_ends_at            timestamptz,
  cancel_at_period_end     boolean     NOT NULL DEFAULT false,
  cancelled_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_acct_sub_active
  ON account_subscriptions(account_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_acct_sub_account
  ON account_subscriptions(account_id);

-- ─── 9. account_vendor_cost_caps ─────────────────────────────────────────────
-- Per-account internal vendor spend limit. Never shown to customers.
-- Prevents any single account from monopolizing the customer_shared pool.

CREATE TABLE IF NOT EXISTS account_vendor_cost_caps (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                 uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_default_cap_cents     integer     NOT NULL DEFAULT 0,
  override_cap_cents         integer,
  spent_this_period_cents    integer     NOT NULL DEFAULT 0 CHECK (spent_this_period_cents >= 0),
  period_start               timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  period_end                 timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  alert_threshold_pct        integer     NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 0 AND 100),
  override_reason            text,
  override_granted_by        uuid        REFERENCES auth.users(id),
  override_granted_at        timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avcc_account ON account_vendor_cost_caps(account_id);

-- effective_cap_cents: override wins, else plan default, else 0 (hard stop)
ALTER TABLE account_vendor_cost_caps
  DROP COLUMN IF EXISTS effective_cap_cents;

ALTER TABLE account_vendor_cost_caps
  ADD COLUMN effective_cap_cents integer
  GENERATED ALWAYS AS (COALESCE(override_cap_cents, plan_default_cap_cents, 0)) STORED;

-- ─── 10. credit_wallets ──────────────────────────────────────────────────────
-- One row per user. Denormalized counters for fast reads.
-- The immutable ledger (credit_transactions) is the source of truth.

CREATE TABLE IF NOT EXISTS credit_wallets (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                  uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status                      text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'frozen', 'suspended')),
  available_monthly_credits   integer     NOT NULL DEFAULT 0,
  available_purchased_credits integer     NOT NULL DEFAULT 0,
  available_bonus_credits     integer     NOT NULL DEFAULT 0,
  reserved_credits            integer     NOT NULL DEFAULT 0,
  lifetime_purchased_credits  integer     NOT NULL DEFAULT 0,
  lifetime_consumed_credits   integer     NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT non_negative_credits CHECK (
    available_monthly_credits   >= 0 AND
    available_purchased_credits >= 0 AND
    available_bonus_credits     >= 0 AND
    reserved_credits            >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_cw_account ON credit_wallets(account_id);

-- ─── 11. credit_grants ───────────────────────────────────────────────────────
-- Tracks lifecycle of each credit bucket (monthly, purchased, bonus, etc.)

CREATE TABLE IF NOT EXISTS credit_grants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         uuid        NOT NULL REFERENCES credit_wallets(id) ON DELETE CASCADE,
  account_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_type        text        NOT NULL
                    CHECK (grant_type IN (
                      'monthly', 'purchased', 'bonus', 'temporary',
                      'promotional', 'admin_adjustment', 'referral'
                    )),
  source_type       text
                    CHECK (source_type IN (
                      'subscription', 'credit_purchase', 'admin',
                      'promotion', 'referral', 'system'
                    )),
  source_id         uuid,
  original_credits  integer     NOT NULL CHECK (original_credits > 0),
  remaining_credits integer     NOT NULL DEFAULT 0,
  starts_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  status            text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'exhausted', 'expired', 'revoked')),
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_credits >= 0),
  CHECK (remaining_credits <= original_credits)
);

CREATE INDEX IF NOT EXISTS idx_cg_wallet ON credit_grants(wallet_id, status, expires_at NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_cg_account ON credit_grants(account_id, status);
CREATE INDEX IF NOT EXISTS idx_cg_source ON credit_grants(source_id) WHERE source_id IS NOT NULL;

-- ─── 12. credit_transactions ─────────────────────────────────────────────────
-- Immutable append-only ledger. Never UPDATE after INSERT.
-- Admin corrections create a new 'adjustment' row.

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         uuid        NOT NULL REFERENCES credit_wallets(id),
  account_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id        text,
  reservation_id    uuid,
  feature_key       text,
  provider_key      text,
  transaction_type  text        NOT NULL
                    CHECK (transaction_type IN (
                      'grant', 'consumption', 'reservation', 'release', 'refund',
                      'expiry', 'adjustment', 'dispute_hold', 'promo_grant', 'rollover'
                    )),
  credits           integer     NOT NULL,
  grant_type_source text
                    CHECK (grant_type_source IN (
                      'monthly', 'purchased', 'bonus', 'temporary', 'promotional'
                    )),
  related_grant_id  uuid        REFERENCES credit_grants(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  internal_note     text,
  metadata          jsonb,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ct_wallet ON credit_transactions(wallet_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ct_account ON credit_transactions(account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ct_request ON credit_transactions(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ct_feature ON credit_transactions(feature_key, occurred_at DESC);

-- Prevent updates to the immutable ledger via RLS-like constraint
-- (enforced in application layer; this is belt-and-suspenders documentation)

-- ─── 13. credit_reservations ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_reservations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       text        NOT NULL UNIQUE,
  wallet_id        uuid        NOT NULL REFERENCES credit_wallets(id) ON DELETE CASCADE,
  account_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key      text        NOT NULL,
  reserved_credits integer     NOT NULL CHECK (reserved_credits >= 0),
  status           text        NOT NULL DEFAULT 'reserved'
                   CHECK (status IN ('reserved', 'finalized', 'released', 'expired')),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  finalized_at     timestamptz,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cr_request ON credit_reservations(request_id);
CREATE INDEX IF NOT EXISTS idx_cr_wallet ON credit_reservations(wallet_id, status);
CREATE INDEX IF NOT EXISTS idx_cr_expires ON credit_reservations(expires_at) WHERE status = 'reserved';

-- ─── 14. credit_products ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_products (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key          text        NOT NULL UNIQUE,
  display_name         text        NOT NULL,
  description          text,
  credit_quantity      integer     NOT NULL CHECK (credit_quantity > 0),
  price_cents          integer     NOT NULL CHECK (price_cents > 0),
  currency             text        NOT NULL DEFAULT 'USD',
  payment_provider     text,
  external_product_id  text,
  external_price_id    text,
  credits_expire       boolean     NOT NULL DEFAULT false,
  expiration_days      integer,
  purchase_limit       integer,
  is_active            boolean     NOT NULL DEFAULT false,
  effective_from       timestamptz,
  effective_to         timestamptz,
  display_order        integer     NOT NULL DEFAULT 0,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── 15. credit_purchases ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_purchases (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id            uuid        NOT NULL REFERENCES credit_wallets(id),
  credit_product_id    uuid        NOT NULL REFERENCES credit_products(id),
  payment_provider     text        NOT NULL DEFAULT 'pending',
  external_checkout_id text,
  external_payment_id  text,
  idempotency_key      text        NOT NULL UNIQUE,
  amount_paid_cents    integer     NOT NULL DEFAULT 0,
  currency             text        NOT NULL DEFAULT 'USD',
  credits_purchased    integer     NOT NULL,
  status               text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN (
                         'pending', 'completed', 'failed', 'refunded', 'disputed', 'expired'
                       )),
  purchased_at         timestamptz,
  refunded_at          timestamptz,
  refund_amount_cents  integer,
  promotion_code_id    uuid,
  discount_amount_cents integer    NOT NULL DEFAULT 0,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_account ON credit_purchases(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_idempotency ON credit_purchases(idempotency_key);

-- ─── 16. feature_pricing_versions ────────────────────────────────────────────
-- Versioned cost and credit configuration per feature. Admin-only view.
-- customer_credit_cost is what the customer pays; vendor fields are internal.

CREATE TABLE IF NOT EXISTS feature_pricing_versions (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key                  text        NOT NULL,
  display_name                 text        NOT NULL,
  description                  text,
  provider_key                 text        REFERENCES api_providers(provider_key) ON DELETE SET NULL,
  expected_vendor_cost_cents   integer     NOT NULL DEFAULT 0,
  platform_overhead_cents      integer     NOT NULL DEFAULT 0,
  risk_buffer_cents            integer     NOT NULL DEFAULT 0,
  target_margin_pct            numeric(5,2),
  customer_credit_cost         integer     NOT NULL DEFAULT 0,
  is_enabled                   boolean     NOT NULL DEFAULT false,
  disable_reason               text,
  requires_confirmed_cost      boolean     NOT NULL DEFAULT true,
  effective_from               timestamptz NOT NULL DEFAULT now(),
  effective_to                 timestamptz,
  is_active                    boolean     NOT NULL DEFAULT true,
  metadata                     jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_key, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fpv_feature ON feature_pricing_versions(feature_key, is_active, effective_from DESC);

-- ─── 17. promotion_codes ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS promotion_codes (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                          text        NOT NULL,
  code_normalized               text        NOT NULL UNIQUE,
  display_name                  text        NOT NULL,
  internal_description          text,
  is_private                    boolean     NOT NULL DEFAULT false,

  -- Promotion type(s)
  promotion_types               text[]      NOT NULL DEFAULT '{}',

  -- Discount benefits
  percentage_off                numeric(5,2) CHECK (percentage_off > 0 AND percentage_off <= 100),
  amount_off_cents              integer     CHECK (amount_off_cents > 0),
  maximum_discount_cents        integer,
  currency                      text        NOT NULL DEFAULT 'USD',

  -- Credit benefits
  bonus_credits                 integer     CHECK (bonus_credits > 0),
  included_credit_increase      integer     CHECK (included_credit_increase > 0),

  -- Subscription benefits
  free_months                   integer     CHECK (free_months > 0),
  trial_extension_days          integer     CHECK (trial_extension_days > 0),
  grandfathered_price_cents     integer,
  waive_setup_fee               boolean     NOT NULL DEFAULT false,

  -- Plan unlock
  special_plan_id               uuid        REFERENCES subscription_plans(id) ON DELETE SET NULL,
  custom_entitlement            jsonb,

  -- Applicability restrictions
  applies_to_plan_ids           uuid[]      NOT NULL DEFAULT '{}',
  applies_to_credit_product_ids uuid[]      NOT NULL DEFAULT '{}',
  minimum_purchase_cents        integer,

  -- Redemption limits
  max_total_redemptions         integer,
  max_redemptions_per_account   integer     NOT NULL DEFAULT 1,
  first_purchase_only           boolean     NOT NULL DEFAULT false,
  new_customers_only            boolean     NOT NULL DEFAULT false,
  friends_and_family_only       boolean     NOT NULL DEFAULT false,

  -- Account restrictions
  allowed_account_ids           uuid[]      NOT NULL DEFAULT '{}',
  allowed_email_domains         text[]      NOT NULL DEFAULT '{}',
  blocked_account_ids           uuid[]      NOT NULL DEFAULT '{}',

  -- Stacking
  is_stackable                  boolean     NOT NULL DEFAULT false,
  stackable_with                text[]      NOT NULL DEFAULT '{}',

  -- Margin safeguard snapshot (calculated at activation)
  estimated_discount_cost_cents integer,
  estimated_credit_cost_cents   integer,
  estimated_max_exposure_cents  integer,

  -- Payment provider integration (Phase D)
  external_coupon_id            text,
  external_promotion_id         text,

  -- Lifecycle
  starts_at                     timestamptz NOT NULL DEFAULT now(),
  expires_at                    timestamptz,
  is_active                     boolean     NOT NULL DEFAULT false,
  deactivated_reason            text,

  created_by                    uuid        NOT NULL REFERENCES auth.users(id),
  metadata                      jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_code_normalized
  ON promotion_codes(code_normalized);
CREATE INDEX IF NOT EXISTS idx_promo_active
  ON promotion_codes(is_active, starts_at, expires_at NULLS LAST);

-- ─── 18. promotion_redemptions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_code_id     uuid        NOT NULL REFERENCES promotion_codes(id),
  account_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id               uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_id       uuid        REFERENCES account_subscriptions(id) ON DELETE SET NULL,
  credit_purchase_id    uuid        REFERENCES credit_purchases(id) ON DELETE SET NULL,
  order_or_checkout_id  text,
  discount_amount_cents integer     NOT NULL DEFAULT 0,
  credits_granted       integer     NOT NULL DEFAULT 0,
  applied_terms         jsonb       NOT NULL DEFAULT '{}',
  status                text        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'expired', 'refunded')),
  idempotency_key       text        NOT NULL UNIQUE,
  redeemed_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,
  revocation_reason     text,
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_code ON promotion_redemptions(promotion_code_id);
CREATE INDEX IF NOT EXISTS idx_pr_account ON promotion_redemptions(account_id);
CREATE INDEX IF NOT EXISTS idx_pr_idempotency ON promotion_redemptions(idempotency_key);

-- ─── 19. promotion_entitlements ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS promotion_entitlements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_code_id   uuid        NOT NULL REFERENCES promotion_codes(id),
  redemption_id       uuid        NOT NULL REFERENCES promotion_redemptions(id),
  account_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement_type    text        NOT NULL,
  entitlement_value   jsonb       NOT NULL DEFAULT '{}',
  starts_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  status              text        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'expired', 'revoked')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pe_account ON promotion_entitlements(account_id, status);
CREATE INDEX IF NOT EXISTS idx_pe_redemption ON promotion_entitlements(redemption_id);

-- ─── 20. Atomic reservation RPC ──────────────────────────────────────────────
-- fn_reserve_budget_and_credits: six-gate check + atomic dual reservation.
-- Called by providerGateway.ts for all paid provider calls.
-- Returns a JSON object describing the authorization result.

CREATE OR REPLACE FUNCTION fn_reserve_budget_and_credits(
  p_request_id           text,
  p_account_id           uuid,
  p_feature_key          text,
  p_provider_key         text,
  p_pool_key             text,        -- 'customer_shared' | 'owner_reserved' | 'background_operations'
  p_estimated_cost_cents integer,
  p_credit_cost          integer,
  p_is_zero_cost_feature boolean      -- true for geocode, distress_ingestion etc.
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
BEGIN
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

  -- Gate 4: global budget (sum of all pools is already enforced at config time)
  -- Gate 3: customer shared pool capacity
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

  -- Budget reservation
  v_budget_res_id := gen_random_uuid();
  INSERT INTO api_budget_reservations (
    id, request_id, pool_key, account_id, provider_key, feature_key,
    estimated_cost_cents, status
  ) VALUES (
    v_budget_res_id, p_request_id, p_pool_key, p_account_id, p_provider_key, p_feature_key,
    p_estimated_cost_cents, 'reserved'
  );

  -- Update pool spend
  UPDATE api_budget_pools
  SET spent_this_period_cents = spent_this_period_cents + p_estimated_cost_cents,
      updated_at = now()
  WHERE pool_key = p_pool_key;

  -- Update account cost cap spend
  UPDATE account_vendor_cost_caps
  SET spent_this_period_cents = spent_this_period_cents + p_estimated_cost_cents,
      updated_at = now()
  WHERE account_id = p_account_id;

  -- Credit reservation
  v_credit_res_id := gen_random_uuid();
  INSERT INTO credit_reservations (
    id, request_id, wallet_id, account_id, feature_key, reserved_credits, status
  ) VALUES (
    v_credit_res_id, p_request_id, v_wallet.id, p_account_id, p_feature_key, p_credit_cost, 'reserved'
  );

  -- Update wallet reserved count
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

-- ─── 21. RLS policies ────────────────────────────────────────────────────────

ALTER TABLE api_providers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_budget_pools         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_budget_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_budget_reservations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_budget_overrides     ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_vendor_cost_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_wallets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_grants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_pricing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_redemptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_entitlements   ENABLE ROW LEVEL SECURITY;

-- Public can read subscription_plans and credit_products
DROP POLICY IF EXISTS "plans_public_read"    ON subscription_plans;
DROP POLICY IF EXISTS "products_public_read" ON credit_products;
CREATE POLICY "plans_public_read"    ON subscription_plans    FOR SELECT USING (is_public = true AND is_active = true);
CREATE POLICY "products_public_read" ON credit_products       FOR SELECT USING (is_active = true);

-- Users can read their own subscription
DROP POLICY IF EXISTS "sub_own_read" ON account_subscriptions;
CREATE POLICY "sub_own_read" ON account_subscriptions FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- Users can read their own wallet (but not vendor cost caps — those are internal)
DROP POLICY IF EXISTS "wallet_own_read" ON credit_wallets;
CREATE POLICY "wallet_own_read" ON credit_wallets FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- Users can read their own credit transactions
DROP POLICY IF EXISTS "ct_own_read" ON credit_transactions;
CREATE POLICY "ct_own_read" ON credit_transactions FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- Users can read their own purchases
DROP POLICY IF EXISTS "cp_own_read" ON credit_purchases;
CREATE POLICY "cp_own_read" ON credit_purchases FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- Users can read their own redemptions
DROP POLICY IF EXISTS "pr_own_read" ON promotion_redemptions;
CREATE POLICY "pr_own_read" ON promotion_redemptions FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- Users can read their own entitlements
DROP POLICY IF EXISTS "pe_own_read" ON promotion_entitlements;
CREATE POLICY "pe_own_read" ON promotion_entitlements FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- Service role can do everything (used by all server-side service calls)
-- All billing operations run via the service client; individual table policies
-- are for direct API/auth-context access control.


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Seed: api_providers ─────────────────────────────────────────────────────

INSERT INTO api_providers (provider_key, display_name, category, is_paid, billing_model, default_estimated_cost_cents, is_enabled, notes)
VALUES
  ('reapi',        'Real Estate API (REAPI)',   'property', true,  'per_call',       5,  true,  'Primary paid property data provider. $0.05/call estimate.'),
  ('rentcast',     'RentCast',                  'rental',   true,  'per_call',       5,  false, 'DISABLED: billing model unconfirmed. Do not enable until vendor agreement reviewed.'),
  ('official_mls', 'Official MLS Feed',         'mls',      false, 'included_access',0,  false, 'Included with MLS membership. No per-call cost. Not yet integrated.'),
  ('beaches_mls',  'Beaches MLS (Spark API)',   'mls',      false, 'subscription',   0,  true,  'Flat subscription. Register for kill switch only.'),
  ('google_maps',  'Google Maps Geocoding',     'geocode',  true,  'per_call',       1,  true,  'Next.js 24h cache active. Mostly free tier. Low metered risk.')
ON CONFLICT (provider_key) DO NOTHING;

-- ─── Seed: api_budget_pools ──────────────────────────────────────────────────

INSERT INTO api_budget_pools (pool_key, display_name, description, monthly_limit_cents, is_protected, requires_owner_override, priority)
VALUES
  ('owner_reserved',      'Owner Reserved',        'Owner and admin workflows, testing, internal operations. Protected — customer requests cannot draw here.',    3000, true,  false, 100),
  ('customer_shared',     'Customer Shared',        'All customer paid-provider calls. Per-account cost caps prevent any one account from monopolizing.',         5000, false, false, 10),
  ('emergency_reserved',  'Emergency Reserve',      'Released only by explicit owner override with a recorded reason. Never automatically consumed.',             1500, true,  true,  200),
  ('background_operations','Background Operations', 'Distress ingestion, scheduled enrichments, and other automated jobs. Isolated from owner and customer capacity.', 500, false, false, 20)
ON CONFLICT (pool_key) DO UPDATE SET
  display_name         = EXCLUDED.display_name,
  description          = EXCLUDED.description,
  monthly_limit_cents  = EXCLUDED.monthly_limit_cents,
  is_protected         = EXCLUDED.is_protected,
  requires_owner_override = EXCLUDED.requires_owner_override,
  priority             = EXCLUDED.priority,
  updated_at           = now();

-- ─── Seed: subscription_plans ────────────────────────────────────────────────
-- default_vendor_cost_cap_cents: per-account internal vendor spend limit/month.
-- Approved: Free=$0.50, Starter=$5, Professional=$15, Investor=$25, Owner=$30+

INSERT INTO subscription_plans (
  plan_key, display_name, description,
  included_monthly_credits, default_vendor_cost_cap_cents,
  can_buy_credit_packs, hard_stop_enabled, is_public, is_active
)
VALUES
  ('free_trial',    'Free / Trial',    'Evaluate the platform. Limited credits and features.',          50,    50,    false, true,  false, true),
  ('starter',       'Starter',         'For individual agents and investors getting started.',          500,   500,   true,  true,  false, true),
  ('professional',  'Professional',    'For active professionals managing multiple transactions.',     2000,  1500,   true,  true,  false, true),
  ('investor',      'Investor',        'For high-volume investors and teams.',                         5000,  2500,   true,  true,  false, true),
  ('enterprise',    'Enterprise',      'Custom plan for teams and brokerages.',                           0,      0,  true,  true,  false, true),
  ('owner',         'Owner / Developer','Platform operator. High credit limit. Still obeys $100 budget.', 10000, 3000, true, false, false, true)
ON CONFLICT (plan_key) DO UPDATE SET
  display_name                  = EXCLUDED.display_name,
  included_monthly_credits      = EXCLUDED.included_monthly_credits,
  default_vendor_cost_cap_cents = EXCLUDED.default_vendor_cost_cap_cents,
  updated_at                    = now();

-- ─── Seed: feature_pricing_versions ──────────────────────────────────────────
-- Only enabled features are activated. Features with unknown vendor cost are
-- disabled with a reason. is_enabled = false means gate 6 will block these.

INSERT INTO feature_pricing_versions (
  feature_key, display_name, provider_key,
  expected_vendor_cost_cents, platform_overhead_cents, risk_buffer_cents,
  customer_credit_cost, is_enabled, disable_reason, requires_confirmed_cost
)
VALUES
  ('property_lookup_basic', 'Basic Property Lookup', 'reapi',
    5, 0, 0, 1, true,  null,  false),

  ('property_report_full',  'Full Property Report',  'reapi',
    8, 0, 0, 5, true,  null,  false),

  ('mls_listing_refresh',   'MLS Listing Refresh',   'beaches_mls',
    0, 0, 0, 2, true,  null,  false),

  ('comps_refresh',         'Comparable Refresh',    'reapi',
    8, 0, 0, 3, true,  null,  false),

  ('geocode',               'Address Geocoding',     'google_maps',
    1, 0, 0, 0, true,  null,  false),

  ('distress_ingestion',    'Distress Record Import','reapi',
    5, 0, 0, 0, true,  null,  false),

  ('rental_analysis',       'Rental Analysis',       'rentcast',
    0, 0, 0, 2, false,
    'Disabled: RentCast billing model not yet confirmed with vendor. Enable only after vendor agreement review.',
    true),

  ('contact_enrichment',    'Contact Enrichment / Skip Trace', null,
    0, 0, 0, 8, false,
    'Disabled: skip trace provider and pricing not yet selected.',
    true),

  ('ai_analysis',           'AI Analysis',           null,
    0, 0, 0, 2, false,
    'Disabled: AI provider and maximum per-request cost policy not yet confirmed.',
    true),

  ('document_ocr',          'Document OCR',          null,
    0, 0, 0, 3, false,
    'Disabled: OCR provider and pricing not yet confirmed.',
    true)
ON CONFLICT (feature_key, effective_from) DO UPDATE SET
  is_enabled      = EXCLUDED.is_enabled,
  disable_reason  = EXCLUDED.disable_reason,
  updated_at      = now();

-- ─── Seed: api_budget_policies ───────────────────────────────────────────────

INSERT INTO api_budget_policies (pool_key, provider_key, monthly_limit_cents, is_enabled)
VALUES
  ('customer_shared',      'reapi',       3500, true),
  ('customer_shared',      'google_maps',  500, true),
  ('owner_reserved',       'reapi',       2000, true),
  ('background_operations','reapi',        500, true)
ON CONFLICT (pool_key, provider_key, feature_key) DO NOTHING;

-- ─── Seed: wallets and subscriptions for existing users ──────────────────────
-- Owner (Charles) gets Owner plan. All others get Starter.
-- This runs idempotently: ON CONFLICT DO NOTHING.

DO $$
DECLARE
  v_owner_plan_id    uuid;
  v_starter_plan_id  uuid;
  v_user             RECORD;
  v_plan_id          uuid;
  v_cap_cents        integer;
  v_credits          integer;
  v_wallet_id        uuid;
BEGIN
  SELECT id INTO v_owner_plan_id   FROM subscription_plans WHERE plan_key = 'owner';
  SELECT id INTO v_starter_plan_id FROM subscription_plans WHERE plan_key = 'starter';

  FOR v_user IN SELECT id, email FROM auth.users LOOP

    -- Determine plan
    IF lower(v_user.email) IN ('crgonz10@gmail.com', 'charlesgonzalez@nextkeyps.com') THEN
      v_plan_id   := v_owner_plan_id;
      v_cap_cents := 3000;
      v_credits   := 10000;
    ELSE
      v_plan_id   := v_starter_plan_id;
      v_cap_cents := 500;
      v_credits   := 500;
    END IF;

    -- Create wallet
    INSERT INTO credit_wallets (account_id)
    VALUES (v_user.id)
    ON CONFLICT (account_id) DO NOTHING;

    SELECT id INTO v_wallet_id FROM credit_wallets WHERE account_id = v_user.id;

    -- Create subscription
    INSERT INTO account_subscriptions (
      account_id, plan_id, status, billing_period_start, billing_period_end
    )
    VALUES (
      v_user.id, v_plan_id, 'active',
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month'
    )
    ON CONFLICT (account_id) WHERE status = 'active' DO NOTHING;

    -- Create vendor cost cap
    INSERT INTO account_vendor_cost_caps (
      account_id, plan_default_cap_cents, period_start, period_end
    )
    VALUES (
      v_user.id, v_cap_cents,
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month'
    )
    ON CONFLICT (account_id) DO NOTHING;

    -- Create initial monthly credit grant
    INSERT INTO credit_grants (
      wallet_id, account_id, grant_type, source_type,
      original_credits, remaining_credits,
      starts_at, expires_at, status
    )
    VALUES (
      v_wallet_id, v_user.id, 'monthly', 'subscription',
      v_credits, v_credits,
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month',
      'active'
    );

    -- Update wallet monthly credits
    UPDATE credit_wallets
    SET available_monthly_credits = v_credits, updated_at = now()
    WHERE account_id = v_user.id;

  END LOOP;
END $$;

-- ─── Seed: credit_products (inactive until pricing is approved) ───────────────

INSERT INTO credit_products (
  product_key, display_name, description, credit_quantity, price_cents, is_active, display_order
)
VALUES
  ('pack_250',  'Starter Pack',  '250 Premium Credits. Never expire.',   250,  1200, false, 1),
  ('pack_500',  'Standard Pack', '500 Premium Credits. Never expire.',   500,  2200, false, 2),
  ('pack_1000', 'Value Pack',    '1,000 Premium Credits. Never expire.', 1000, 4000, false, 3),
  ('pack_2500', 'Pro Pack',      '2,500 Premium Credits. Never expire.', 2500, 9000, false, 4)
ON CONFLICT (product_key) DO NOTHING;
