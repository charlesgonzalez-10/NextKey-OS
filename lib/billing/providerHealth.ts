// Provider health tracking — records events when external providers return
// error responses, enabling admin dashboards to distinguish platform billing
// failures from vendor-side issues (wallet depleted, rate limit, etc.).

import { serviceClient } from '@/lib/supabase-service'

export type ProviderErrorCategory =
  | 'provider_wallet_depleted'   // vendor 402 — prepaid wallet empty
  | 'provider_rate_limited'      // vendor 429 — too many requests
  | 'provider_auth_failed'       // vendor 401/403 — bad API key
  | 'provider_timeout'           // request timed out
  | 'provider_server_error'      // vendor 5xx
  | 'provider_disabled'          // kill-switch or feature flag
  | 'platform_budget_exhausted'  // NextKey pool exhausted (not provider)
  | 'customer_credit_exhausted'  // Customer has no credits (not provider)

export type ProviderWalletStatus =
  | 'healthy'
  | 'low_balance'
  | 'depleted'
  | 'rate_limited'
  | 'auth_failed'
  | 'server_error'
  | 'unknown'

// Wallet state is derived from manually entered balance — separate from ProviderWalletStatus
// (which is derived from actual API call outcomes recorded in api_provider_health).
//   unknown  — no balance ever entered
//   healthy  — balance above low_balance_threshold
//   low      — balance between critical and low threshold
//   critical — balance between 0 and critical threshold
//   depleted — either balance === 0, or HTTP 402 evidence received
export type ProviderWalletState = 'unknown' | 'healthy' | 'low' | 'critical' | 'depleted'

export interface ProviderWalletInfo {
  provider_key:               string
  wallet_state:               ProviderWalletState
  known_balance_cents:        number | null
  balance_entered_at:         string | null
  balance_entered_by:         string | null
  low_balance_threshold_cents:      number | null
  critical_balance_threshold_cents: number | null
  owner_reserve_cents:        number | null
  customer_usable_cents:      number | null
  last_wallet_depleted_at:    string | null
  last_refill_verified_at:    string | null
  last_refill_verified_by:    string | null
}

export interface ProviderHealthEvent {
  provider_key:   string
  status:         ProviderWalletStatus
  error_category?: ProviderErrorCategory
  http_status?:   number
  detail?:        string
}

export interface ProviderHealthSummary {
  provider_key:     string
  current_status:   ProviderWalletStatus
  error_category?:  ProviderErrorCategory
  http_status?:     number
  detail?:          string
  last_event_at?:   string
}

/** Map an HTTP status code to a ProviderErrorCategory */
export function classifyHttpError(httpStatus: number): ProviderErrorCategory {
  if (httpStatus === 402)             return 'provider_wallet_depleted'
  if (httpStatus === 429)             return 'provider_rate_limited'
  if (httpStatus === 401 || httpStatus === 403) return 'provider_auth_failed'
  if (httpStatus >= 500)              return 'provider_server_error'
  return 'provider_server_error'
}

/** Map a ProviderErrorCategory to a ProviderWalletStatus */
export function categoryToStatus(cat: ProviderErrorCategory): ProviderWalletStatus {
  switch (cat) {
    case 'provider_wallet_depleted': return 'depleted'
    case 'provider_rate_limited':   return 'rate_limited'
    case 'provider_auth_failed':    return 'auth_failed'
    case 'provider_server_error':
    case 'provider_timeout':        return 'server_error'
    default:                        return 'unknown'
  }
}

function deriveWalletState(
  balance: number,
  low:     number | null,
  critical: number | null,
): ProviderWalletState {
  if (balance <= 0)                            return 'depleted'
  if (critical != null && balance <= critical) return 'critical'
  if (low      != null && balance <= low)      return 'low'
  return 'healthy'
}

class ProviderHealthService {

  /** Record a health event (fire-and-forget safe — caller uses .catch(() => {})) */
  async recordEvent(event: ProviderHealthEvent): Promise<void> {
    const { error } = await serviceClient.from('api_provider_health').insert({
      provider_key:   event.provider_key,
      status:         event.status,
      error_category: event.error_category ?? null,
      http_status:    event.http_status ?? null,
      detail:         event.detail ?? null,
    })
    if (error) {
      // Never throw from a health recorder — log only
      console.warn(`[ProviderHealth] Failed to record event for ${event.provider_key}:`, error.message)
    }
  }

  /** Record a successful call, resetting status to 'healthy' */
  async recordSuccess(provider_key: string): Promise<void> {
    await this.recordEvent({ provider_key, status: 'healthy' })
  }

  /** Get the most recent health summary for a single provider */
  async getStatus(provider_key: string): Promise<ProviderHealthSummary> {
    const { data, error } = await serviceClient
      .from('api_provider_health')
      .select('status, error_category, http_status, detail, recorded_at')
      .eq('provider_key', provider_key)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return { provider_key, current_status: 'unknown' }

    return {
      provider_key,
      current_status:  data.status as ProviderWalletStatus,
      error_category:  data.error_category as ProviderErrorCategory | undefined,
      http_status:     data.http_status ?? undefined,
      detail:          data.detail ?? undefined,
      last_event_at:   data.recorded_at,
    }
  }

  /** Get latest health summary for all known providers */
  async getAllStatuses(): Promise<ProviderHealthSummary[]> {
    // Fetch the latest record per provider via a window function workaround:
    // select all, then deduplicate client-side (provider set is small).
    const { data, error } = await serviceClient
      .from('api_provider_health')
      .select('provider_key, status, error_category, http_status, detail, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(200)

    if (error || !data) return []

    const seen = new Set<string>()
    const result: ProviderHealthSummary[] = []
    for (const row of data) {
      if (seen.has(row.provider_key)) continue
      seen.add(row.provider_key)
      result.push({
        provider_key:    row.provider_key,
        current_status:  row.status as ProviderWalletStatus,
        error_category:  row.error_category as ProviderErrorCategory | undefined,
        http_status:     row.http_status ?? undefined,
        detail:          row.detail ?? undefined,
        last_event_at:   row.recorded_at,
      })
    }
    return result
  }

  /**
   * Convenience: classify an HTTP error from a provider and record the event.
   * Returns the category so the caller can include it in logs/error objects.
   * For HTTP 402 (wallet depleted): also stamps api_providers.last_wallet_depleted_at
   * and sets wallet_state='depleted'. Does NOT set api_providers.is_enabled=false.
   */
  async recordHttpError(
    provider_key: string,
    httpStatus: number,
    detail?: string,
  ): Promise<ProviderErrorCategory> {
    const category = classifyHttpError(httpStatus)
    const status   = categoryToStatus(category)
    await this.recordEvent({ provider_key, status, error_category: category, http_status: httpStatus, detail })

    if (category === 'provider_wallet_depleted') {
      await serviceClient
        .from('api_providers')
        .update({
          wallet_state:            'depleted',
          last_wallet_depleted_at: new Date().toISOString(),
          updated_at:              new Date().toISOString(),
        })
        .eq('provider_key', provider_key)
    }

    return category
  }

  // ── Wallet balance management ─────────────────────────────────────────────────

  /**
   * Admin: enter a manually known balance for a provider wallet.
   * Computes wallet_state from balance vs thresholds.
   * Does NOT set api_providers.is_enabled=false (stale balance is advisory).
   */
  async updateWalletBalance(params: {
    provider_key:               string
    balance_cents:              number
    actor_id:                   string
    low_balance_threshold_cents?:      number
    critical_balance_threshold_cents?: number
    owner_reserve_cents?:       number
  }): Promise<ProviderWalletState> {
    const {
      provider_key, balance_cents, actor_id,
      low_balance_threshold_cents,
      critical_balance_threshold_cents,
      owner_reserve_cents,
    } = params

    // Read current thresholds if not provided
    const { data: current } = await serviceClient
      .from('api_providers')
      .select('low_balance_threshold_cents, critical_balance_threshold_cents, owner_reserve_cents')
      .eq('provider_key', provider_key)
      .single()

    const cur = current as unknown as Record<string, unknown> | null
    const low      = low_balance_threshold_cents      ?? (cur?.low_balance_threshold_cents      as number | null) ?? null
    const critical = critical_balance_threshold_cents ?? (cur?.critical_balance_threshold_cents as number | null) ?? null
    const reserve  = owner_reserve_cents              ?? (cur?.owner_reserve_cents              as number | null) ?? 0

    const wallet_state = deriveWalletState(balance_cents, low, critical)

    const updates: Record<string, unknown> = {
      known_balance_cents:  balance_cents,
      balance_entered_at:   new Date().toISOString(),
      balance_entered_by:   actor_id,
      wallet_state,
      updated_at:           new Date().toISOString(),
    }
    if (low_balance_threshold_cents      != null) updates.low_balance_threshold_cents      = low_balance_threshold_cents
    if (critical_balance_threshold_cents != null) updates.critical_balance_threshold_cents = critical_balance_threshold_cents
    if (owner_reserve_cents              != null) updates.owner_reserve_cents              = owner_reserve_cents

    await serviceClient
      .from('api_providers')
      .update(updates)
      .eq('provider_key', provider_key)

    return wallet_state
  }

  /** Get current wallet state for a provider */
  async getWalletState(provider_key: string): Promise<ProviderWalletState> {
    const { data } = await serviceClient
      .from('api_providers')
      .select('*')
      .eq('provider_key', provider_key)
      .single()
    return ((data as unknown as Record<string, unknown>)?.wallet_state as ProviderWalletState | null) ?? 'unknown'
  }

  /** Get full wallet info for dashboard display */
  async getWalletInfo(provider_key: string): Promise<ProviderWalletInfo> {
    const { data } = await serviceClient
      .from('api_providers')
      .select('*')
      .eq('provider_key', provider_key)
      .single()

    const row = (data as unknown as Record<string, unknown>) ?? {}
    return {
      provider_key,
      wallet_state:               (row.wallet_state as ProviderWalletState | null) ?? 'unknown',
      known_balance_cents:        (row.known_balance_cents as number | null)              ?? null,
      balance_entered_at:         (row.balance_entered_at as string | null)               ?? null,
      balance_entered_by:         (row.balance_entered_by as string | null)               ?? null,
      low_balance_threshold_cents:      (row.low_balance_threshold_cents as number | null)      ?? null,
      critical_balance_threshold_cents: (row.critical_balance_threshold_cents as number | null) ?? null,
      owner_reserve_cents:        (row.owner_reserve_cents as number | null)              ?? null,
      customer_usable_cents:      (row.customer_usable_cents as number | null)            ?? null,
      last_wallet_depleted_at:    (row.last_wallet_depleted_at as string | null)          ?? null,
      last_refill_verified_at:    (row.last_refill_verified_at as string | null)          ?? null,
      last_refill_verified_by:    (row.last_refill_verified_by as string | null)          ?? null,
    }
  }

  /** Admin: mark the provider wallet as refilled/verified after topping up. */
  async markWalletRefilled(provider_key: string, actor_id: string): Promise<void> {
    await serviceClient
      .from('api_providers')
      .update({
        last_refill_verified_at: new Date().toISOString(),
        last_refill_verified_by: actor_id,
        updated_at:              new Date().toISOString(),
      })
      .eq('provider_key', provider_key)
  }

  /** Get all providers' wallet info for dashboard display */
  async getAllWalletInfos(): Promise<ProviderWalletInfo[]> {
    const { data, error } = await serviceClient
      .from('api_providers')
      .select('*')
      .order('provider_key')

    if (error || !data) return []

    return (data as unknown as Record<string, unknown>[]).map(row => ({
      provider_key:               (row.provider_key as string),
      wallet_state:               (row.wallet_state as ProviderWalletState | null) ?? 'unknown',
      known_balance_cents:        (row.known_balance_cents as number | null)              ?? null,
      balance_entered_at:         (row.balance_entered_at as string | null)               ?? null,
      balance_entered_by:         (row.balance_entered_by as string | null)               ?? null,
      low_balance_threshold_cents:      (row.low_balance_threshold_cents as number | null)      ?? null,
      critical_balance_threshold_cents: (row.critical_balance_threshold_cents as number | null) ?? null,
      owner_reserve_cents:        (row.owner_reserve_cents as number | null)              ?? null,
      customer_usable_cents:      (row.customer_usable_cents as number | null)            ?? null,
      last_wallet_depleted_at:    (row.last_wallet_depleted_at as string | null)          ?? null,
      last_refill_verified_at:    (row.last_refill_verified_at as string | null)          ?? null,
      last_refill_verified_by:    (row.last_refill_verified_by as string | null)          ?? null,
    }))
  }
}

export const providerHealthService = new ProviderHealthService()

/** Admin-safe summary label for a provider wallet status */
export function providerStatusLabel(s: ProviderHealthSummary): string {
  switch (s.current_status) {
    case 'healthy':      return 'Healthy'
    case 'low_balance':  return 'Low Balance'
    case 'depleted':     return `Depleted${s.http_status ? ` (HTTP ${s.http_status})` : ''}`
    case 'rate_limited': return 'Rate Limited'
    case 'auth_failed':  return 'Auth Failed'
    case 'server_error': return 'Server Error'
    default:             return 'Unknown'
  }
}

/** Customer-safe message — never reveals vendor/internal details */
export const PROVIDER_SAFE_MESSAGE =
  'Live property data is temporarily unavailable. Please try again later.'
