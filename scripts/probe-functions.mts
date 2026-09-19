import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
for (const line of envLines) {
  const eq = line.indexOf('=')
  if (eq > 0) { const k = line.slice(0, eq).trim(); if (!process.env[k]) process.env[k] = line.slice(eq + 1).trim() }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// fn_adjust_pool_spent — call with delta=0 (no-op) on a real pool key
const { error: e1 } = await sb.rpc('fn_adjust_pool_spent', { p_pool_key: 'customer_shared', p_delta_cents: 0 })
console.log('fn_adjust_pool_spent:        ', e1 ? `❌ ${e1.message}` : '✓ exists and callable')

// fn_adjust_account_cost — call with delta=0 on a real account
const { data: caps } = await sb.from('account_vendor_cost_caps').select('account_id').limit(1).single()
const { error: e2 } = await sb.rpc('fn_adjust_account_cost', { p_account_id: caps?.account_id ?? '00000000-0000-0000-0000-000000000000', p_delta_cents: 0 })
console.log('fn_adjust_account_cost:      ', e2 ? `❌ ${e2.message}` : '✓ exists and callable')

// fn_adjust_reserved_credits — call with delta=0 on a real account
const { data: wallet } = await sb.from('credit_wallets').select('account_id').limit(1).single()
const { error: e3 } = await sb.rpc('fn_adjust_reserved_credits', { p_account_id: wallet?.account_id ?? '00000000-0000-0000-0000-000000000000', p_delta: 0 })
console.log('fn_adjust_reserved_credits:  ', e3 ? `❌ ${e3.message}` : '✓ exists and callable')

// Current state before reconciliation
console.log('\n=== PRE-RECONCILIATION STATE ===')
const { data: pools } = await sb.from('api_budget_pools').select('pool_key, spent_this_period_cents')
for (const p of pools ?? []) if (p.spent_this_period_cents > 0) console.log(`  pool ${p.pool_key}: ${p.spent_this_period_cents}¢`)

const { data: wallets } = await sb.from('credit_wallets').select('account_id, reserved_credits, available_monthly_credits, lifetime_consumed_credits')
for (const w of wallets ?? []) console.log(`  wallet ${w.account_id.slice(0,8)}…: reserved=${w.reserved_credits} monthly=${w.available_monthly_credits} lifetime_consumed=${w.lifetime_consumed_credits}`)

const { data: caps2 } = await sb.from('account_vendor_cost_caps').select('account_id, spent_this_period_cents')
for (const c of caps2 ?? []) if (c.spent_this_period_cents > 0) console.log(`  cap ${c.account_id.slice(0,8)}…: spent=${c.spent_this_period_cents}¢`)
