// Analytics attribution structures for Phase C reporting.
// These types describe the shape of data that flows through the billing system
// and is captured in api_usage_events and credit_transactions.
// No aggregation or query logic here — that belongs in Phase C.

import type { PoolKey } from './types'

export interface UsageEventAttribution {
  request_id: string
  account_id: string
  feature_key: string
  provider_key: string
  pool_key: PoolKey
  occurred_at: string

  // Cost attribution
  actual_cost_cents: number
  estimated_cost_cents: number
  account_vendor_cost_cents: number

  // Credit attribution
  credits_consumed: number
  credit_source_type: string | null
  credit_grant_id: string | null

  // Outcome
  cache_hit: boolean
  provider_called: boolean
  success: boolean
  error_code: string | null
  duration_ms: number | null
}

export interface RevenueAttribution {
  account_id: string
  plan_key: string
  period_start: string
  period_end: string

  // Revenue side
  subscription_revenue_cents: number
  credit_pack_revenue_cents: number
  total_revenue_cents: number

  // Cost side (internal — never expose to customers)
  vendor_cost_cents: number
  platform_overhead_cents: number
  total_cost_cents: number

  // Margin
  gross_margin_cents: number
  gross_margin_pct: number | null
}

export interface FeatureUsageSummary {
  feature_key: string
  display_name: string
  provider_key: string | null
  period_start: string
  period_end: string

  total_calls: number
  cached_calls: number
  provider_calls: number
  failed_calls: number
  total_cost_cents: number
  total_credits_consumed: number
  unique_accounts: number
}

export interface PoolUsageSummary {
  pool_key: PoolKey
  display_name: string
  period_start: string
  period_end: string

  limit_cents: number
  spent_cents: number
  utilization_pct: number
  call_count: number
  unique_accounts: number
  peak_day_spent_cents: number
}

export interface AccountUsageSummary {
  account_id: string
  plan_key: string
  period_start: string
  period_end: string

  vendor_cost_cents: number
  vendor_cap_cents: number
  vendor_utilization_pct: number
  credits_consumed: number
  credits_granted: number
  credits_purchased: number
  call_count: number
  cache_hit_rate_pct: number
}

export interface PromotionAnalytics {
  promotion_code_id: string
  code: string
  period_start: string
  period_end: string

  total_redemptions: number
  active_redemptions: number
  revoked_redemptions: number
  total_discount_cents: number
  total_credits_granted: number
  estimated_cost_cents: number
  unique_accounts: number
}
