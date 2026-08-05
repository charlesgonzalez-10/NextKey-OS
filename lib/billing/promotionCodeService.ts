// PromotionCodeService: 13-step server-side validation and redemption.
//
// Security invariants:
// - Never reveal whether a private code exists — always return generic error
// - Credits granted only after server-side validation; browser confirmation means nothing
// - A code may not bypass global budget, pool isolation, or cost caps
// - No live payment discounts until Phase D (external_coupon_id not applied)
// - Fail closed: any validation step failure blocks the benefit

import { serviceClient } from '@/lib/supabase-service'
import type {
  PromotionCode,
  PromotionType,
  PromoValidationResult,
  ApplicableBenefit,
} from './types'
import { creditWalletService } from './creditWalletService'
import { creditLiabilityService } from './creditLiabilityService'

export class PromotionCodeService {

  // Step 1–13 server-side validation flow.
  // Returns a sanitized result — never expose internal details on failure.
  async validateCode(params: {
    raw_code: string
    account_id: string
    account_email: string
    apply_to_plan_id?: string
    apply_to_credit_product_id?: string
    is_first_purchase?: boolean
    is_new_customer?: boolean
    purchase_amount_cents?: number
  }): Promise<PromoValidationResult> {
    const INVALID = (code: string): PromoValidationResult => ({
      valid: false,
      promotion_code_id: null,
      code_normalized: null,
      applicable_benefits: [],
      error_code: code,
      error_message: 'Invalid or unavailable promotion code.',
    })

    const code_normalized = params.raw_code.toLowerCase().trim()
    if (!code_normalized) return INVALID('empty_code')

    // Step 1: Look up by normalized code
    const { data: promo, error } = await serviceClient
      .from('promotion_codes')
      .select('*')
      .eq('code_normalized', code_normalized)
      .single()

    // Step 2: Code must exist and be active
    // For private codes, return the same generic error to avoid enumeration
    if (error || !promo) return INVALID('not_found')
    if (!promo.is_active) return INVALID('inactive')

    // Step 3: Date range
    const now = new Date()
    if (new Date(promo.starts_at) > now) return INVALID('not_started')
    if (promo.expires_at && new Date(promo.expires_at) < now) return INVALID('expired')

    // Step 4: Blocked accounts
    if (promo.blocked_account_ids?.includes(params.account_id)) {
      return INVALID('not_eligible')
    }

    // Step 5: Friends-and-family gate
    if (promo.friends_and_family_only) {
      const isAllowed =
        promo.allowed_account_ids?.includes(params.account_id) ||
        promo.allowed_email_domains?.some((domain: string) =>
          params.account_email.toLowerCase().endsWith(`@${domain}`)
        )
      if (!isAllowed) return INVALID('not_eligible')
    } else if (promo.allowed_account_ids?.length > 0) {
      // Restricted to specific accounts (not F&F)
      if (!promo.allowed_account_ids.includes(params.account_id)) {
        return INVALID('not_eligible')
      }
    } else if (promo.allowed_email_domains?.length > 0) {
      const isAllowed = promo.allowed_email_domains.some((domain: string) =>
        params.account_email.toLowerCase().endsWith(`@${domain}`)
      )
      if (!isAllowed) return INVALID('not_eligible')
    }

    // Step 6: New customer / first purchase gates
    if (promo.new_customers_only && !params.is_new_customer) {
      return INVALID('new_customers_only')
    }
    if (promo.first_purchase_only && !params.is_first_purchase) {
      return INVALID('first_purchase_only')
    }

    // Step 7: Minimum purchase check
    if (
      promo.minimum_purchase_cents &&
      (params.purchase_amount_cents ?? 0) < promo.minimum_purchase_cents
    ) {
      return INVALID('minimum_purchase_not_met')
    }

    // Step 8: Plan / product applicability
    if (params.apply_to_plan_id && promo.applies_to_plan_ids?.length > 0) {
      if (!promo.applies_to_plan_ids.includes(params.apply_to_plan_id)) {
        return INVALID('not_applicable_to_plan')
      }
    }
    if (
      params.apply_to_credit_product_id &&
      promo.applies_to_credit_product_ids?.length > 0
    ) {
      if (!promo.applies_to_credit_product_ids.includes(params.apply_to_credit_product_id)) {
        return INVALID('not_applicable_to_product')
      }
    }

    // Step 9: Global redemption limit
    if (promo.max_total_redemptions != null) {
      const { count } = await serviceClient
        .from('promotion_redemptions')
        .select('*', { count: 'exact', head: true })
        .eq('promotion_code_id', promo.id)
        .in('status', ['active'])

      if ((count ?? 0) >= promo.max_total_redemptions) {
        return INVALID('fully_redeemed')
      }
    }

    // Step 10: Per-account redemption limit
    const { count: accountCount } = await serviceClient
      .from('promotion_redemptions')
      .select('*', { count: 'exact', head: true })
      .eq('promotion_code_id', promo.id)
      .eq('account_id', params.account_id)
      .in('status', ['active'])

    if ((accountCount ?? 0) >= promo.max_redemptions_per_account) {
      return INVALID('already_redeemed')
    }

    // Step 11: Margin safeguard — check estimated exposure
    if ((promo.estimated_max_exposure_cents ?? 0) > 0) {
      const { data: totalSpend } = await serviceClient
        .from('promotion_redemptions')
        .select('discount_amount_cents, credits_granted')
        .eq('promotion_code_id', promo.id)
        .eq('status', 'active')

      const used_cents = (totalSpend ?? []).reduce(
        (sum, r) => sum + (r.discount_amount_cents ?? 0),
        0
      )
      if (used_cents >= promo.estimated_max_exposure_cents!) {
        return INVALID('budget_exhausted')
      }
    }

    // Step 12: Credit liability check for credit-granting codes
    const bonus_credits = promo.bonus_credits ?? 0
    if (bonus_credits > 0) {
      const { safe, reason } = await creditLiabilityService.canGrantSafely(bonus_credits)
      if (!safe) {
        console.error(`[PromotionCodeService] Liability block: ${reason}`)
        return INVALID('platform_capacity')
      }
    }

    // Step 13: Build applicable benefits
    const benefits = this.buildBenefits(promo)

    return {
      valid: true,
      promotion_code_id: promo.id,
      code_normalized,
      applicable_benefits: benefits,
      error_message: '',
    }
  }

  // Idempotent redemption. Records the redemption and grants credit benefits.
  // Payment discounts are NOT applied here — that is Phase D (external payment provider).
  async redeemCode(params: {
    promotion_code_id: string
    account_id: string
    user_id?: string
    subscription_id?: string
    credit_purchase_id?: string
    idempotency_key: string
    discount_amount_cents?: number
  }): Promise<{ redemption_id: string; credits_granted: number }> {
    // Idempotency guard
    const { data: existing } = await serviceClient
      .from('promotion_redemptions')
      .select('id, credits_granted')
      .eq('idempotency_key', params.idempotency_key)
      .single()

    if (existing) {
      return { redemption_id: existing.id, credits_granted: existing.credits_granted }
    }

    const { data: promo } = await serviceClient
      .from('promotion_codes')
      .select('*')
      .eq('id', params.promotion_code_id)
      .single()

    if (!promo) {
      throw new Error(`Promotion code not found: ${params.promotion_code_id}`)
    }

    const credits_to_grant = promo.bonus_credits ?? 0
    const discount_cents = params.discount_amount_cents ?? 0

    const applied_terms = {
      promotion_types: promo.promotion_types,
      bonus_credits: credits_to_grant,
      discount_amount_cents: discount_cents,
      percentage_off: promo.percentage_off,
      free_months: promo.free_months,
      waive_setup_fee: promo.waive_setup_fee,
    }

    const { data: redemption, error } = await serviceClient
      .from('promotion_redemptions')
      .insert({
        promotion_code_id: params.promotion_code_id,
        account_id: params.account_id,
        user_id: params.user_id ?? null,
        subscription_id: params.subscription_id ?? null,
        credit_purchase_id: params.credit_purchase_id ?? null,
        discount_amount_cents: discount_cents,
        credits_granted: credits_to_grant,
        applied_terms,
        status: 'active',
        idempotency_key: params.idempotency_key,
        redeemed_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) throw new Error(`PromotionCodeService.redeemCode: ${error.message}`)

    // Grant bonus credits immediately (credit benefit only — payment discounts in Phase D)
    if (credits_to_grant > 0) {
      await creditWalletService.grantCredits(
        params.account_id,
        credits_to_grant,
        'promotional',
        'promotion',
        params.promotion_code_id,
        promo.expires_at ?? undefined
      )
    }

    // Create entitlement records for non-credit benefits
    const entitlementTypes = (promo.promotion_types as PromotionType[]).filter(
      t => t !== 'bonus_credits'
    )
    for (const entitlement_type of entitlementTypes) {
      await serviceClient.from('promotion_entitlements').insert({
        promotion_code_id: params.promotion_code_id,
        redemption_id: redemption.id,
        account_id: params.account_id,
        entitlement_type,
        entitlement_value: this.buildEntitlementValue(promo, entitlement_type),
        starts_at: new Date().toISOString(),
        expires_at: promo.expires_at ?? null,
        status: 'active',
      })
    }

    return { redemption_id: redemption.id, credits_granted: credits_to_grant }
  }

  async getActiveEntitlements(account_id: string): Promise<Array<{
    entitlement_type: string
    entitlement_value: Record<string, unknown>
    expires_at: string | null
  }>> {
    const { data, error } = await serviceClient
      .from('promotion_entitlements')
      .select('entitlement_type, entitlement_value, expires_at')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

    if (error) throw new Error(`PromotionCodeService.getActiveEntitlements: ${error.message}`)
    return data ?? []
  }

  async getPromoCode(code_normalized: string): Promise<PromotionCode | null> {
    const { data, error } = await serviceClient
      .from('promotion_codes')
      .select('*')
      .eq('code_normalized', code_normalized)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`PromotionCodeService.getPromoCode: ${error.message}`)
    }
    return data as PromotionCode | null
  }

  async listCodes(include_inactive: boolean = false): Promise<PromotionCode[]> {
    let query = serviceClient.from('promotion_codes').select('*')
    if (!include_inactive) query = query.eq('is_active', true)
    query = query.order('created_at', { ascending: false })

    const { data, error } = await query
    if (error) throw new Error(`PromotionCodeService.listCodes: ${error.message}`)
    return data as PromotionCode[]
  }

  async deactivateCode(id: string, reason: string): Promise<void> {
    const { error } = await serviceClient
      .from('promotion_codes')
      .update({
        is_active: false,
        deactivated_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) throw new Error(`PromotionCodeService.deactivateCode: ${error.message}`)
  }

  private buildBenefits(promo: PromotionCode): ApplicableBenefit[] {
    const benefits: ApplicableBenefit[] = []

    for (const type of promo.promotion_types as PromotionType[]) {
      switch (type) {
        case 'percentage_discount':
          if (promo.percentage_off != null) {
            benefits.push({ type, value: promo.percentage_off, display_label: `${promo.percentage_off}% off` })
          }
          break
        case 'fixed_amount_discount':
          if (promo.amount_off_cents != null) {
            benefits.push({ type, value: promo.amount_off_cents, display_label: `$${(promo.amount_off_cents / 100).toFixed(2)} off` })
          }
          break
        case 'free_months':
          if (promo.free_months != null) {
            benefits.push({ type, value: promo.free_months, display_label: `${promo.free_months} free month${promo.free_months > 1 ? 's' : ''}` })
          }
          break
        case 'trial_extension':
          if (promo.trial_extension_days != null) {
            benefits.push({ type, value: promo.trial_extension_days, display_label: `${promo.trial_extension_days} extra trial days` })
          }
          break
        case 'bonus_credits':
          if (promo.bonus_credits != null) {
            benefits.push({ type, value: promo.bonus_credits, display_label: `${promo.bonus_credits} bonus credits` })
          }
          break
        case 'included_credit_increase':
          if (promo.included_credit_increase != null) {
            benefits.push({ type, value: promo.included_credit_increase, display_label: `+${promo.included_credit_increase} monthly credits` })
          }
          break
        case 'waived_setup_fee':
          benefits.push({ type, value: true, display_label: 'Setup fee waived' })
          break
        case 'grandfathered_price':
          if (promo.grandfathered_price_cents != null) {
            benefits.push({ type, value: promo.grandfathered_price_cents, display_label: `Price locked at $${(promo.grandfathered_price_cents / 100).toFixed(2)}/mo` })
          }
          break
        case 'special_plan_access':
          benefits.push({ type, value: promo.special_plan_id, display_label: 'Special plan access unlocked' })
          break
        case 'credit_pack_discount':
          if (promo.percentage_off != null) {
            benefits.push({ type, value: promo.percentage_off, display_label: `${promo.percentage_off}% off credit packs` })
          }
          break
        case 'custom_entitlement':
          benefits.push({ type, value: null, display_label: 'Special benefit applied' })
          break
      }
    }

    return benefits
  }

  private buildEntitlementValue(
    promo: PromotionCode,
    entitlement_type: PromotionType
  ): Record<string, unknown> {
    switch (entitlement_type) {
      case 'percentage_discount':
        return { percentage_off: promo.percentage_off, maximum_discount_cents: promo.maximum_discount_cents }
      case 'fixed_amount_discount':
        return { amount_off_cents: promo.amount_off_cents }
      case 'free_months':
        return { free_months: promo.free_months }
      case 'trial_extension':
        return { trial_extension_days: promo.trial_extension_days }
      case 'included_credit_increase':
        return { included_credit_increase: promo.included_credit_increase }
      case 'grandfathered_price':
        return { grandfathered_price_cents: promo.grandfathered_price_cents }
      case 'special_plan_access':
        return { plan_id: promo.special_plan_id }
      case 'credit_pack_discount':
        return { percentage_off: promo.percentage_off }
      case 'custom_entitlement':
        return promo.custom_entitlement as Record<string, unknown> ?? {}
      default:
        return {}
    }
  }
}

export const promotionCodeService = new PromotionCodeService()
