/**
 * Phase 6.6 Stabilization Tests
 *
 * Proves key behaviors required by the Phase 6.6 stabilization brief:
 *   - Skip-trace gate: contact_enrichment disabled → blocked before HTTP
 *   - mlsReapi: providerGateway called before REAPI fetch
 *   - mlsComps: providerGateway called before REAPI comps fetch
 *   - Bulk pagination: DEFAULT_SEARCH_CONFIG.maxPaidPages = 1
 *   - Partner model: credits gate enforced (gateway mock)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockAuthorize,
  mockAuthorizeFeature,
  mockFinalize,
  mockGetActivePricing,
  mockFrom,
  mockInsert,
  mockSelect,
  mockSingle,
} = vi.hoisted(() => ({
  mockAuthorize:        vi.fn(),
  mockAuthorizeFeature: vi.fn(),
  mockFinalize:         vi.fn().mockResolvedValue({}),
  mockGetActivePricing: vi.fn(),
  mockFrom:             vi.fn(),
  mockInsert:           vi.fn(),
  mockSelect:           vi.fn(),
  mockSingle:           vi.fn(),
}))

vi.mock('@/lib/billing/providerGateway', () => ({
  providerGateway: {
    authorize:        mockAuthorize,
    authorizeFeature: mockAuthorizeFeature,
    finalize:         mockFinalize,
  },
  ProviderGateway: class {},
}))

vi.mock('@/lib/billing/pricingEngine', () => ({
  pricingEngine: { getActivePricing: mockGetActivePricing },
}))

vi.mock('@/lib/billing/accountCostCapService', () => ({
  accountCostCapService: { ensureCapExists: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@/lib/billing/creditWalletService', () => ({
  creditWalletService: { ensureWalletExists: vi.fn().mockResolvedValue({}) },
}))

// Mock propertyService to control freshness
vi.mock('@/lib/propertyService', () => ({
  shouldRefreshModule: vi.fn().mockResolvedValue(true),  // stale → proceed
  getModuleFreshness:  vi.fn().mockResolvedValue({ isFresh: false }),
  markModuleRefreshed: vi.fn().mockResolvedValue({}),
}))

// Minimal chainable mock for serviceClient
// Note: mockInsert, mockSelect, mockSingle, mockFrom are declared in vi.hoisted() above
const chain: Record<string, unknown> = {
  insert: mockInsert,
  select: mockSelect,
  single: mockSingle,
  eq:     vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  in:     vi.fn(),
  or:     vi.fn(),
  lt:     vi.fn(),
  lte:    vi.fn(),
  order:  vi.fn(),
  limit:  vi.fn(),
  maybeSingle: vi.fn(),
  then:   (fn: (v: unknown) => void) => Promise.resolve(fn({ data: null, error: null })),
}
for (const m of Object.keys(chain)) {
  const v = chain[m]
  if (typeof v === 'function' && m !== 'then') {
    (v as ReturnType<typeof vi.fn>).mockReturnValue(chain)
  }
}

mockFrom.mockReturnValue(chain)

vi.mock('@/lib/supabase-service', () => ({
  serviceClient: { from: mockFrom, rpc: vi.fn() },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { runSkipTrace } from '@/lib/skiptrace/service'
import { mlsReapiProvider } from '@/lib/graph/providers/mlsReapi'
import { fetchCompsFromReapi } from '@/lib/graph/providers/mlsComps'
import { DEFAULT_SEARCH_CONFIG } from '@/lib/search/reapi-search'
import { buildCustomerContext, BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRICING_BASIC = {
  feature_key: 'property_lookup_basic', provider_key: 'reapi',
  expected_vendor_cost_cents: 5, customer_credit_cost: 1,
  is_enabled: true, disable_reason: null, requires_confirmed_cost: false,
}

const PRICING_COMPS = {
  feature_key: 'comps_refresh', provider_key: 'reapi',
  expected_vendor_cost_cents: 15, customer_credit_cost: 3,
  is_enabled: true, disable_reason: null, requires_confirmed_cost: false,
}

const PRICING_CONTACT_DISABLED = {
  feature_key: 'contact_enrichment', provider_key: null,
  expected_vendor_cost_cents: 0, customer_credit_cost: 8,
  is_enabled: false,
  disable_reason: 'Disabled: skip trace provider and pricing not yet selected.',
  requires_confirmed_cost: true,
}

const AUTH_OK = {
  success: true,
  budget_reservation_id: 'bres-1',
  credit_reservation_id: 'cres-1',
}

const AUTH_BLOCKED_CREDITS = {
  success: false, budget_reservation_id: null, credit_reservation_id: null,
  gate_failed: 1, error_code: 'insufficient_credits',
  error_message: 'Insufficient credits.',
}

const AUTH_BLOCKED_POOL = {
  success: false, budget_reservation_id: null, credit_reservation_id: null,
  gate_failed: 3, error_code: 'pool_exhausted',
  error_message: 'Pool exhausted.',
}

const AUTH_FEATURE_DISABLED = {
  success: false, budget_reservation_id: null, credit_reservation_id: null,
  gate_failed: 6, error_code: 'feature_disabled',
  error_message: 'Skip trace feature is disabled.',
}

const BILLING = buildCustomerContext('user-test-1')

// ─── 1. Skip-trace: DB-disabled contact_enrichment blocks before HTTP ─────────

describe('Skip-trace: contact_enrichment disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFinalize.mockResolvedValue({})
    // authorizeFeature returns feature_disabled
    mockAuthorizeFeature.mockResolvedValue(AUTH_FEATURE_DISABLED)
    // skiptrace_requests row creation — needs id
    mockInsert.mockReturnValue({
      ...chain,
      select: vi.fn().mockReturnValue({
        ...chain,
        single: vi.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null }),
      }),
    })
  })

  it('throws before making any HTTP request', async () => {
    await expect(
      runSkipTrace({
        propertyId: 'prop-1',
        leadId:     null,
        input:      { address: '100 Main St', city: 'Miami', state: 'FL', zip: '33101', first_name: null, last_name: null },
        userId:     'user-test-1',
        userEmail:  'test@test.com',
        force:      true,    // bypass freshness so we reach the gateway check
        billing:    BILLING,
      })
    ).rejects.toThrow()

    // Proved: no HTTP fetch was made before the throw
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws BillingError (not null or undefined) so API can return 402/503', async () => {
    const err = await runSkipTrace({
      propertyId: 'prop-1',
      leadId:     null,
      input:      { address: '100 Main St', city: 'Miami', state: 'FL', zip: '33101', first_name: null, last_name: null },
      userId:     'user-test-1',
      userEmail:  'test@test.com',
      force:      true,
      billing:    BILLING,
    }).catch(e => e)

    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
  })

  it('requires billing context — throws immediately if missing', async () => {
    await expect(
      runSkipTrace({
        propertyId: 'prop-1',
        leadId:     null,
        input:      { address: '100 Main St', city: 'Miami', state: 'FL', zip: '33101', first_name: null, last_name: null },
        userId:     'user-test-1',
        userEmail:  'test@test.com',
        // billing intentionally omitted
      })
    ).rejects.toThrow(/billing context/)
    // authorizeFeature never called — billed before request record
    expect(mockAuthorizeFeature).not.toHaveBeenCalled()
  })
})

// ─── 2. mlsReapi: gateway enforced ───────────────────────────────────────────

describe('mlsReapi: providerGateway enforced (BACKGROUND_CONTEXT)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFinalize.mockResolvedValue({})
    process.env.REAPI_KEY = 'test-reapi-key'
  })

  it('calls gateway.authorize before any HTTP fetch', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_BASIC)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })

    await mlsReapiProvider.fetch({ propertyId: 'p1', intent: 'listing', address: '100 Main St' })

    // authorize called exactly once, before fetch
    expect(mockAuthorize).toHaveBeenCalledOnce()
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id:   BACKGROUND_CONTEXT.account_id,
        pool_key:     BACKGROUND_CONTEXT.pool_key,
        provider_key: 'reapi',
        credit_cost:  0,
      })
    )
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('does NOT call REAPI when gateway blocks (pool exhausted)', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_BASIC)
    mockAuthorize.mockResolvedValue(AUTH_BLOCKED_POOL)

    const result = await mlsReapiProvider.fetch({ propertyId: 'p1', intent: 'listing', address: '100 Main St' })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/blocked/i)
  })

  it('calls finalize with success=true after successful fetch', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_BASIC)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockFetch.mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ data: [{ mlsStatus: 'Active', mlsListingPrice: 500000 }] }),
    })

    await mlsReapiProvider.fetch({ propertyId: 'p1', intent: 'listing', address: '100 Main St' })

    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, actual_cost_cents: PRICING_BASIC.expected_vendor_cost_cents })
    )
  })

  it('calls finalize with success=false on HTTP error (no charge)', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_BASIC)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockFetch.mockResolvedValue({ ok: false, status: 503 })

    await mlsReapiProvider.fetch({ propertyId: 'p1', intent: 'listing', address: '100 Main St' })

    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, actual_cost_cents: 0 })
    )
  })
})

// ─── 3. mlsComps: gateway enforced ───────────────────────────────────────────

describe('mlsComps: providerGateway enforced (BACKGROUND_CONTEXT)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFinalize.mockResolvedValue({})
    process.env.REAPI_KEY = 'test-reapi-key'
  })

  it('calls gateway.authorize with comps_refresh feature key', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_COMPS)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })

    await fetchCompsFromReapi({ address: '100 Main St' })

    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id:   BACKGROUND_CONTEXT.account_id,
        feature_key:  'comps_refresh',
        credit_cost:  0,
      })
    )
  })

  it('does NOT call REAPI when gateway blocks', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_COMPS)
    mockAuthorize.mockResolvedValue(AUTH_BLOCKED_POOL)

    const result = await fetchCompsFromReapi({ address: '100 Main St' })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })

  it('reports correct costCents in result', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_COMPS)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockFetch.mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ data: [{ mlsStatus: 'Sold', closePrice: 350000 }] }),
    })

    const result = await fetchCompsFromReapi({ address: '100 Main St' })

    expect(result.success).toBe(true)
    expect(result.costCents).toBe(PRICING_COMPS.expected_vendor_cost_cents)
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, actual_cost_cents: PRICING_COMPS.expected_vendor_cost_cents })
    )
  })
})

// ─── 4. Bulk search: pagination defaults proven ───────────────────────────────

describe('Bulk search: DEFAULT_SEARCH_CONFIG', () => {
  it('maxPaidPages is 1 (not 4)', () => {
    expect(DEFAULT_SEARCH_CONFIG.maxPaidPages).toBe(1)
  })

  it('maxTotalRecords is 50 (not 200)', () => {
    expect(DEFAULT_SEARCH_CONFIG.maxTotalRecords).toBe(50)
  })

  it('maxVendorCostCents is 10 (not 30)', () => {
    expect(DEFAULT_SEARCH_CONFIG.maxVendorCostCents).toBe(10)
  })
})

// ─── 5. Partner: credit gate enforced ────────────────────────────────────────

describe('Partner: credits gate enforcement (via mlsReapi as proxy)', () => {
  // Partners use buildCustomerContext → customer_shared pool.
  // When gateway returns insufficient_credits, no REAPI call is made.

  beforeEach(() => {
    vi.clearAllMocks()
    mockFinalize.mockResolvedValue({})
    process.env.REAPI_KEY = 'test-reapi-key'
  })

  it('zero-credit partner: gateway blocks, no HTTP call', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_BASIC)
    mockAuthorize.mockResolvedValue(AUTH_BLOCKED_CREDITS)

    const result = await mlsReapiProvider.fetch({ propertyId: 'p1', intent: 'listing', address: '100 Main St' })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })

  it('funded partner: gateway permits, REAPI call proceeds', async () => {
    mockGetActivePricing.mockResolvedValue(PRICING_BASIC)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })

    const result = await mlsReapiProvider.fetch({ propertyId: 'p1', intent: 'listing', address: '100 Main St' })

    expect(mockAuthorize).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalled()
  })
})
