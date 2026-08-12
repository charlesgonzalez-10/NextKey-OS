/**
 * Billing reconciliation service — classified approach.
 *
 * Stale reservations (status='reserved', expires_at < now) are classified
 * before any action is taken:
 *
 *   A — No usage event: provider never called. Expire + release credits.
 *   B — Usage event with success=true: provider succeeded (lost-response).
 *       Finalize at actual cost + consume credits. No new usage event written
 *       (already exists; api_usage_events.request_id UNIQUE constraint).
 *   C — Usage event with success=false AND provider_called=true: provider was
 *       called but outcome is ambiguous for billing. Mark needs_review.
 *       Do NOT automatically consume or release credits.
 *   D — Already settled (status ≠ 'reserved' or not expired): no-op.
 *
 * Idempotency: every mutation uses `.eq('status', 'reserved')` as a WHERE guard.
 * If 0 rows are affected, all downstream pool/cap/credit adjustments are skipped.
 * Running reconciliation twice is a safe no-op.
 *
 * Invariants:
 *   - Never deletes ledger rows.
 *   - Never calls fn_reserve_budget_and_credits (not a re-authorization).
 *   - Category B never writes a new usage event (already exists).
 *   - Category C leaves wallet unchanged.
 */

import { serviceClient } from '@/lib/supabase-service'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReservationCategory = 'A' | 'B' | 'C'

export interface ClassifiedReservation {
  budget_id:              string
  request_id:             string
  account_id:             string | null
  pool_key:               string
  provider_key:           string | null
  feature_key:            string | null
  estimated_cost_cents:   number
  expires_at:             string

  credit_reservation_id:  string | null
  reserved_credits:       number

  usage_event_found:      boolean
  usage_success:          boolean | null
  usage_provider_called:  boolean | null
  actual_cost_cents:      number | null

  category:               ReservationCategory
  category_reason:        string
  proposed_action:        string
}

export interface ReconciliationPreview {
  previewed_at: string

  total_stale_budget:  number
  total_stale_credit:  number
  category_A:          number
  category_B:          number
  category_C:          number

  credits_to_release:  number
  credits_to_consume:  number

  current_reserved_credits:    number
  current_pool_spend_cents:    Record<string, number>
  current_account_spend_cents: Record<string, number>

  expected_reserved_credits:    number
  expected_pool_spend_cents:    Record<string, number>
  expected_account_spend_cents: Record<string, number>

  classified:    ClassifiedReservation[]
  is_safe:       boolean
  safety_notes:  string[]
}

export interface ReconciliationResult {
  run_at:                  string
  category_A_processed:    number
  category_B_processed:    number
  category_C_needs_review: number
  drift_corrected:         number
  errors:                  string[]
}

export interface ReconciliationVerification {
  verified_at:                               string
  reserved_credits_match_active:             boolean
  no_stale_in_flight:                        boolean
  no_successful_call_accidentally_released:  boolean
  remaining_needs_review:                    number
  remaining_drift:                           number
  issues:                                    string[]
}

export interface ReservedCreditsDrift {
  account_id:       string
  wallet_id:        string
  wallet_reserved:  number
  actual_active:    number
  drift:            number
}

// ─── Classification ───────────────────────────────────────────────────────────

export async function classifyStaleReservations(): Promise<ClassifiedReservation[]> {
  const now = new Date().toISOString()

  const { data: stale, error } = await serviceClient
    .from('api_budget_reservations')
    .select('id, request_id, account_id, pool_key, provider_key, feature_key, estimated_cost_cents, expires_at')
    .eq('status', 'reserved')
    .lt('expires_at', now)

  if (error) throw new Error(`classifyStaleReservations: ${error.message}`)
  if (!stale?.length) return []

  const classified: ClassifiedReservation[] = []

  for (const r of stale) {
    // Credit reservation for this request
    const { data: creditRes } = await serviceClient
      .from('credit_reservations')
      .select('id, reserved_credits')
      .eq('request_id', r.request_id)
      .maybeSingle()

    // Usage event for this request
    const { data: event } = await serviceClient
      .from('api_usage_events')
      .select('success, provider_called, actual_cost_cents')
      .eq('request_id', r.request_id)
      .maybeSingle()

    let category: ReservationCategory
    let reason: string
    let action: string

    if (!event) {
      category = 'A'
      reason   = 'No usage event — provider was never called'
      action   = 'Expire reservation → release reserved credits → reverse pool/cap hold'
    } else if (event.success === true) {
      category = 'B'
      reason   = 'Usage event found with success=true (lost-response scenario)'
      action   = `Finalize at ${event.actual_cost_cents}¢ actual cost → consume ${creditRes?.reserved_credits ?? 0} credits`
    } else {
      category = 'C'
      reason   = `Usage event found with success=${event.success}, provider_called=${event.provider_called} — ambiguous`
      action   = 'Mark needs_review — do not auto-consume or release credits'
    }

    classified.push({
      budget_id:             r.id,
      request_id:            r.request_id,
      account_id:            r.account_id,
      pool_key:              r.pool_key,
      provider_key:          r.provider_key,
      feature_key:           r.feature_key,
      estimated_cost_cents:  r.estimated_cost_cents,
      expires_at:            r.expires_at,
      credit_reservation_id: creditRes?.id ?? null,
      reserved_credits:      creditRes?.reserved_credits ?? 0,
      usage_event_found:     !!event,
      usage_success:         event?.success ?? null,
      usage_provider_called: event?.provider_called ?? null,
      actual_cost_cents:     event?.actual_cost_cents ?? null,
      category,
      category_reason:       reason,
      proposed_action:       action,
    })
  }

  return classified
}

// ─── Preview (read-only) ──────────────────────────────────────────────────────

export async function computeReconciliationPreview(): Promise<ReconciliationPreview> {
  const previewed_at = new Date().toISOString()
  const now          = previewed_at

  const classified = await classifyStaleReservations()

  // Stale credit reservation count (may differ from budget if orphaned)
  const { count: totalStaleCredit } = await serviceClient
    .from('credit_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'reserved')
    .lt('expires_at', now)

  // Current wallet reserved_credits (summed across all wallets)
  const { data: wallets } = await serviceClient
    .from('credit_wallets')
    .select('account_id, reserved_credits')

  const currentReservedCredits = (wallets ?? []).reduce((s, w) => s + w.reserved_credits, 0)

  // Current pool spend
  const { data: pools } = await serviceClient
    .from('api_budget_pools')
    .select('pool_key, spent_this_period_cents')

  const currentPoolSpend: Record<string, number> = {}
  for (const p of pools ?? []) currentPoolSpend[p.pool_key] = p.spent_this_period_cents

  // Current account cap spend
  const { data: caps } = await serviceClient
    .from('account_vendor_cost_caps')
    .select('account_id, spent_this_period_cents')

  const currentAccountSpend: Record<string, number> = {}
  for (const c of caps ?? []) currentAccountSpend[c.account_id] = c.spent_this_period_cents

  // Compute expected post-reconciliation state
  const catA = classified.filter(r => r.category === 'A')
  const catB = classified.filter(r => r.category === 'B')
  const catC = classified.filter(r => r.category === 'C')

  const creditsToRelease = catA.reduce((s, r) => s + r.reserved_credits, 0)
  const creditsToConsume = catB.reduce((s, r) => s + r.reserved_credits, 0)

  const expectedPoolSpend    = { ...currentPoolSpend }
  const expectedAccountSpend = { ...currentAccountSpend }

  for (const r of catA) {
    // A: reverse the full estimated cost (provider never called)
    if (expectedPoolSpend[r.pool_key] !== undefined) {
      expectedPoolSpend[r.pool_key] = Math.max(0, expectedPoolSpend[r.pool_key] - r.estimated_cost_cents)
    }
    if (r.account_id && expectedAccountSpend[r.account_id] !== undefined) {
      expectedAccountSpend[r.account_id] = Math.max(0, expectedAccountSpend[r.account_id] - r.estimated_cost_cents)
    }
  }
  for (const r of catB) {
    // B: adjust from estimated to actual (delta may be 0 if actual == estimated)
    const delta = (r.actual_cost_cents ?? 0) - r.estimated_cost_cents
    if (delta !== 0) {
      if (expectedPoolSpend[r.pool_key] !== undefined) {
        expectedPoolSpend[r.pool_key] = Math.max(0, expectedPoolSpend[r.pool_key] + delta)
      }
      if (r.account_id && expectedAccountSpend[r.account_id] !== undefined) {
        expectedAccountSpend[r.account_id] = Math.max(0, expectedAccountSpend[r.account_id] + delta)
      }
    }
  }

  const expectedReservedCredits = Math.max(0, currentReservedCredits - creditsToRelease - creditsToConsume)

  // Safety checks
  const safetyNotes: string[] = []
  let isSafe = true

  if (catC.length > 0) {
    safetyNotes.push(`${catC.length} reservation(s) classified needs_review — credits untouched pending human review`)
  }
  if (catB.length > 0) {
    safetyNotes.push(`${catB.length} reservation(s) have confirmed provider success — credits will be consumed, not released`)
  }
  if (creditsToRelease + creditsToConsume > currentReservedCredits) {
    isSafe = false
    safetyNotes.push(
      `UNSAFE: credits to release/consume (${creditsToRelease + creditsToConsume}) ` +
      `exceeds wallet reserved_credits (${currentReservedCredits}) — DB drift must be fixed first`
    )
  }

  return {
    previewed_at,
    total_stale_budget:          classified.length,
    total_stale_credit:          totalStaleCredit ?? 0,
    category_A:                  catA.length,
    category_B:                  catB.length,
    category_C:                  catC.length,
    credits_to_release:          creditsToRelease,
    credits_to_consume:          creditsToConsume,
    current_reserved_credits:    currentReservedCredits,
    current_pool_spend_cents:    currentPoolSpend,
    current_account_spend_cents: currentAccountSpend,
    expected_reserved_credits:   expectedReservedCredits,
    expected_pool_spend_cents:   expectedPoolSpend,
    expected_account_spend_cents: expectedAccountSpend,
    classified,
    is_safe:                     isSafe,
    safety_notes:                safetyNotes,
  }
}

// ─── Direct adjust helpers (fallback when DB fn_adjust_* functions are missing) ─

async function adjustPoolSpent(poolKey: string, deltaCents: number): Promise<void> {
  const { error } = await serviceClient.rpc('fn_adjust_pool_spent', {
    p_pool_key:    poolKey,
    p_delta_cents: deltaCents,
  })
  if (!error) return
  // Fallback: direct UPDATE (equivalent to: MAX(0, spent + delta))
  const { data: pool } = await serviceClient
    .from('api_budget_pools')
    .select('spent_this_period_cents')
    .eq('pool_key', poolKey)
    .single()
  if (!pool) return
  const target = Math.max(0, pool.spent_this_period_cents + deltaCents)
  await serviceClient
    .from('api_budget_pools')
    .update({ spent_this_period_cents: target })
    .eq('pool_key', poolKey)
}

async function adjustAccountCost(accountId: string, deltaCents: number): Promise<void> {
  const { error } = await serviceClient.rpc('fn_adjust_account_cost', {
    p_account_id:  accountId,
    p_delta_cents: deltaCents,
  })
  if (!error) return
  const { data: cap } = await serviceClient
    .from('account_vendor_cost_caps')
    .select('spent_this_period_cents')
    .eq('account_id', accountId)
    .single()
  if (!cap) return
  const target = Math.max(0, cap.spent_this_period_cents + deltaCents)
  await serviceClient
    .from('account_vendor_cost_caps')
    .update({ spent_this_period_cents: target })
    .eq('account_id', accountId)
}

async function adjustReservedCredits(accountId: string, delta: number): Promise<void> {
  const { error } = await serviceClient.rpc('fn_adjust_reserved_credits', {
    p_account_id: accountId,
    p_delta:      delta,
  })
  if (!error) return
  const { data: wallet } = await serviceClient
    .from('credit_wallets')
    .select('reserved_credits')
    .eq('account_id', accountId)
    .single()
  if (!wallet) return
  const target = Math.max(0, wallet.reserved_credits + delta)
  await serviceClient
    .from('credit_wallets')
    .update({ reserved_credits: target })
    .eq('account_id', accountId)
}

// ─── Category A: expire + release ─────────────────────────────────────────────

async function reconcileCategoryA(r: ClassifiedReservation): Promise<'done' | 'skipped'> {
  const now = new Date().toISOString()

  // Guard: only proceed if reservation is still in 'reserved' state
  const { data: updated } = await serviceClient
    .from('api_budget_reservations')
    .update({ status: 'released', actual_cost_cents: 0, finalized_at: now, updated_at: now })
    .eq('request_id', r.request_id)
    .eq('status', 'reserved')
    .select('id')

  if (!updated?.length) return 'skipped'  // Already reconciled (idempotent)

  // Release pool budget hold (RPC with direct-update fallback)
  await adjustPoolSpent(r.pool_key, -r.estimated_cost_cents)

  // Release account cap hold
  if (r.account_id) {
    await adjustAccountCost(r.account_id, -r.estimated_cost_cents)
  }

  // Release credit reservation + locked credits
  if (r.credit_reservation_id) {
    await serviceClient
      .from('credit_reservations')
      .update({ status: 'released', finalized_at: now, updated_at: now })
      .eq('request_id', r.request_id)
      .eq('status', 'reserved')

    if (r.account_id && r.reserved_credits > 0) {
      await adjustReservedCredits(r.account_id, -r.reserved_credits)
    }
  }

  // Write audit usage event (Category A has no existing event — INSERT will succeed)
  await serviceClient.from('api_usage_events').insert({
    request_id:                r.request_id,
    pool_key:                  r.pool_key,
    account_id:                r.account_id,
    provider_key:              r.provider_key,
    feature_key:               r.feature_key,
    actual_cost_cents:         0,
    estimated_cost_cents:      r.estimated_cost_cents,
    account_vendor_cost_cents: 0,
    provider_called:           false,
    success:                   false,
    error_code:                'stale_reservation_released_no_provider_call',
  }).then(({ error }) => {
    if (error) console.error(`[Reconcile] Category A audit event: ${r.request_id}: ${error.message}`)
  })

  return 'done'
}

// ─── Category B: finalize at actual cost + consume credits ───────────────────
// Does NOT call providerGateway.finalize() — that would INSERT a duplicate
// usage event (api_usage_events.request_id is UNIQUE and event already exists).

async function reconcileCategoryB(r: ClassifiedReservation): Promise<'done' | 'skipped'> {
  const now        = new Date().toISOString()
  const actual     = r.actual_cost_cents ?? 0
  const poolDelta  = actual - r.estimated_cost_cents

  // Guard: only proceed if reservation is still in 'reserved' state
  const { data: updated } = await serviceClient
    .from('api_budget_reservations')
    .update({ status: 'finalized', actual_cost_cents: actual, finalized_at: now, updated_at: now })
    .eq('request_id', r.request_id)
    .eq('status', 'reserved')
    .select('id')

  if (!updated?.length) return 'skipped'  // Already reconciled (idempotent)

  // Adjust pool spend from estimated to actual (RPC with direct-update fallback)
  if (poolDelta !== 0) {
    await adjustPoolSpent(r.pool_key, poolDelta)
  }

  // Adjust account cap from estimated to actual
  if (r.account_id && poolDelta !== 0) {
    await adjustAccountCost(r.account_id, poolDelta)
  }

  // Finalize credit reservation + consume credits from wallet
  if (r.credit_reservation_id && r.account_id) {
    await serviceClient
      .from('credit_reservations')
      .update({ status: 'finalized', finalized_at: now, updated_at: now })
      .eq('request_id', r.request_id)
      .eq('status', 'reserved')

    const { data: wallet } = await serviceClient
      .from('credit_wallets')
      .select('reserved_credits, lifetime_consumed_credits, available_bonus_credits, available_monthly_credits, available_purchased_credits')
      .eq('account_id', r.account_id)
      .single()

    if (wallet) {
      const consumed = r.reserved_credits
      const updates: Record<string, number | string> = {
        reserved_credits:          Math.max(0, wallet.reserved_credits - consumed),
        lifetime_consumed_credits: wallet.lifetime_consumed_credits + consumed,
        updated_at:                now,
      }
      let remaining = consumed
      if (remaining > 0 && wallet.available_bonus_credits > 0) {
        const draw = Math.min(remaining, wallet.available_bonus_credits)
        updates.available_bonus_credits = wallet.available_bonus_credits - draw
        remaining -= draw
      }
      if (remaining > 0 && wallet.available_monthly_credits > 0) {
        const draw = Math.min(remaining, wallet.available_monthly_credits)
        updates.available_monthly_credits = wallet.available_monthly_credits - draw
        remaining -= draw
      }
      if (remaining > 0 && wallet.available_purchased_credits > 0) {
        const draw = Math.min(remaining, wallet.available_purchased_credits)
        updates.available_purchased_credits = wallet.available_purchased_credits - draw
      }
      await serviceClient.from('credit_wallets').update(updates).eq('account_id', r.account_id)
    }
  }
  // NOTE: no usage event INSERT — already exists (UNIQUE constraint)
  return 'done'
}

// ─── Category C: mark needs_review ────────────────────────────────────────────
// Does not touch pool spend, account cap, or reserved credits.
// Requires phase66e_needs_review.sql migration to be applied first.

async function reconcileCategoryC(r: ClassifiedReservation): Promise<'done' | 'skipped'> {
  const now = new Date().toISOString()

  const { data: updated } = await serviceClient
    .from('api_budget_reservations')
    .update({ status: 'needs_review', updated_at: now })
    .eq('request_id', r.request_id)
    .eq('status', 'reserved')
    .select('id')

  if (!updated?.length) return 'skipped'

  if (r.credit_reservation_id) {
    await serviceClient
      .from('credit_reservations')
      .update({ status: 'needs_review', updated_at: now })
      .eq('request_id', r.request_id)
      .eq('status', 'reserved')
  }

  return 'done'
}

// ─── Main reconciliation ───────────────────────────────────────────────────────

export async function reconcileStaleReservations(): Promise<ReconciliationResult> {
  const run_at = new Date().toISOString()
  const errors: string[] = []

  const classified = await classifyStaleReservations()
  let catA_done = 0, catB_done = 0, catC_done = 0

  for (const r of classified) {
    try {
      if (r.category === 'A') {
        const result = await reconcileCategoryA(r)
        if (result === 'done') catA_done++
      } else if (r.category === 'B') {
        const result = await reconcileCategoryB(r)
        if (result === 'done') catB_done++
      } else {
        const result = await reconcileCategoryC(r)
        if (result === 'done') catC_done++
      }
    } catch (e) {
      const msg = `${r.request_id} (${r.category}): ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
      console.error(`[Reconcile] Error:`, msg)
    }
  }

  // Correct any remaining wallet drift (positive drift = over-counted reserved_credits)
  const drifts    = await detectReservedCreditsDrift()
  let drift_corrected = 0
  for (const d of drifts.filter(x => x.drift > 0)) {
    try {
      await adjustReservedCredits(d.account_id, -d.drift)
      drift_corrected++
    } catch (e) {
      errors.push(`Drift correction ${d.account_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { run_at, category_A_processed: catA_done, category_B_processed: catB_done, category_C_needs_review: catC_done, drift_corrected, errors }
}

// ─── Post-reconciliation verification (read-only) ─────────────────────────────

export async function verifyReconciliation(): Promise<ReconciliationVerification> {
  const verified_at = new Date().toISOString()
  const now         = verified_at
  const issues: string[] = []

  // 1. No stale in-flight reservations remain
  const { count: staleCount } = await serviceClient
    .from('api_budget_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'reserved')
    .lt('expires_at', now)

  const no_stale = (staleCount ?? 0) === 0
  if (!no_stale) issues.push(`${staleCount} stale budget reservations still exist`)

  // 2. Wallet drift check
  const drifts = await detectReservedCreditsDrift()
  const driftsWithIssue = drifts.filter(d => d.drift !== 0)
  const credits_match = driftsWithIssue.length === 0
  if (!credits_match) {
    for (const d of driftsWithIssue) {
      issues.push(`Wallet drift: account ${d.account_id} reserved=${d.wallet_reserved} actual=${d.actual_active} drift=${d.drift}`)
    }
  }

  // 3. No successful provider call accidentally released/expired
  const { data: successEvents } = await serviceClient
    .from('api_usage_events')
    .select('request_id')
    .eq('success', true)
    .eq('provider_called', true)
    .limit(200)

  let accidentalReleases = 0
  for (const e of successEvents ?? []) {
    const { data: res } = await serviceClient
      .from('api_budget_reservations')
      .select('status')
      .eq('request_id', e.request_id)
      .maybeSingle()

    if (res && (res.status === 'expired' || res.status === 'released')) {
      accidentalReleases++
      issues.push(`Successful call ${e.request_id.slice(0, 12)}… has reservation status=${res.status} — should be finalized`)
    }
  }

  // 4. Count needs_review
  const { count: needsReview } = await serviceClient
    .from('api_budget_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'needs_review')

  return {
    verified_at,
    reserved_credits_match_active:            credits_match,
    no_stale_in_flight:                       no_stale,
    no_successful_call_accidentally_released: accidentalReleases === 0,
    remaining_needs_review:                   needsReview ?? 0,
    remaining_drift:                          driftsWithIssue.reduce((s, d) => s + Math.abs(d.drift), 0),
    issues,
  }
}

// ─── Drift detection (exported for diagnostics) ───────────────────────────────

export async function detectReservedCreditsDrift(): Promise<ReservedCreditsDrift[]> {
  const { data: wallets } = await serviceClient
    .from('credit_wallets')
    .select('id, account_id, reserved_credits')

  if (!wallets?.length) return []

  const now = new Date().toISOString()
  const drifts: ReservedCreditsDrift[] = []

  for (const wallet of wallets) {
    const { data: active } = await serviceClient
      .from('credit_reservations')
      .select('reserved_credits')
      .eq('wallet_id', wallet.id)
      .eq('status', 'reserved')
      .gt('expires_at', now)

    const actualActive = (active ?? []).reduce(
      (s, r) => s + ((r as { reserved_credits: number }).reserved_credits ?? 0), 0
    )

    drifts.push({
      account_id:      wallet.account_id,
      wallet_id:       wallet.id,
      wallet_reserved: wallet.reserved_credits,
      actual_active:   actualActive,
      drift:           wallet.reserved_credits - actualActive,
    })
  }

  return drifts
}
