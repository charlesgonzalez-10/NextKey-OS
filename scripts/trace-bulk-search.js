/**
 * Controlled bulk search trace — stages 2–6.
 *
 * Exercises ProviderGateway → REAPI → Normalization directly
 * using the service role key (bypasses HTTP/cookie auth).
 *
 * Usage: node scripts/trace-bulk-search.js
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

const SUPABASE_URL      = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_ROLE_KEY  = env['SUPABASE_SERVICE_ROLE_KEY']
const REAPI_KEY         = env['REAPI_KEY']
const ACCOUNT_ID        = 'e5e19ad8-d6ed-40a4-89ce-aa961ddddae4'
const POOL_KEY          = 'customer_shared'
const FEATURE_KEY       = 'property_search_criteria'
const PROVIDER_KEY      = 'reapi'

function log(stage, msg, data) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [TRACE:${stage}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : '')
}

function fail(stage, msg, err) {
  console.error(`\n❌ FAIL at stage ${stage}: ${msg}`)
  if (err) console.error(err)
  process.exit(1)
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  NextKey Bulk Search — End-to-End Trace')
  console.log('══════════════════════════════════════════════════════\n')

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) fail('env', 'Missing SUPABASE_URL or SERVICE_ROLE_KEY')
  if (!REAPI_KEY) fail('env', 'Missing REAPI_KEY')

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Stage 2a: Pricing engine ──────────────────────────────────────────────
  log('2a-PricingEngine', `Fetching active pricing for feature_key="${FEATURE_KEY}"`)
  const { data: pricing, error: pricingErr } = await sb
    .from('feature_pricing_versions')
    .select('*')
    .eq('feature_key', FEATURE_KEY)
    .eq('is_active', true)
    .eq('is_enabled', true)
    .lte('effective_from', new Date().toISOString())
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pricingErr) fail('2a-PricingEngine', 'DB error fetching pricing', pricingErr)
  if (!pricing) fail('2a-PricingEngine', 'No active pricing row — feature_pricing_versions missing property_search_criteria')

  log('2a-PricingEngine', 'Pricing found ✓', {
    feature_key:               pricing.feature_key,
    is_enabled:                pricing.is_enabled,
    requires_confirmed_cost:   pricing.requires_confirmed_cost,
    expected_vendor_cost_cents: pricing.expected_vendor_cost_cents,
    customer_credit_cost:      pricing.customer_credit_cost,
    provider_key:              pricing.provider_key,
  })

  // ── Stage 2b: Pre-authorize checks (ensureCapExists + ensureWalletExists) ─
  log('2b-PreAuth', `Checking account cap + wallet for account=${ACCOUNT_ID}`)

  const { data: cap, error: capErr } = await sb
    .from('account_vendor_cost_caps')
    .select('account_id, effective_cap_cents, spent_this_period_cents, plan_default_cap_cents, override_cap_cents')
    .eq('account_id', ACCOUNT_ID)
    .maybeSingle()

  if (capErr) fail('2b-PreAuth', 'DB error fetching cost cap', capErr)
  if (!cap) fail('2b-PreAuth', 'No account_vendor_cost_caps row — ensureCapExists would need to create one')
  log('2b-PreAuth', 'Cost cap ✓', cap)

  const { data: wallet, error: walletErr } = await sb
    .from('credit_wallets')
    .select('account_id, status, available_monthly_credits, available_purchased_credits, available_bonus_credits, reserved_credits')
    .eq('account_id', ACCOUNT_ID)
    .maybeSingle()

  if (walletErr) fail('2b-PreAuth', 'DB error fetching wallet', walletErr)
  if (!wallet) fail('2b-PreAuth', 'No credit_wallets row — ensureWalletExists would need to create one')
  const availableCredits = wallet.available_monthly_credits + wallet.available_purchased_credits + wallet.available_bonus_credits - wallet.reserved_credits
  log('2b-PreAuth', 'Wallet ✓', { ...wallet, availableCredits })

  // ── Stage 2c: ProviderGateway authorize() — fn_reserve_budget_and_credits ─
  const REQUEST_ID = `trace-srch-${crypto.randomBytes(8).toString('hex')}-p1`
  log('2c-GatewayAuthorize', `Calling fn_reserve_budget_and_credits`, {
    p_request_id:           REQUEST_ID,
    p_account_id:           ACCOUNT_ID,
    p_feature_key:          FEATURE_KEY,
    p_provider_key:         PROVIDER_KEY,
    p_pool_key:             POOL_KEY,
    p_estimated_cost_cents: pricing.expected_vendor_cost_cents,
    p_credit_cost:          pricing.customer_credit_cost,
    p_is_zero_cost_feature: false,
  })

  const { data: authResult, error: authErr } = await sb.rpc('fn_reserve_budget_and_credits', {
    p_request_id:           REQUEST_ID,
    p_account_id:           ACCOUNT_ID,
    p_feature_key:          FEATURE_KEY,
    p_provider_key:         PROVIDER_KEY,
    p_pool_key:             POOL_KEY,
    p_estimated_cost_cents: pricing.expected_vendor_cost_cents,
    p_credit_cost:          pricing.customer_credit_cost,
    p_is_zero_cost_feature: false,
  })

  if (authErr) fail('2c-GatewayAuthorize', 'RPC call failed', authErr)
  log('2c-GatewayAuthorize', `Auth result`, authResult)

  if (!authResult?.success) {
    console.error('\n❌ AUTHORIZATION BLOCKED')
    console.error('Gate failed:', authResult?.gate_failed)
    console.error('Error code:', authResult?.error_code)
    console.error('Error message:', authResult?.error_message)
    process.exit(2)
  }

  log('2c-GatewayAuthorize', `✓ Authorized — budget_res=${authResult.budget_reservation_id} credit_res=${authResult.credit_reservation_id}`)

  // ── Stage 3: DSOE routing note ────────────────────────────────────────────
  log('3-DSOERouting', 'Bulk criteria search routes directly to REAPI (no DSOE branching). Pool: customer_shared → provider: reapi → endpoint: /v2/PropertySearch')

  // ── Stage 4: REAPI request ────────────────────────────────────────────────
  const reapiBody = {
    state: 'FL',
    county: 'Broward',
    pre_foreclosure: true,
    size: 10,   // small for trace — not a full 250-result page
  }
  log('4-REAPIRequest', `POST https://api.realestateapi.com/v2/PropertySearch`, reapiBody)

  const t0 = Date.now()
  let reapiRes
  try {
    reapiRes = await fetch('https://api.realestateapi.com/v2/PropertySearch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': REAPI_KEY },
      body: JSON.stringify(reapiBody),
      signal: AbortSignal.timeout(25_000),
    })
  } catch (e) {
    fail('4-REAPIRequest', 'Network error calling REAPI', e)
  }
  const durationMs = Date.now() - t0

  log('5-REAPIResponse', `HTTP ${reapiRes.status} in ${durationMs}ms — content-type: ${reapiRes.headers.get('content-type')}`)

  if (!reapiRes.ok) {
    const body = await reapiRes.text()
    fail('5-REAPIResponse', `REAPI returned ${reapiRes.status}`, body)
  }

  let reapiData
  try {
    reapiData = await reapiRes.json()
  } catch (e) {
    fail('5-REAPIResponse', 'Failed to parse REAPI JSON', e)
  }

  log('5-REAPIResponse', 'REAPI response summary', {
    statusCode:   reapiData.statusCode,
    resultCount:  reapiData.resultCount,
    recordCount:  reapiData.recordCount,
    resultIndex:  reapiData.resultIndex,
    dataLength:   reapiData.data?.length ?? 0,
    firstRecord:  reapiData.data?.[0]
      ? { propertyId: reapiData.data[0].propertyId, address: reapiData.data[0].address }
      : null,
  })

  if (reapiData.statusCode && reapiData.statusCode !== 200) {
    fail('5-REAPIResponse', `REAPI error status ${reapiData.statusCode}`, reapiData.message ?? reapiData.statusMessage)
  }

  // ── Stage 6: Normalization (inline — TS not available) ───────────────────
  const raw = reapiData.data ?? []
  log('6-Normalization', `Normalising ${raw.length} records from REAPI`)

  const normalized = raw.map(p => {
    const addr = p.address ?? {}
    return {
      id:               `REAPI-${p.propertyId}`,
      reapi_id:         String(p.propertyId ?? ''),
      property_address: addr.address ?? null,
      city:             addr.city ?? null,
      zip:              addr.zip  ?? null,
      county:           (addr.county ?? '').toLowerCase().replace(' county', '').trim(),
      owner_name:       [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(' ') || p.companyName || null,
      market_value:     p.estimatedValue ?? null,
      equity_percentage: p.equityPercent ?? null,
      is_pre_foreclosure: p.preForeclosure ?? false,
      is_foreclosure:   p.foreclosure ?? false,
      is_auction:       p.auction ?? false,
    }
  })

  log('6-Normalization', `✓ ${normalized.length} records normalized`, {
    sample: normalized.slice(0, 2)
  })

  // ── Stage 7: Finalize reservation in DB ──────────────────────────────────
  log('7-Finalize', `Finalizing reservation request_id=${REQUEST_ID}`)

  const { error: finalErr } = await sb
    .from('api_budget_reservations')
    .update({ status: 'finalized', actual_cost_cents: pricing.expected_vendor_cost_cents, finalized_at: new Date().toISOString() })
    .eq('request_id', REQUEST_ID)

  if (finalErr) {
    log('7-Finalize', `⚠️  Budget reservation finalize error (non-fatal): ${finalErr.message}`)
  } else {
    log('7-Finalize', '✓ Budget reservation finalized')
  }

  // Write usage event
  const { error: usageErr } = await sb.from('api_usage_events').insert({
    request_id:               REQUEST_ID,
    pool_key:                 POOL_KEY,
    account_id:               ACCOUNT_ID,
    provider_key:             PROVIDER_KEY,
    feature_key:              FEATURE_KEY,
    reservation_id:           authResult.budget_reservation_id,
    actual_cost_cents:        pricing.expected_vendor_cost_cents,
    estimated_cost_cents:     pricing.expected_vendor_cost_cents,
    account_vendor_cost_cents: pricing.expected_vendor_cost_cents,
    duration_ms:              durationMs,
    cache_hit:                false,
    provider_called:          true,
    success:                  true,
  })

  if (usageErr) {
    log('7-Finalize', `⚠️  Usage event write error (non-fatal): ${usageErr.message}`)
  } else {
    log('7-Finalize', '✓ Usage event written')
  }

  // ── Stage 8: Verify DB state post-search ─────────────────────────────────
  log('8-PostVerify', 'Verifying DB state after search')

  const { data: budgetRes } = await sb
    .from('api_budget_reservations')
    .select('status, actual_cost_cents, estimated_cost_cents')
    .eq('request_id', REQUEST_ID)
    .maybeSingle()

  const { data: usageEvent } = await sb
    .from('api_usage_events')
    .select('success, actual_cost_cents, duration_ms')
    .eq('request_id', REQUEST_ID)
    .maybeSingle()

  const { data: walletAfter } = await sb
    .from('credit_wallets')
    .select('available_monthly_credits, available_purchased_credits, reserved_credits, lifetime_consumed_credits')
    .eq('account_id', ACCOUNT_ID)
    .maybeSingle()

  const { data: creditRes } = await sb
    .from('credit_reservations')
    .select('status, reserved_credits')
    .eq('request_id', REQUEST_ID)
    .maybeSingle()

  log('8-PostVerify', 'DB state', {
    budget_reservation:  budgetRes,
    credit_reservation:  creditRes,
    usage_event:         usageEvent,
    wallet_after:        walletAfter,
    wallet_before:       { available_monthly_credits: wallet.available_monthly_credits, reserved_credits: wallet.reserved_credits },
  })

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  TRACE SUMMARY')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  ✓ Stage 2a: Pricing loaded (${pricing.expected_vendor_cost_cents}¢ vendor, ${pricing.customer_credit_cost} credit)`)
  console.log(`  ✓ Stage 2b: Account cap (${cap.effective_cap_cents}¢) + wallet (${availableCredits} credits available)`)
  console.log(`  ✓ Stage 2c: Gateway authorized — budget_res=${authResult.budget_reservation_id?.slice(0,8)}… credit_res=${authResult.credit_reservation_id?.slice(0,8)}…`)
  console.log(`  ✓ Stage 3:  DSOE → REAPI (direct route, no branching)`)
  console.log(`  ✓ Stage 4:  REAPI request sent (${durationMs}ms)`)
  console.log(`  ✓ Stage 5:  REAPI response HTTP ${reapiRes.status} — ${reapiData.resultCount ?? 0} total results, ${raw.length} returned`)
  console.log(`  ✓ Stage 6:  ${normalized.length} records normalized`)
  console.log(`  ${budgetRes?.status === 'finalized' ? '✓' : '⚠'} Stage 7:  Budget reservation status = ${budgetRes?.status}`)
  console.log(`  ${usageEvent ? '✓' : '⚠'} Stage 7:  Usage event = ${usageEvent ? 'written' : 'MISSING'}`)
  console.log(`  ${creditRes ? '✓' : '—'} Stage 7:  Credit reservation status = ${creditRes?.status ?? 'none (0-credit feature would skip)'}`)
  console.log('')
  console.log('  RETRY IDEMPOTENCY CHECK:')
  console.log(`  Sending same request_id again should be blocked by UNIQUE constraint...`)

  const { data: retryAuth, error: retryErr } = await sb.rpc('fn_reserve_budget_and_credits', {
    p_request_id:           REQUEST_ID,
    p_account_id:           ACCOUNT_ID,
    p_feature_key:          FEATURE_KEY,
    p_provider_key:         PROVIDER_KEY,
    p_pool_key:             POOL_KEY,
    p_estimated_cost_cents: pricing.expected_vendor_cost_cents,
    p_credit_cost:          pricing.customer_credit_cost,
    p_is_zero_cost_feature: false,
  })

  if (retryErr) {
    console.log(`  ✓ Retry BLOCKED by DB constraint: ${retryErr.message}`)
  } else {
    console.log(`  Retry result:`, JSON.stringify(retryAuth))
    if (retryAuth?.success) {
      console.log('  ⚠️  WARNING: Retry succeeded — double-charge possible. Check UNIQUE constraint on request_id.')
    } else {
      console.log('  ✓ Retry blocked at gate (auth returned success=false — idempotency holds)')
    }
  }

  console.log('\n══════════════════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('\nUnhandled error:', err)
  process.exit(1)
})
