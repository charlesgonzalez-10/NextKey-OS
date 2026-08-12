/**
 * Broward County bulk search — end-to-end billing verification.
 *
 * Tests (all using the owner account e5e19ad8):
 *   Test 1 — Cache miss → live REAPI call → verify 1 charge, 1 credit consumed
 *   Test 2 — Immediate retry with same request_id → idempotent_duplicate, no double-charge
 *   Test 3 — Explicit refresh (refreshGen=1) → new request_id → 1 new billable charge
 *
 * Usage: node scripts/test-broward-search.js
 */

const fs   = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local')
const envText = fs.readFileSync(envPath, 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

const SUPABASE_URL     = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY']
const REAPI_KEY        = env['REAPI_KEY']

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error('❌ Missing SUPABASE_URL or SERVICE_ROLE_KEY'); process.exit(1) }
if (!REAPI_KEY)                         { console.error('❌ Missing REAPI_KEY'); process.exit(1) }

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Constants ────────────────────────────────────────────────────────────────
const ACCOUNT_ID   = 'e5e19ad8-d6ed-40a4-89ce-aa961ddddae4'
const POOL_KEY     = 'customer_shared'
const FEATURE_KEY  = 'property_search_criteria'
const PROVIDER_KEY = 'reapi'
const REAPI_BASE   = 'https://api.realestateapi.com/v2'

// ── Helpers ──────────────────────────────────────────────────────────────────
function sha256(input) { return crypto.createHash('sha256').update(input).digest('hex') }
function sep(ch = '─', n = 62) { return ch.repeat(n) }
function log(label, msg, data) {
  const ts = new Date().toISOString().slice(11, 23)
  if (data !== undefined) {
    console.log(`[${ts}] ${label}: ${msg}`)
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(`[${ts}] ${label}: ${msg}`)
  }
}

/** Mirror of buildCacheKey — {county: 'Broward'} only */
function buildCacheKey(params) {
  const keys = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '').sort()
  const ordered = {}
  for (const k of keys) ordered[k] = params[k]
  return sha256(JSON.stringify(ordered)).slice(0, 32)
}

/** Mirror of buildBillingRequestId */
function buildBillingReqId(logicalSearchId, pageNum, refreshGen, dayEpoch) {
  return sha256(`srch:${ACCOUNT_ID}:${logicalSearchId}:p${pageNum}:g${refreshGen}:d${dayEpoch}`).slice(0, 32)
}

/** Snapshot billing state for comparison */
async function billingSnapshot(label) {
  const [pools, wallets, caps, usageCount, budgetByStatus, creditByStatus] = await Promise.all([
    sb.from('api_budget_pools').select('pool_key, spent_this_period_cents').eq('pool_key', POOL_KEY).single(),
    sb.from('credit_wallets').select('reserved_credits, available_monthly_credits, available_purchased_credits, available_bonus_credits, lifetime_consumed_credits').eq('account_id', ACCOUNT_ID).single(),
    sb.from('account_vendor_cost_caps').select('spent_this_period_cents').eq('account_id', ACCOUNT_ID).single(),
    sb.from('api_usage_events').select('id', { count: 'exact', head: true }).eq('account_id', ACCOUNT_ID),
    sb.from('api_budget_reservations').select('status').eq('account_id', ACCOUNT_ID),
    sb.from('credit_reservations').select('status').eq('account_id', ACCOUNT_ID),
  ])
  const budgetBySt = {}
  for (const r of budgetByStatus.data ?? []) budgetBySt[r.status] = (budgetBySt[r.status] ?? 0) + 1
  const creditBySt = {}
  for (const r of creditByStatus.data ?? []) creditBySt[r.status] = (creditBySt[r.status] ?? 0) + 1
  const snap = {
    pool_spent_cents:       pools.data?.spent_this_period_cents ?? 0,
    cap_spent_cents:        caps.data?.spent_this_period_cents ?? 0,
    wallet_monthly:         wallets.data?.available_monthly_credits ?? 0,
    wallet_purchased:       wallets.data?.available_purchased_credits ?? 0,
    wallet_bonus:           wallets.data?.available_bonus_credits ?? 0,
    wallet_reserved:        wallets.data?.reserved_credits ?? 0,
    wallet_lifetime:        wallets.data?.lifetime_consumed_credits ?? 0,
    usage_event_count:      usageCount.count ?? 0,
    budget_reservations:    budgetBySt,
    credit_reservations:    creditBySt,
  }
  console.log(`\n${sep()}`)
  console.log(`SNAPSHOT: ${label}`)
  console.log(sep())
  console.log(`  pool_spent:        ${snap.pool_spent_cents}¢`)
  console.log(`  cap_spent:         ${snap.cap_spent_cents}¢`)
  console.log(`  wallet_monthly:    ${snap.wallet_monthly}  reserved:${snap.wallet_reserved}  lifetime_consumed:${snap.wallet_lifetime}`)
  console.log(`  usage_events:      ${snap.usage_event_count}`)
  console.log(`  budget_res:        ${JSON.stringify(snap.budget_reservations)}`)
  console.log(`  credit_res:        ${JSON.stringify(snap.credit_reservations)}`)
  return snap
}

/** Call fn_reserve_budget_and_credits and return auth result */
async function authorize(requestId, estimatedCostCents, creditCost) {
  const { data, error } = await sb.rpc('fn_reserve_budget_and_credits', {
    p_request_id:           requestId,
    p_account_id:           ACCOUNT_ID,
    p_feature_key:          FEATURE_KEY,
    p_provider_key:         PROVIDER_KEY,
    p_pool_key:             POOL_KEY,
    p_estimated_cost_cents: estimatedCostCents,
    p_credit_cost:          creditCost,
    p_is_zero_cost_feature: false,
  })

  if (error) {
    const isDuplicate = error.code === '23505' ||
      /duplicate key|unique.*request_id|request_id.*unique/i.test(error.message ?? '')

    if (isDuplicate) {
      const { data: existing } = await sb
        .from('api_budget_reservations').select('status').eq('request_id', requestId).maybeSingle()
      const status = existing?.status ?? 'unknown'
      if (status === 'finalized') {
        return { success: false, error_code: 'idempotent_duplicate', error_message: 'Already finalized', _existing_status: status }
      }
      return { success: false, error_code: 'duplicate_request_id', error_message: `Collision (status=${status})`, _existing_status: status }
    }
    return { success: false, error_code: 'rpc_error', error_message: error.message }
  }
  return data
}

/** Replicate providerGateway.finalize for a successful call */
async function finalize(requestId, actualCostCents, durationMs, authResult) {
  const now = new Date().toISOString()
  const errors = []

  // 1. Update budget reservation → finalized
  const { error: brErr } = await sb.from('api_budget_reservations')
    .update({ status: 'finalized', actual_cost_cents: actualCostCents, finalized_at: now, updated_at: now })
    .eq('request_id', requestId)
  if (brErr) errors.push(`budget_reservation update: ${brErr.message}`)

  // 2. Pool/cap delta (actual vs estimated — for this search they should match, so delta=0)
  const { data: budgetRes } = await sb.from('api_budget_reservations')
    .select('estimated_cost_cents, pool_key').eq('request_id', requestId).single()
  if (budgetRes) {
    const delta = actualCostCents - budgetRes.estimated_cost_cents
    if (delta !== 0) {
      const { error: pe } = await sb.rpc('fn_adjust_pool_spent', { p_pool_key: budgetRes.pool_key, p_delta_cents: delta })
      if (pe) errors.push(`pool adjust: ${pe.message}`)
      const { error: ae } = await sb.rpc('fn_adjust_account_cost', { p_account_id: ACCOUNT_ID, p_delta_cents: delta })
      if (ae) errors.push(`cap adjust: ${ae.message}`)
    }
  }

  // 3. Update credit reservation → finalized + draw from wallet
  const { data: creditRes } = await sb.from('credit_reservations')
    .select('reserved_credits, account_id').eq('request_id', requestId).maybeSingle()

  if (creditRes) {
    const { error: crErr } = await sb.from('credit_reservations')
      .update({ status: 'finalized', finalized_at: now, updated_at: now }).eq('request_id', requestId)
    if (crErr) errors.push(`credit_reservation update: ${crErr.message}`)

    const { data: wallet } = await sb.from('credit_wallets').select('*').eq('account_id', ACCOUNT_ID).single()
    if (wallet) {
      const consumed = creditRes.reserved_credits
      const updates = {
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
      const { error: wErr } = await sb.from('credit_wallets').update(updates).eq('account_id', ACCOUNT_ID)
      if (wErr) errors.push(`wallet update: ${wErr.message}`)
    }
  }

  // 4. Write usage event
  const usageRow = {
    request_id:                requestId,
    pool_key:                  POOL_KEY,
    account_id:                ACCOUNT_ID,
    provider_key:              PROVIDER_KEY,
    feature_key:               FEATURE_KEY,
    reservation_id:            authResult?.budget_reservation_id ?? null,
    actual_cost_cents:         actualCostCents,
    estimated_cost_cents:      actualCostCents,
    account_vendor_cost_cents: actualCostCents,
    duration_ms:               durationMs,
    cache_hit:                 false,
    provider_called:           true,
    success:                   true,
  }
  const { error: ueErr } = await sb.from('api_usage_events').insert(usageRow)
  if (ueErr) errors.push(`usage_event insert: ${ueErr.message}`)

  return errors
}

/** Store results in search_cache */
async function writeCache(cacheKey, results, total) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  await sb.from('search_cache').upsert({
    search_hash:  cacheKey,
    query_params: { county: 'Broward' },
    results,
    result_count: total,
    created_at:   now.toISOString(),
    expires_at:   expiresAt.toISOString(),
    hit_count:    0,
  }, { onConflict: 'search_hash' })
}

/** Verify post-search state */
function verifySnap(before, after, expectedCharges) {
  const checks = []
  const poolDelta = after.pool_spent_cents - before.pool_spent_cents
  const capDelta  = after.cap_spent_cents  - before.cap_spent_cents
  const creditDelta = before.wallet_monthly - after.wallet_monthly + (before.wallet_purchased - after.wallet_purchased) + (before.wallet_bonus - after.wallet_bonus)
  const lifetimeDelta = after.wallet_lifetime - before.wallet_lifetime
  const usageDelta = after.usage_event_count - before.usage_event_count
  const reservedAfter = after.wallet_reserved

  checks.push({ ok: poolDelta    === expectedCharges * 5, label: `Pool +${poolDelta}¢ (expected +${expectedCharges * 5}¢)` })
  checks.push({ ok: capDelta     === expectedCharges * 5, label: `Cap +${capDelta}¢ (expected +${expectedCharges * 5}¢)` })
  checks.push({ ok: creditDelta  === expectedCharges,     label: `Credits consumed: ${creditDelta} (expected ${expectedCharges})` })
  checks.push({ ok: lifetimeDelta === expectedCharges,    label: `Lifetime consumed +${lifetimeDelta} (expected +${expectedCharges})` })
  checks.push({ ok: usageDelta   === expectedCharges,     label: `Usage events +${usageDelta} (expected +${expectedCharges})` })
  checks.push({ ok: reservedAfter === 0,                  label: `wallet_reserved = ${reservedAfter} (expected 0 — no stuck reservation)` })
  return checks
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║        BROWARD COUNTY BULK SEARCH — BILLING TEST        ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`  Account: ${ACCOUNT_ID}`)
  console.log(`  Pool:    ${POOL_KEY}`)
  console.log(`  Date:    ${new Date().toISOString()}`)

  // ── Pricing ───────────────────────────────────────────────────────────────
  console.log('\n[Setup] Fetching pricing for property_search_criteria…')
  const { data: pricing, error: pricingErr } = await sb
    .from('feature_pricing_versions').select('*')
    .eq('feature_key', FEATURE_KEY).eq('is_active', true).eq('is_enabled', true)
    .lte('effective_from', new Date().toISOString())
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()

  if (pricingErr || !pricing) {
    console.error('❌ Pricing fetch failed:', pricingErr?.message ?? 'no active pricing row')
    process.exit(1)
  }
  console.log(`  ✓ vendor_cost=${pricing.expected_vendor_cost_cents}¢  credit_cost=${pricing.customer_credit_cost}  is_enabled=${pricing.is_enabled}`)

  const VENDOR_COST = pricing.expected_vendor_cost_cents  // should be 5
  const CREDIT_COST = pricing.customer_credit_cost         // should be 1

  // ── Build deterministic keys ──────────────────────────────────────────────
  const SEARCH_PARAMS = { county: 'Broward' }
  const CACHE_KEY = buildCacheKey(SEARCH_PARAMS)
  const DAY_EPOCH = Math.floor(Date.now() / 86_400_000)
  const REQ_ID_G0 = buildBillingReqId(CACHE_KEY, 1, 0, DAY_EPOCH)  // refreshGen=0
  const REQ_ID_G1 = buildBillingReqId(CACHE_KEY, 1, 1, DAY_EPOCH)  // refreshGen=1

  console.log(`\n[Setup] Deterministic keys:`)
  console.log(`  cache_key:    ${CACHE_KEY}`)
  console.log(`  req_id (g0):  ${REQ_ID_G0}`)
  console.log(`  req_id (g1):  ${REQ_ID_G1}`)

  // ── Clear Broward cache (force cache miss on first search) ─────────────────
  console.log('\n[Setup] Clearing any existing Broward cache entry…')
  await sb.from('search_cache').delete().eq('search_hash', CACHE_KEY)
  console.log('  ✓ Cache cleared (will be repopulated after first search)')

  // ── Also check for existing reservation with same request_id ─────────────
  // If a prior run today left g0 finalized, we can't re-test first-search billing.
  const { data: existingBudget } = await sb.from('api_budget_reservations')
    .select('status').eq('request_id', REQ_ID_G0).maybeSingle()

  if (existingBudget?.status === 'finalized') {
    console.log(`\n⚠️  req_id g0 already finalized from a prior run today.`)
    console.log(`   Billing test 1 will show idempotent_duplicate (correct — same day means same ID).`)
    console.log(`   This is expected: buildBillingRequestId resets at UTC midnight.`)
    console.log(`   Re-run after midnight or clear the reservation row to re-test test 1.`)
    console.log(`\n   Proceeding with test 2 (idempotent) + test 3 (refresh_gen=1) only.\n`)
  }

  // ── PRE-TEST SNAPSHOT ─────────────────────────────────────────────────────
  const snapBefore = await billingSnapshot('PRE-TEST')

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: First search — cache miss → live REAPI call → full billing
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + sep('═') + '\nTEST 1: First search (cache miss → live REAPI)\n' + sep('═'))

  const snapBeforeT1 = await billingSnapshot('Before Test 1')
  let test1Pass = false
  let test1Results = []

  // Authorize
  console.log(`\n[Test 1] Authorizing request_id=${REQ_ID_G0}`)
  const auth1 = await authorize(REQ_ID_G0, VENDOR_COST, CREDIT_COST)
  log('Test 1 Auth', auth1.success ? '✓ Authorized' : `❌ Blocked (${auth1.error_code})`, auth1)

  if (!auth1.success) {
    if (auth1.error_code === 'idempotent_duplicate') {
      console.log('  → idempotent_duplicate: today\'s g0 request already finalized. Recovering from cache…')
      const { data: cached } = await sb.from('search_cache').select('results, result_count').eq('search_hash', CACHE_KEY).maybeSingle()
      if (cached && Array.isArray(cached.results) && cached.results.length > 0) {
        console.log(`  ✓ Recovered ${cached.results.length} results from cache (lost-response recovery path)`)
        test1Results = cached.results
      } else {
        console.log('  ⚠ No cache entry — prior run cached nothing (possibly partial). Continuing to test 2.')
      }
      test1Pass = true // idempotent is correct behavior for same-day re-run
    } else {
      console.log(`  ❌ Unexpected block: ${auth1.error_code} — ${auth1.error_message}`)
      process.exit(2)
    }
  } else {
    // Call REAPI
    const reapiBody = { state: 'FL', county: 'Broward', pre_foreclosure: true, size: 50 }
    console.log(`\n[Test 1] Calling REAPI /v2/PropertySearch`, reapiBody)

    const t0 = Date.now()
    let reapiRes, reapiData
    try {
      reapiRes = await fetch(`${REAPI_BASE}/PropertySearch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': REAPI_KEY },
        body: JSON.stringify(reapiBody),
        signal: AbortSignal.timeout(30_000),
      })
      const duration1 = Date.now() - t0
      console.log(`  REAPI HTTP ${reapiRes.status} — ${duration1}ms`)

      if (!reapiRes.ok) {
        const txt = await reapiRes.text()
        console.error(`  ❌ REAPI ${reapiRes.status}: ${txt.slice(0, 200)}`)
        // Finalize as failed — mirrors providerGateway.finalize(success=false)
        const now = new Date().toISOString()
        await sb.from('api_budget_reservations')
          .update({ status: 'released', actual_cost_cents: 0, finalized_at: now, updated_at: now })
          .eq('request_id', REQ_ID_G0)
        // Reverse pool + cap increments from reservation (actual=0, estimated=VENDOR_COST → delta = -VENDOR_COST)
        await sb.rpc('fn_adjust_pool_spent',   { p_pool_key: POOL_KEY,   p_delta_cents: -VENDOR_COST })
        await sb.rpc('fn_adjust_account_cost', { p_account_id: ACCOUNT_ID, p_delta_cents: -VENDOR_COST })
        if (auth1.credit_reservation_id) {
          await sb.from('credit_reservations')
            .update({ status: 'released', finalized_at: now, updated_at: now }).eq('request_id', REQ_ID_G0)
          await sb.rpc('fn_adjust_reserved_credits', { p_account_id: ACCOUNT_ID, p_delta: -CREDIT_COST })
        }
        console.log('  ✓ Reservations released + pool/cap reversed (billing state clean)')
        process.exit(3)
      }

      reapiData = await reapiRes.json()
      console.log(`  ✓ REAPI: resultCount=${reapiData.resultCount ?? 0}  recordCount=${reapiData.recordCount ?? 0}  records=${reapiData.data?.length ?? 0}`)

      const rawResults = reapiData.data ?? []
      // Simple normalization to match route shape (full normalize not needed for billing test)
      test1Results = rawResults.map(p => ({
        id:         `REAPI-${p.propertyId}`,
        reapi_id:   String(p.propertyId ?? ''),
        county:     (p.address?.county ?? '').toLowerCase().replace(' county','').trim(),
        owner_name: [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(' ') || p.companyName || null,
      }))

      // Finalize
      console.log('\n[Test 1] Finalizing billing…')
      const finalErrors = await finalize(REQ_ID_G0, VENDOR_COST, Date.now() - t0, auth1)
      if (finalErrors.length > 0) {
        console.error('  ❌ Finalize errors:', finalErrors)
      } else {
        console.log('  ✓ Finalize complete (budget + credit + usage event)')
      }

      // Write cache
      await writeCache(CACHE_KEY, test1Results, reapiData.resultCount ?? rawResults.length)
      console.log('  ✓ Results cached in search_cache')

      test1Pass = true

    } catch (err) {
      console.error('  ❌ Network error:', err.message)
      process.exit(3)
    }
  }

  const snapAfterT1 = await billingSnapshot('After Test 1')
  const checks1 = verifySnap(snapBeforeT1, snapAfterT1, auth1.success ? 1 : 0)
  console.log('\n[Test 1] Billing verification:')
  let t1Fail = false
  for (const c of checks1) {
    const icon = c.ok ? '  ✓' : '  ❌'
    console.log(`${icon} ${c.label}`)
    if (!c.ok) t1Fail = true
  }
  if (test1Results.length > 0) {
    console.log(`  ✓ Results rendered: ${test1Results.length} properties returned`)
  } else {
    console.log('  ⚠ No results (REAPI may have returned 0 records for this search)')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Immediate retry (same request_id → no double-charge)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + sep('═') + '\nTEST 2: Immediate retry (same request_id — must not double-charge)\n' + sep('═'))

  const snapBeforeT2 = await billingSnapshot('Before Test 2')

  console.log(`\n[Test 2] Re-authorizing same request_id=${REQ_ID_G0}`)
  const auth2 = await authorize(REQ_ID_G0, VENDOR_COST, CREDIT_COST)
  log('Test 2 Auth', `error_code=${auth2.error_code ?? 'n/a'}  success=${auth2.success}`, auth2)

  let test2Pass = false
  if (!auth2.success && auth2.error_code === 'idempotent_duplicate') {
    console.log('  ✓ idempotent_duplicate — no new reservation created')
    // Verify cache recovery path
    const { data: cached2 } = await sb.from('search_cache').select('results, result_count').eq('search_hash', CACHE_KEY).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (cached2 && Array.isArray(cached2.results) && cached2.results.length > 0) {
      console.log(`  ✓ Cache recovery: ${cached2.results.length} results available (no new provider call needed)`)
      test2Pass = true
    } else {
      console.log('  ⚠ Cache empty — idempotent_duplicate recovery would fail (results not cached)')
    }
  } else if (!auth2.success) {
    console.log(`  ⚠ Unexpected error code: ${auth2.error_code} (expected idempotent_duplicate)`)
  } else {
    console.log('  ❌ auth succeeded on retry — DOUBLE-CHARGE RISK. Releasing reservation.')
    // Release to avoid corruption
    await sb.from('api_budget_reservations')
      .update({ status: 'released', actual_cost_cents: 0, finalized_at: new Date().toISOString() })
      .eq('request_id', auth2.budget_reservation_id)
  }

  const snapAfterT2 = await billingSnapshot('After Test 2')
  const checks2 = verifySnap(snapBeforeT2, snapAfterT2, 0)  // expect 0 new charges
  console.log('\n[Test 2] Billing verification (expect 0 new charges):')
  let t2Fail = false
  for (const c of checks2) {
    const icon = c.ok ? '  ✓' : '  ❌'
    console.log(`${icon} ${c.label}`)
    if (!c.ok) t2Fail = true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Explicit refresh (refreshGen=1 → new request_id → 1 new charge)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + sep('═') + '\nTEST 3: Explicit refresh (refresh_gen=1 → new billable charge)\n' + sep('═'))

  // Check if g1 was already run today
  const { data: existingG1 } = await sb.from('api_budget_reservations')
    .select('status').eq('request_id', REQ_ID_G1).maybeSingle()

  if (existingG1?.status === 'finalized') {
    console.log(`\n⚠️  req_id g1 already finalized from a prior run today — skipping to avoid triple-charge.`)
    console.log('   This is expected behavior: each refreshGen + day combination is idempotent.')
  } else {
    const snapBeforeT3 = await billingSnapshot('Before Test 3')

    console.log(`\n[Test 3] Authorizing with refreshGen=1 request_id=${REQ_ID_G1}`)
    const auth3 = await authorize(REQ_ID_G1, VENDOR_COST, CREDIT_COST)
    log('Test 3 Auth', auth3.success ? '✓ Authorized (new charge)' : `❌ Blocked (${auth3.error_code})`, { success: auth3.success, error_code: auth3.error_code, budget_res: auth3.budget_reservation_id })

    if (!auth3.success) {
      console.log(`  ❌ Unexpected block on refreshGen=1: ${auth3.error_code} — ${auth3.error_message}`)
    } else {
      // Call REAPI
      const reapiBody3 = { state: 'FL', county: 'Broward', pre_foreclosure: true, size: 10 }
      console.log('\n[Test 3] Calling REAPI (refresh — provider must be called again)…')
      const t3 = Date.now()
      let reapiRes3, reapiData3
      try {
        reapiRes3 = await fetch(`${REAPI_BASE}/PropertySearch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': REAPI_KEY },
          body: JSON.stringify(reapiBody3),
          signal: AbortSignal.timeout(30_000),
        })
        console.log(`  REAPI HTTP ${reapiRes3.status} — ${Date.now() - t3}ms`)
        reapiData3 = await reapiRes3.json()
        console.log(`  ✓ REAPI: ${reapiData3.resultCount ?? 0} total, ${reapiData3.data?.length ?? 0} returned`)
      } catch (e) {
        console.error('  ❌ REAPI error:', e.message)
        await sb.from('api_budget_reservations')
          .update({ status: 'released', actual_cost_cents: 0, finalized_at: new Date().toISOString() })
          .eq('request_id', REQ_ID_G1)
      }

      if (reapiData3) {
        const finalErrors3 = await finalize(REQ_ID_G1, VENDOR_COST, Date.now() - t3, auth3)
        if (finalErrors3.length > 0) {
          console.error('  ❌ Finalize errors:', finalErrors3)
        } else {
          console.log('  ✓ Finalize complete (1 new billable generation)')
        }
      }
    }

    const snapAfterT3 = await billingSnapshot('After Test 3')
    const checks3 = verifySnap(snapBeforeT3, snapAfterT3, auth3.success ? 1 : 0)
    console.log('\n[Test 3] Billing verification (expect 1 new charge from refresh):')
    let t3Fail = false
    for (const c of checks3) {
      const icon = c.ok ? '  ✓' : '  ❌'
      console.log(`${icon} ${c.label}`)
      if (!c.ok) t3Fail = true
    }
  }

  // ── Final diagnostics ─────────────────────────────────────────────────────
  console.log('\n' + sep('═') + '\nFINAL DIAGNOSTICS\n' + sep('═'))
  const { data: diag, error: diagErr } = await sb.rpc('fn_billing_diagnostics_check')
  if (diagErr) {
    console.log('  ⚠ fn_billing_diagnostics_check error:', diagErr.message)
  } else {
    console.log(`  stale_budget:         ${diag.stale_budget}`)
    console.log(`  stale_credit:         ${diag.stale_credit}`)
    console.log(`  drift_credits:        ${diag.drift_credits}`)
    console.log(`  drift_accounts:       ${diag.drift_accounts}`)
    console.log(`  needs_reconciliation: ${diag.needs_reconciliation}`)
    const diagOk = diag.stale_budget === 0 && diag.stale_credit === 0 && !diag.needs_reconciliation
    console.log(`\n  ${diagOk ? '✓ DIAGNOSTICS PASS' : '❌ DIAGNOSTICS INDICATE ISSUES'}`)
  }

  const snapFinal = await billingSnapshot('FINAL')
  console.log('\n' + sep('═'))
  console.log('  BROWARD SEARCH TEST COMPLETE')
  console.log(sep('═'))
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err)
  process.exit(99)
})
