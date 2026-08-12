#!/usr/bin/env node
/**
 * apply-phase66-migrations.js
 *
 * Applies Phase 6.6 commerce schema migrations to the Supabase database in
 * the required order, with per-migration verification and stop-on-error.
 *
 * Usage:
 *   DB_PASS="<your-password>" node scripts/apply-phase66-migrations.js
 *
 *   The password is found in:
 *   Supabase Dashboard → [Project] → Settings → Database → Database Password
 *
 * Environment:
 *   DB_PASS              (required)  — Postgres password for the 'postgres' user
 *   NEXT_PUBLIC_SUPABASE_URL         — loaded from .env.local automatically
 *
 * What it does:
 *   1. phase66_commerce_schema.sql  — tables, RPC, seed providers/pools/plans/pricing
 *   2. phase66b_background_seed.sql — background operations account seed
 *   3. phase66b_search_pricing.sql  — property_search_criteria feature pricing
 *   4. phase66b_ingestion_support.sql — OR ingestion schema additions
 *
 *   After all four: NOTIFY pgrst, 'reload schema';
 *
 *   For account e5e19ad8-d6ed-40a4-89ce-aa961ddddae4:
 *   Verifies and initialises missing credit_wallet, account_subscription,
 *   account_vendor_cost_cap using the same ON CONFLICT DO NOTHING logic as
 *   the migration seed.
 */

'use strict'

const { Client }  = require('pg')
const fs          = require('fs')
const path        = require('path')
const readline    = require('readline')

// ─── Load env from .env.local ────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_0-9]+)=(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

loadEnv()

// ─── Config ───────────────────────────────────────────────────────────────────
const DB_PASS = process.env.DB_PASS
const TARGET_ACCOUNT = 'e5e19ad8-d6ed-40a4-89ce-aa961ddddae4'

if (!DB_PASS) {
  console.error('\n  ERROR: DB_PASS environment variable is required.')
  console.error('  Find your password at: Supabase Dashboard → Settings → Database → Database Password\n')
  console.error('  Usage:  DB_PASS="<password>" node scripts/apply-phase66-migrations.js\n')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!supabaseUrl) {
  console.error('\n  ERROR: NEXT_PUBLIC_SUPABASE_URL not found.')
  process.exit(1)
}

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
if (!projectRef) {
  console.error(`\n  ERROR: Could not parse project ref from ${supabaseUrl}`)
  process.exit(1)
}

const DB_CONFIG = {
  host:     `db.${projectRef}.supabase.co`,
  port:     5432,
  database: 'postgres',
  user:     'postgres',
  password: DB_PASS,
  ssl:      { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')

const MIGRATION_ORDER = [
  'phase66_commerce_schema.sql',
  'phase66b_background_seed.sql',
  'phase66b_search_pricing.sql',
  'phase66b_ingestion_support.sql',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg)  { console.log(`  ${msg}`) }
function ok(msg)   { console.log(`  ✓  ${msg}`) }
function warn(msg) { console.log(`  ⚠  ${msg}`) }
function fail(msg) { console.error(`  ✗  ${msg}`) }
function hr()      { console.log('\n' + '─'.repeat(70) + '\n') }

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  )
  return rows.length > 0
}

async function rowExists(client, table, column, value) {
  const { rows } = await client.query(
    `SELECT 1 FROM "${table}" WHERE "${column}" = $1 LIMIT 1`,
    [value]
  )
  return rows.length > 0
}

async function countRows(client, table) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)
  return rows[0].n
}

async function functionExists(client, fnName) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_proc WHERE proname = $1 LIMIT 1`,
    [fnName]
  )
  return rows.length > 0
}

// ─── Execute a migration file ──────────────────────────────────────────────────
async function applyMigration(client, filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename)
  if (!fs.existsSync(filepath)) {
    fail(`Migration file not found: ${filepath}`)
    return false
  }

  const sql = fs.readFileSync(filepath, 'utf8')
  log(`Applying ${filename} (${(sql.length / 1024).toFixed(1)} KB)…`)

  try {
    await client.query(sql)
    ok(`${filename} applied successfully`)
    return true
  } catch (e) {
    fail(`${filename} FAILED: ${e.message}`)
    if (e.detail) fail(`  Detail: ${e.detail}`)
    if (e.hint)   fail(`  Hint:   ${e.hint}`)
    return false
  }
}

// ─── Post-migration verification ──────────────────────────────────────────────
async function verifyAfterCommerce(client) {
  log('Verifying phase66_commerce_schema…')
  const REQUIRED_TABLES = [
    'api_providers', 'api_budget_pools', 'api_budget_policies',
    'api_budget_reservations', 'api_usage_events', 'feature_pricing_versions',
    'account_vendor_cost_caps', 'credit_wallets', 'credit_reservations',
    'subscription_plans', 'account_subscriptions', 'api_budget_overrides',
    'credit_grants', 'credit_transactions', 'credit_products', 'credit_purchases',
    'promotion_codes', 'promotion_redemptions', 'promotion_entitlements',
  ]
  let passed = true
  for (const t of REQUIRED_TABLES) {
    const exists = await tableExists(client, t)
    if (exists) ok(`  table: ${t}`)
    else { fail(`  table MISSING: ${t}`); passed = false }
  }

  const fnExists = await functionExists(client, 'fn_reserve_budget_and_credits')
  if (fnExists) ok(`  function: fn_reserve_budget_and_credits`)
  else { fail(`  function MISSING: fn_reserve_budget_and_credits`); passed = false }

  // Seed data
  const seeds = [
    { table: 'api_providers',        col: 'provider_key', val: 'reapi'            },
    { table: 'api_budget_pools',     col: 'pool_key',     val: 'customer_shared'  },
    { table: 'api_budget_pools',     col: 'pool_key',     val: 'owner_reserved'   },
    { table: 'subscription_plans',   col: 'plan_key',     val: 'owner'            },
    { table: 'subscription_plans',   col: 'plan_key',     val: 'starter'          },
    { table: 'feature_pricing_versions', col: 'feature_key', val: 'property_lookup_basic' },
  ]
  for (const s of seeds) {
    const exists = await rowExists(client, s.table, s.col, s.val)
    if (exists) ok(`  seed: ${s.table}[${s.val}]`)
    else { fail(`  seed MISSING: ${s.table}[${s.val}]`); passed = false }
  }

  return passed
}

async function verifyAfterSearchPricing(client) {
  log('Verifying phase66b_search_pricing…')
  const { rows } = await client.query(
    `SELECT feature_key, is_enabled, expected_vendor_cost_cents, customer_credit_cost, requires_confirmed_cost
     FROM feature_pricing_versions WHERE feature_key = 'property_search_criteria' LIMIT 1`
  )
  if (rows.length === 0) {
    fail('  property_search_criteria pricing row: MISSING')
    return false
  }
  const r = rows[0]
  ok(`  property_search_criteria: enabled=${r.is_enabled} vendor_cost=${r.expected_vendor_cost_cents}¢ credit_cost=${r.customer_credit_cost} requires_confirmed=${r.requires_confirmed_cost}`)
  if (!r.is_enabled) {
    fail('  property_search_criteria is NOT enabled — bulk search will be blocked at gate 6')
    return false
  }
  return true
}

// ─── Account record initialization ────────────────────────────────────────────
async function initAccountRecords(client, accountId) {
  hr()
  log(`Initializing account records for ${accountId}…`)

  // Wallet
  const hasWallet = await rowExists(client, 'credit_wallets', 'account_id', accountId)
  if (hasWallet) {
    ok('  credit_wallet: already exists')
  } else {
    await client.query(
      `INSERT INTO credit_wallets (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`,
      [accountId]
    )
    ok('  credit_wallet: created')
  }

  // Subscription (owner plan)
  const hasSub = await rowExists(client, 'account_subscriptions', 'account_id', accountId)
  if (hasSub) {
    ok('  account_subscription: already exists')
  } else {
    const { rows: planRows } = await client.query(
      `SELECT id FROM subscription_plans WHERE plan_key = 'owner' LIMIT 1`
    )
    if (planRows.length > 0) {
      await client.query(
        `INSERT INTO account_subscriptions (account_id, plan_id, status)
         VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`,
        [accountId, planRows[0].id]
      )
      ok('  account_subscription: created (owner plan)')
    } else {
      warn('  account_subscription: owner plan not found, using starter')
      const { rows: starterRows } = await client.query(
        `SELECT id FROM subscription_plans WHERE plan_key = 'starter' LIMIT 1`
      )
      if (starterRows.length > 0) {
        await client.query(
          `INSERT INTO account_subscriptions (account_id, plan_id, status)
           VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`,
          [accountId, starterRows[0].id]
        )
        ok('  account_subscription: created (starter plan)')
      }
    }
  }

  // Vendor cost cap (sync from subscription plan)
  const hasCap = await rowExists(client, 'account_vendor_cost_caps', 'account_id', accountId)
  if (hasCap) {
    ok('  account_vendor_cost_cap: already exists')
  } else {
    const { rows: capSrc } = await client.query(
      `SELECT sp.default_vendor_cost_cap_cents
       FROM account_subscriptions s
       JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.account_id = $1 AND s.status = 'active' LIMIT 1`,
      [accountId]
    )
    const capCents = capSrc[0]?.default_vendor_cost_cap_cents ?? 3000  // owner default
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    await client.query(
      `INSERT INTO account_vendor_cost_caps
         (account_id, plan_default_cap_cents, period_start, period_end)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, capCents, periodStart, periodEnd]
    )
    ok(`  account_vendor_cost_cap: created (cap=${capCents}¢/month)`)
  }

  // Active credit grant (starter credits for testing)
  const { rows: walletRows } = await client.query(
    `SELECT id FROM credit_wallets WHERE account_id = $1`,
    [accountId]
  )
  if (walletRows.length > 0) {
    const walletId = walletRows[0].id
    const { rows: grantRows } = await client.query(
      `SELECT id FROM credit_grants WHERE account_id = $1 AND status = 'active' LIMIT 1`,
      [accountId]
    )
    if (grantRows.length > 0) {
      ok('  credit_grant: active grant already exists')
    } else {
      // Grant 100 monthly credits for immediate use
      await client.query(
        `INSERT INTO credit_grants
           (wallet_id, account_id, grant_type, source_type, original_credits, remaining_credits, status)
         VALUES ($1, $2, 'monthly', 'system', 100, 100, 'active')`,
        [walletId, accountId]
      )
      // Update wallet balance
      await client.query(
        `UPDATE credit_wallets
         SET available_monthly_credits = available_monthly_credits + 100, updated_at = now()
         WHERE account_id = $1`,
        [accountId]
      )
      ok('  credit_grant: created (100 monthly credits)')
    }
  }

  // Final account state report
  const { rows: final } = await client.query(
    `SELECT
       cw.available_monthly_credits, cw.available_purchased_credits, cw.available_bonus_credits,
       cw.status AS wallet_status,
       avcc.plan_default_cap_cents, avcc.effective_cap_cents, avcc.spent_this_period_cents,
       sp.plan_key, s.status AS sub_status
     FROM credit_wallets cw
     LEFT JOIN account_vendor_cost_caps avcc ON avcc.account_id = cw.account_id
     LEFT JOIN account_subscriptions s ON s.account_id = cw.account_id AND s.status = 'active'
     LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE cw.account_id = $1`,
    [accountId]
  )

  if (final.length > 0) {
    const f = final[0]
    log('\n  Account state:')
    log(`    wallet:       ${f.wallet_status} | monthly=${f.available_monthly_credits} purchased=${f.available_purchased_credits} bonus=${f.available_bonus_credits}`)
    log(`    cost cap:     ${f.effective_cap_cents}¢/mo (plan default: ${f.plan_default_cap_cents}¢, spent: ${f.spent_this_period_cents}¢)`)
    log(`    subscription: ${f.plan_key} (${f.sub_status})`)

    if (f.effective_cap_cents === 0) {
      fail('  PROBLEM: effective_cap_cents is 0 — all paid calls will be blocked at Gate 2!')
      fail('  Fix: the owner plan should have default_vendor_cost_cap_cents > 0.')
    } else {
      ok(`  Gate 2 (account cap): ${f.effective_cap_cents}¢ available`)
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════════════════')
  console.log('  Phase 6.6 Migration Runner')
  console.log(`  Project: ${projectRef}`)
  console.log(`  Host:    ${DB_CONFIG.host}`)
  console.log('══════════════════════════════════════════════════════════════════════\n')

  const client = new Client(DB_CONFIG)

  try {
    log(`Connecting to ${DB_CONFIG.host}:${DB_CONFIG.port}…`)
    await client.connect()
    ok('Connected\n')
  } catch (e) {
    fail(`Connection failed: ${e.message}`)
    fail('  Check: DB_PASS correct? Database accessible? VPN required?')
    process.exit(1)
  }

  try {
    // ── Migration 1: Commerce schema ────────────────────────────────────────
    hr()
    log('MIGRATION 1/4: phase66_commerce_schema.sql')
    const m1ok = await applyMigration(client, 'phase66_commerce_schema.sql')
    if (!m1ok) { fail('Stopping — fix migration 1 before proceeding.'); process.exit(1) }

    const v1ok = await verifyAfterCommerce(client)
    if (!v1ok) { fail('Stopping — verification failed after migration 1.'); process.exit(1) }

    // ── Migration 2: Background seed ────────────────────────────────────────
    hr()
    log('MIGRATION 2/4: phase66b_background_seed.sql')
    const m2ok = await applyMigration(client, 'phase66b_background_seed.sql')
    if (!m2ok) { fail('Stopping — fix migration 2 before proceeding.'); process.exit(1) }

    // ── Migration 3: Search pricing ─────────────────────────────────────────
    hr()
    log('MIGRATION 3/4: phase66b_search_pricing.sql')
    const m3ok = await applyMigration(client, 'phase66b_search_pricing.sql')
    if (!m3ok) { fail('Stopping — fix migration 3 before proceeding.'); process.exit(1) }

    const v3ok = await verifyAfterSearchPricing(client)
    if (!v3ok) { fail('Stopping — verification failed after migration 3.'); process.exit(1) }

    // ── Migration 4: Ingestion support ──────────────────────────────────────
    hr()
    log('MIGRATION 4/4: phase66b_ingestion_support.sql')
    const m4ok = await applyMigration(client, 'phase66b_ingestion_support.sql')
    if (!m4ok) { fail('Stopping — fix migration 4 before proceeding.'); process.exit(1) }

    // ── Reload PostgREST schema cache ───────────────────────────────────────
    hr()
    log('Reloading PostgREST schema cache…')
    await client.query(`NOTIFY pgrst, 'reload schema'`)
    ok('NOTIFY pgrst sent')

    // ── Account record initialization ───────────────────────────────────────
    await initAccountRecords(client, TARGET_ACCOUNT)

    // ── Final summary ────────────────────────────────────────────────────────
    hr()
    console.log('  ✓  ALL FOUR MIGRATIONS APPLIED SUCCESSFULLY')
    console.log(`  ✓  Account ${TARGET_ACCOUNT} initialized`)
    console.log('\n  Next steps:')
    console.log('    1. Visit /api/billing/diagnostics to verify overall=PASS')
    console.log('    2. Run one controlled bulk property search')
    console.log('    3. Check server logs for [LiveSearch] and [ProviderGateway] entries\n')

  } finally {
    await client.end()
  }
}

main().catch(e => {
  fail(`Unexpected error: ${e.message}`)
  if (e.stack) console.error(e.stack)
  process.exit(1)
})
