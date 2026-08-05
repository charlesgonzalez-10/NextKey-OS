import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderGateway } from '@/lib/billing/providerGateway'
import { mockFrom, mockRpc } from './setup'

// We also need to mock the pricingEngine and the account/wallet services
vi.mock('@/lib/billing/pricingEngine', () => ({
  pricingEngine: {
    getActivePricing: vi.fn(),
  },
}))
vi.mock('@/lib/billing/accountCostCapService', () => ({
  accountCostCapService: {
    ensureCapExists: vi.fn().mockResolvedValue({}),
  },
}))
vi.mock('@/lib/billing/creditWalletService', () => ({
  creditWalletService: {
    ensureWalletExists: vi.fn().mockResolvedValue({}),
  },
}))

import { pricingEngine } from '@/lib/billing/pricingEngine'
import { accountCostCapService } from '@/lib/billing/accountCostCapService'
import { creditWalletService } from '@/lib/billing/creditWalletService'

const pricing = (partial: Partial<any> = {}) => ({
  feature_key: 'property_lookup_basic',
  provider_key: 'reapi',
  expected_vendor_cost_cents: 5,
  customer_credit_cost: 1,
  is_enabled: true,
  disable_reason: null,
  requires_confirmed_cost: false,
  ...partial,
})

describe('ProviderGateway', () => {
  let gateway: ProviderGateway

  beforeEach(() => {
    vi.clearAllMocks()
    gateway = new ProviderGateway()
    vi.mocked(accountCostCapService.ensureCapExists).mockResolvedValue({} as any)
    vi.mocked(creditWalletService.ensureWalletExists).mockResolvedValue({} as any)
  })

  describe('authorize', () => {
    it('returns success when RPC succeeds', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          budget_reservation_id: 'bres-1',
          credit_reservation_id: 'cres-1',
        },
        error: null,
      })

      const result = await gateway.authorize({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'property_lookup_basic',
        provider_key: 'reapi',
        pool_key: 'customer_shared',
        estimated_cost_cents: 5,
        credit_cost: 1,
        is_zero_cost_feature: false,
      })

      expect(result.success).toBe(true)
      expect(result.budget_reservation_id).toBe('bres-1')
      expect(result.credit_reservation_id).toBe('cres-1')
    })

    it('returns failure when gate 1 fails (insufficient credits)', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: false,
          gate_failed: 1,
          error_code: 'insufficient_credits',
          error_message: 'Insufficient Premium Credits',
          budget_reservation_id: null,
          credit_reservation_id: null,
        },
        error: null,
      })

      const result = await gateway.authorize({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'property_lookup_basic',
        provider_key: 'reapi',
        pool_key: 'customer_shared',
        estimated_cost_cents: 5,
        credit_cost: 1,
        is_zero_cost_feature: false,
      })

      expect(result.success).toBe(false)
      expect(result.gate_failed).toBe(1)
      expect(result.error_code).toBe('insufficient_credits')
    })

    it('fails closed when RPC itself errors (service unavailable)', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

      const result = await gateway.authorize({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'property_lookup_basic',
        provider_key: 'reapi',
        pool_key: 'customer_shared',
        estimated_cost_cents: 5,
        credit_cost: 1,
        is_zero_cost_feature: false,
      })

      expect(result.success).toBe(false)
      expect(result.error_code).toBe('authorization_unavailable')
    })

    it('fails closed when account setup errors', async () => {
      vi.mocked(accountCostCapService.ensureCapExists).mockRejectedValue(
        new Error('DB error during setup')
      )

      const result = await gateway.authorize({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'property_lookup_basic',
        provider_key: 'reapi',
        pool_key: 'customer_shared',
        estimated_cost_cents: 5,
        credit_cost: 1,
        is_zero_cost_feature: false,
      })

      expect(result.success).toBe(false)
      expect(result.error_code).toBe('setup_error')
    })
  })

  describe('authorizeFeature', () => {
    it('blocks disabled features at gate 6', async () => {
      vi.mocked(pricingEngine.getActivePricing).mockResolvedValue(
        pricing({ is_enabled: false, disable_reason: 'Pending cost confirmation' }) as any
      )

      const result = await gateway.authorizeFeature({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'rental_analysis',
      })

      expect(result.success).toBe(false)
      expect(result.gate_failed).toBe(6)
      expect(result.error_code).toBe('feature_disabled')
    })

    it('blocks features with unconfirmed vendor cost', async () => {
      vi.mocked(pricingEngine.getActivePricing).mockResolvedValue(
        pricing({
          expected_vendor_cost_cents: 0,
          requires_confirmed_cost: true,
          is_enabled: true,
        }) as any
      )

      const result = await gateway.authorizeFeature({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'ai_analysis',
      })

      expect(result.success).toBe(false)
      expect(result.error_code).toBe('unknown_vendor_cost')
    })

    it('blocks features with no active pricing', async () => {
      vi.mocked(pricingEngine.getActivePricing).mockResolvedValue(null)

      const result = await gateway.authorizeFeature({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'contact_enrichment',
      })

      expect(result.success).toBe(false)
      expect(result.error_code).toBe('feature_not_configured')
    })

    it('proceeds for zero-cost features without budget reservation', async () => {
      vi.mocked(pricingEngine.getActivePricing).mockResolvedValue(
        pricing({
          feature_key: 'geocode',
          expected_vendor_cost_cents: 0,
          customer_credit_cost: 0,
          requires_confirmed_cost: false,
        }) as any
      )

      mockRpc.mockResolvedValue({
        data: {
          success: true,
          zero_cost: true,
          budget_reservation_id: null,
          credit_reservation_id: null,
        },
        error: null,
      })

      const result = await gateway.authorizeFeature({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'geocode',
      })

      expect(result.success).toBe(true)
      expect(result.zero_cost).toBe(true)
    })

    it('routes customer calls to customer_shared pool by default', async () => {
      vi.mocked(pricingEngine.getActivePricing).mockResolvedValue(pricing() as any)
      mockRpc.mockResolvedValue({
        data: { success: true, budget_reservation_id: 'bres-1', credit_reservation_id: 'cres-1' },
        error: null,
      })

      await gateway.authorizeFeature({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'property_lookup_basic',
      })

      expect(mockRpc).toHaveBeenCalledWith(
        'fn_reserve_budget_and_credits',
        expect.objectContaining({ p_pool_key: 'customer_shared' })
      )
    })
  })

  describe('six gate invariants', () => {
    it('gate 5 is enforced for protected pools — never auto-accessible by customers', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: false,
          gate_failed: 5,
          error_code: 'protected_pool',
          budget_reservation_id: null,
          credit_reservation_id: null,
        },
        error: null,
      })

      const result = await gateway.authorize({
        request_id: 'req-1',
        account_id: 'user-1',
        feature_key: 'property_lookup_basic',
        provider_key: 'reapi',
        pool_key: 'emergency_reserved',
        estimated_cost_cents: 5,
        credit_cost: 1,
        is_zero_cost_feature: false,
      })

      expect(result.success).toBe(false)
      expect(result.gate_failed).toBe(5)
      expect(result.error_code).toBe('protected_pool')
    })
  })
})
