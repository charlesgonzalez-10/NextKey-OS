import { readFileSync } from 'fs'; import { resolve } from 'path'
const e = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
for (const l of e) { const eq = l.indexOf('='); if (eq > 0) { const k = l.slice(0, eq).trim(); if (!process.env[k]) process.env[k] = l.slice(eq + 1).trim() } }

import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data, error } = await sb.rpc('version')
console.log('DB reachable:', !error, error?.message ?? '')

// Check if fn_adjust_reserved_credits exists by querying information_schema
const { data: fns, error: fnsErr } = await (sb as any)
  .from('information_schema.routines')
  .select('routine_name, routine_type')
  .eq('routine_schema', 'public')
  .like('routine_name', 'fn_adjust%')
console.log('Adjust functions in public schema:', fns, fnsErr?.message)

// Check wallet reserved_credits
const { data: wallets } = await sb.from('credit_wallets').select('id, account_id, reserved_credits')
console.log('\nWallets:')
for (const w of wallets ?? []) console.log(' ', w.account_id.slice(0,8), 'reserved_credits=', w.reserved_credits)

// Check active credit_reservations
const now = new Date().toISOString()
const { data: actives } = await sb.from('credit_reservations').select('wallet_id, status, reserved_credits, expires_at').eq('status', 'reserved').gt('expires_at', now)
console.log('\nActive credit_reservations (status=reserved, not expired):', actives?.length ?? 0)

// Try calling the function directly via SQL using rpc('query') if available
const { data: sqlData, error: sqlErr } = await sb.rpc('fn_adjust_reserved_credits', { p_account_id: '00000000-0000-0000-0000-000000000000', p_delta: 0 })
console.log('\nfn_adjust_reserved_credits test call:', sqlErr?.message ?? 'EXISTS and callable (delta=0 no-op)')
