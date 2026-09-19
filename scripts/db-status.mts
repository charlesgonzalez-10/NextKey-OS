import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
for (const line of envLines) {
  const eq = line.indexOf('=')
  if (eq > 0) {
    const k = line.slice(0, eq).trim()
    if (!process.env[k]) process.env[k] = line.slice(eq + 1).trim()
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

console.log('=== POOL SPEND ===')
const { data: pools } = await sb.from('api_budget_pools').select('pool_key, spent_this_period_cents, monthly_limit_cents')
for (const p of pools ?? []) console.log(`  ${p.pool_key}: spent=${p.spent_this_period_cents}¢ / limit=${p.monthly_limit_cents}¢`)

console.log('\n=== WALLET reserved_credits ===')
const { data: wallets } = await sb.from('credit_wallets').select('id, account_id, reserved_credits, available_monthly_credits')
for (const w of wallets ?? []) console.log(`  ${w.account_id.slice(0,8)}…  reserved=${w.reserved_credits}  monthly=${w.available_monthly_credits}`)

console.log('\n=== ACCOUNT CAP SPEND ===')
const { data: caps } = await sb.from('account_vendor_cost_caps').select('account_id, spent_this_period_cents')
for (const c of caps ?? []) console.log(`  ${c.account_id.slice(0,8)}…  spent=${c.spent_this_period_cents}¢`)

console.log('\n=== BUDGET RESERVATIONS (by status) ===')
const { data: budgets } = await sb.from('api_budget_reservations').select('request_id, status, estimated_cost_cents, pool_key, account_id, expires_at')
const grouped: Record<string, typeof budgets> = {}
for (const b of budgets ?? []) {
  grouped[b.status] = grouped[b.status] ?? []
  grouped[b.status]!.push(b)
}
for (const [status, rows] of Object.entries(grouped)) {
  console.log(`  ${status}: ${rows!.length}`)
  if (status === 'reserved') {
    for (const r of rows!) {
      console.log(`    request_id=${r.request_id}  cost=${r.estimated_cost_cents}¢  expires=${r.expires_at}`)
    }
  }
}

console.log('\n=== CREDIT RESERVATIONS (by status) ===')
const { data: credits } = await sb.from('credit_reservations').select('request_id, status, reserved_credits, expires_at')
const cGrouped: Record<string, typeof credits> = {}
for (const c of credits ?? []) {
  cGrouped[c.status] = cGrouped[c.status] ?? []
  cGrouped[c.status]!.push(c)
}
for (const [status, rows] of Object.entries(cGrouped)) {
  console.log(`  ${status}: ${rows!.length}`)
  if (status === 'reserved') {
    for (const r of rows!) {
      console.log(`    request_id=${r.request_id}  credits=${r.reserved_credits}  expires=${r.expires_at}`)
    }
  }
}

console.log('\n=== WHICH DB FUNCTIONS EXIST ===')
const fnNames = ['fn_adjust_pool_spent', 'fn_adjust_account_cost', 'fn_adjust_reserved_credits', 'fn_reserve_budget_and_credits', 'fn_finalize_reservation', 'fn_billing_diagnostics_check']
for (const fn of fnNames) {
  const { error } = await sb.rpc(fn as string, {})
  // A "wrong number of arguments" error means function EXISTS
  // A "schema cache" error means it doesn't exist
  const exists = !error || !error.message.includes('schema cache')
  const msg = exists ? 'EXISTS' : 'MISSING'
  const detail = error?.message ?? '(callable)'
  console.log(`  ${fn}: ${msg} — ${detail.slice(0, 80)}`)
}
