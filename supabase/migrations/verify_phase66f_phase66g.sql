-- Migration verification queries for phase66f_provider_health.sql and phase66g_stripe_integration.sql
--
-- Run these queries BEFORE applying the migrations to verify safety.
-- Run them AGAIN AFTER applying to confirm everything landed correctly.
--
-- Copy-paste into the Supabase SQL editor (service-role connection).
-- Each block is a separate verification check. A row returned = check passed.
-- Empty result or error = do NOT apply the migration until resolved.

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A — phase66f_provider_health.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- A1. Confirm auth.users exists (api_provider_health references it via seeded rows)
SELECT table_schema, table_name
  FROM information_schema.tables
 WHERE table_schema = 'auth' AND table_name = 'users';
-- Expected: 1 row

-- A2. Confirm api_provider_health does NOT already exist (migration uses CREATE TABLE IF NOT EXISTS)
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'api_provider_health';
-- Expected: 0 rows = safe to apply; 1 row = already applied (migration is idempotent, safe to re-run)

-- A3. Verify status CHECK constraint values (after applying)
SELECT cc.constraint_name, cc.check_clause
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
 WHERE tc.table_name = 'api_provider_health'
   AND tc.constraint_type = 'CHECK';
-- Expected: 2 constraints — one for status (7 values), one for error_category (8 values)

-- A4. Verify RLS is enabled on api_provider_health
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public' AND tablename = 'api_provider_health';
-- Expected: 1 row with rowsecurity = true

-- A5. Verify service_role_only policy blocks anon + authenticated users
-- (Run as anon/authenticated — if RLS is correct, this should return 0 rows
--  even though seeded rows exist)
SELECT COUNT(*) AS visible_rows_as_service_role
  FROM public.api_provider_health;
-- Expected as service-role: 3 rows (reapi, rentcast, google_maps seeds)
-- Expected as anon/authenticated: error or 0 rows (RLS blocks all)

-- A6. Verify seed rows landed
SELECT provider_key, status, error_category
  FROM public.api_provider_health
 ORDER BY created_at;
-- Expected: 3 rows: reapi/unknown, rentcast/unknown, google_maps/unknown

-- A7. Verify api_provider_health index
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'api_provider_health';
-- Expected: at least idx_api_provider_health_provider_key and idx_api_provider_health_created

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B — phase66g_stripe_integration.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- B1. Confirm stripe_events does NOT already exist (safe to re-run — IF NOT EXISTS)
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'stripe_events';
-- Expected: 0 rows = safe to apply; 1 row = already applied (idempotent)

-- B2. After applying: verify stripe_events columns and types
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'stripe_events'
 ORDER BY ordinal_position;
-- Expected columns: id (uuid), event_id (text NOT NULL UNIQUE), event_type (text),
--   account_id (uuid nullable), processing_status (text NOT NULL DEFAULT 'received'),
--   attempt_count (integer NOT NULL DEFAULT 0), last_error (text nullable),
--   payload (jsonb nullable), first_received_at (timestamptz NOT NULL DEFAULT now()),
--   last_attempt_at (timestamptz nullable), processed_at (timestamptz nullable)

-- B3. Verify UNIQUE constraint on stripe_events.event_id
SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
 WHERE tc.table_name = 'stripe_events'
   AND tc.constraint_type = 'UNIQUE';
-- Expected: 1 row — UNIQUE on event_id

-- B4. Verify stripe_events processing_status CHECK constraint
SELECT cc.check_clause
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
 WHERE tc.table_name = 'stripe_events'
   AND tc.constraint_type = 'CHECK';
-- Expected: contains 'received', 'processing', 'processed', 'permanent_failure', 'retryable_failure'

-- B5. Verify RLS is enabled on stripe_events
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public' AND tablename = 'stripe_events';
-- Expected: rowsecurity = true

-- B6. Verify stripe_events indexes (event_id + retryable filtered index)
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'stripe_events';
-- Expected: idx_stripe_events_event_id and idx_stripe_events_retryable
-- idx_stripe_events_retryable should be a partial index WHERE processing_status IN (...)

-- B7. Verify account_subscriptions now has Stripe lifecycle columns
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'account_subscriptions'
   AND column_name IN (
     'payment_provider', 'external_customer_id', 'external_subscription_id',
     'cancel_at_period_end', 'cancelled_at'
   )
 ORDER BY column_name;
-- Expected: 5 rows

-- B8. Verify account_subscriptions status CHECK includes full Stripe lifecycle values
SELECT cc.check_clause
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
 WHERE tc.table_name = 'account_subscriptions'
   AND tc.constraint_type = 'CHECK'
   AND cc.check_clause ILIKE '%status%';
-- Expected check_clause contains: active, trialing, past_due, incomplete,
--   incomplete_expired, unpaid, paused, cancelled

-- B9. Verify existing account_subscriptions data still satisfies the new CHECK
-- (Run BEFORE applying — will confirm no current rows would violate the new constraint)
SELECT status, COUNT(*) as row_count
  FROM public.account_subscriptions
 WHERE status NOT IN (
   'active', 'trialing', 'past_due', 'incomplete',
   'incomplete_expired', 'unpaid', 'paused', 'cancelled'
 )
 GROUP BY status;
-- Expected: 0 rows — any result here means existing data would violate the new constraint

-- B10. Verify credit_products has display_order column
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'credit_products'
   AND column_name = 'display_order';
-- Expected: 1 row (integer, default 0)

-- B11. Verify subscription_plans has external price ID columns
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'subscription_plans'
   AND column_name IN ('external_price_id_monthly', 'external_price_id_annual', 'external_product_id');
-- Expected: 3 rows (may already exist from phase66_commerce_schema.sql — no-op is correct)

-- B12. Verify credit_purchases has payment_provider_customer_id column
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'credit_purchases'
   AND column_name = 'payment_provider_customer_id';
-- Expected: 1 row (text)

-- B13. Verify foreign key from stripe_events.account_id → auth.users(id)
SELECT tc.constraint_name, tc.constraint_type,
       kcu.column_name, ccu.table_schema AS foreign_schema,
       ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
 WHERE tc.table_name = 'stripe_events'
   AND tc.constraint_type = 'FOREIGN KEY';
-- Expected: FOREIGN KEY on account_id → auth.users(id)

-- B14. Service-role access verification (run as service-role)
-- These must succeed for the webhook handler to function
INSERT INTO stripe_events (event_id, event_type, processing_status, attempt_count, first_received_at)
VALUES ('evt_verify_test_001', 'test.event', 'received', 1, now())
ON CONFLICT (event_id) DO NOTHING;

SELECT event_id, processing_status FROM stripe_events WHERE event_id = 'evt_verify_test_001';

UPDATE stripe_events SET processing_status = 'processed', processed_at = now()
 WHERE event_id = 'evt_verify_test_001';

DELETE FROM stripe_events WHERE event_id = 'evt_verify_test_001';
-- Expected: insert/select/update/delete all succeed without error
-- If you get "row-level security policy violation", service-role bypass is not working

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION C — Cross-migration safety checks
-- ─────────────────────────────────────────────────────────────────────────────

-- C1. Verify RLS policies exist and block non-service-role access
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE tablename IN ('api_provider_health', 'stripe_events')
 ORDER BY tablename, policyname;
-- Expected: service_role_only policy for each table
-- qual = 'false' (USING (false)) and with_check = 'false' (WITH CHECK (false))

-- C2. Verify no existing table or index name collisions before applying
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('stripe_events', 'api_provider_health');
-- Expected: 0 rows before first apply; 2 rows after

-- C3. Rerun safety — all migration DDL uses IF NOT EXISTS or DO $$ blocks
-- This query confirms no duplicate objects if migration is applied twice
-- (After applying twice, verify row counts haven't doubled)
SELECT COUNT(*) AS provider_health_rows FROM api_provider_health;
-- Expected: 3 rows (seeds are inside IF NOT EXISTS column-check blocks, so re-run is safe)

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION D — Budget invariant guard (DO NOT TOUCH BUDGET LIMITS)
-- ─────────────────────────────────────────────────────────────────────────────

-- D1. Confirm api_budget_pools are unchanged after migrations
SELECT pool_key, monthly_limit_cents, spent_this_period_cents, is_protected
  FROM api_budget_pools
 ORDER BY pool_key;
-- Expected: same values as before applying migrations
-- Phase66f and Phase66g must NOT modify any row in api_budget_pools

-- D2. Confirm no triggers were added that could modify billing pools
SELECT trigger_name, event_manipulation, event_object_table, action_statement
  FROM information_schema.triggers
 WHERE event_object_table IN ('stripe_events', 'api_provider_health', 'account_subscriptions',
                               'credit_purchases', 'credit_products', 'subscription_plans')
   AND trigger_name NOT LIKE 'RI_%'  -- exclude FK enforcement triggers
 ORDER BY event_object_table, trigger_name;
-- Expected: 0 rows (migrations add no triggers that could silently move money)
