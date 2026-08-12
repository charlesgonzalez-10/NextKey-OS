import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

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

vi.mock('@/lib/supabase-service', () => ({ get serviceClient() { return {} } }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  executeGatewaySearch,
  buildBillingRequestId,
  buildCacheKey,
  DEFAULT_SEARCH_CONFIG,
  type SearchParams,
} from '@/lib/search/reapi-search'
import { buildCustomerContext } from '@/lib/billing/gatewayContext'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SEARCH_PRICING = {
  feature_key:                'property_search_criteria',
  provider_key:               'reapi',
  expected_vendor_cost_cents: 5,
  customer_credit_cost:       1,
  is_enabled:                 true,
  disable_reason:             null,
  requires_confirmed_cost:    false,
}

const AUTH_OK = {
  success:               true,
  budget_reservation_id: 'res-budget-1',
  credit_reservation_id: 'res-credit-1',
}

const AUTH_CREDIT_BLOCKED = {
  success:               false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  gate_failed:           1,
  error_code:            'insufficient_credits',
  error_message:         'Insufficient credits.',
}

const AUTH_POOL_BLOCKED = {
  success:               false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  gate_failed:           3,
  error_code:            'pool_exhausted',
  error_message:         'Customer pool exhausted.',
}

const AUTH_IDEMPOTENT_DUPLICATE = {
  success:               false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  gate_failed:           undefined,
  error_code:            'idempotent_duplicate',
  error_message:         'Request already completed. Use cached results.',
}

const AUTH_IDEMPOTENT_IN_FLIGHT = {
  success:               false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  gate_failed:           undefined,
  error_code:            'idempotent_in_flight',
  error_message:         'Request is already in progress.',
}

const RAW_PROPERTY_1 = {
  propertyId:     'prop-001',
  apn:            '0001',
  address:        { address: '101 First Ave', city: 'Davie', state: 'FL', zip: '33317' },
  estimatedValue: 300000,
}

const RAW_PROPERTY_2 = {
  propertyId:     'prop-002',
  apn:            '0002',
  address:        { address: '202 Second Ave', city: 'Davie', state: 'FL', zip: '33317' },
  estimatedValue: 450000,
}

const SEARCH_PARAMS: SearchParams = { county: 'broward', lead_types: 'pre_foreclosure' }
const BILLING         = buildCustomerContext('user-abc')
const LOGICAL_SEARCH_ID = buildCacheKey(SEARCH_PARAMS)

// Fixed day epoch for deterministic tests — avoids midnight boundary failures
const TEST_DAY_EPOCH = Math.floor(Date.now() / 86_400_000)

/**
 * Mock a successful REAPI page.
 *
 * @param props         Raw property records in this page
 * @param total         Total records matching the query (resultCount)
 * @param nextIndex     REAPI resultIndex for the next page (default 251)
 * @param recordCount   Records actually returned (default = props.length).
 *                      Set to 250 to signal "more pages follow" — the loop
 *                      stops when recordCount < pageSize.
 */
function mockPage(
  props: object[],
  total: number,
  nextIndex = 251,
  recordCount?: number,
) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({
      data:        props,
      resultCount: total,
      recordCount: recordCount ?? props.length,
      resultIndex: nextIndex,
    }),
  } as Response)
}

function mockProviderError(status = 503) {
  mockFetch.mockResolvedValueOnce({
    ok:     false,
    status,
    text:   async () => 'Service Unavailable',
  } as Response)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('executeGatewaySearch', () => {
  beforeEach(() => {
    // resetAllMocks clears call history AND flushes mockResolvedValueOnce queues,
    // preventing state leakage between tests.
    vi.resetAllMocks()
    process.env.REAPI_KEY = 'test-api-key'
    mockFinalize.mockResolvedValue(undefined)
  })

  // T1: one-page search — success, 1 result, 1 page fetched
  it('[T1] one-page search — succeeds, charges 1 credit + 5¢ vendor cost', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 1)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('success')
    expect((result as any).properties).toHaveLength(1)
    expect((result as any).pages_fetched).toBe(1)

    const expectedRequestId = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
    expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({
      request_id:           expectedRequestId,
      account_id:           'user-abc',
      estimated_cost_cents: 5,
      credit_cost:          1,
      pool_key:             'customer_shared',
    }))
    expect(mockFinalize).toHaveBeenCalledTimes(1)
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
      request_id:        expectedRequestId,
      actual_cost_cents: 5,
      success:           true,
    }))
  })

  // T2: multi-page search — page 1 signals more data (recordCount=250), page 2 fetched
  it('[T2] multi-page search — fetches 2 pages, credits charged on page 1 only', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    // recordCount=250 tells the loop "REAPI has more results"
    mockPage([RAW_PROPERTY_1], 300, 2, 250)
    mockPage([RAW_PROPERTY_2], 300)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('success')
    expect((result as any).properties).toHaveLength(2)
    expect((result as any).pages_fetched).toBe(2)

    const expectedP1Id = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    const expectedP2Id = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 2, TEST_DAY_EPOCH)
    expect(expectedP1Id).not.toBe(expectedP2Id)

    // Page 1: credit_cost = 1
    expect(mockAuthorize).toHaveBeenNthCalledWith(1, expect.objectContaining({
      request_id:  expectedP1Id,
      credit_cost: 1,
    }))
    // Page 2: credit_cost = 0
    expect(mockAuthorize).toHaveBeenNthCalledWith(2, expect.objectContaining({
      request_id:  expectedP2Id,
      credit_cost: 0,
    }))
    expect(mockFinalize).toHaveBeenCalledTimes(2)
  })

  // T3: provider not configured — returns provider_disabled before any authorize call
  it('[T3] REAPI_KEY missing → provider_disabled, no authorize/fetch', async () => {
    delete process.env.REAPI_KEY

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('provider_disabled')
    expect(mockGetActivePricing).not.toHaveBeenCalled()
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // T4: feature disabled → returns feature_disabled before authorize call
  it('[T4] feature disabled — returns feature_disabled, no provider call', async () => {
    mockGetActivePricing.mockResolvedValueOnce({
      ...SEARCH_PRICING,
      is_enabled:     false,
      disable_reason: 'Maintenance',
    })

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('feature_disabled')
    expect((result as any).safe_message).toMatch(/Maintenance|disabled/)
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // T5: forced single-page via custom config — stops after one page
  it('[T5] custom config (maxPaidPages=1) — stops after one page even if total > pageSize', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 500, 2, 250)  // signals more available

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID, {
      ...DEFAULT_SEARCH_CONFIG,
      maxPaidPages: 1,
    })

    expect(result.outcome).toBe('success')
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // T6: page 2 auth blocked → partial_result with page 1 data
  it('[T6] page 2 auth blocked → partial_result with page 1 results', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockAuthorize.mockResolvedValueOnce(AUTH_POOL_BLOCKED)
    mockPage([RAW_PROPERTY_1], 300, 2, 250)  // more results available

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID) as any

    expect(result.outcome).toBe('partial_result')
    expect(result.properties).toHaveLength(1)
    expect(result.pages_fetched).toBe(1)
    expect(result.blocked_at_page).toBe(2)
    expect(result.error_code).toBe('customer_pool_exhausted')
  })

  // T7: partial_result includes safe_message
  it('[T7] partial_result includes safe_message from gateway', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockAuthorize.mockResolvedValueOnce(AUTH_CREDIT_BLOCKED)
    mockPage([RAW_PROPERTY_1], 500, 2, 250)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID) as any

    expect(result.outcome).toBe('partial_result')
    expect(result.safe_message).toBeTruthy()
    expect(result.error_code).toBe('credit_insufficient')
  })

  // T8: billing_request_id is deterministic — same inputs, same output
  it('[T8] billing_request_id is deterministic — same account+search+page+day → same id', () => {
    const id1 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    const id2 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^[0-9a-f]{32}$/)
  })

  // T9: different accounts produce different billing_request_ids — no cross-account collision
  it('[T9] different accounts produce non-colliding billing_request_ids', () => {
    const idUserA = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    const idUserB = buildBillingRequestId('user-xyz', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    expect(idUserA).not.toBe(idUserB)
  })

  // T10: same logical search twice → same billing_request_id → DB enforces idempotency
  it('[T10] same logical search twice — page 1 billing_request_id is identical (DB enforces idempotency)', async () => {
    mockGetActivePricing.mockResolvedValue(SEARCH_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 1)
    mockPage([RAW_PROPERTY_1], 1)

    await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)
    await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    const firstRequestId  = (mockAuthorize.mock.calls[0] as any[])[0].request_id
    const secondRequestId = (mockAuthorize.mock.calls[1] as any[])[0].request_id
    // Same billing_request_id — the DB fn_reserve_budget_and_credits idempotency
    // check handles the duplicate rather than charging twice
    expect(firstRequestId).toBe(secondRequestId)
    expect(firstRequestId).toMatch(/^[0-9a-f]{32}$/)
  })

  // T11: concurrent searches with different params — each gets a unique billing_request_id
  it('[T11] concurrent searches with different params — each gets a unique billing_request_id', async () => {
    const PARAMS_A: SearchParams = { county: 'broward',    lead_types: 'pre_foreclosure' }
    const PARAMS_B: SearchParams = { county: 'miami-dade', lead_types: 'foreclosure'     }
    const LOGICAL_A = buildCacheKey(PARAMS_A)
    const LOGICAL_B = buildCacheKey(PARAMS_B)

    expect(LOGICAL_A).not.toBe(LOGICAL_B)
    expect(buildBillingRequestId('user-abc', LOGICAL_A, 1, TEST_DAY_EPOCH))
      .not.toBe(buildBillingRequestId('user-abc', LOGICAL_B, 1, TEST_DAY_EPOCH))

    mockGetActivePricing.mockResolvedValue(SEARCH_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 1)
    mockPage([RAW_PROPERTY_2], 1)

    const [r1, r2] = await Promise.all([
      executeGatewaySearch(PARAMS_A, BILLING, LOGICAL_A),
      executeGatewaySearch(PARAMS_B, BILLING, LOGICAL_B),
    ])

    expect(r1.outcome).toBe('success')
    expect(r2.outcome).toBe('success')

    const ids = mockAuthorize.mock.calls.map((c: any[]) => c[0].request_id)
    expect(new Set(ids).size).toBe(ids.length)  // all unique
  })

  // T12: concurrent searches near pool limit — one succeeds, one blocked
  it('[T12] concurrent searches — one succeeds, one blocked (pool exhausted)', async () => {
    mockGetActivePricing.mockResolvedValue(SEARCH_PRICING)
    mockAuthorize
      .mockResolvedValueOnce(AUTH_OK)           // first to authorize
      .mockResolvedValueOnce(AUTH_POOL_BLOCKED)  // second blocked
    mockPage([RAW_PROPERTY_1], 1)   // only one fetch (blocked call skips fetch)

    const PARAMS_A: SearchParams = { county: 'broward',    lead_types: 'pre_foreclosure' }
    const PARAMS_B: SearchParams = { county: 'miami-dade', lead_types: 'auction'         }

    const [r1, r2] = await Promise.all([
      executeGatewaySearch(PARAMS_A, BILLING, buildCacheKey(PARAMS_A)),
      executeGatewaySearch(PARAMS_B, BILLING, buildCacheKey(PARAMS_B)),
    ])

    const outcomes = new Set([r1.outcome, r2.outcome])
    expect(outcomes.has('success')).toBe(true)
    expect(outcomes.has('customer_pool_exhausted')).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)   // only the approved call fetched
  })

  // T13: provider failure — finalize(success=false), returns provider_failed
  it('[T13] provider fetch throws → provider_failed, finalize(success=false)', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockProviderError(503)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('provider_failed')
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
      actual_cost_cents: 0,
      success:           false,
    }))
  })

  // T14: global budget exhaustion — pool_exhausted maps to customer_pool_exhausted
  it('[T14] global budget exhausted → customer_pool_exhausted outcome', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce({
      success:               false,
      budget_reservation_id: null,
      credit_reservation_id: null,
      gate_failed:           4,
      error_code:            'pool_exhausted',
      error_message:         'Global budget exhausted.',
    })

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('customer_pool_exhausted')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // T15: customer credit exhaustion → credit_insufficient
  it('[T15] insufficient credits → credit_insufficient outcome, no provider call', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_CREDIT_BLOCKED)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('credit_insufficient')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFinalize).not.toHaveBeenCalled()
  })

  // T16: no pool spillover — one authorize call, pool_key never changes
  it('[T16] pool blocked — exactly one authorize call, no retry with a different pool', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_POOL_BLOCKED)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('customer_pool_exhausted')
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
    expect((mockAuthorize.mock.calls[0] as any[])[0].pool_key).toBe('customer_shared')
  })

  // T17: no duplicate credit charge — page 1 = 1 credit, page 2 = 0 credits
  it('[T17] 2-page search — credit charged once on page 1, zero on page 2', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 300, 2, 250)  // page 1 signals more data
    mockPage([RAW_PROPERTY_2], 300)

    await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    const calls = mockAuthorize.mock.calls as any[][]
    expect(calls).toHaveLength(2)
    expect(calls[0][0].credit_cost).toBe(1)   // page 1 — 1 credit
    expect(calls[1][0].credit_cost).toBe(0)   // page 2 — 0 credits
  })

  // T18: idempotent_duplicate on page 1 — tries cache recovery; falls to authorization_unavailable
  // when no cache entry exists (serviceClient is mocked as {} in tests)
  it('[T18] idempotent_duplicate — falls to authorization_unavailable when no cache entry', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_IDEMPOTENT_DUPLICATE)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('authorization_unavailable')
    expect((result as any).error_code).toBe('idempotent_duplicate')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFinalize).not.toHaveBeenCalled()
  })

  // T19: idempotent_in_flight on page 1 — returns authorization_unavailable, no provider call
  it('[T19] idempotent_in_flight — returns authorization_unavailable, no provider call', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_IDEMPOTENT_IN_FLIGHT)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('authorization_unavailable')
    expect((result as any).error_code).toBe('idempotent_in_flight')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFinalize).not.toHaveBeenCalled()
  })

  // T20: billing resets across UTC days — different day → different billing_request_id
  it('[T20] different UTC day produces a different billing_request_id (billing resets with cache TTL)', () => {
    const today     = TEST_DAY_EPOCH
    const yesterday = TEST_DAY_EPOCH - 1
    const idToday     = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, today)
    const idYesterday = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, yesterday)
    expect(idToday).not.toBe(idYesterday)
  })

  // T21: page idempotency — page 1 and page 2 have distinct billing_request_ids
  it('[T21] different pages of the same search have different billing_request_ids', () => {
    const idP1 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH)
    const idP2 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 2, TEST_DAY_EPOCH)
    expect(idP1).not.toBe(idP2)
  })

  // T22: concurrent same-user-same-search — one gets idempotent_in_flight, only one provider call
  it('[T22] concurrent same-user-same-search — one gets idempotent_in_flight, no double provider call', async () => {
    mockGetActivePricing.mockResolvedValue(SEARCH_PRICING)
    mockAuthorize
      .mockResolvedValueOnce(AUTH_OK)                 // first request authorized
      .mockResolvedValueOnce(AUTH_IDEMPOTENT_IN_FLIGHT) // concurrent duplicate → in-flight
    mockPage([RAW_PROPERTY_1], 1)  // only one fetch

    const [r1, r2] = await Promise.all([
      executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID),
      executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID),
    ])

    const outcomes = new Set([r1.outcome, r2.outcome])
    expect(outcomes.has('success')).toBe(true)
    expect(outcomes.has('authorization_unavailable')).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)  // only one provider call — no double charge
  })

  // T23: refresh generation isolation — gen 0 and gen 1 produce different billing_request_ids
  it('[T23] different refresh generations produce different billing_request_ids', () => {
    const idGen0 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH, 0)
    const idGen1 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH, 1)
    const idGen2 = buildBillingRequestId('user-abc', LOGICAL_SEARCH_ID, 1, TEST_DAY_EPOCH, 2)
    expect(idGen0).not.toBe(idGen1)
    expect(idGen1).not.toBe(idGen2)
    expect(idGen0).not.toBe(idGen2)
  })

  // T24: same refresh generation → same billing_request_id (duplicate "Refresh" clicks are idempotent)
  it('[T24] same refresh generation called twice — same billing_request_id (duplicate clicks idempotent)', async () => {
    mockGetActivePricing.mockResolvedValue(SEARCH_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 1)
    mockPage([RAW_PROPERTY_1], 1)

    await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID, undefined, undefined, 1)
    await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID, undefined, undefined, 1)

    const id1 = (mockAuthorize.mock.calls[0] as any[])[0].request_id
    const id2 = (mockAuthorize.mock.calls[1] as any[])[0].request_id
    expect(id1).toBe(id2)  // same gen → same ID → DB enforces idempotency
    expect(id1).toMatch(/^[0-9a-f]{32}$/)
  })

  // ─── Additional invariant tests ────────────────────────────────────────────

  it('no pricing configured → feature_disabled', async () => {
    mockGetActivePricing.mockResolvedValueOnce(null)

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('feature_disabled')
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('requires_confirmed_cost + vendor_cost=0 → feature_disabled (unknown_vendor_cost)', async () => {
    mockGetActivePricing.mockResolvedValueOnce({
      ...SEARCH_PRICING,
      requires_confirmed_cost:    true,
      expected_vendor_cost_cents: 0,
    })

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID)

    expect(result.outcome).toBe('feature_disabled')
    expect((result as any).error_code).toBe('unknown_vendor_cost')
  })

  it('provider failure after page 1 success → partial_result with page 1 data', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)   // page 1 OK
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)   // page 2 OK
    mockPage([RAW_PROPERTY_1], 500, 2, 250)         // page 1 succeeds
    mockProviderError(502)                          // page 2 fetch throws

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID) as any

    expect(result.outcome).toBe('partial_result')
    expect(result.properties).toHaveLength(1)
    expect(result.blocked_at_page).toBe(2)
    expect(result.error_code).toBe('provider_failed')
  })

  it('deduplication — same propertyId across pages is included once', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 300, 2, 250)  // page 1
    mockPage([RAW_PROPERTY_1], 300)          // page 2 returns the same property

    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID) as any

    expect(result.outcome).toBe('success')
    expect(result.properties).toHaveLength(1)
  })

  it('maxVendorCostCents guard — page 2 skipped when cost would exceed cap', async () => {
    mockGetActivePricing.mockResolvedValueOnce(SEARCH_PRICING)  // 5¢/page
    mockAuthorize.mockResolvedValueOnce(AUTH_OK)
    mockPage([RAW_PROPERTY_1], 500, 2, 250)  // signals more available

    // maxVendorCostCents=8: allows page 1 (5¢ + 5¢ = 10¢ > 8¢ → page 2 blocked by guard)
    const result = await executeGatewaySearch(SEARCH_PARAMS, BILLING, LOGICAL_SEARCH_ID, {
      ...DEFAULT_SEARCH_CONFIG,
      maxPaidPages:       3,
      maxVendorCostCents: 8,
    }) as any

    expect(result.outcome).toBe('success')
    expect(result.pages_fetched).toBe(1)
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
  })
})
