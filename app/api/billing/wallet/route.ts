import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodStart = new Date()
  periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0)

  const [walletRes, capRes, usageRes, subscriptionRes] = await Promise.allSettled([
    serviceClient.from('credit_wallets')
      .select('status, available_monthly_credits, available_purchased_credits, available_bonus_credits, reserved_credits, lifetime_consumed_credits')
      .eq('account_id', user.id)
      .maybeSingle(),

    serviceClient.from('account_vendor_cost_caps')
      .select('effective_cap_cents, spent_this_period_cents, plan_default_cap_cents, override_cap_cents')
      .eq('account_id', user.id)
      .maybeSingle(),

    serviceClient.from('api_usage_events')
      .select('feature_key, actual_cost_cents, success, created_at')
      .eq('account_id', user.id)
      .gte('created_at', periodStart.toISOString())
      .order('created_at', { ascending: false }),

    serviceClient.from('account_subscriptions')
      .select('plan_name, status, current_period_end')
      .eq('account_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
  ])

  const wallet       = walletRes.status       === 'fulfilled' ? walletRes.value.data       : null
  const cap          = capRes.status           === 'fulfilled' ? capRes.value.data           : null
  const usageEvents  = usageRes.status         === 'fulfilled' ? (usageRes.value.data ?? []) : []
  const subscription = subscriptionRes.status  === 'fulfilled' ? subscriptionRes.value.data  : null

  const monthlyCredits   = wallet?.available_monthly_credits  ?? 0
  const purchasedCredits = wallet?.available_purchased_credits ?? 0
  const bonusCredits     = wallet?.available_bonus_credits     ?? 0
  const reservedCredits  = wallet?.reserved_credits            ?? 0
  const totalGross       = monthlyCredits + purchasedCredits + bonusCredits
  const availableNow     = Math.max(0, totalGross - reservedCredits)

  // Usage this month
  const usageByFeature: Record<string, { calls: number; credits: number }> = {}
  let totalUsageCredits = 0
  for (const e of usageEvents) {
    const k = e.feature_key ?? 'other'
    if (!usageByFeature[k]) usageByFeature[k] = { calls: 0, credits: 0 }
    usageByFeature[k].calls++
    totalUsageCredits++
  }

  // Build progress bar data: available / total gross (cap at 100%)
  const creditPct = totalGross > 0
    ? Math.round((availableNow / totalGross) * 100)
    : 0

  return NextResponse.json({
    wallet: {
      status:             wallet?.status ?? 'not_found',
      available:          availableNow,
      monthly_credits:    monthlyCredits,
      purchased_credits:  purchasedCredits,
      bonus_credits:      bonusCredits,
      reserved_credits:   reservedCredits,
      total_gross:        totalGross,
      lifetime_consumed:  wallet?.lifetime_consumed_credits ?? 0,
      credit_pct:         creditPct,
    },
    plan: {
      name:               subscription?.plan_name ?? 'Free',
      status:             subscription?.status ?? 'none',
      period_end:         subscription?.current_period_end ?? null,
    },
    usage_this_month: {
      total_calls:        usageEvents.length,
      credits_used:       totalUsageCredits,
      by_feature:         Object.entries(usageByFeature).map(([feature_key, v]) => ({ feature_key, ...v })),
    },
  })
}
