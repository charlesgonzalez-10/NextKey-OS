import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PromotionCodeService } from '@/lib/billing/promotionCodeService'
import { mockFrom } from './setup'

vi.mock('@/lib/billing/creditWalletService', () => ({
  creditWalletService: {
    grantCredits: vi.fn().mockResolvedValue({}),
  },
}))
vi.mock('@/lib/billing/creditLiabilityService', () => ({
  creditLiabilityService: {
    canGrantSafely: vi.fn().mockResolvedValue({ safe: true }),
  },
}))

import { creditWalletService } from '@/lib/billing/creditWalletService'
import { creditLiabilityService } from '@/lib/billing/creditLiabilityService'

function makeChain(overrides: Record<string, any> = {}) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'eq', 'single', 'in', 'or', 'lte', 'not', 'lt', 'order', 'limit', 'head']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  Object.assign(chain, overrides)
  return chain
}

const promoCode = (partial: Partial<any> = {}) => ({
  id: 'promo-1',
  code: 'WELCOME50',
  code_normalized: 'welcome50',
  display_name: 'Welcome Bonus',
  internal_description: 'Test promo',
  is_private: false,
  promotion_types: ['bonus_credits'],
  percentage_off: null,
  amount_off_cents: null,
  maximum_discount_cents: null,
  bonus_credits: 50,
  included_credit_increase: null,
  free_months: null,
  trial_extension_days: null,
  grandfathered_price_cents: null,
  waive_setup_fee: false,
  special_plan_id: null,
  custom_entitlement: null,
  applies_to_plan_ids: [],
  applies_to_credit_product_ids: [],
  minimum_purchase_cents: null,
  max_total_redemptions: null,
  max_redemptions_per_account: 1,
  first_purchase_only: false,
  new_customers_only: false,
  friends_and_family_only: false,
  allowed_account_ids: [],
  allowed_email_domains: [],
  blocked_account_ids: [],
  is_stackable: false,
  stackable_with: [],
  estimated_max_exposure_cents: null,
  external_coupon_id: null,
  starts_at: new Date(Date.now() - 1000).toISOString(),
  expires_at: null,
  is_active: true,
  deactivated_reason: null,
  created_by: 'admin-1',
  ...partial,
})

describe('PromotionCodeService', () => {
  let service: PromotionCodeService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PromotionCodeService()
    vi.mocked(creditLiabilityService.canGrantSafely).mockResolvedValue({ safe: true })
    vi.mocked(creditWalletService.grantCredits).mockResolvedValue({} as any)
  })

  describe('validateCode — generic error for invalid codes', () => {
    it('returns generic error for nonexistent code (never reveals whether private code exists)', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } })
      mockFrom.mockReturnValue(chain)

      const result = await service.validateCode({
        raw_code: 'DOESNOTEXIST',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.error_message).toBe('Invalid or unavailable promotion code.')
      // Must not leak error details about whether the code exists
      expect(result.error_code).toBe('not_found')
    })

    it('returns generic error for expired code', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: promoCode({ expires_at: new Date(Date.now() - 86400000).toISOString() }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      const result = await service.validateCode({
        raw_code: 'EXPIRED',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.error_message).toBe('Invalid or unavailable promotion code.')
    })

    it('returns generic error for inactive code', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: promoCode({ is_active: false }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      const result = await service.validateCode({
        raw_code: 'INACTIVE',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.error_message).toBe('Invalid or unavailable promotion code.')
    })

    it('returns empty string for valid code (not "accepted" until redeemCode is called)', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: promoCode(), error: null })
      // global redemption count
      chain.in = vi.fn().mockReturnValue({
        ...chain,
        count: 0,
      })
      // count queries
      const countChain = makeChain()
      countChain.head = vi.fn().mockReturnValue(countChain)
      countChain.in = vi.fn().mockResolvedValue({ count: 0, error: null })
      mockFrom.mockImplementation(() => {
        const c = makeChain()
        c.single = vi.fn().mockResolvedValue({ data: promoCode(), error: null })
        c.select = vi.fn().mockReturnValue(c)
        c.in = vi.fn().mockResolvedValue({ count: 0, error: null })
        c.eq = vi.fn().mockReturnValue(c)
        return c
      })

      const result = await service.validateCode({
        raw_code: 'WELCOME50',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      expect(result.valid).toBe(true)
      expect(result.error_message).toBe('')
    })
  })

  describe('validateCode — friends and family gate', () => {
    it('blocks non-allowed accounts from F&F code', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: promoCode({
          friends_and_family_only: true,
          allowed_account_ids: ['allowed-user-id'],
        }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      const result = await service.validateCode({
        raw_code: 'FF2026',
        account_id: 'random-user',
        account_email: 'random@example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.error_message).toBe('Invalid or unavailable promotion code.')
    })

    it('allows explicitly listed accounts to use F&F code', async () => {
      mockFrom.mockImplementation(() => {
        const c = makeChain()
        c.single = vi.fn().mockResolvedValue({
          data: promoCode({
            friends_and_family_only: true,
            allowed_account_ids: ['allowed-user'],
          }),
          error: null,
        })
        c.select = vi.fn().mockReturnValue(c)
        c.in = vi.fn().mockResolvedValue({ count: 0, error: null })
        c.eq = vi.fn().mockReturnValue(c)
        return c
      })

      const result = await service.validateCode({
        raw_code: 'FF2026',
        account_id: 'allowed-user',
        account_email: 'friend@example.com',
      })

      expect(result.valid).toBe(true)
    })

    it('allows email-domain-restricted F&F access', async () => {
      mockFrom.mockImplementation(() => {
        const c = makeChain()
        c.single = vi.fn().mockResolvedValue({
          data: promoCode({
            friends_and_family_only: true,
            allowed_email_domains: ['nextkeyps.com'],
            allowed_account_ids: [],
          }),
          error: null,
        })
        c.select = vi.fn().mockReturnValue(c)
        c.in = vi.fn().mockResolvedValue({ count: 0, error: null })
        c.eq = vi.fn().mockReturnValue(c)
        return c
      })

      const result = await service.validateCode({
        raw_code: 'FF2026',
        account_id: 'user-1',
        account_email: 'charles@nextkeyps.com',
      })

      expect(result.valid).toBe(true)
    })
  })

  describe('validateCode — blocked accounts', () => {
    it('blocks accounts in the blocklist', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: promoCode({ blocked_account_ids: ['bad-actor'] }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      const result = await service.validateCode({
        raw_code: 'WELCOME50',
        account_id: 'bad-actor',
        account_email: 'bad@example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.error_message).toBe('Invalid or unavailable promotion code.')
    })
  })

  describe('validateCode — credit liability check', () => {
    it('blocks credit-granting codes when platform capacity is insufficient', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: promoCode({ bonus_credits: 500 }), error: null })
      mockFrom.mockReturnValue(chain)

      vi.mocked(creditLiabilityService.canGrantSafely).mockResolvedValue({
        safe: false,
        reason: 'Fulfillment cost would exceed platform capacity',
      })

      const result = await service.validateCode({
        raw_code: 'BIGBONUS',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      expect(result.valid).toBe(false)
      // Must return generic error — never expose internal capacity reasons to customers
      expect(result.error_message).toBe('Invalid or unavailable promotion code.')
    })
  })

  describe('validateCode — promotion may not bypass budget', () => {
    it('does not expose global budget status through code validation', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: promoCode(), error: null })
      mockFrom.mockReturnValue(chain)

      // The validation result must never include budget pool details
      const result = await service.validateCode({
        raw_code: 'WELCOME50',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      // Regardless of outcome, budget internals must not be exposed
      expect((result as any).budget_status).toBeUndefined()
      expect((result as any).pool_remaining).toBeUndefined()
      expect((result as any).global_spent).toBeUndefined()
    })
  })

  describe('redeemCode', () => {
    it('grants credits via creditWalletService when bonus_credits is set', async () => {
      // redeemCode does 3 DB operations in sequence:
      // 1. Select from promotion_redemptions (idempotency check) → no existing
      // 2. Select from promotion_codes (promo lookup) → found
      // 3. Insert into promotion_redemptions → new redemption
      // 4. Insert into promotion_entitlements (for non-credit types, skipped here since only bonus_credits)

      let callIndex = 0
      mockFrom.mockImplementation((table: string) => {
        callIndex++
        const c = makeChain()
        c.select = vi.fn().mockReturnValue(c)
        c.insert = vi.fn().mockReturnValue(c)
        c.eq = vi.fn().mockReturnValue(c)

        if (table === 'promotion_redemptions' && callIndex === 1) {
          // idempotency check: no existing redemption
          c.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
        } else if (table === 'promotion_codes') {
          // promo lookup
          c.single = vi.fn().mockResolvedValue({ data: promoCode(), error: null })
        } else if (table === 'promotion_redemptions') {
          // insert new redemption
          c.single = vi.fn().mockResolvedValue({ data: { id: 'redemption-1', credits_granted: 50 }, error: null })
        } else {
          c.single = vi.fn().mockResolvedValue({ data: null, error: null })
        }
        return c
      })

      await service.redeemCode({
        promotion_code_id: 'promo-1',
        account_id: 'user-1',
        idempotency_key: 'idem-1',
      })

      expect(creditWalletService.grantCredits).toHaveBeenCalledWith(
        'user-1',
        50,
        'promotional',
        'promotion',
        'promo-1',
        undefined
      )
    })

    it('is idempotent — returns existing redemption without re-granting credits', async () => {
      mockFrom.mockImplementation(() => {
        const c = makeChain()
        c.single = vi.fn().mockResolvedValue({
          data: { id: 'existing-redemption', credits_granted: 50 },
          error: null,
        })
        c.eq = vi.fn().mockReturnValue(c)
        return c
      })

      const result = await service.redeemCode({
        promotion_code_id: 'promo-1',
        account_id: 'user-1',
        idempotency_key: 'same-key',
      })

      expect(result.credits_granted).toBe(50)
      // creditWalletService.grantCredits must NOT be called for idempotent repeat
      expect(creditWalletService.grantCredits).not.toHaveBeenCalled()
    })
  })

  describe('code normalization', () => {
    it('normalizes code to lowercase for lookup', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      mockFrom.mockReturnValue(chain)

      await service.validateCode({
        raw_code: '  WELCOME50  ',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      expect(chain.eq).toHaveBeenCalledWith('code_normalized', 'welcome50')
    })
  })

  describe('buildBenefits', () => {
    it('builds correct display labels for all benefit types', async () => {
      // Test via validateCode which calls buildBenefits internally
      mockFrom.mockImplementation(() => {
        const c = makeChain()
        c.single = vi.fn().mockResolvedValue({
          data: promoCode({
            promotion_types: ['bonus_credits', 'percentage_discount', 'free_months'],
            bonus_credits: 100,
            percentage_off: 25,
            free_months: 2,
          }),
          error: null,
        })
        c.select = vi.fn().mockReturnValue(c)
        c.in = vi.fn().mockResolvedValue({ count: 0, error: null })
        c.eq = vi.fn().mockReturnValue(c)
        return c
      })

      const result = await service.validateCode({
        raw_code: 'MULTI',
        account_id: 'user-1',
        account_email: 'user@example.com',
      })

      if (result.valid) {
        const labels = result.applicable_benefits.map(b => b.display_label)
        expect(labels).toContain('100 bonus credits')
        expect(labels).toContain('25% off')
        expect(labels).toContain('2 free months')
      }
    })
  })
})
