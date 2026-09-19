// Economics Service — read-only aggregation for the /admin/economics dashboard.
//
// All methods are pure reads — no reservations created, no credits consumed,
// no budgets modified. Aggregates directly from api_usage_events and related
// tables (no feature_economics_snapshots).
//
// Revenue fields are intentionally null until Stripe is in live mode.

import { serviceClient } from '@/lib/supabase-service'
import type { PoolKey }   from './types'
import { providerHealthService } from './providerHealth'
import type { ProviderWalletInfo } from './providerHealth'

// ── Period helpers ─────────────────────────────────────────────────────────────

function currentMonthBounds(): { start: string; end: string } {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
  return { start, end }
}

function periodBounds(period?: string): { start: string; end: string } {
  if (!period || period === 'current_month') return currentMonthBounds()
  if (period === 'last_30_days') {
    const end   = new Date().toISOString()
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString()
    return { start, end }
  }
  if (period === 'last_60_days') {
    const end   = new Date().toISOString()
    const start = new Date(Date.now() - 60 * 86_400_000).toISOString()
    return { start, end }
  }
  return currentMonthBounds()
}

// ── Section types ──────────────────────────────────────────────────────────────

export interface PlatformSummary {
  period_start:        string
  period_end:          string
  total_accounts:      number
  accounts_by_plan:    { plan_key: string; display_name: string; count: number }[]
  total_credits_available:   number
  total_credits_consumed:    number
  total_credits_purchased:   number
  total_credits_bonus:       number
}

export interface VendorSpendSummary {
  period_start:   string
  period_end:     string
  total_cost_cents: number
  by_provider:    { provider_key: string; cost_cents: number; call_count: number }[]
  by_feature:     { feature_key: string; cost_cents: number; call_count: number }[]
  pool_utilization: {
    pool_key:      PoolKey
    display_name:  string
    limit_cents:   number
    spent_cents:   number
    utilization_pct: number
  }[]
}

export interface FeatureEconomicRow {
  feature_key:          string
  period_start:         string
  period_end:           string
  total_calls:          number
  cache_hits:           number
  provider_calls:       number
  failed_calls:         number
  total_vendor_cost_cents: number
  total_credits_consumed:  number
  avg_vendor_cost_cents:   number
  cache_hit_rate_pct:      number
  expected_vendor_cost_cents: number | null
  customer_credit_cost:      number | null
  recommended_credit_cost:   number | null
}

export interface CustomerEconomicRow {
  account_id:          string
  plan_key:            string | null
  period_start:        string
  period_end:          string
  vendor_cost_cents:   number
  vendor_cap_cents:    number | null
  cap_utilization_pct: number | null
  credits_consumed:    number
  call_count:          number
  cache_hit_rate_pct:  number | null
}

export interface EconomicsDashboard {
  generated_at:     string
  platform:         PlatformSummary
  vendor_spend:     VendorSpendSummary
  feature_economics: FeatureEconomicRow[]
  customer_economics: CustomerEconomicRow[]
  provider_health:  {
    statuses: Awaited<ReturnType<typeof providerHealthService.getAllStatuses>>
    wallets:  ProviderWalletInfo[]
  }
  revenue: null
  revenue_note: string
}

// ── Platform summary ───────────────────────────────────────────────────────────

async function getPlatformSummary(period?: string): Promise<PlatformSummary> {
  const { start, end } = periodBounds(period)

  // Account and plan counts
  const { data: planRows } = await serviceClient
    .from('account_subscriptions')
    .select('plan_id, status, subscription_plans(plan_key, display_name)')
    .eq('status', 'active')

  const planCounts: Record<string, { plan_key: string; display_name: string; count: number }> = {}
  let totalAccounts = 0
  for (const row of (planRows ?? [])) {
    const plan = (row.subscription_plans as unknown as { plan_key: string; display_name: string } | null)
    if (!plan) continue
    totalAccounts++
    if (!planCounts[plan.plan_key]) {
      planCounts[plan.plan_key] = { plan_key: plan.plan_key, display_name: plan.display_name, count: 0 }
    }
    planCounts[plan.plan_key].count++
  }

  // Credit wallet totals
  const { data: wallets } = await serviceClient
    .from('credit_wallets')
    .select(
      'available_monthly_credits, available_purchased_credits, available_bonus_credits, lifetime_consumed_credits'
    )

  let totalAvailable = 0, totalConsumed = 0, totalPurchased = 0, totalBonus = 0
  for (const w of (wallets ?? [])) {
    totalAvailable += (w.available_monthly_credits ?? 0) +
                     (w.available_purchased_credits ?? 0) +
                     (w.available_bonus_credits ?? 0)
    totalConsumed  += w.lifetime_consumed_credits ?? 0
  }

  // Purchased credits this period from credit_grants
  const { data: grants } = await serviceClient
    .from('credit_grants')
    .select('credits_granted, grant_type')
    .gte('granted_at', start)
    .lt('granted_at', end)

  for (const g of (grants ?? [])) {
    if (g.grant_type === 'purchased')   totalPurchased += g.credits_granted ?? 0
    if (g.grant_type === 'promotional') totalBonus     += g.credits_granted ?? 0
    if (g.grant_type === 'bonus')       totalBonus     += g.credits_granted ?? 0
  }

  return {
    period_start:  start,
    period_end:    end,
    total_accounts: totalAccounts,
    accounts_by_plan: Object.values(planCounts).sort((a, b) => b.count - a.count),
    total_credits_available:  totalAvailable,
    total_credits_consumed:   totalConsumed,
    total_credits_purchased:  totalPurchased,
    total_credits_bonus:      totalBonus,
  }
}

// ── Vendor spend ───────────────────────────────────────────────────────────────

async function getVendorSpend(period?: string): Promise<VendorSpendSummary> {
  const { start, end } = periodBounds(period)

  const { data: events } = await serviceClient
    .from('api_usage_events')
    .select('provider_key, feature_key, actual_cost_cents, success, pool_key')
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .eq('provider_called', true)

  const byProvider: Record<string, { cost_cents: number; call_count: number }> = {}
  const byFeature:  Record<string, { cost_cents: number; call_count: number }> = {}
  let totalCost = 0

  for (const e of (events ?? [])) {
    if (!e.success) continue
    const cost = e.actual_cost_cents ?? 0
    totalCost += cost

    const pk = e.provider_key ?? 'unknown'
    if (!byProvider[pk]) byProvider[pk] = { cost_cents: 0, call_count: 0 }
    byProvider[pk].cost_cents  += cost
    byProvider[pk].call_count  += 1

    const fk = e.feature_key ?? 'unknown'
    if (!byFeature[fk]) byFeature[fk] = { cost_cents: 0, call_count: 0 }
    byFeature[fk].cost_cents  += cost
    byFeature[fk].call_count  += 1
  }

  // Pool utilization
  const { data: pools } = await serviceClient
    .from('api_budget_pools')
    .select('pool_key, display_name, monthly_limit_cents, spent_this_period_cents')
    .eq('is_active', true)

  const poolUtilization = (pools ?? []).map(p => ({
    pool_key:       p.pool_key as PoolKey,
    display_name:   p.display_name,
    limit_cents:    p.monthly_limit_cents,
    spent_cents:    p.spent_this_period_cents,
    utilization_pct: p.monthly_limit_cents > 0
      ? Math.round((p.spent_this_period_cents / p.monthly_limit_cents) * 100)
      : 0,
  }))

  return {
    period_start:   start,
    period_end:     end,
    total_cost_cents: totalCost,
    by_provider:    Object.entries(byProvider)
      .map(([k, v]) => ({ provider_key: k, ...v }))
      .sort((a, b) => b.cost_cents - a.cost_cents),
    by_feature:     Object.entries(byFeature)
      .map(([k, v]) => ({ feature_key: k, ...v }))
      .sort((a, b) => b.cost_cents - a.cost_cents),
    pool_utilization: poolUtilization,
  }
}

// ── Feature economics ──────────────────────────────────────────────────────────

async function getFeatureEconomics(period?: string): Promise<FeatureEconomicRow[]> {
  const { start, end } = periodBounds(period)

  const { data: events } = await serviceClient
    .from('api_usage_events')
    .select('feature_key, actual_cost_cents, credits_consumed, success, cache_hit, provider_called')
    .gte('occurred_at', start)
    .lt('occurred_at', end)

  type FeatureAcc = {
    total_calls: number; cache_hits: number; provider_calls: number
    failed_calls: number; total_vendor_cost_cents: number; total_credits_consumed: number
  }
  const agg: Record<string, FeatureAcc> = {}

  for (const e of (events ?? [])) {
    const fk = e.feature_key ?? 'unknown'
    if (!agg[fk]) agg[fk] = { total_calls: 0, cache_hits: 0, provider_calls: 0, failed_calls: 0, total_vendor_cost_cents: 0, total_credits_consumed: 0 }
    agg[fk].total_calls++
    if (e.cache_hit)        agg[fk].cache_hits++
    if (e.provider_called)  agg[fk].provider_calls++
    if (!e.success)         agg[fk].failed_calls++
    agg[fk].total_vendor_cost_cents += (e.actual_cost_cents ?? 0)
    agg[fk].total_credits_consumed  += (e.credits_consumed  ?? 0)
  }

  // Fetch active pricing for each feature
  const { data: pricing } = await serviceClient
    .from('feature_pricing_versions')
    .select('feature_key, expected_vendor_cost_cents, customer_credit_cost')
    .eq('is_active', true)
    .eq('is_enabled', true)

  const pricingMap: Record<string, { expected_vendor_cost_cents: number; customer_credit_cost: number }> = {}
  for (const p of (pricing ?? [])) pricingMap[p.feature_key] = p

  return Object.entries(agg)
    .map(([fk, acc]) => {
      const p = pricingMap[fk]
      const providerCalls = acc.provider_calls || 1
      return {
        feature_key:           fk,
        period_start:          start,
        period_end:            end,
        ...acc,
        avg_vendor_cost_cents: Math.round(acc.total_vendor_cost_cents / providerCalls),
        cache_hit_rate_pct:    acc.total_calls > 0
          ? Math.round((acc.cache_hits / acc.total_calls) * 100)
          : 0,
        expected_vendor_cost_cents: p?.expected_vendor_cost_cents ?? null,
        customer_credit_cost:       p?.customer_credit_cost       ?? null,
        recommended_credit_cost:    null,   // advisory only — Phase C; may remain NULL
      }
    })
    .sort((a, b) => b.total_vendor_cost_cents - a.total_vendor_cost_cents)
}

// ── Customer economics ─────────────────────────────────────────────────────────

async function getCustomerEconomics(period?: string): Promise<CustomerEconomicRow[]> {
  const { start, end } = periodBounds(period)

  const { data: events } = await serviceClient
    .from('api_usage_events')
    .select('account_id, actual_cost_cents, credits_consumed, success, cache_hit, provider_called')
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .not('account_id', 'is', null)

  type AccAcc = {
    vendor_cost_cents: number; credits_consumed: number
    call_count: number; cache_hits: number
  }
  const agg: Record<string, AccAcc> = {}

  for (const e of (events ?? [])) {
    const aid = e.account_id as string
    if (!aid) continue
    if (!agg[aid]) agg[aid] = { vendor_cost_cents: 0, credits_consumed: 0, call_count: 0, cache_hits: 0 }
    if (e.success) agg[aid].vendor_cost_cents += (e.actual_cost_cents ?? 0)
    agg[aid].credits_consumed += (e.credits_consumed ?? 0)
    agg[aid].call_count++
    if (e.cache_hit) agg[aid].cache_hits++
  }

  // Fetch active subscriptions and cost caps
  const { data: subs } = await serviceClient
    .from('account_subscriptions')
    .select('account_id, plan_id, subscription_plans(plan_key)')
    .eq('status', 'active')
    .in('account_id', Object.keys(agg))

  const { data: caps } = await serviceClient
    .from('account_vendor_cost_caps')
    .select('account_id, effective_cap_cents')
    .in('account_id', Object.keys(agg))

  const planMap: Record<string, string> = {}
  const capMap:  Record<string, number> = {}
  for (const s of (subs ?? [])) {
    const plan = (s.subscription_plans as unknown as { plan_key: string } | null)
    if (plan) planMap[s.account_id] = plan.plan_key
  }
  for (const c of (caps ?? [])) capMap[c.account_id] = c.effective_cap_cents

  return Object.entries(agg)
    .map(([aid, acc]) => {
      const capCents = capMap[aid] ?? null
      return {
        account_id:          aid,
        plan_key:            planMap[aid] ?? null,
        period_start:        start,
        period_end:          end,
        vendor_cost_cents:   acc.vendor_cost_cents,
        vendor_cap_cents:    capCents,
        cap_utilization_pct: capCents && capCents > 0
          ? Math.round((acc.vendor_cost_cents / capCents) * 100)
          : null,
        credits_consumed:    acc.credits_consumed,
        call_count:          acc.call_count,
        cache_hit_rate_pct:  acc.call_count > 0
          ? Math.round((acc.cache_hits / acc.call_count) * 100)
          : null,
      }
    })
    .sort((a, b) => b.vendor_cost_cents - a.vendor_cost_cents)
}

// ── Assembled dashboard ────────────────────────────────────────────────────────

class EconomicsService {

  async getDashboard(period?: string): Promise<EconomicsDashboard> {
    const [platform, vendor_spend, feature_economics, customer_economics, statuses, wallets] =
      await Promise.all([
        getPlatformSummary(period),
        getVendorSpend(period),
        getFeatureEconomics(period),
        getCustomerEconomics(period),
        providerHealthService.getAllStatuses(),
        providerHealthService.getAllWalletInfos(),
      ])

    return {
      generated_at:       new Date().toISOString(),
      platform,
      vendor_spend,
      feature_economics,
      customer_economics,
      provider_health: { statuses, wallets },
      revenue:         null,
      revenue_note:    'Revenue data unavailable: Stripe is not yet in live mode. ' +
                       'Enable Stripe live mode and complete product setup before this section shows data.',
    }
  }
}

export const economicsService = new EconomicsService()
