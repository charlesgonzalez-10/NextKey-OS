import { serviceClient } from '@/lib/supabase-service'
import type {
  ApiBudgetPool,
  BudgetReservation,
  BudgetStatusAdmin,
  PoolKey,
  ReservationStatus,
} from './types'

export class ApiBudgetService {

  async getPools(): Promise<ApiBudgetPool[]> {
    const { data, error } = await serviceClient
      .from('api_budget_pools')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })

    if (error) throw new Error(`ApiBudgetService.getPools: ${error.message}`)
    return data as ApiBudgetPool[]
  }

  async getPool(pool_key: PoolKey): Promise<ApiBudgetPool | null> {
    const { data, error } = await serviceClient
      .from('api_budget_pools')
      .select('*')
      .eq('pool_key', pool_key)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`ApiBudgetService.getPool: ${error.message}`)
    }
    return data as ApiBudgetPool | null
  }

  async getBudgetStatus(): Promise<BudgetStatusAdmin> {
    const pools = await this.getPools()

    const global_limit_cents = pools.reduce((sum, p) => sum + p.monthly_limit_cents, 0)
    const global_spent_cents = pools.reduce((sum, p) => sum + p.spent_this_period_cents, 0)
    const global_available_cents = global_limit_cents - global_spent_cents

    return {
      period_start: pools[0]?.period_start ?? new Date().toISOString(),
      period_end: pools[0]?.period_end ?? new Date().toISOString(),
      global_limit_cents,
      global_spent_cents,
      global_available_cents,
      global_utilization_pct: global_limit_cents > 0
        ? Math.round((global_spent_cents / global_limit_cents) * 100)
        : 0,
      pools: pools.map(p => ({
        pool_key: p.pool_key as PoolKey,
        display_name: p.display_name,
        limit_cents: p.monthly_limit_cents,
        spent_cents: p.spent_this_period_cents,
        available_cents: p.monthly_limit_cents - p.spent_this_period_cents,
        utilization_pct: p.monthly_limit_cents > 0
          ? Math.round((p.spent_this_period_cents / p.monthly_limit_cents) * 100)
          : 0,
        is_protected: p.is_protected,
      })),
    }
  }

  async getReservation(request_id: string): Promise<BudgetReservation | null> {
    const { data, error } = await serviceClient
      .from('api_budget_reservations')
      .select('*')
      .eq('request_id', request_id)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`ApiBudgetService.getReservation: ${error.message}`)
    }
    return data as BudgetReservation | null
  }

  async finalizeReservation(
    request_id: string,
    actual_cost_cents: number,
    status: Extract<ReservationStatus, 'finalized' | 'released'>
  ): Promise<void> {
    const reservation = await this.getReservation(request_id)
    if (!reservation) {
      throw new Error(`No reservation found for request_id: ${request_id}`)
    }

    const { error: updateError } = await serviceClient
      .from('api_budget_reservations')
      .update({
        status,
        actual_cost_cents,
        finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', request_id)

    if (updateError) {
      throw new Error(`ApiBudgetService.finalizeReservation: ${updateError.message}`)
    }

    // Reconcile pool spent: replace estimated with actual
    const delta = actual_cost_cents - reservation.estimated_cost_cents
    if (delta !== 0) {
      const { error: poolError } = await serviceClient.rpc(
        'fn_adjust_pool_spent',
        { p_pool_key: reservation.pool_key, p_delta_cents: delta }
      )
      if (poolError) {
        // Non-fatal: log but do not throw. Reconciliation can run as a background job.
        console.error(`[ApiBudgetService] Pool reconciliation warning: ${poolError.message}`)
      }
    }
  }

  async expireStaleReservations(): Promise<number> {
    const { data, error } = await serviceClient
      .from('api_budget_reservations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('status', 'reserved')
      .lt('expires_at', new Date().toISOString())
      .select('id')

    if (error) throw new Error(`ApiBudgetService.expireStaleReservations: ${error.message}`)
    return data?.length ?? 0
  }

  async resetPeriod(pool_key: PoolKey): Promise<void> {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const { error } = await serviceClient
      .from('api_budget_pools')
      .update({
        spent_this_period_cents: 0,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('pool_key', pool_key)

    if (error) throw new Error(`ApiBudgetService.resetPeriod: ${error.message}`)
  }

  async updatePoolLimit(pool_key: PoolKey, new_limit_cents: number): Promise<void> {
    // Validate: sum of all pool limits must not exceed $10,000 (safety cap)
    const pools = await this.getPools()
    const otherTotal = pools
      .filter(p => p.pool_key !== pool_key)
      .reduce((sum, p) => sum + p.monthly_limit_cents, 0)

    if (otherTotal + new_limit_cents > 10_000) {
      throw new Error(
        `Pool limit change would exceed the $100 platform budget. ` +
        `Other pools: ${otherTotal}¢, requested: ${new_limit_cents}¢, max total: 10000¢`
      )
    }

    const { error } = await serviceClient
      .from('api_budget_pools')
      .update({ monthly_limit_cents: new_limit_cents, updated_at: new Date().toISOString() })
      .eq('pool_key', pool_key)

    if (error) throw new Error(`ApiBudgetService.updatePoolLimit: ${error.message}`)
  }

  async toggleKillSwitch(
    pool_key: PoolKey,
    provider_key: string,
    enabled: boolean,
    reason?: string
  ): Promise<void> {
    const { error } = await serviceClient
      .from('api_budget_policies')
      .update({
        is_enabled: enabled,
        kill_switch_reason: enabled ? null : (reason ?? 'Disabled by admin'),
        updated_at: new Date().toISOString(),
      })
      .eq('pool_key', pool_key)
      .eq('provider_key', provider_key)

    if (error) throw new Error(`ApiBudgetService.toggleKillSwitch: ${error.message}`)
  }
}

export const apiBudgetService = new ApiBudgetService()
