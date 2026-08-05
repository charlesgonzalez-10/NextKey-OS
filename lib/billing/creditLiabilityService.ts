// CreditLiabilityService: tracks the platform's outstanding credit fulfillment obligation.
//
// "Outstanding credits" = all active credits that customers can spend but haven't yet.
// Each unspent credit has an implied fulfillment cost when eventually consumed.
// This metric answers: "Can we actually cover what we've promised?"

import { serviceClient } from '@/lib/supabase-service'
import type { CreditLiabilityReport } from './types'
import { pricingEngine } from './pricingEngine'
import { apiBudgetService } from './apiBudgetService'

export class CreditLiabilityService {

  // Average vendor cost per credit across all enabled features.
  // Used to estimate the total fulfillment cost of outstanding credits.
  private async computeAvgCostPerCredit(): Promise<number> {
    const pricingVersions = await pricingEngine.getAllActivePricing()

    const enabled = pricingVersions.filter(
      p => p.is_enabled && p.customer_credit_cost > 0
    )

    if (enabled.length === 0) return 0

    const totalCostPerCredit = enabled.reduce((sum, p) => {
      const costPerCredit =
        (p.expected_vendor_cost_cents + p.platform_overhead_cents + p.risk_buffer_cents) /
        p.customer_credit_cost
      return sum + costPerCredit
    }, 0)

    return totalCostPerCredit / enabled.length
  }

  async computeLiability(): Promise<CreditLiabilityReport> {
    // Sum all active credits across all wallets
    const { data: wallets, error } = await serviceClient
      .from('credit_wallets')
      .select(
        'available_monthly_credits, available_purchased_credits, available_bonus_credits, reserved_credits'
      )
      .eq('status', 'active')

    if (error) throw new Error(`CreditLiabilityService.computeLiability: ${error.message}`)

    const total_outstanding_credits = (wallets ?? []).reduce((sum, w) => {
      return (
        sum +
        w.available_monthly_credits +
        w.available_purchased_credits +
        w.available_bonus_credits -
        w.reserved_credits
      )
    }, 0)

    const avg_cost_per_credit = await this.computeAvgCostPerCredit()
    const estimated_fulfillment_cost_cents = Math.ceil(
      total_outstanding_credits * avg_cost_per_credit
    )

    const budgetStatus = await apiBudgetService.getBudgetStatus()
    const platform_remaining_capacity_cents = budgetStatus.global_available_cents

    const coverage_ratio =
      estimated_fulfillment_cost_cents > 0
        ? platform_remaining_capacity_cents / estimated_fulfillment_cost_cents
        : Infinity

    let risk_level: CreditLiabilityReport['risk_level']
    if (coverage_ratio >= 3) risk_level = 'low'
    else if (coverage_ratio >= 1.5) risk_level = 'medium'
    else if (coverage_ratio >= 1) risk_level = 'high'
    else risk_level = 'critical'

    return {
      total_outstanding_credits,
      estimated_fulfillment_cost_cents,
      platform_remaining_capacity_cents,
      coverage_ratio: isFinite(coverage_ratio) ? coverage_ratio : 999,
      risk_level,
      calculated_at: new Date().toISOString(),
    }
  }

  // Returns true if the platform can safely grant `credit_amount` more credits
  // without pushing the liability into a critical state.
  async canGrantSafely(credit_amount: number): Promise<{ safe: boolean; reason?: string }> {
    const liability = await this.computeLiability()
    const avg_cost = await this.computeAvgCostPerCredit()

    const new_cost = Math.ceil(credit_amount * avg_cost)
    const projected_fulfillment =
      liability.estimated_fulfillment_cost_cents + new_cost

    const projected_ratio =
      projected_fulfillment > 0
        ? liability.platform_remaining_capacity_cents / projected_fulfillment
        : 999

    if (projected_ratio < 1) {
      return {
        safe: false,
        reason:
          `Granting ${credit_amount} credits would push estimated fulfillment cost ` +
          `(${projected_fulfillment}¢) above remaining platform capacity ` +
          `(${liability.platform_remaining_capacity_cents}¢).`,
      }
    }

    return { safe: true }
  }
}

export const creditLiabilityService = new CreditLiabilityService()
