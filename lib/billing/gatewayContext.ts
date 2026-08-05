import type { PoolKey } from './types'

export interface BillingContext {
  account_id: string
  pool_key: PoolKey
  // Controls credit_cost=0 for background ops. Does NOT suppress estimated_cost_cents —
  // the real vendor cost is always reserved before the provider call.
  is_background?: boolean
}

export type EnrichmentOutcome<T> =
  | { outcome: 'success'; data: T; request_id: string }
  | { outcome: 'blocked'; error_code: string; safe_message: string }
  | { outcome: 'provider_failed'; error: string }

export function buildCustomerContext(account_id: string): BillingContext {
  return { account_id, pool_key: 'customer_shared' }
}

export function buildOwnerContext(account_id: string): BillingContext {
  return { account_id, pool_key: 'owner_reserved' }
}

// Synthetic account for background/cron operations.
// Gate 2 (per-account cap) is bypassed in fn_reserve_budget_and_credits for this UUID.
// Real throttle is gate 3: background_operations pool = 500¢/month.
// See migration: phase66b_background_seed.sql
export const BACKGROUND_CONTEXT: BillingContext = {
  account_id: '00000000-0000-0000-0000-000000000001',
  pool_key: 'background_operations',
  is_background: true,
}
