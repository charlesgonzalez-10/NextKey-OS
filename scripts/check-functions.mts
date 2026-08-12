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

// Check wallet states
const { data: wallets } = await sb.from('credit_wallets').select('id, account_id, reserved_credits')
console.log('\n=== Wallet reserved_credits ===')
for (const w of wallets ?? []) {
  console.log(`  ${w.account_id.slice(0,8)}…  reserved_credits=${w.reserved_credits}`)
}

// Check active credit_reservations
const now = new Date().toISOString()
const { data: actives } = await sb
  .from('credit_reservations')
  .select('wallet_id, status, reserved_credits, expires_at')
  .eq('status', 'reserved')
  .gt('expires_at', now)
console.log(`\nActive credit_reservations (non-expired): ${actives?.length ?? 0}`)

// Try the RPC
const { error: rpcErr } = await sb.rpc('fn_adjust_reserved_credits', {
  p_account_id: '00000000-0000-0000-0000-000000000000',
  p_delta: 0,
})
console.log(`\nfn_adjust_reserved_credits probe: ${rpcErr ? `MISSING — ${rpcErr.message}` : 'EXISTS (callable)'}`)

// Check which fn_adjust* functions exist
const { data: fns } = await sb
  .from('pg_proc')
  .select('proname')
  .like('proname', 'fn_adjust%')
  .limit(20)
console.log('\nfn_adjust* in pg_proc:', fns)

// Try notification to reload schema
const { error: notifyErr } = await sb.rpc('pg_notify', { channel: 'pgrst', payload: 'reload schema' }).catch(() => ({ error: 'no pg_notify rpc' }))
console.log('\npg_notify attempt:', notifyErr ? String(notifyErr) : 'sent')
