// Response model builders: produce safe, role-appropriate API response shapes.
//
// Customer-safe: no internal cost data, no vendor keys, no pool details.
// Admin-safe: full internal data including cost cents, pool utilization, cap details.

import type {
  CreditWallet,
  SubscriptionPlan,
  AccountSubscription,
  BudgetStatusAdmin,
  AccountVendorCostCap,
  CreditProduct,
  CustomerWalletResponse,
  CustomerSubscriptionResponse,
  AdminWalletResponse,
  AdminBudgetPoolResponse,
  PoolKey,
} from './types'

// ─── Customer-facing responses ────────────────────────────────────────────────

export function toCustomerWallet(wallet: CreditWallet): CustomerWalletResponse {
  return {
    available_credits:
      wallet.available_monthly_credits +
      wallet.available_purchased_credits +
      wallet.available_bonus_credits -
      wallet.reserved_credits,
    breakdown: {
      monthly: wallet.available_monthly_credits,
      purchased: wallet.available_purchased_credits,
      bonus: wallet.available_bonus_credits,
    },
    status: wallet.status,
  }
}

export function toCustomerSubscription(
  subscription: AccountSubscription,
  plan: SubscriptionPlan
): CustomerSubscriptionResponse {
  return {
    plan_key: plan.plan_key,
    plan_name: plan.display_name,
    status: subscription.status,
    included_monthly_credits: plan.included_monthly_credits,
    billing_period_end: subscription.billing_period_end,
    can_buy_credit_packs: plan.can_buy_credit_packs,
  }
}

export function toCustomerCreditProduct(product: CreditProduct): {
  product_key: string
  display_name: string
  description: string | null
  credit_quantity: number
  price_cents: number
  currency: string
  credits_expire: boolean
  expiration_days: number | null
  display_order: number
} {
  // Never expose purchase_limit, external IDs, or internal metadata
  return {
    product_key: product.product_key,
    display_name: product.display_name,
    description: product.description,
    credit_quantity: product.credit_quantity,
    price_cents: product.price_cents,
    currency: product.currency,
    credits_expire: product.credits_expire,
    expiration_days: product.expiration_days,
    display_order: product.display_order,
  }
}

// ─── Admin-facing responses ────────────────────────────────────────────────────

export function toAdminWallet(wallet: CreditWallet): AdminWalletResponse {
  return {
    ...toCustomerWallet(wallet),
    account_id: wallet.account_id,
    reserved_credits: wallet.reserved_credits,
    lifetime_purchased: wallet.lifetime_purchased_credits,
    lifetime_consumed: wallet.lifetime_consumed_credits,
    wallet_id: wallet.id,
    updated_at: wallet.updated_at,
  }
}

export function toAdminBudgetPool(
  status: BudgetStatusAdmin,
  reservations_active: number
): AdminBudgetPoolResponse {
  return {
    ...status,
    reservations_active,
  }
}

export function toAdminCostCap(cap: AccountVendorCostCap): {
  account_id: string
  effective_cap_cents: number
  plan_default_cap_cents: number
  override_cap_cents: number | null
  spent_this_period_cents: number
  remaining_cents: number
  utilization_pct: number
  period_start: string
  period_end: string
} {
  const remaining_cents = Math.max(0, cap.effective_cap_cents - cap.spent_this_period_cents)
  const utilization_pct =
    cap.effective_cap_cents > 0
      ? Math.round((cap.spent_this_period_cents / cap.effective_cap_cents) * 100)
      : 100

  return {
    account_id: cap.account_id,
    effective_cap_cents: cap.effective_cap_cents,
    plan_default_cap_cents: cap.plan_default_cap_cents,
    override_cap_cents: cap.override_cap_cents,
    spent_this_period_cents: cap.spent_this_period_cents,
    remaining_cents,
    utilization_pct,
    period_start: cap.period_start,
    period_end: cap.period_end,
  }
}

// Pool summary with utilization bar-friendly numbers
export function toAdminPoolSummary(pool: BudgetStatusAdmin['pools'][0]): {
  pool_key: PoolKey
  display_name: string
  limit_cents: number
  spent_cents: number
  available_cents: number
  utilization_pct: number
  is_protected: boolean
  status: 'ok' | 'warning' | 'critical'
} {
  let status: 'ok' | 'warning' | 'critical'
  if (pool.utilization_pct >= 90) status = 'critical'
  else if (pool.utilization_pct >= 70) status = 'warning'
  else status = 'ok'

  return { ...pool, status }
}
