import { serviceClient } from '@/lib/supabase-service'
import type {
  SubscriptionPlan,
  AccountSubscription,
  CustomerSubscriptionResponse,
} from './types'
import { creditWalletService } from './creditWalletService'
import { accountCostCapService } from './accountCostCapService'

export class SubscriptionPlanService {

  async getPlans(include_private: boolean = false): Promise<SubscriptionPlan[]> {
    let query = serviceClient
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)

    if (!include_private) query = query.eq('is_public', true)
    query = query.order('monthly_price_cents', { ascending: true, nullsFirst: true })

    const { data, error } = await query
    if (error) throw new Error(`SubscriptionPlanService.getPlans: ${error.message}`)
    return data as SubscriptionPlan[]
  }

  async getPlan(plan_key: string): Promise<SubscriptionPlan | null> {
    const { data, error } = await serviceClient
      .from('subscription_plans')
      .select('*')
      .eq('plan_key', plan_key)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`SubscriptionPlanService.getPlan: ${error.message}`)
    }
    return data as SubscriptionPlan | null
  }

  async getActiveSubscription(account_id: string): Promise<AccountSubscription | null> {
    const { data, error } = await serviceClient
      .from('account_subscriptions')
      .select('*')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`SubscriptionPlanService.getActiveSubscription: ${error.message}`)
    }
    return data as AccountSubscription | null
  }

  async getSubscriptionWithPlan(account_id: string): Promise<{
    subscription: AccountSubscription
    plan: SubscriptionPlan
  } | null> {
    const { data, error } = await serviceClient
      .from('account_subscriptions')
      .select('*, subscription_plans(*)')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`SubscriptionPlanService.getSubscriptionWithPlan: ${error.message}`)
    }
    if (!data) return null

    return {
      subscription: data as AccountSubscription,
      plan: data.subscription_plans as unknown as SubscriptionPlan,
    }
  }

  // Called by webhook handler only — never from client-side.
  // Grants monthly credits and syncs cost cap for the new billing period.
  async activateSubscription(params: {
    account_id: string
    plan_id: string
    payment_provider: string
    external_customer_id: string
    external_subscription_id: string
    billing_period_start: string
    billing_period_end: string
  }): Promise<AccountSubscription> {
    // Deactivate any existing subscription first
    await serviceClient
      .from('account_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('account_id', params.account_id)
      .eq('status', 'active')

    const { data, error } = await serviceClient
      .from('account_subscriptions')
      .insert({
        account_id: params.account_id,
        plan_id: params.plan_id,
        status: 'active',
        payment_provider: params.payment_provider,
        external_customer_id: params.external_customer_id,
        external_subscription_id: params.external_subscription_id,
        billing_period_start: params.billing_period_start,
        billing_period_end: params.billing_period_end,
      })
      .select()
      .single()

    if (error) throw new Error(`SubscriptionPlanService.activateSubscription: ${error.message}`)

    const sub = data as AccountSubscription

    // Sync cost cap to new plan
    await accountCostCapService.syncCapToSubscription(params.account_id)

    // Grant monthly credits for the new period
    const plan = await this.getPlanById(params.plan_id)
    if (plan && plan.included_monthly_credits > 0) {
      await creditWalletService.ensureWalletExists(params.account_id)
      await creditWalletService.grantCredits(
        params.account_id,
        plan.included_monthly_credits,
        'monthly',
        'subscription',
        sub.id,
        params.billing_period_end
      )
    }

    return sub
  }

  async renewMonthlyCredits(account_id: string): Promise<void> {
    const result = await this.getSubscriptionWithPlan(account_id)
    if (!result) return

    const { plan, subscription } = result
    if (plan.included_monthly_credits <= 0) return

    const billing_period_end = subscription.billing_period_end ?? undefined

    await creditWalletService.grantCredits(
      account_id,
      plan.included_monthly_credits,
      'monthly',
      'subscription',
      subscription.id,
      billing_period_end
    )
  }

  async cancelSubscription(account_id: string, at_period_end: boolean): Promise<void> {
    if (at_period_end) {
      const { error } = await serviceClient
        .from('account_subscriptions')
        .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
        .eq('account_id', account_id)
        .eq('status', 'active')
      if (error) throw new Error(`SubscriptionPlanService.cancelSubscription: ${error.message}`)
    } else {
      const { error } = await serviceClient
        .from('account_subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', account_id)
        .eq('status', 'active')
      if (error) throw new Error(`SubscriptionPlanService.cancelSubscription: ${error.message}`)
    }
  }

  toCustomerResponse(
    subscription: AccountSubscription,
    plan: SubscriptionPlan
  ): CustomerSubscriptionResponse {
    return {
      plan_key: plan.plan_key,
      plan_name: plan.display_name,
      status: subscription.status,
      included_monthly_credits: plan.included_monthly_credits,
      billing_period_end: subscription.billing_period_end,
      can_buy_credit_packs: plan.can_buy_credit_packs,
    }
  }

  async getPlanById(plan_id: string): Promise<SubscriptionPlan | null> {
    const { data, error } = await serviceClient
      .from('subscription_plans')
      .select('*')
      .eq('id', plan_id)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`SubscriptionPlanService.getPlanById: ${error.message}`)
    }
    return data as SubscriptionPlan | null
  }

  /** Look up a plan by its Stripe price ID (used in webhook handler) */
  async getPlanByPriceId(priceId: string): Promise<SubscriptionPlan | null> {
    const { data, error } = await serviceClient
      .from('subscription_plans')
      .select('*')
      .or(`external_price_id_monthly.eq.${priceId},external_price_id_annual.eq.${priceId}`)
      .maybeSingle()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`SubscriptionPlanService.getPlanByPriceId: ${error.message}`)
    }
    return data as SubscriptionPlan | null
  }
}

export const subscriptionPlanService = new SubscriptionPlanService()
