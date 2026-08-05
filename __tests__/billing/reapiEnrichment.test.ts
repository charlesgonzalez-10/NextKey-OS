import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks (must precede vi.mock calls) ───────────────────────────────

const { mockAuthorize, mockFinalize, mockGetActivePricing } = vi.hoisted(() => ({
  mockAuthorize:        vi.fn(),
  mockFinalize:         vi.fn(),
  mockGetActivePricing: vi.fn(),
}))

vi.mock('@/lib/billing/providerGateway', () => ({
  providerGateway: { authorize: mockAuthorize, finalize: mockFinalize },
  ProviderGateway: class {},
}))

vi.mock('@/lib/billing/pricingEngine', () => ({
  pricingEngine: { getActivePricing: mockGetActivePricing },
  PricingEngine: class {},
}))

// ─── Mock supabase-service (pricingEngine and providerGateway use it) ─────────
vi.mock('@/lib/supabase-service', () => ({
  get serviceClient() { return {} },
}))

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Mock crypto.randomUUID ───────────────────────────────────────────────────

vi.mock('crypto', () => ({
  randomUUID: () => 'test-request-id-123',
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  searchPropertiesByAddress,
  getPropertyByAPN,
  getPropertyDetailByAddress,
  getPropertyByCoords,
} from '@/lib/enrichment/reapi'
import { buildCustomerContext, BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRICING = {
  feature_key:                 'property_lookup_basic',
  provider_key:                'reapi',
  expected_vendor_cost_cents:  5,
  customer_credit_cost:        1,
  is_enabled:                  true,
  disable_reason:              null,
  requires_confirmed_cost:     true,
}

const PRICING_APN = { ...PRICING, feature_key: 'property_report_full', expected_vendor_cost_cents: 10 }

const AUTH_OK = {
  success:                true,
  budget_reservation_id:  'res-budget-1',
  credit_reservation_id:  'res-credit-1',
}

const AUTH_BLOCKED = {
  success:       false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  gate_failed:   3,
  error_code:    'pool_capacity_exceeded',
  error_message: 'Budget pool is at capacity.',
}

const RAW_REAPI_PROPERTY = {
  apn:          '5041234567890',
  address:      { address: '123 Main St', city: 'Fort Lauderdale', state: 'FL', zip: '33301' },
  estimatedValue: 350000,
  bedrooms:     3,
  bathrooms:    2,
}

function mockSuccessFetch() {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({ data: [RAW_REAPI_PROPERTY] }),
  } as Response)
}

function mockFailFetch(status = 502) {
  mockFetch.mockResolvedValueOnce({
    ok:     false,
    status,
    text:   async () => 'Bad Gateway',
  } as Response)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('REAPI Enrichment — gateway enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.REAPI_KEY = 'test-key'
    mockFinalize.mockResolvedValue(undefined)
  })

  describe('searchPropertiesByAddress', () => {
    it('returns blocked when authorization fails (gate 3 — pool capacity)', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce(AUTH_BLOCKED)

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('blocked')
      expect((outcome as any).error_code).toBe('pool_capacity_exceeded')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns blocked when feature is disabled', async () => {
      mockGetActivePricing.mockResolvedValueOnce({ ...PRICING, is_enabled: false, disable_reason: 'Maintenance window' })

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('blocked')
      expect((outcome as any).error_code).toBe('feature_disabled')
      expect(mockAuthorize).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns blocked when feature has no pricing', async () => {
      mockGetActivePricing.mockResolvedValueOnce(null)

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('blocked')
      expect((outcome as any).error_code).toBe('feature_not_configured')
    })

    it('returns blocked when REAPI_KEY is not set', async () => {
      delete process.env.REAPI_KEY

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('blocked')
      expect((outcome as any).error_code).toBe('provider_not_configured')
      expect(mockGetActivePricing).not.toHaveBeenCalled()
    })

    it('returns success with normalized results on authorized call', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('success')
      if (outcome.outcome === 'success') {
        expect(outcome.data).toHaveLength(1)
        expect(outcome.data[0].folio).toBe('5041234567890')
        expect(outcome.data[0].market_value).toBe(350000)
        expect(outcome.request_id).toBe('test-request-id-123')
      }

      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        feature_key:          'property_lookup_basic',
        provider_key:         'reapi',
        pool_key:             'customer_shared',
        estimated_cost_cents: 5,
        credit_cost:          1,
      }))
      expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
        request_id:        'test-request-id-123',
        actual_cost_cents: 5,
        success:           true,
      }))
    })

    it('returns provider_failed and calls finalize with success=false on HTTP error', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockFailFetch(502)

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('provider_failed')
      expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
        success:           false,
        actual_cost_cents: 0,
      }))
    })
  })

  describe('getPropertyByAPN', () => {
    it('uses property_report_full feature key', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      await getPropertyByAPN('5041234567890', 'broward', buildCustomerContext('user-1'))

      expect(mockGetActivePricing).toHaveBeenCalledWith('property_report_full')
      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        estimated_cost_cents: 10,
        credit_cost:          1,
      }))
    })

    it('returns null data when REAPI returns empty array', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockFetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ data: [] }),
      } as Response)

      const outcome = await getPropertyByAPN('5041234567890', 'broward', buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('success')
      if (outcome.outcome === 'success') {
        expect(outcome.data).toBeNull()
      }
    })
  })

  describe('getPropertyDetailByAddress', () => {
    it('propagates blocked outcome from searchPropertiesByAddress', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce(AUTH_BLOCKED)

      const outcome = await getPropertyDetailByAddress('123 Main St', 'broward', buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('blocked')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns first result as PropertySearchResult | null', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      const outcome = await getPropertyDetailByAddress('123 Main St', 'broward', buildCustomerContext('user-1'))

      expect(outcome.outcome).toBe('success')
      if (outcome.outcome === 'success') {
        expect(outcome.data?.folio).toBe('5041234567890')
      }
    })
  })

  describe('BACKGROUND_CONTEXT — gate invariant enforcement', () => {
    it('authorizes with real estimated_cost_cents (not zero) and zero credit_cost', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        account_id:           BACKGROUND_CONTEXT.account_id,
        pool_key:             'background_operations',
        estimated_cost_cents: PRICING_APN.expected_vendor_cost_cents, // 10¢ — not 0
        credit_cost:          0,
      }))
    })

    it('finalize records actual vendor cost for pool reconciliation', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
        actual_cost_cents: PRICING_APN.expected_vendor_cost_cents,
        success:           true,
      }))
    })

    // ─── 10 required enforcement tests ───────────────────────────────────────

    it('[T1] background call succeeds when pool has capacity', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      const outcome = await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(outcome.outcome).toBe('success')
      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        pool_key:             'background_operations',
        estimated_cost_cents: PRICING_APN.expected_vendor_cost_cents,
        credit_cost:          0,
      }))
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    })

    it('[T2] background call returns blocked when background_operations pool is exhausted', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce({
        success:       false,
        gate_failed:   3,
        error_code:    'pool_exhausted',
        error_message: 'Background operations pool is at capacity.',
      })

      const outcome = await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(outcome.outcome).toBe('blocked')
      expect((outcome as any).error_code).toBe('pool_exhausted')
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockFinalize).not.toHaveBeenCalled()
    })

    it('[T3] background call returns blocked when global platform budget is exhausted (pool_exhausted)', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce({
        success:       false,
        gate_failed:   3,
        error_code:    'pool_exhausted',
        error_message: 'Platform budget limit reached.',
      })

      const outcome = await searchPropertiesByAddress('123 Main St', 'broward', 1, BACKGROUND_CONTEXT)

      expect(outcome.outcome).toBe('blocked')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('[T4] background credit_cost is 0 regardless of pricing.customer_credit_cost', async () => {
      mockGetActivePricing.mockResolvedValueOnce({
        ...PRICING_APN,
        customer_credit_cost: 50, // high value for regular customers
      })
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        credit_cost: 0,
      }))
    })

    it('[T5] provider failure in background: finalize called with success=false, actual_cost=0', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockFailFetch(503)

      const outcome = await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(outcome.outcome).toBe('provider_failed')
      expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
        success:           false,
        actual_cost_cents: 0,
      }))
    })

    it('[T6] unknown vendor cost fails closed for background (requires_confirmed_cost + cost=0 → blocked)', async () => {
      mockGetActivePricing.mockResolvedValueOnce({
        ...PRICING_APN,
        requires_confirmed_cost:    true,
        expected_vendor_cost_cents: 0,
      })

      const outcome = await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(outcome.outcome).toBe('blocked')
      expect((outcome as any).error_code).toBe('unknown_vendor_cost')
      expect(mockAuthorize).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('[T7] is_background does not suppress estimated_cost_cents — catalog value always used', async () => {
      mockGetActivePricing.mockResolvedValueOnce({
        ...PRICING,
        expected_vendor_cost_cents: 15,
      })
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      await searchPropertiesByAddress('123 Main St', 'broward', 1, BACKGROUND_CONTEXT)

      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        estimated_cost_cents: 15,
      }))
    })

    it('[T8] blocked background pool does not retry with owner_reserved — exactly one authorize call', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING_APN)
      mockAuthorize.mockResolvedValueOnce({
        success:       false,
        gate_failed:   3,
        error_code:    'pool_exhausted',
        error_message: 'Background pool exhausted.',
      })

      const outcome = await getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT)

      expect(outcome.outcome).toBe('blocked')
      expect(mockAuthorize).toHaveBeenCalledTimes(1)
      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        pool_key: 'background_operations',
      }))
    })

    it('[T9] second concurrent background call is blocked when pool is exhausted after first succeeds', async () => {
      mockGetActivePricing.mockResolvedValue(PRICING_APN)
      mockAuthorize
        .mockResolvedValueOnce(AUTH_OK) // first call: pool available
        .mockResolvedValueOnce({        // second call: pool now full
          success:       false,
          gate_failed:   3,
          error_code:    'pool_exhausted',
          error_message: 'Pool exhausted after first reservation.',
        })
      mockSuccessFetch()

      const [r1, r2] = await Promise.all([
        getPropertyByAPN('5041234567890', 'broward', BACKGROUND_CONTEXT),
        getPropertyByAPN('9990000000001', 'miami-dade', BACKGROUND_CONTEXT),
      ])

      expect(r1.outcome).toBe('success')
      expect(r2.outcome).toBe('blocked')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('[T10] finalize records both estimated_cost_cents (reserved) and actual_cost_cents (settled)', async () => {
      mockGetActivePricing.mockResolvedValueOnce({
        ...PRICING,
        expected_vendor_cost_cents: 5,
      })
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockSuccessFetch()

      await searchPropertiesByAddress('123 Main St', 'broward', 1, BACKGROUND_CONTEXT)

      expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
        estimated_cost_cents: 5,
      }))
      expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
        actual_cost_cents: 5,
        success:           true,
      }))
    })
  })

  describe('getPropertyByCoords', () => {
    it('uses property_lookup_basic and passes lat/lng to REAPI', async () => {
      mockGetActivePricing.mockResolvedValueOnce(PRICING)
      mockAuthorize.mockResolvedValueOnce(AUTH_OK)
      mockFetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ data: [RAW_REAPI_PROPERTY] }),
      } as Response)

      const outcome = await getPropertyByCoords(26.12, -80.14, 'broward', buildCustomerContext('user-1'))

      expect(mockGetActivePricing).toHaveBeenCalledWith('property_lookup_basic')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/PropertySearch'),
        expect.objectContaining({
          body: expect.stringContaining('"latitude":26.12'),
        })
      )
      expect(outcome.outcome).toBe('success')
    })
  })
})
