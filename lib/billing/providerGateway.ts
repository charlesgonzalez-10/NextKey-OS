// ProviderGateway: the single chokepoint for all paid provider calls.
//
// Six-gate authorization (enforced in fn_reserve_budget_and_credits):
//   Gate 1: Customer credit balance sufficient
//   Gate 2: Account vendor cost cap not exceeded
//   Gate 3: Customer shared pool has capacity
//   Gate 4: Global budget not exceeded (implicit in pool sum constraints)
//   Gate 5: Protected reserve isolation (is_protected pools blocked for customers)
//   Gate 6: Provider + feature enabled (kill switch + pricing version active)
//
// Atomic dual reservation: fn_reserve_budget_and_credits handles all gates and
// both reservations in a single Postgres transaction with FOR UPDATE locking.
//
// Fail closed: if any service call throws, the provider call is BLOCKED.
// Unknown-cost features are BLOCKED (requires_confirmed_cost enforced in pricing).

import { serviceClient } from '@/lib/supabase-service'
import type {
  AuthorizationResult,
  ProviderCallRequest,
  ProviderCallFinalizeRequest,
  PoolKey,
} from './types'
import { pricingEngine } from './pricingEngine'
import { accountCostCapService } from './accountCostCapService'
import { creditWalletService } from './creditWalletService'

export class ProviderGateway {

  // Authorize a paid provider call.
  // Returns a reservation pair. Call finalize() after the provider responds.
  // If this throws, the provider call must NOT proceed.
  async authorize(request: ProviderCallRequest): Promise<AuthorizationResult> {
    // Background system account bypasses gates 1 and 2 in the RPC —
    // it has no account_vendor_cost_caps or credit_wallets rows (FK → auth.users),
    // so ensure* calls would fail. Skip them; the RPC handles the rest.
    const isBg = request.account_id === '00000000-0000-0000-0000-000000000001'
    if (!isBg) {
      try {
        await Promise.all([
          accountCostCapService.ensureCapExists(request.account_id),
          creditWalletService.ensureWalletExists(request.account_id),
        ])
      } catch (err) {
        return {
          success: false,
          budget_reservation_id: null,
          credit_reservation_id: null,
          gate_failed: 2,
          error_code: 'setup_error',
          error_message: 'Could not initialize account billing records.',
        }
      }
    }

    // Delegate all gate checks + atomic reservation to the database RPC.
    // This is the only correct path — do not duplicate gate logic here.
    const { data, error } = await serviceClient.rpc('fn_reserve_budget_and_credits', {
      p_request_id: request.request_id,
      p_account_id: request.account_id,
      p_feature_key: request.feature_key,
      p_provider_key: request.provider_key,
      p_pool_key: request.pool_key,
      p_estimated_cost_cents: request.estimated_cost_cents,
      p_credit_cost: request.credit_cost,
      p_is_zero_cost_feature: request.is_zero_cost_feature,
    })

    if (error) {
      console.error(`[ProviderGateway] RPC error: ${error.message}`)
      // Fail closed: any RPC failure blocks the call
      return {
        success: false,
        budget_reservation_id: null,
        credit_reservation_id: null,
        gate_failed: 4,
        error_code: 'authorization_unavailable',
        error_message: 'Authorization service unavailable. Provider call blocked.',
      }
    }

    return data as AuthorizationResult
  }

  // Convenience method: derive cost estimates from PricingEngine and call authorize.
  async authorizeFeature(params: {
    request_id: string
    account_id: string
    feature_key: string
    pool_key?: PoolKey
  }): Promise<AuthorizationResult> {
    const pricing = await pricingEngine.getActivePricing(params.feature_key)

    if (!pricing) {
      return {
        success: false,
        budget_reservation_id: null,
        credit_reservation_id: null,
        gate_failed: 6,
        error_code: 'feature_not_configured',
        error_message: 'Feature has no active pricing configuration.',
      }
    }

    if (!pricing.is_enabled) {
      return {
        success: false,
        budget_reservation_id: null,
        credit_reservation_id: null,
        gate_failed: 6,
        error_code: 'feature_disabled',
        error_message: pricing.disable_reason ?? 'Feature is disabled.',
      }
    }

    if (pricing.requires_confirmed_cost && pricing.expected_vendor_cost_cents === 0) {
      return {
        success: false,
        budget_reservation_id: null,
        credit_reservation_id: null,
        gate_failed: 6,
        error_code: 'unknown_vendor_cost',
        error_message: 'Feature has unconfirmed vendor cost. Cannot proceed.',
      }
    }

    const is_zero_cost = pricing.customer_credit_cost === 0 && pricing.expected_vendor_cost_cents === 0

    const pool_key = params.pool_key ?? 'customer_shared'

    return this.authorize({
      request_id: params.request_id,
      account_id: params.account_id,
      feature_key: params.feature_key,
      provider_key: pricing.provider_key ?? 'unknown',
      pool_key,
      estimated_cost_cents: pricing.expected_vendor_cost_cents,
      credit_cost: pricing.customer_credit_cost,
      is_zero_cost_feature: is_zero_cost,
    })
  }

  // Called after the provider call completes (success or failure).
  // Reconciles budget pool with actual cost and finalizes credit reservations.
  async finalize(params: ProviderCallFinalizeRequest): Promise<void> {
    const { request_id, actual_cost_cents, success, error_code, response_metadata, duration_ms, cache_hit } = params

    // Get reservation details for finalization
    const { data: budgetRes } = await serviceClient
      .from('api_budget_reservations')
      .select('*')
      .eq('request_id', request_id)
      .single()

    const { data: creditRes } = await serviceClient
      .from('credit_reservations')
      .select('*')
      .eq('request_id', request_id)
      .single()

    if (!budgetRes) {
      console.error(`[ProviderGateway] No budget reservation found for request_id: ${request_id}`)
    }

    // Finalize or release budget reservation
    if (budgetRes) {
      const finalStatus = success ? 'finalized' : 'released'
      const billedCost = success ? actual_cost_cents : 0

      await serviceClient
        .from('api_budget_reservations')
        .update({
          status: finalStatus,
          actual_cost_cents: billedCost,
          finalized_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', request_id)

      // Reconcile pool: replace estimate with actual
      const delta = billedCost - budgetRes.estimated_cost_cents
      if (delta !== 0) {
        await serviceClient.rpc('fn_adjust_pool_spent', {
          p_pool_key: budgetRes.pool_key,
          p_delta_cents: delta,
        }).then(({ error }) => {
          if (error) console.error(`[ProviderGateway] Pool reconcile: ${error.message}`)
        })
      }

      // Reconcile account cost cap
      if (budgetRes.account_id) {
        const capDelta = billedCost - budgetRes.estimated_cost_cents
        if (capDelta !== 0) {
          await serviceClient.rpc('fn_adjust_account_cost', {
            p_account_id: budgetRes.account_id,
            p_delta_cents: capDelta,
          }).then(({ error }) => {
            if (error) console.error(`[ProviderGateway] Cap reconcile: ${error.message}`)
          })
        }
      }
    }

    // Finalize credit reservation
    if (creditRes) {
      if (success) {
        // Consume the reserved credits for the actual call
        await serviceClient
          .from('credit_reservations')
          .update({
            status: 'finalized',
            finalized_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('request_id', request_id)

        await serviceClient
          .from('credit_wallets')
          .select('*')
          .eq('account_id', creditRes.account_id)
          .single()
          .then(async ({ data: wallet }) => {
            if (!wallet) return
            // Release reservation, draw actual amount from available
            const consumed = creditRes.reserved_credits
            const updates: Record<string, number | string> = {
              reserved_credits: Math.max(0, wallet.reserved_credits - consumed),
              lifetime_consumed_credits: wallet.lifetime_consumed_credits + consumed,
              updated_at: new Date().toISOString(),
            }
            // Draw from buckets (priority: bonus → monthly → purchased)
            let remaining = consumed
            if (remaining > 0 && wallet.available_bonus_credits > 0) {
              const draw = Math.min(remaining, wallet.available_bonus_credits)
              updates.available_bonus_credits = wallet.available_bonus_credits - draw
              remaining -= draw
            }
            if (remaining > 0 && wallet.available_monthly_credits > 0) {
              const draw = Math.min(remaining, wallet.available_monthly_credits)
              updates.available_monthly_credits = wallet.available_monthly_credits - draw
              remaining -= draw
            }
            if (remaining > 0 && wallet.available_purchased_credits > 0) {
              const draw = Math.min(remaining, wallet.available_purchased_credits)
              updates.available_purchased_credits = wallet.available_purchased_credits - draw
            }
            await serviceClient.from('credit_wallets').update(updates).eq('account_id', creditRes.account_id)
          })
      } else {
        // Release reservation on failure — do not consume credits for failed calls
        await serviceClient
          .from('credit_reservations')
          .update({
            status: 'released',
            finalized_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('request_id', request_id)

        await serviceClient.rpc('fn_adjust_reserved_credits', {
          p_account_id: creditRes.account_id,
          p_delta: -creditRes.reserved_credits,
        })
      }
    }

    // Write usage event (best-effort: non-fatal)
    await serviceClient.from('api_usage_events').insert({
      request_id,
      pool_key: budgetRes?.pool_key ?? null,
      account_id: budgetRes?.account_id ?? null,
      provider_key: budgetRes?.provider_key ?? null,
      feature_key: budgetRes?.feature_key ?? null,
      reservation_id: budgetRes?.id ?? null,
      actual_cost_cents: success ? actual_cost_cents : 0,
      estimated_cost_cents: budgetRes?.estimated_cost_cents ?? 0,
      account_vendor_cost_cents: success ? actual_cost_cents : 0,
      duration_ms: duration_ms ?? null,
      cache_hit: cache_hit ?? false,
      provider_called: success,
      success,
      error_code: error_code ?? null,
      response_metadata: response_metadata ?? null,
    }).then(({ error }) => {
      if (error) console.error(`[ProviderGateway] Usage event write: ${error.message}`)
    })
  }

  // Release all stale reservations (e.g. in a cron job or background cleanup).
  async expireStaleReservations(): Promise<{ budget: number; credit: number }> {
    const now = new Date().toISOString()

    const { data: budgetExpired } = await serviceClient
      .from('api_budget_reservations')
      .update({ status: 'expired', updated_at: now })
      .eq('status', 'reserved')
      .lt('expires_at', now)
      .select('id')

    const { data: creditExpired } = await serviceClient
      .from('credit_reservations')
      .update({ status: 'expired', updated_at: now })
      .eq('status', 'reserved')
      .lt('expires_at', now)
      .select('id, account_id, reserved_credits')

    // Release locked credits for expired reservations
    for (const res of (creditExpired ?? [])) {
      await serviceClient.rpc('fn_adjust_reserved_credits', {
        p_account_id: res.account_id,
        p_delta: -res.reserved_credits,
      })
    }

    return {
      budget: budgetExpired?.length ?? 0,
      credit: creditExpired?.length ?? 0,
    }
  }
}

export const providerGateway = new ProviderGateway()
