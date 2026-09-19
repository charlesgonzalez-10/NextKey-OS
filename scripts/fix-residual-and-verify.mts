/**
 * Post-migration cleanup script.
 *
 * The diag-test-00000 Category A reconciliation already:
 *   ✓ set budget reservation → released
 *   ✓ set credit reservation → released
 *   ✓ cleared wallet reserved_credits (direct update fallback)
 *
 * But at that time fn_adjust_pool_spent and fn_adjust_account_cost didn't exist,
 * so the pool and account cap were never decremented.
 *
 * This script:
 *   1. Confirms all three functions are callable
 *   2. Applies the -5¢ pool + cap correction for the already-released diag-test reservation
 *   3. Runs a full reconciliation pass (no-op for categories, drift check)
 *   4. Runs verification
 *   5. Reports final state
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
for (const line of envLines) {
  const eq = line.indexOf('=')
  if (eq > 0) { const k = line.slice(0, eq).trim(); if (!process.env[k]) process.env[k] = line.slice(eq + 1).trim() }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

import {
  reconcileStaleReservations,
  verifyReconciliation,
  detectReservedCreditsDrift,
} from '../lib/billing/reconciliationService.js'

function sep() { return '─'.repeat(62) }

// ─── 1. Confirm functions ─────────────────────────────────────────────────────

console.log('\n1. Function existence check')
console.log(sep())

const probes = [
  { name: 'fn_adjust_pool_spent',        call: () => sb.rpc('fn_adjust_pool_spent',        { p_pool_key: 'customer_shared', p_delta_cents: 0 }) },
  { name: 'fn_adjust_account_cost',      call: () => sb.rpc('fn_adjust_account_cost',      { p_account_id: '00000000-0000-0000-0000-000000000000', p_delta_cents: 0 }) },
  { name: 'fn_adjust_reserved_credits',  call: () => sb.rpc('fn_adjust_reserved_credits',  { p_account_id: '00000000-0000-0000-0000-000000000000', p_delta: 0 }) },
]

let allFnsOk = true
for (const { name, call } of probes) {
  const { error } = await call()
  const ok = !error || !error.message.includes('schema cache')
  if (!ok) allFnsOk = false
  console.log(`  ${ok ? '✓' : '❌'} ${name}: ${ok ? 'callable' : error!.message.slice(0, 60)}`)
}

if (!allFnsOk) {
  console.error('\n❌  Functions still missing — run NOTIFY pgrst, \'reload schema\'; in the SQL editor and retry.')
  process.exit(1)
}

// ─── 2. Find the diag-test-00000 released reservation to get exact amounts ───

console.log('\n2. Locating diag-test-00000 released reservation')
console.log(sep())

const { data: diagRes } = await sb
  .from('api_budget_reservations')
  .select('request_id, pool_key, account_id, estimated_cost_cents, status')
  .eq('request_id', 'diag-test-00000')
  .maybeSingle()

if (!diagRes) {
  console.log('  diag-test-00000 not found — pool/cap already corrected or reservation never existed.')
} else {
  console.log(`  Found: status=${diagRes.status}  pool=${diagRes.pool_key}  cost=${diagRes.estimated_cost_cents}¢  account=${diagRes.account_id?.slice(0,8)}…`)

  if (diagRes.status === 'released') {
    // Check current pool/cap to confirm correction is needed
    const { data: pool } = await sb.from('api_budget_pools').select('spent_this_period_cents').eq('pool_key', diagRes.pool_key).single()
    const { data: cap }  = await sb.from('account_vendor_cost_caps').select('spent_this_period_cents').eq('account_id', diagRes.account_id).maybeSingle()

    console.log(`  Pool ${diagRes.pool_key}: currently ${pool?.spent_this_period_cents}¢`)
    console.log(`  Account cap: currently ${cap?.spent_this_period_cents}¢`)
    console.log(`  Applying -${diagRes.estimated_cost_cents}¢ correction to both…`)

    const { error: pe } = await sb.rpc('fn_adjust_pool_spent', {
      p_pool_key:    diagRes.pool_key,
      p_delta_cents: -diagRes.estimated_cost_cents,
    })
    console.log(`  fn_adjust_pool_spent:   ${pe ? `❌ ${pe.message}` : '✓ applied'}`)

    if (diagRes.account_id) {
      const { error: ae } = await sb.rpc('fn_adjust_account_cost', {
        p_account_id:  diagRes.account_id,
        p_delta_cents: -diagRes.estimated_cost_cents,
      })
      console.log(`  fn_adjust_account_cost: ${ae ? `❌ ${ae.message}` : '✓ applied'}`)
    }
  } else {
    console.log(`  Reservation is not 'released' (status=${diagRes.status}) — no pool/cap correction needed.`)
  }
}

// ─── 3. Full reconciliation pass (drift check + any remaining stale) ──────────

console.log('\n3. Full reconciliation pass')
console.log(sep())

const result = await reconcileStaleReservations()
console.log(`  run_at:             ${result.run_at}`)
console.log(`  category_A_processed:    ${result.category_A_processed}`)
console.log(`  category_B_processed:    ${result.category_B_processed}`)
console.log(`  category_C_needs_review: ${result.category_C_needs_review}`)
console.log(`  drift_corrected:         ${result.drift_corrected}`)
if (result.errors.length > 0) {
  console.log(`  ❌ Errors (${result.errors.length}):`)
  for (const e of result.errors) console.log(`    ${e}`)
} else {
  console.log('  ✓ No errors')
}

// ─── 4. Verification ──────────────────────────────────────────────────────────

console.log('\n4. Post-reconciliation verification')
console.log(sep())

const v = await verifyReconciliation()
const checks = [
  { label: 'reserved_credits match active reservations', ok: v.reserved_credits_match_active },
  { label: 'No stale in-flight budget reservations',     ok: v.no_stale_in_flight },
  { label: 'No accidental releases of paid calls',       ok: v.no_successful_call_accidentally_released },
  { label: `Remaining drift = ${v.remaining_drift}`,     ok: v.remaining_drift === 0 },
  { label: `needs_review = ${v.remaining_needs_review}`, ok: true },
]
for (const { label, ok } of checks) console.log(`  ${ok ? '✓' : '❌'} ${label}`)
if (v.issues.length > 0) for (const i of v.issues) console.log(`  ⚠ ${i}`)

// ─── 5. Second reconciliation must be no-op ───────────────────────────────────

console.log('\n5. Second reconciliation (must be no-op)')
console.log(sep())

const run2 = await reconcileStaleReservations()
const isNoop = run2.category_A_processed === 0 && run2.category_B_processed === 0 &&
               run2.category_C_needs_review === 0 && run2.drift_corrected === 0 && run2.errors.length === 0
console.log(`  ${isNoop ? '✓ No-op confirmed' : '❌ NOT a no-op — investigate'}`)
if (!isNoop) console.log('  Result:', JSON.stringify(run2))

// ─── 6. Final state report ────────────────────────────────────────────────────

console.log('\n6. Final state')
console.log(sep())

const { data: finalPools }   = await sb.from('api_budget_pools').select('pool_key, spent_this_period_cents, monthly_limit_cents')
const { data: finalWallets } = await sb.from('credit_wallets').select('account_id, reserved_credits, available_monthly_credits, lifetime_consumed_credits')
const { data: finalCaps }    = await sb.from('account_vendor_cost_caps').select('account_id, spent_this_period_cents, effective_cap_cents')
const { data: budgetCounts } = await sb.from('api_budget_reservations').select('status')
const { data: creditCounts } = await sb.from('credit_reservations').select('status')
const { data: diagSnap, error: diagErr } = await sb.rpc('fn_billing_diagnostics_check')

console.log('  POOLS:')
for (const p of finalPools ?? []) {
  if (p.spent_this_period_cents > 0 || p.pool_key === 'customer_shared')
    console.log(`    ${p.pool_key}: ${p.spent_this_period_cents}¢ / ${p.monthly_limit_cents}¢`)
}

console.log('  WALLETS:')
for (const w of finalWallets ?? [])
  console.log(`    ${w.account_id.slice(0,8)}…: reserved=${w.reserved_credits}  monthly=${w.available_monthly_credits}  lifetime_consumed=${w.lifetime_consumed_credits}`)

console.log('  ACCOUNT CAPS:')
for (const c of finalCaps ?? []) if (c.spent_this_period_cents > 0)
  console.log(`    ${c.account_id.slice(0,8)}…: ${c.spent_this_period_cents}¢ / ${c.effective_cap_cents}¢`)

const budgetByStatus: Record<string, number> = {}
for (const r of budgetCounts ?? []) budgetByStatus[r.status] = (budgetByStatus[r.status] ?? 0) + 1
const creditByStatus: Record<string, number> = {}
for (const r of creditCounts ?? []) creditByStatus[r.status] = (creditByStatus[r.status] ?? 0) + 1

console.log('  BUDGET RESERVATIONS:', JSON.stringify(budgetByStatus))
console.log('  CREDIT RESERVATIONS:', JSON.stringify(creditByStatus))

if (diagErr) {
  console.log('  DIAGNOSTICS: error —', diagErr.message)
} else {
  console.log('  DB DIAGNOSTICS:')
  console.log('    stale_budget:          ', diagSnap.stale_budget)
  console.log('    stale_credit:          ', diagSnap.stale_credit)
  console.log('    drift_credits:         ', diagSnap.drift_credits)
  console.log('    drift_accounts:        ', diagSnap.drift_accounts)
  console.log('    needs_reconciliation:  ', diagSnap.needs_reconciliation)
}

const allGood = v.reserved_credits_match_active && v.no_stale_in_flight &&
                v.no_successful_call_accidentally_released && v.remaining_drift === 0 && isNoop

console.log(`\n${sep()}`)
console.log(allGood
  ? '✓  ALL CHECKS PASS — safe to run Broward bulk search'
  : '❌  SOME CHECKS FAILED — review output before proceeding')
console.log(sep())
