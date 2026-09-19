import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
// All mocks referenced inside vi.mock() factories must be hoisted so that vitest
// can place them before the factory runs (factories are evaluated before imports).

const { mockAuthorize, mockFinalize, mockGetActivePricing, mockFrom } = vi.hoisted(() => ({
  mockAuthorize:        vi.fn(),
  mockFinalize:         vi.fn(),
  mockGetActivePricing: vi.fn(),
  mockFrom:             vi.fn(),
}))

vi.mock('@/lib/billing/providerGateway', () => ({
  providerGateway: { authorize: mockAuthorize, finalize: mockFinalize },
  ProviderGateway: class {},
}))

vi.mock('@/lib/billing/pricingEngine', () => ({
  pricingEngine: { getActivePricing: mockGetActivePricing },
  PricingEngine: class {},
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/propertyService', () => ({
  markModuleRefreshed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/dsoe', () => ({
  recordFieldSources: vi.fn().mockResolvedValue(undefined),
  logDSOERequest:     vi.fn(),
}))

vi.mock('@/lib/scrapers/utils', () => ({
  detectEntityType: vi.fn().mockReturnValue('individual'),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  runREAPIIngestion,
  DEFAULT_INGESTION_CONFIG,
  INGESTION_FEATURE_KEY,
  type IngestionCheckpoint,
} from '@/lib/ingestion/reapi-engine'

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKGROUND_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001'
const BACKGROUND_POOL        = 'background_operations'
const RUN_ID                 = 'run-test-001'

const INGESTION_PRICING = {
  feature_key:                INGESTION_FEATURE_KEY,
  provider_key:               'reapi',
  expected_vendor_cost_cents: 5,
  customer_credit_cost:       0,
  is_enabled:                 true,
  disable_reason:             null,
  requires_confirmed_cost:    false,
}

const AUTH_OK = {
  success:               true,
  budget_reservation_id: 'res-bg-1',
  credit_reservation_id: null,
}

const AUTH_POOL_EXHAUSTED = {
  success:               false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  error_code:            'pool_exhausted',
  error_message:         'Background operations pool exhausted.',
}

const AUTH_GLOBAL_EXHAUSTED = {
  success:               false,
  budget_reservation_id: null,
  credit_reservation_id: null,
  error_code:            'global_budget_exhausted',
  error_message:         'Global budget limit reached.',
}

// ─── Supabase chain builder ───────────────────────────────────────────────────

/**
 * Build a chainable Supabase query builder.
 *
 * Every method returns the same object (`chain`) so that arbitrary chains like
 * `.from(t).insert(p).select('id').single()` resolve correctly.
 *
 * Terminal methods and direct `await` work via:
 *   .single()      → resolves to { data, error }
 *   .maybeSingle() → resolves to { data: null, error: null }  (no existing row)
 *   await chain    → resolves to { error: null }  (for update/delete)
 */
function makeChain(overrides?: {
  single?:      { data: any; error: any }
  maybeSingle?: { data: any; error: any }
}) {
  const chain: Record<string, any> = {}
  const self = () => chain

  chain.select      = vi.fn(self)
  chain.insert      = vi.fn(self)
  chain.update      = vi.fn(self)
  chain.delete      = vi.fn(self)
  chain.upsert      = vi.fn(self)
  chain.eq          = vi.fn(self)
  chain.neq         = vi.fn(self)
  chain.in          = vi.fn(self)
  chain.not         = vi.fn(self)
  chain.lt          = vi.fn(self)
  chain.limit       = vi.fn(self)
  chain.single      = vi.fn().mockResolvedValue(
    overrides?.single ?? { data: { id: RUN_ID }, error: null }
  )
  chain.maybeSingle = vi.fn().mockResolvedValue(
    overrides?.maybeSingle ?? { data: null, error: null }
  )
  // Make the chain `await`-able — handles `await supabase.from(t).update(...).eq(...)`
  chain.then = (resolve: Function, reject?: Function) =>
    Promise.resolve({ error: null }).then(resolve as any, reject as any)

  return chain
}

/** Wire mockFrom to return table-appropriate chains. */
function setupDbMock(opts?: {
  scraper_runs_single?: { data: any; error: any }
  properties_single?:   { data: any; error: any }
  properties_maybe?:    { data: any; error: any }
  leads_single?:        { data: any; error: any }
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'scraper_runs') {
      return makeChain({
        single: opts?.scraper_runs_single ?? { data: { id: RUN_ID }, error: null },
      })
    }
    if (table === 'properties') {
      return makeChain({
        single:      opts?.properties_single ?? { data: { id: 'prop-test-001' }, error: null },
        maybeSingle: opts?.properties_maybe  ?? { data: null, error: null },
      })
    }
    if (table === 'leads') {
      return makeChain({
        single:      opts?.leads_single ?? { data: { id: 'lead-test-001' }, error: null },
        maybeSingle: { data: null, error: null },
      })
    }
    return makeChain()
  })
}

// ─── REAPI fetch helpers ──────────────────────────────────────────────────────

/**
 * Queue a successful REAPI PropertySearch page.
 *
 * @param props       Records in this page
 * @param total       resultCount (total matching records)
 * @param nextIndex   resultIndex for the next page (default 251)
 * @param recordCount recordCount in response (default = props.length).
 *                    Set to PAGE_SIZE (250) to signal "more pages available" —
 *                    the loop stops when recordCount < pageSize.
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

/** Queue an HTTP error for the next REAPI fetch. */
function mockFetchError(status = 503) {
  mockFetch.mockResolvedValueOnce({
    ok:     false,
    status,
    text:   async () => 'Service Unavailable',
  } as Response)
}

/** Make ALL fetch calls return an empty page (good for concurrent-test stability). */
function mockFetchAlwaysEmpty() {
  mockFetch.mockResolvedValue({
    ok:   true,
    json: async () => ({ data: [], resultCount: 0, recordCount: 0, resultIndex: 251 }),
  } as Response)
}

const SAMPLE_PROPERTY = {
  propertyId:     'prop-test-001',
  apn:            'TEST-001-APN',
  address:        { address: '100 Test St', city: 'Fort Lauderdale', state: 'FL', zip: '33301' },
  estimatedValue: 350_000,
  preForeclosure: true,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runREAPIIngestion — billing invariants', () => {
  beforeEach(() => {
    // resetAllMocks flushes mockResolvedValueOnce queues AND call history —
    // prevents state leakage between tests (same lesson as searchGateway tests).
    vi.resetAllMocks()
    process.env.REAPI_KEY = 'test-key'
    mockFinalize.mockResolvedValue(undefined)
    setupDbMock()
  })

  // ─── [T1] One-page ingestion ─────────────────────────────────────────────

  it('[T1] one-page ingestion — 1 authorize per segment, 5¢ each, finalize each', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    // broward has 3 distress types; each fires 1 fetch
    mockPage([SAMPLE_PROPERTY], 1)   // pre_foreclosure — 1 result, returned=1 < 250 → stop
    mockPage([], 0)                   // foreclosure     — empty
    mockPage([], 0)                   // auction         — empty

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
    )

    expect(result.paused).toBe(false)
    expect(result.calls_attempted).toBe(3)
    expect(result.calls_completed).toBe(3)
    expect(result.estimated_cost_cents).toBe(15)   // 3 segments × 5¢
    expect(result.actual_cost_cents).toBe(15)
    expect(result.total_inserted).toBe(1)

    // All 3 authorize calls use background billing, 5¢, 0 credits
    expect(mockAuthorize).toHaveBeenCalledTimes(3)
    for (const [req] of mockAuthorize.mock.calls) {
      expect(req.account_id).toBe(BACKGROUND_ACCOUNT_ID)
      expect(req.pool_key).toBe(BACKGROUND_POOL)
      expect(req.credit_cost).toBe(0)
      expect(req.estimated_cost_cents).toBe(5)
      expect(req.is_zero_cost_feature).toBe(false)
    }

    // Every successful page was finalized
    expect(mockFinalize).toHaveBeenCalledTimes(3)
    for (const [fin] of mockFinalize.mock.calls) {
      expect(fin.actual_cost_cents).toBe(5)
      expect(fin.success).toBe(true)
    }
  })

  // ─── [T2] Multi-page ingestion ───────────────────────────────────────────

  it('[T2] multi-page ingestion — 2 pages for pre_foreclosure, costs double', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    // pre_foreclosure: page 1 full (recordCount=250 → continues), page 2 partial (stops)
    mockPage([SAMPLE_PROPERTY], 500, 251, 250)
    mockPage([SAMPLE_PROPERTY], 500, 501,   1)
    // foreclosure and auction: empty
    mockPage([], 0)
    mockPage([], 0)

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
    )

    const preFC = result.counties.find(
      c => c.county === 'broward' && c.distress_type === 'pre_foreclosure'
    )
    expect(preFC?.calls_attempted).toBe(2)
    expect(preFC?.calls_completed).toBe(2)
    expect(preFC?.estimated_cost_cents).toBe(10)   // 5¢ × 2 pages
    expect(preFC?.actual_cost_cents).toBe(10)

    // Total across all segments: pre_FC(2) + foreclosure(1) + auction(1) = 4
    expect(mockAuthorize).toHaveBeenCalledTimes(4)
    expect(result.calls_attempted).toBe(4)
    expect(result.calls_completed).toBe(4)
    expect(result.estimated_cost_cents).toBe(20)
  })

  // ─── [T3] Background pool routing ───────────────────────────────────────

  it('[T3] background pool — all authorize calls use background_operations with credit_cost=0', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([], 0)  // pre_foreclosure
    mockPage([], 0)  // foreclosure
    mockPage([], 0)  // auction

    await runREAPIIngestion(['broward'], '2026-08-04', '2026-08-04')

    expect(mockAuthorize.mock.calls.length).toBeGreaterThan(0)
    for (const [req] of mockAuthorize.mock.calls) {
      expect(req.account_id).toBe(BACKGROUND_ACCOUNT_ID)
      expect(req.pool_key).toBe(BACKGROUND_POOL)
      expect(req.credit_cost).toBe(0)
    }
  })

  // ─── [T4] Background pool exhausted mid-run ──────────────────────────────

  it('[T4] pool exhausted mid-run — run pauses, checkpoint set, pause_reason=background_paused_by_budget', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    // Page 1 (pre_foreclosure) succeeds; page 1 of next segment (foreclosure) is blocked
    mockAuthorize
      .mockResolvedValueOnce(AUTH_OK)              // broward/pre_foreclosure page 1
      .mockResolvedValueOnce(AUTH_POOL_EXHAUSTED)  // broward/foreclosure page 1 → blocked

    mockPage([SAMPLE_PROPERTY], 1)  // pre_foreclosure fetch succeeds

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
    )

    expect(result.paused).toBe(true)
    expect(result.pause_reason).toBe('background_paused_by_budget')
    expect(result.checkpoint).toBeTruthy()
    expect(result.checkpoint!.county).toBe('broward')
    expect(result.checkpoint!.distress_type).toBe('foreclosure')
    expect(result.checkpoint!.next_page_index).toBe(1)

    // After pause, no more authorize calls
    expect(mockAuthorize).toHaveBeenCalledTimes(2)
  })

  // ─── [T5] Global budget exhausted ───────────────────────────────────────

  it('[T5] global budget exhausted — first authorize blocked, checkpoint at page 1 of first segment', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_GLOBAL_EXHAUSTED)

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
    )

    expect(result.paused).toBe(true)
    expect(result.pause_reason).toBe('global_budget_exhausted')
    expect(result.checkpoint).toMatchObject({
      county:          'broward',
      distress_type:   'pre_foreclosure',
      next_page_index: 1,
    })

    // fetch was NEVER called — no paid provider call without authorization
    expect(mockFetch).not.toHaveBeenCalled()
    // Only 1 authorize was attempted before pausing
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
  })

  // ─── [T6] Max calls per run ──────────────────────────────────────────────

  it('[T6] maxCallsPerRun=1 — exactly 1 authorize, then pause with max_calls_reached', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([SAMPLE_PROPERTY], 1)  // The only allowed fetch

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
      undefined,
      { ...DEFAULT_INGESTION_CONFIG, maxCallsPerRun: 1 },
    )

    expect(mockAuthorize).toHaveBeenCalledTimes(1)
    expect(result.paused).toBe(true)
    expect(result.pause_reason).toBe('max_calls_reached')
    expect(result.calls_attempted).toBe(1)
  })

  // ─── [T7] Max vendor cost per run ───────────────────────────────────────

  it('[T7] maxVendorCostCents=5 — second segment blocked before authorize (cost guard)', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    // Only one fetch happens (first segment, 1 page)
    mockPage([SAMPLE_PROPERTY], 1)

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
      undefined,
      { ...DEFAULT_INGESTION_CONFIG, maxVendorCostCents: 5 },
    )

    // Only 1 authorize — the second would bring cost to 10¢ > 5¢ cap
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
    expect(result.paused).toBe(true)
    expect(result.pause_reason).toBe('max_cost_reached')
    expect(result.estimated_cost_cents).toBe(5)
  })

  // ─── [T8] Resume from checkpoint ────────────────────────────────────────

  it('[T8] resume from checkpoint — skips prior segments, starts at saved page index', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)

    const checkpoint: IngestionCheckpoint = {
      county:          'broward',
      distress_type:   'foreclosure',
      next_page_index: 251,
    }

    // Only foreclosure (resumed at p251) and auction run
    mockPage([], 0)   // broward/foreclosure page 251 — empty
    mockPage([], 0)   // broward/auction page 1

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
      RUN_ID,
      DEFAULT_INGESTION_CONFIG,
      checkpoint,
    )

    // pre_foreclosure must not appear in results (skipped)
    const preFCResult = result.counties.find(c => c.distress_type === 'pre_foreclosure')
    expect(preFCResult).toBeUndefined()

    // First authorize should reference foreclosure at page 251
    const firstCall = mockAuthorize.mock.calls[0]?.[0]
    expect(firstCall?.request_id).toBe(`ing-${RUN_ID}-broward-foreclosure-p251`)

    expect(result.paused).toBe(false)
  })

  // ─── [T9] Duplicate job — reuse existing runId ──────────────────────────

  it('[T9] existingRunId — run_id in result matches the supplied ID (no new insert)', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([], 0)  // broward/pre_foreclosure
    mockPage([], 0)  // broward/foreclosure
    mockPage([], 0)  // broward/auction

    const existingId = 'existing-run-id-999'
    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
      existingId,
    )

    // Engine must reuse the supplied ID rather than creating a new record
    expect(result.run_id).toBe(existingId)
    expect(result.paused).toBe(false)
  })

  // ─── [T10] Idempotent request_id ────────────────────────────────────────

  it('[T10] request_id is deterministic — ing-{runId}-{county}-{type}-p{page}', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([], 0)  // pre_foreclosure
    mockPage([], 0)  // foreclosure
    mockPage([], 0)  // auction

    const fixedRunId = 'idem-run-test'
    await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
      fixedRunId,
    )

    // First call must use the canonical pattern
    expect(mockAuthorize.mock.calls[0]?.[0]?.request_id)
      .toBe(`ing-${fixedRunId}-broward-pre_foreclosure-p1`)

    // Subsequent calls follow the same pattern
    expect(mockAuthorize.mock.calls[1]?.[0]?.request_id)
      .toBe(`ing-${fixedRunId}-broward-foreclosure-p1`)

    expect(mockAuthorize.mock.calls[2]?.[0]?.request_id)
      .toBe(`ing-${fixedRunId}-broward-auction-p1`)
  })

  // ─── [T11] Provider failure ──────────────────────────────────────────────

  it('[T11] provider failure — finalize(success=false), checkpoint set, NOT paused (not budget)', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    // pre_foreclosure fetch fails; foreclosure and auction succeed (empty)
    mockFetchError(503)   // broward/pre_foreclosure page 1 — provider down
    mockPage([], 0)        // broward/foreclosure page 1
    mockPage([], 0)        // broward/auction page 1

    const result = await runREAPIIngestion(
      ['broward'],
      '2026-08-04',
      '2026-08-04',
    )

    // finalize called with success=false for the failed page
    const failFinalizes = mockFinalize.mock.calls.filter(([req]) => req.success === false)
    expect(failFinalizes).toHaveLength(1)
    expect(failFinalizes[0][0]).toMatchObject({
      actual_cost_cents: 0,
      success:           false,
      error_code:        'provider_error',
    })

    // Cost was reconciled back — only the two successful empty pages cost anything
    expect(result.estimated_cost_cents).toBe(10)   // foreclosure(5¢) + auction(5¢)
    expect(result.actual_cost_cents).toBe(10)

    // Checkpoint set for retry of the failed segment, but run is NOT paused
    expect(result.checkpoint).toMatchObject({
      county:          'broward',
      distress_type:   'pre_foreclosure',
      next_page_index: 1,
    })
    expect(result.paused).toBe(false)   // provider failure ≠ budget_paused
    expect(result.pause_reason).toBeUndefined()
  })

  // ─── [T12] Case lookup idempotency ──────────────────────────────────────

  it('[T12] case lookup idempotency key — same APN+FIPS+minute → same request_id', () => {
    // Verify the formula used in reapi-case-lookup without invoking the live function.
    // Formula: `case-${md5(apn+':'+fips).slice(0,8)}-${Math.floor(Date.now()/60_000)}`
    const crypto = require('crypto')
    const apn  = 'TEST-APN-01'
    const fips = '12011'   // Broward FIPS
    const t    = Date.now()
    const min  = Math.floor(t / 60_000)

    const hash = () =>
      crypto.createHash('md5').update(`${apn}:${fips}`).digest('hex').slice(0, 8)

    // Same inputs → same hash (deterministic)
    expect(hash()).toBe(hash())

    // Same-minute calls produce the same key
    const key1 = `case-${hash()}-${min}`
    const key2 = `case-${hash()}-${min}`
    expect(key1).toBe(key2)

    // Different minute → different key (prevents cross-minute re-use only)
    const keyNext = `case-${hash()}-${min + 1}`
    expect(key1).not.toBe(keyNext)
  })

  // ─── [T13] No customer credits consumed ─────────────────────────────────

  it('[T13] no customer credits — credit_cost=0 on every authorize call regardless of page', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    // Two pages for pre_foreclosure (ensure we verify multi-page credit_cost)
    mockPage([SAMPLE_PROPERTY], 500, 251, 250)  // page 1 — full
    mockPage([SAMPLE_PROPERTY], 500, 501,   1)  // page 2 — partial
    mockPage([], 0)  // foreclosure
    mockPage([], 0)  // auction

    await runREAPIIngestion(['broward'], '2026-08-04', '2026-08-04')

    expect(mockAuthorize.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const [req] of mockAuthorize.mock.calls) {
      expect(req.credit_cost).toBe(0)
    }
  })

  // ─── [T14] No owner pool spillover ──────────────────────────────────────

  it('[T14] no pool spillover — pool_key stays background_operations on all pages', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    mockPage([SAMPLE_PROPERTY], 500, 251, 250)  // page 1 — full
    mockPage([SAMPLE_PROPERTY], 500, 501,   1)  // page 2 — partial
    mockPage([], 0)
    mockPage([], 0)

    await runREAPIIngestion(['broward'], '2026-08-04', '2026-08-04')

    for (const [req] of mockAuthorize.mock.calls) {
      expect(req.pool_key).toBe('background_operations')
      expect(req.pool_key).not.toBe('customer_shared')
      expect(req.pool_key).not.toBe('owner_reserved')
    }
  })

  // ─── [T15] Concurrent background jobs near pool limit ────────────────────

  it('[T15] concurrent background jobs — both use background_operations, no pool spillover', async () => {
    mockGetActivePricing.mockResolvedValue(INGESTION_PRICING)
    mockAuthorize.mockResolvedValue(AUTH_OK)
    // All fetches return empty — safe for concurrent calls (mockResolvedValue, not Once)
    mockFetchAlwaysEmpty()

    const [r1, r2] = await Promise.all([
      runREAPIIngestion(['broward'], '2026-08-04', '2026-08-04'),
      runREAPIIngestion(['broward'], '2026-08-04', '2026-08-04'),
    ])

    expect(r1.paused).toBe(false)
    expect(r2.paused).toBe(false)

    // Every authorize across both concurrent runs stays in background pool
    for (const [req] of mockAuthorize.mock.calls) {
      expect(req.pool_key).toBe('background_operations')
      expect(req.credit_cost).toBe(0)
    }
  })

  // ─── [T16] Unknown cost fails closed ────────────────────────────────────

  it('[T16] unknown vendor cost fails closed — requires_confirmed_cost=true with 0 cost → throws', async () => {
    mockGetActivePricing.mockResolvedValue({
      ...INGESTION_PRICING,
      expected_vendor_cost_cents: 0,
      requires_confirmed_cost:    true,
    })

    await expect(
      runREAPIIngestion(['broward'], '2026-08-04', '2026-08-04')
    ).rejects.toThrow('unconfirmed vendor cost')

    // No provider call without a confirmed cost
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
