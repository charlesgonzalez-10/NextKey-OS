import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import { providerHealthService } from '@/lib/billing/providerHealth'

export const dynamic = 'force-dynamic'

async function getBudgetPools() {
  const { data } = await serviceClient
    .from('api_budget_pools')
    .select('pool_key, pool_name, monthly_limit_cents, spent_this_period_cents, is_protected, is_active')
    .order('monthly_limit_cents', { ascending: false })

  return (data ?? []).map(p => ({
    ...p,
    remaining_cents: Math.max(0, p.monthly_limit_cents - p.spent_this_period_cents),
    utilization_pct: p.monthly_limit_cents > 0
      ? Math.round((p.spent_this_period_cents / p.monthly_limit_cents) * 100) : 0,
  }))
}

async function getProviderUsage() {
  const start = new Date()
  start.setDate(1); start.setHours(0, 0, 0, 0)

  const { data } = await serviceClient
    .from('api_usage_events')
    .select('provider_key, feature_key, actual_cost_cents, success, created_at')
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: false })

  const events = data ?? []
  const byProvider: Record<string, { events: number; cost_cents: number; failures: number }> = {}
  let total_cost = 0

  for (const e of events) {
    const k = e.provider_key ?? 'unknown'
    if (!byProvider[k]) byProvider[k] = { events: 0, cost_cents: 0, failures: 0 }
    byProvider[k].events++
    byProvider[k].cost_cents += e.actual_cost_cents ?? 0
    if (!e.success) byProvider[k].failures++
    total_cost += e.actual_cost_cents ?? 0
  }

  return {
    total_events: events.length,
    total_cost_cents: total_cost,
    by_provider: Object.entries(byProvider).map(([provider_key, v]) => ({ provider_key, ...v })),
  }
}

async function getRecentUsageEvents() {
  const { data } = await serviceClient
    .from('api_usage_events')
    .select('request_id, account_id, provider_key, feature_key, actual_cost_cents, estimated_cost_cents, duration_ms, success, error_code, cache_hit, created_at')
    .order('created_at', { ascending: false })
    .limit(25)
  return data ?? []
}

async function getRecentReservations() {
  const { data } = await serviceClient
    .from('api_budget_reservations')
    .select('request_id, account_id, pool_key, provider_key, feature_key, status, estimated_cost_cents, actual_cost_cents, expires_at, finalized_at, created_at')
    .order('created_at', { ascending: false })
    .limit(15)
  return data ?? []
}

async function getActiveReservations() {
  const { data } = await serviceClient
    .from('api_budget_reservations')
    .select('id, estimated_cost_cents')
    .eq('status', 'reserved')

  const rows = data ?? []
  return {
    count: rows.length,
    total_reserved_cents: rows.reduce((s, r) => s + (r.estimated_cost_cents ?? 0), 0),
  }
}

async function getReservationState() {
  const now = new Date().toISOString()

  const [budgetByStatus, creditByStatus, staleB, staleC] = await Promise.all([
    serviceClient
      .from('api_budget_reservations')
      .select('status')
      .then(({ data }) => {
        const counts: Record<string, number> = {}
        for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1
        return counts
      }),
    serviceClient
      .from('credit_reservations')
      .select('status')
      .then(({ data }) => {
        const counts: Record<string, number> = {}
        for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1
        return counts
      }),
    serviceClient
      .from('api_budget_reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'reserved')
      .lt('expires_at', now)
      .then(({ count }) => count ?? 0),
    serviceClient
      .from('credit_reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'reserved')
      .lt('expires_at', now)
      .then(({ count }) => count ?? 0),
  ])

  // Wallet drift: sum(wallet.reserved_credits) vs sum(active credit_reservations)
  const { data: wallets } = await serviceClient
    .from('credit_wallets')
    .select('id, account_id, reserved_credits')
    .gt('reserved_credits', 0)

  let drift_credits = 0
  let drift_accounts = 0

  if (wallets?.length) {
    const { data: activeCredRes } = await serviceClient
      .from('credit_reservations')
      .select('wallet_id, reserved_credits')
      .eq('status', 'reserved')
      .gt('expires_at', now)

    const actualByWallet: Record<string, number> = {}
    for (const r of activeCredRes ?? []) {
      actualByWallet[r.wallet_id] = (actualByWallet[r.wallet_id] ?? 0) + (r.reserved_credits ?? 0)
    }

    for (const w of wallets) {
      const actual = actualByWallet[w.id] ?? 0
      const d = w.reserved_credits - actual
      if (d !== 0) { drift_accounts++; drift_credits += d }
    }
  }

  return {
    budget:         budgetByStatus,
    credit:         creditByStatus,
    stale_budget:   staleB,
    stale_credit:   staleC,
    drift_accounts,
    drift_credits,
    needs_reconciliation: staleB > 0 || staleC > 0 || drift_credits > 0,
  }
}

async function getCustomerAccounts() {
  const [walletsRes, capsRes] = await Promise.all([
    serviceClient.from('credit_wallets')
      .select('account_id, status, available_monthly_credits, available_purchased_credits, available_bonus_credits, reserved_credits, lifetime_consumed_credits')
      .order('lifetime_consumed_credits', { ascending: false })
      .limit(50),
    serviceClient.from('account_vendor_cost_caps')
      .select('account_id, effective_cap_cents, spent_this_period_cents, plan_default_cap_cents, override_cap_cents')
      .limit(50),
  ])

  const wallets = walletsRes.data ?? []
  const capsMap = Object.fromEntries((capsRes.data ?? []).map(c => [c.account_id, c]))

  return wallets.map(w => ({
    account_id: w.account_id,
    status:     w.status,
    available_credits: Math.max(0,
      w.available_monthly_credits + w.available_purchased_credits + w.available_bonus_credits - w.reserved_credits
    ),
    monthly_credits:   w.available_monthly_credits,
    purchased_credits: w.available_purchased_credits,
    bonus_credits:     w.available_bonus_credits,
    reserved_credits:  w.reserved_credits,
    lifetime_consumed: w.lifetime_consumed_credits,
    cap: capsMap[w.account_id] ?? null,
  }))
}

async function getCreditOverview() {
  const { data } = await serviceClient
    .from('credit_wallets')
    .select('available_monthly_credits, available_purchased_credits, available_bonus_credits, reserved_credits')

  const wallets = data ?? []
  let total_available = 0, total_reserved = 0

  for (const w of wallets) {
    total_available += Math.max(0,
      w.available_monthly_credits + w.available_purchased_credits + w.available_bonus_credits - w.reserved_credits
    )
    total_reserved += w.reserved_credits
  }

  return { total_wallets: wallets.length, total_available, total_reserved }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [pools, providerUsage, recentEvents, recentReservations, activeReservations, customers, credits, reservationState, providerHealth] =
    await Promise.allSettled([
      getBudgetPools(),
      getProviderUsage(),
      getRecentUsageEvents(),
      getRecentReservations(),
      getActiveReservations(),
      getCustomerAccounts(),
      getCreditOverview(),
      getReservationState(),
      providerHealthService.getAllStatuses(),
    ])

  return NextResponse.json({
    generated_at:         new Date().toISOString(),
    pools:                pools.status              === 'fulfilled' ? pools.value                : [],
    provider_usage:       providerUsage.status      === 'fulfilled' ? providerUsage.value        : { error: 'Failed' },
    recent_events:        recentEvents.status        === 'fulfilled' ? recentEvents.value         : [],
    recent_reservations:  recentReservations.status  === 'fulfilled' ? recentReservations.value   : [],
    active_reservations:  activeReservations.status  === 'fulfilled' ? activeReservations.value   : { count: 0, total_reserved_cents: 0 },
    customer_accounts:    customers.status           === 'fulfilled' ? customers.value            : [],
    credit_overview:      credits.status             === 'fulfilled' ? credits.value              : { error: 'Failed' },
    reservation_state:    reservationState.status    === 'fulfilled' ? reservationState.value     : null,
    provider_health:      providerHealth.status      === 'fulfilled' ? providerHealth.value       : [],
  })
}
