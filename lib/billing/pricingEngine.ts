// PricingEngine: reads versioned feature pricing, exposes admin profitability estimates,
// and calculates the credit cost for any feature call.
//
// Responsibilities: pricing reads, margin calculations, cost estimates.
// NOT responsible for authorization — that is providerGateway + fn_reserve_budget_and_credits.

import { serviceClient } from '@/lib/supabase-service'
import type { FeaturePricingVersion, PricingEstimateAdmin } from './types'

export class PricingEngine {

  async getActivePricing(feature_key: string): Promise<FeaturePricingVersion | null> {
    const { data, error } = await serviceClient
      .from('feature_pricing_versions')
      .select('*')
      .eq('feature_key', feature_key)
      .eq('is_active', true)
      .lte('effective_from', new Date().toISOString())
      .or('effective_to.is.null,effective_to.gt.' + new Date().toISOString())
      .order('effective_from', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`PricingEngine.getActivePricing: ${error.message}`)
    }
    return data as FeaturePricingVersion | null
  }

  async getAllActivePricing(): Promise<FeaturePricingVersion[]> {
    const now = new Date().toISOString()
    const { data, error } = await serviceClient
      .from('feature_pricing_versions')
      .select('*')
      .eq('is_active', true)
      .lte('effective_from', now)
      .or(`effective_to.is.null,effective_to.gt.${now}`)
      .order('feature_key', { ascending: true })
      .order('effective_from', { ascending: false })

    if (error) throw new Error(`PricingEngine.getAllActivePricing: ${error.message}`)
    return data as FeaturePricingVersion[]
  }

  // Credit cost that will be charged to the customer for a given feature call.
  async getCreditCost(feature_key: string): Promise<number> {
    const pricing = await this.getActivePricing(feature_key)
    return pricing?.customer_credit_cost ?? 0
  }

  // Estimated vendor cost in cents for a given feature call.
  // Used by providerGateway to populate budget reservation estimates.
  async getVendorCostEstimate(feature_key: string): Promise<number> {
    const pricing = await this.getActivePricing(feature_key)
    return pricing?.expected_vendor_cost_cents ?? 0
  }

  // Admin-facing profitability estimate.
  async getProfitabilityEstimate(feature_key: string): Promise<PricingEstimateAdmin | null> {
    const pricing = await this.getActivePricing(feature_key)
    if (!pricing) return null

    const total_cost_cents =
      pricing.expected_vendor_cost_cents +
      pricing.platform_overhead_cents +
      pricing.risk_buffer_cents

    // Implied credit value: what one credit is worth in cents
    // If 5 credits costs the customer ~$0.25 (implied), credit_value = 5¢ each
    // We don't have a public credit price yet (Phase D), so we use vendor cost / credit_cost as a proxy
    const implied_credit_value_cents =
      pricing.customer_credit_cost > 0
        ? total_cost_cents / pricing.customer_credit_cost
        : 0

    const revenue_equivalent_cents =
      pricing.customer_credit_cost * implied_credit_value_cents

    const estimated_margin_pct =
      revenue_equivalent_cents > 0 && total_cost_cents > 0
        ? Math.round(((revenue_equivalent_cents - total_cost_cents) / revenue_equivalent_cents) * 100)
        : null

    return {
      feature_key: pricing.feature_key,
      display_name: pricing.display_name,
      provider_key: pricing.provider_key,
      expected_vendor_cost_cents: pricing.expected_vendor_cost_cents,
      overhead_cents: pricing.platform_overhead_cents + pricing.risk_buffer_cents,
      risk_buffer_cents: pricing.risk_buffer_cents,
      total_cost_cents,
      customer_credit_cost: pricing.customer_credit_cost,
      implied_credit_value_cents,
      estimated_margin_pct,
      is_enabled: pricing.is_enabled,
    }
  }

  async getAllProfitabilityEstimates(): Promise<PricingEstimateAdmin[]> {
    const all = await this.getAllActivePricing()
    return Promise.all(
      all.map(async p => {
        const est = await this.getProfitabilityEstimate(p.feature_key)
        return est!
      })
    ).then(results => results.filter(Boolean))
  }

  // Create a new pricing version (admin).
  // Features with requires_confirmed_cost = true cannot be enabled without a confirmed vendor cost.
  async createPricingVersion(params: {
    feature_key: string
    display_name: string
    provider_key?: string
    expected_vendor_cost_cents: number
    platform_overhead_cents?: number
    risk_buffer_cents?: number
    customer_credit_cost: number
    is_enabled: boolean
    disable_reason?: string
    requires_confirmed_cost?: boolean
    effective_from?: string
  }): Promise<FeaturePricingVersion> {
    if (params.is_enabled && params.expected_vendor_cost_cents === 0 && params.requires_confirmed_cost !== false) {
      throw new Error(
        `Cannot enable feature '${params.feature_key}' with unknown vendor cost. ` +
        'Set requires_confirmed_cost=false explicitly only when the feature is genuinely free.'
      )
    }

    // Deactivate any existing active versions for this feature
    await serviceClient
      .from('feature_pricing_versions')
      .update({ is_active: false, effective_to: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('feature_key', params.feature_key)
      .eq('is_active', true)

    const { data, error } = await serviceClient
      .from('feature_pricing_versions')
      .insert({
        feature_key: params.feature_key,
        display_name: params.display_name,
        provider_key: params.provider_key ?? null,
        expected_vendor_cost_cents: params.expected_vendor_cost_cents,
        platform_overhead_cents: params.platform_overhead_cents ?? 0,
        risk_buffer_cents: params.risk_buffer_cents ?? 0,
        customer_credit_cost: params.customer_credit_cost,
        is_enabled: params.is_enabled,
        disable_reason: params.disable_reason ?? null,
        requires_confirmed_cost: params.requires_confirmed_cost ?? true,
        effective_from: params.effective_from ?? new Date().toISOString(),
        is_active: true,
      })
      .select()
      .single()

    if (error) throw new Error(`PricingEngine.createPricingVersion: ${error.message}`)
    return data as FeaturePricingVersion
  }

  // Toggle enable/disable for a feature (kill switch).
  async setFeatureEnabled(
    feature_key: string,
    enabled: boolean,
    reason?: string
  ): Promise<void> {
    const { error } = await serviceClient
      .from('feature_pricing_versions')
      .update({
        is_enabled: enabled,
        disable_reason: enabled ? null : (reason ?? 'Disabled by admin'),
        updated_at: new Date().toISOString(),
      })
      .eq('feature_key', feature_key)
      .eq('is_active', true)

    if (error) throw new Error(`PricingEngine.setFeatureEnabled: ${error.message}`)
  }
}

export const pricingEngine = new PricingEngine()
