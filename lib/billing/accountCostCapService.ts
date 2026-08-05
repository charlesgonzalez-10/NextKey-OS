import { serviceClient } from '@/lib/supabase-service'
import type { AccountVendorCostCap } from './types'

export class AccountCostCapService {

  async getCap(account_id: string): Promise<AccountVendorCostCap | null> {
    const { data, error } = await serviceClient
      .from('account_vendor_cost_caps')
      .select('*')
      .eq('account_id', account_id)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`AccountCostCapService.getCap: ${error.message}`)
    }
    return data as AccountVendorCostCap | null
  }

  // Called during onboarding or first provider call for an account.
  async ensureCapExists(account_id: string): Promise<AccountVendorCostCap> {
    const existing = await this.getCap(account_id)
    if (existing) return existing

    // Look up the account's subscription plan for the default cap
    const { data: sub } = await serviceClient
      .from('account_subscriptions')
      .select('plan_id, subscription_plans(default_vendor_cost_cap_cents)')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .single()

    const plan = (sub?.subscription_plans as unknown) as { default_vendor_cost_cap_cents: number } | null
    const plan_default_cap_cents = plan?.default_vendor_cost_cap_cents ?? 0

    const now = new Date()
    const period_start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const period_end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    const { data, error } = await serviceClient
      .from('account_vendor_cost_caps')
      .insert({
        account_id,
        plan_default_cap_cents,
        period_start,
        period_end,
      })
      .select()
      .single()

    if (error) throw new Error(`AccountCostCapService.ensureCapExists: ${error.message}`)
    return data as AccountVendorCostCap
  }

  // Sync cap when a subscription plan changes (e.g. upgrade/downgrade).
  // Does NOT decrease the cap below what was already spent.
  async syncCapToSubscription(account_id: string): Promise<void> {
    const { data: sub } = await serviceClient
      .from('account_subscriptions')
      .select('plan_id, subscription_plans(default_vendor_cost_cap_cents)')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .single()

    const plan = (sub?.subscription_plans as unknown) as { default_vendor_cost_cap_cents: number } | null
    if (!plan) return

    const { error } = await serviceClient
      .from('account_vendor_cost_caps')
      .update({
        plan_default_cap_cents: plan.default_vendor_cost_cap_cents,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', account_id)

    if (error) throw new Error(`AccountCostCapService.syncCapToSubscription: ${error.message}`)
  }

  // Admin: set an override cap for a specific account.
  // Purchased credits do NOT automatically trigger this — only explicit admin action.
  async setOverrideCap(
    account_id: string,
    override_cap_cents: number,
    reason: string,
    granted_by: string
  ): Promise<void> {
    const { error } = await serviceClient
      .from('account_vendor_cost_caps')
      .update({
        override_cap_cents,
        override_reason: reason,
        override_granted_by: granted_by,
        override_granted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', account_id)

    if (error) throw new Error(`AccountCostCapService.setOverrideCap: ${error.message}`)
  }

  async clearOverrideCap(account_id: string): Promise<void> {
    const { error } = await serviceClient
      .from('account_vendor_cost_caps')
      .update({
        override_cap_cents: null,
        override_reason: null,
        override_granted_by: null,
        override_granted_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', account_id)

    if (error) throw new Error(`AccountCostCapService.clearOverrideCap: ${error.message}`)
  }

  async getUtilizationPct(account_id: string): Promise<number> {
    const cap = await this.getCap(account_id)
    if (!cap || cap.effective_cap_cents === 0) return 100
    return Math.round((cap.spent_this_period_cents / cap.effective_cap_cents) * 100)
  }

  // Called at the start of each billing period to reset counters.
  async resetPeriod(account_id: string): Promise<void> {
    const now = new Date()
    const period_start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const period_end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    const { error } = await serviceClient
      .from('account_vendor_cost_caps')
      .update({
        spent_this_period_cents: 0,
        period_start,
        period_end,
        updated_at: now.toISOString(),
      })
      .eq('account_id', account_id)

    if (error) throw new Error(`AccountCostCapService.resetPeriod: ${error.message}`)
  }

  async getCapsByUtilization(threshold_pct: number = 80): Promise<AccountVendorCostCap[]> {
    const { data, error } = await serviceClient
      .from('account_vendor_cost_caps')
      .select('*')

    if (error) throw new Error(`AccountCostCapService.getCapsByUtilization: ${error.message}`)

    return (data as AccountVendorCostCap[]).filter(cap => {
      if (cap.effective_cap_cents === 0) return false
      const pct = (cap.spent_this_period_cents / cap.effective_cap_cents) * 100
      return pct >= threshold_pct
    })
  }
}

export const accountCostCapService = new AccountCostCapService()
