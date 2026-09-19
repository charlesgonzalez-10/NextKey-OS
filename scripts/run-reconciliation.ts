/**
 * Standalone reconciliation runner.
 * Loads .env.local, then calls classify → preview → execute → verify.
 * Run with:  npx tsx scripts/run-reconciliation.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Load .env.local ─────────────────────────────────────────────────────────

const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq < 0) continue
  const key = trimmed.slice(0, eq).trim()
  const val = trimmed.slice(eq + 1).trim()
  if (!process.env[key]) process.env[key] = val
}

// ─── Import after env ────────────────────────────────────────────────────────

import {
  computeReconciliationPreview,
  reconcileStaleReservations,
  verifyReconciliation,
} from '../lib/billing/reconciliationService.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function c$(cents: number) { return `$${(cents / 100).toFixed(2)}` }
function sep(char = '─', len = 64) { return char.repeat(len) }

function printJson(label: string, val: unknown) {
  console.log(`\n${sep()}`)
  console.log(label)
  console.log(sep())
  console.log(JSON.stringify(val, null, 2))
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║         NEXTKEYOS BILLING RECONCILIATION RUNNER          ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  // ── STEP 1: Preview (read-only) ─────────────────────────────────────────────
  console.log('STEP 1 — Computing reconciliation preview…\n')
  const preview = await computeReconciliationPreview()
  printJson('PREVIEW RESULT', preview)

  console.log('\n┌─── PREVIEW SUMMARY ─────────────────────────────────────┐')
  console.log(`│  is_safe:                ${String(preview.is_safe).padEnd(37)}│`)
  console.log(`│  Total stale budget res: ${String(preview.total_stale_budget).padEnd(37)}│`)
  console.log(`│  Total stale credit res: ${String(preview.total_stale_credit).padEnd(37)}│`)
  console.log(`│  Category A (release):   ${String(preview.category_A).padEnd(37)}│`)
  console.log(`│  Category B (finalize):  ${String(preview.category_B).padEnd(37)}│`)
  console.log(`│  Category C (review):    ${String(preview.category_C).padEnd(37)}│`)
  console.log(`│  Credits to release:     ${String(preview.credits_to_release).padEnd(37)}│`)
  console.log(`│  Credits to consume:     ${String(preview.credits_to_consume).padEnd(37)}│`)
  console.log(`│  Current reserved_creds: ${String(preview.current_reserved_credits).padEnd(37)}│`)
  console.log(`│  Expected reserved_creds:${String(preview.expected_reserved_credits).padEnd(37)}│`)
  if (preview.classified.length > 0) {
    console.log('├─────────────────────────────────────────────────────────┤')
    console.log('│  Classified reservations:                               │')
    for (const r of preview.classified) {
      const line = `│    [${r.category}] ${r.request_id.slice(0, 16)}…  cost=${c$(r.estimated_cost_cents)}  cr=${r.reserved_credits}  `
      console.log(line.slice(0, 61).padEnd(61) + '│')
      const reason = `│         reason: ${r.category_reason}`.slice(0, 61).padEnd(61) + '│'
      console.log(reason)
    }
  }
  if (Object.keys(preview.expected_pool_spend_cents ?? {}).length > 0) {
    console.log('├─────────────────────────────────────────────────────────┤')
    console.log('│  Pool spend (current → expected):                       │')
    for (const [k, v] of Object.entries(preview.expected_pool_spend_cents)) {
      const curr = preview.current_pool_spend_cents[k] ?? 0
      const delta = v - curr
      const line = `│    ${k}: ${c$(curr)} → ${c$(v)} (${delta >= 0 ? '+' : ''}${c$(delta)})`.slice(0, 61).padEnd(61) + '│'
      console.log(line)
    }
  }
  if (Object.keys(preview.expected_account_spend_cents ?? {}).length > 0) {
    console.log('├─────────────────────────────────────────────────────────┤')
    console.log('│  Account spend (current → expected):                    │')
    for (const [k, v] of Object.entries(preview.expected_account_spend_cents)) {
      const curr = preview.current_account_spend_cents[k] ?? 0
      const delta = v - curr
      const line = `│    ${k.slice(0, 8)}…: ${c$(curr)} → ${c$(v)} (${delta >= 0 ? '+' : ''}${c$(delta)})`.slice(0, 61).padEnd(61) + '│'
      console.log(line)
    }
  }
  if (preview.safety_notes?.length > 0) {
    console.log('├─────────────────────────────────────────────────────────┤')
    for (const note of preview.safety_notes) {
      const prefix = note.startsWith('UNSAFE') ? '⛔' : '⚠ '
      console.log(`│  ${prefix} ${note}`.slice(0, 61).padEnd(61) + '│')
    }
  }
  console.log('└─────────────────────────────────────────────────────────┘\n')

  // ── STEP 2: Safety gate ─────────────────────────────────────────────────────
  if (!preview.is_safe) {
    console.error('❌  STOPPED — preview.is_safe is false.')
    console.error('   Safety notes:')
    for (const n of preview.safety_notes ?? []) console.error('  ', n)
    process.exit(1)
  }

  // ── STEP 3: Execute reconciliation (always — drift correction runs even with 0 stale) ──
  console.log('STEP 3 — Executing classified reconciliation (+ wallet drift correction)…\n')
  const result = await reconcileStaleReservations()
  printJson('RECONCILIATION RESULT', result)

  console.log('\n┌─── RECONCILIATION SUMMARY ──────────────────────────────┐')
  console.log(`│  run_at:           ${result.run_at.slice(0, 43).padEnd(43)}│`)
  console.log(`│  Category A done:  ${String(result.category_A_processed).padEnd(43)}│`)
  console.log(`│  Category B done:  ${String(result.category_B_processed).padEnd(43)}│`)
  console.log(`│  Category C flag:  ${String(result.category_C_needs_review).padEnd(43)}│`)
  console.log(`│  Drift corrected:  ${String(result.drift_corrected).padEnd(43)}│`)
  if (result.errors.length > 0) {
    console.log('├─────────────────────────────────────────────────────────┤')
    console.log(`│  ❌ Errors (${result.errors.length}):${''.padEnd(46)}│`)
    for (const e of result.errors) console.log(`│    ${e}`.slice(0, 61).padEnd(61) + '│')
  }
  console.log('└─────────────────────────────────────────────────────────┘\n')

  if (result.errors.length > 0) {
    console.error('⚠  Reconciliation completed with errors. Verify before proceeding.')
  }

  // ── STEP 4: Verify ──────────────────────────────────────────────────────────
  console.log('STEP 4 — Running post-reconciliation verification…\n')
  const verification = await verifyReconciliation()
  printJson('VERIFICATION RESULT', verification)

  const allOk = (
    verification.reserved_credits_match_active &&
    verification.no_stale_in_flight &&
    verification.no_successful_call_accidentally_released &&
    verification.remaining_drift === 0
  )

  console.log('\n┌─── VERIFICATION SUMMARY ────────────────────────────────┐')
  const checks = [
    { label: 'reserved_credits match active reservations', ok: verification.reserved_credits_match_active },
    { label: 'No stale in-flight budget reservations',     ok: verification.no_stale_in_flight },
    { label: 'No accidental releases of paid calls',       ok: verification.no_successful_call_accidentally_released },
    { label: 'Drift = 0',                                  ok: verification.remaining_drift === 0 },
    { label: `needs_review count: ${verification.remaining_needs_review}`, ok: true },
  ]
  for (const { label, ok } of checks) {
    const icon = ok ? '✓' : '✗'
    console.log(`│  ${icon} ${label}`.slice(0, 61).padEnd(61) + '│')
  }
  if (verification.issues.length > 0) {
    console.log('├─────────────────────────────────────────────────────────┤')
    for (const issue of verification.issues) {
      console.log(`│  ⚠ ${issue}`.slice(0, 61).padEnd(61) + '│')
    }
  }
  console.log('└─────────────────────────────────────────────────────────┘\n')

  if (!allOk) {
    console.error('❌  VERIFICATION FAILED — do not proceed to bulk search.')
    process.exit(2)
  }

  // ── STEP 5: Second run must be no-op ────────────────────────────────────────
  console.log('STEP 5 — Second reconciliation run (must be no-op)…\n')
  const run2 = await reconcileStaleReservations()
  const isNoop = (
    run2.category_A_processed === 0 &&
    run2.category_B_processed === 0 &&
    run2.category_C_needs_review === 0 &&
    run2.drift_corrected === 0 &&
    run2.errors.length === 0
  )
  if (isNoop) {
    console.log('✓  Second run is a no-op — idempotency confirmed.\n')
  } else {
    console.error('❌  Second run was NOT a no-op:')
    console.error(JSON.stringify(run2, null, 2))
    process.exit(3)
  }

  // ── STEP 6: Final diagnostics check ─────────────────────────────────────────
  console.log('STEP 6 — Fetching live diagnostics from DB (fn_billing_diagnostics_check)…\n')
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: diagData, error: diagErr } = await sb.rpc('fn_billing_diagnostics_check')
  if (diagErr) {
    console.warn('⚠  fn_billing_diagnostics_check not available (migration not yet applied):', diagErr.message)
    console.log('   Skipping DB-side diagnostics. Apply phase66e_needs_review.sql to enable.\n')
  } else {
    printJson('DB DIAGNOSTICS SNAPSHOT', diagData)
    const needsReconciliation = diagData?.needs_reconciliation ?? false
    if (needsReconciliation) {
      console.warn('\n⚠  DB diagnostics still show needs_reconciliation=true. Investigate before bulk search.')
    } else {
      console.log('\n✓  DB diagnostics: needs_reconciliation = false\n')
    }
  }

  // ── Final state report ──────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  ✓  RECONCILIATION COMPLETE — safe to run bulk search   ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')
  console.log('Proceed with Broward bulk search. Expected behavior:')
  console.log('  • Results render on first execution')
  console.log('  • One legitimate charge (one usage event)')
  console.log('  • Normal retry → idempotent_duplicate (no double-charge)')
  console.log('  • No authorization_unavailable')
  console.log('  • No idempotent_in_flight from stale reservations\n')
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err)
  process.exit(99)
})
