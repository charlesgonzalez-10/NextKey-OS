// ─── Pool keys ───────────────────────────────────────────────────────────────

export type PoolKey =
  | 'owner_reserved'
  | 'customer_shared'
  | 'emergency_reserved'
  | 'background_operations'

// ─── Credit grant types ───────────────────────────────────────────────────────

export type GrantType =
  | 'monthly'
  | 'purchased'
  | 'bonus'
  | 'temporary'
  | 'promotional'
  | 'admin_adjustment'
  | 'referral'

export type CreditSourceType =
  | 'subscription'
  | 'credit_purchase'
  | 'admin'
  | 'promotion'
  | 'referral'
  | 'system'

// ─── Transaction types ────────────────────────────────────────────────────────

export type TransactionType =
  | 'grant'
  | 'consumption'
  | 'reservation'
  | 'release'
  | 'refund'
  | 'expiry'
  | 'adjustment'
  | 'dispute_hold'
  | 'promo_grant'
  | 'rollover'

// ─── Budget reservation status ────────────────────────────────────────────────

export type ReservationStatus = 'reserved' | 'finalized' | 'released' | 'expired' | 'needs_review'

// ─── API Budget pool ──────────────────────────────────────────────────────────

export interface ApiBudgetPool {
  id: string
  pool_key: PoolKey
  display_name: string
  monthly_limit_cents: number
  spent_this_period_cents: number
  period_start: string
  period_end: string
  is_protected: boolean
  requires_owner_override: boolean
  is_active: boolean
}

// ─── Budget reservation ───────────────────────────────────────────────────────

export interface BudgetReservation {
  id: string
  request_id: string
  pool_key: PoolKey
  account_id: string | null
  provider_key: string | null
  feature_key: string | null
  estimated_cost_cents: number
  actual_cost_cents: number | null
  status: ReservationStatus
  expires_at: string
}

// ─── Account vendor cost cap ──────────────────────────────────────────────────

export interface AccountVendorCostCap {
  id: string
  account_id: string
  plan_default_cap_cents: number
  override_cap_cents: number | null
  effective_cap_cents: number
  spent_this_period_cents: number
  period_start: string
  period_end: string
  alert_threshold_pct: number
}

// ─── Credit wallet ────────────────────────────────────────────────────────────

export interface CreditWallet {
  id: string
  account_id: string
  status: 'active' | 'frozen' | 'suspended'
  available_monthly_credits: number
  available_purchased_credits: number
  available_bonus_credits: number
  reserved_credits: number
  lifetime_purchased_credits: number
  lifetime_consumed_credits: number
  created_at: string
  updated_at: string
}

export interface CreditGrant {
  id: string
  wallet_id: string
  account_id: string
  grant_type: GrantType
  source_type: CreditSourceType | null
  source_id: string | null
  original_credits: number
  remaining_credits: number
  starts_at: string
  expires_at: string | null
  status: 'active' | 'exhausted' | 'expired' | 'revoked'
}

// ─── Subscription plan ────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string
  plan_key: string
  display_name: string
  description: string | null
  monthly_price_cents: number | null
  annual_price_cents: number | null
  currency: string
  included_monthly_credits: number
  default_vendor_cost_cap_cents: number
  rollover_policy: 'no_rollover' | 'rollover_all' | 'rollover_purchased'
  can_buy_credit_packs: boolean
  hard_stop_enabled: boolean
  is_public: boolean
  is_active: boolean
  // Stripe integration
  external_product_id:       string | null
  external_price_id_monthly: string | null
  external_price_id_annual:  string | null
}

export interface AccountSubscription {
  id: string
  account_id: string
  plan_id: string
  status: 'active' | 'trialing' | 'past_due' | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'paused' | 'cancelled'
  payment_provider:           string | null
  external_customer_id:       string | null
  external_subscription_id:   string | null
  cancel_at_period_end:       boolean
  cancelled_at:               string | null
  billing_period_start:       string | null
  billing_period_end:         string | null
  trial_ends_at:              string | null
  created_at:                 string
  updated_at:                 string
}

// ─── Feature pricing ──────────────────────────────────────────────────────────

export interface FeaturePricingVersion {
  id: string
  feature_key: string
  display_name: string
  provider_key: string | null
  expected_vendor_cost_cents: number
  platform_overhead_cents: number
  risk_buffer_cents: number
  target_margin_pct: number | null
  customer_credit_cost: number
  is_enabled: boolean
  disable_reason: string | null
  requires_confirmed_cost: boolean
  effective_from: string
  effective_to: string | null
  is_active: boolean
}

// ─── Credit product ───────────────────────────────────────────────────────────

export interface CreditProduct {
  id: string
  product_key: string
  display_name: string
  description: string | null
  credit_quantity: number
  price_cents: number
  currency: string
  credits_expire: boolean
  expiration_days: number | null
  purchase_limit: number | null
  is_active: boolean
  display_order: number
  // Stripe integration
  external_product_id: string | null
  external_price_id:   string | null
}

// ─── Promotion codes ──────────────────────────────────────────────────────────

export type PromotionType =
  | 'percentage_discount'
  | 'fixed_amount_discount'
  | 'free_months'
  | 'trial_extension'
  | 'bonus_credits'
  | 'included_credit_increase'
  | 'credit_pack_discount'
  | 'special_plan_access'
  | 'waived_setup_fee'
  | 'grandfathered_price'
  | 'custom_entitlement'

export interface PromotionCode {
  id: string
  code: string
  code_normalized: string
  display_name: string
  internal_description: string | null
  is_private: boolean
  promotion_types: PromotionType[]
  percentage_off: number | null
  amount_off_cents: number | null
  maximum_discount_cents: number | null
  bonus_credits: number | null
  included_credit_increase: number | null
  free_months: number | null
  trial_extension_days: number | null
  grandfathered_price_cents: number | null
  waive_setup_fee: boolean
  special_plan_id: string | null
  custom_entitlement: Record<string, unknown> | null
  applies_to_plan_ids: string[]
  applies_to_credit_product_ids: string[]
  minimum_purchase_cents: number | null
  max_total_redemptions: number | null
  max_redemptions_per_account: number
  first_purchase_only: boolean
  new_customers_only: boolean
  friends_and_family_only: boolean
  allowed_account_ids: string[]
  allowed_email_domains: string[]
  blocked_account_ids: string[]
  is_stackable: boolean
  starts_at: string
  expires_at: string | null
  is_active: boolean
  deactivated_reason: string | null
  estimated_max_exposure_cents: number | null
}

// ─── Six-gate authorization result ───────────────────────────────────────────

export type GateNumber = 1 | 2 | 3 | 4 | 5 | 6

export interface AuthorizationResult {
  success: boolean
  zero_cost?: boolean
  budget_reservation_id: string | null
  credit_reservation_id: string | null
  gate_failed?: GateNumber
  error_code?: string
  error_message?: string
  available_credits_before?: number
  pool_remaining_before?: number
  cap_remaining_before?: number
}

// ─── Provider gateway request ─────────────────────────────────────────────────

export interface ProviderCallRequest {
  request_id: string
  account_id: string
  feature_key: string
  provider_key: string
  pool_key: PoolKey
  estimated_cost_cents: number
  credit_cost: number
  is_zero_cost_feature: boolean
}

export interface ProviderCallFinalizeRequest {
  request_id: string
  actual_cost_cents: number
  success: boolean
  error_code?: string
  response_metadata?: Record<string, unknown>
  duration_ms?: number
  cache_hit?: boolean
}

// ─── Budget status (admin) ────────────────────────────────────────────────────

export interface BudgetStatusAdmin {
  period_start: string
  period_end: string
  global_limit_cents: number
  global_spent_cents: number
  global_available_cents: number
  global_utilization_pct: number
  pools: Array<{
    pool_key: PoolKey
    display_name: string
    limit_cents: number
    spent_cents: number
    available_cents: number
    utilization_pct: number
    is_protected: boolean
  }>
}

// ─── Credit liability metric ──────────────────────────────────────────────────

export interface CreditLiabilityReport {
  total_outstanding_credits: number
  estimated_fulfillment_cost_cents: number
  platform_remaining_capacity_cents: number
  coverage_ratio: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  calculated_at: string
}

// ─── Promotion validation result ─────────────────────────────────────────────

export interface PromoValidationResult {
  valid: boolean
  promotion_code_id: string | null
  code_normalized: string | null
  applicable_benefits: ApplicableBenefit[]
  error_code?: string
  error_message: string
}

export interface ApplicableBenefit {
  type: PromotionType
  value: number | string | boolean | null
  display_label: string
}

// ─── Response models ──────────────────────────────────────────────────────────

export interface CustomerWalletResponse {
  available_credits: number
  breakdown: {
    monthly: number
    purchased: number
    bonus: number
  }
  status: 'active' | 'frozen' | 'suspended'
}

export interface CustomerSubscriptionResponse {
  plan_key: string
  plan_name: string
  status: string
  included_monthly_credits: number
  billing_period_end: string | null
  can_buy_credit_packs: boolean
}

export interface AdminWalletResponse extends CustomerWalletResponse {
  account_id: string
  reserved_credits: number
  lifetime_purchased: number
  lifetime_consumed: number
  wallet_id: string
  updated_at: string
}

export interface AdminBudgetPoolResponse extends BudgetStatusAdmin {
  reservations_active: number
}

export interface PricingEstimateAdmin {
  feature_key: string
  display_name: string
  provider_key: string | null
  expected_vendor_cost_cents: number
  overhead_cents: number
  risk_buffer_cents: number
  total_cost_cents: number
  customer_credit_cost: number
  implied_credit_value_cents: number
  estimated_margin_pct: number | null
  is_enabled: boolean
}
