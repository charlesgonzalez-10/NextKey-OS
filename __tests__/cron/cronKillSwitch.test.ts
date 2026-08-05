/**
 * Cron kill-switch tests
 *
 * Confirms that when CRON_REFRESH_SAVED_ENABLED=false or
 * CRON_INGEST_DISTRESS_ENABLED=false the cron route:
 *   - returns { status: 'paused', reason: 'cron_disabled' }
 *   - makes zero provider calls
 *   - creates zero budget reservations
 *   - consumes zero credits
 *   - modifies no checkpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockAuthorize, mockFinalize, mockFrom, mockFetch } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockFinalize:  vi.fn(),
  mockFrom:      vi.fn(),
  mockFetch:     vi.fn(),
}))

vi.mock('next/server', () => {
  class MockNextResponse {
    private body: unknown
    private init: ResponseInit
    constructor(body: unknown, init?: ResponseInit) {
      this.body = body
      this.init = init ?? {}
    }
    async json() { return this.body }
    get status() { return (this.init as { status?: number }).status ?? 200 }

    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init)
    }
  }
  return { NextResponse: MockNextResponse }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/billing/providerGateway', () => ({
  providerGateway: { authorize: mockAuthorize, finalize: mockFinalize },
  ProviderGateway:  class {},
}))

vi.mock('@/lib/billing/pricingEngine', () => ({
  pricingEngine: { getActivePricing: vi.fn() },
  PricingEngine:  class {},
}))

vi.mock('@/lib/ingestion/reapi-engine', () => ({
  runREAPIIngestion:       vi.fn(),
  DEFAULT_INGESTION_CONFIG: {},
  INGESTION_FEATURE_KEY:   'property_search_criteria',
}))

vi.mock('@/lib/ingestion/reapi-case-lookup', () => ({
  lookupCaseNumber: vi.fn(),
  CASE_LOOKUP_FEATURE_KEY: 'property_detail_lookup',
}))

vi.mock('@/lib/enrichment/reapi', () => ({
  getPropertyByAPN:           vi.fn(),
  getPropertyDetailByAddress:  vi.fn(),
}))

vi.mock('@/lib/propertyService', () => ({
  markModuleRefreshed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/billing/gatewayContext', () => ({
  BACKGROUND_CONTEXT: {
    account_id: '00000000-0000-0000-0000-000000000001',
    pool_key:   'background_operations',
  },
}))

vi.stubGlobal('fetch', mockFetch)

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret-abc'

function makeRequest(url = 'http://localhost/api/cron/test') {
  return new Request(url, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('refresh-saved kill switch', () => {
  let originalSecret: string | undefined
  let originalEnabled: string | undefined

  beforeEach(() => {
    vi.resetAllMocks()
    originalSecret  = process.env.CRON_SECRET
    originalEnabled = process.env.CRON_REFRESH_SAVED_ENABLED
    process.env.CRON_SECRET = CRON_SECRET
    process.env.CRON_REFRESH_SAVED_ENABLED = 'false'
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
    if (originalEnabled === undefined) {
      delete process.env.CRON_REFRESH_SAVED_ENABLED
    } else {
      process.env.CRON_REFRESH_SAVED_ENABLED = originalEnabled
    }
  })

  it('returns paused response when disabled', async () => {
    const { GET } = await import('@/app/api/cron/refresh-saved/route')
    const res     = await GET(makeRequest())
    const body    = await (res as unknown as { json(): Promise<unknown> }).json()

    expect(body).toEqual({ status: 'paused', reason: 'cron_disabled' })
  })

  it('makes zero provider calls when disabled', async () => {
    const { GET } = await import('@/app/api/cron/refresh-saved/route')
    await GET(makeRequest())

    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockFinalize).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('creates zero budget reservations when disabled', async () => {
    const { GET } = await import('@/app/api/cron/refresh-saved/route')
    await GET(makeRequest())
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('consumes zero credits when disabled', async () => {
    const { GET } = await import('@/app/api/cron/refresh-saved/route')
    await GET(makeRequest())
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockFinalize).not.toHaveBeenCalled()
  })

  it('modifies no checkpoints when disabled', async () => {
    const { GET } = await import('@/app/api/cron/refresh-saved/route')
    await GET(makeRequest())
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('ingest-distress kill switch', () => {
  let originalSecret: string | undefined
  let originalEnabled: string | undefined

  beforeEach(() => {
    vi.resetAllMocks()
    originalSecret  = process.env.CRON_SECRET
    originalEnabled = process.env.CRON_INGEST_DISTRESS_ENABLED
    process.env.CRON_SECRET = CRON_SECRET
    process.env.CRON_INGEST_DISTRESS_ENABLED = 'false'
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
    if (originalEnabled === undefined) {
      delete process.env.CRON_INGEST_DISTRESS_ENABLED
    } else {
      process.env.CRON_INGEST_DISTRESS_ENABLED = originalEnabled
    }
  })

  it('returns paused response when disabled', async () => {
    const { GET } = await import('@/app/api/cron/ingest-distress/route')
    const res     = await GET(makeRequest())
    const body    = await (res as unknown as { json(): Promise<unknown> }).json()

    expect(body).toEqual({ status: 'paused', reason: 'cron_disabled' })
  })

  it('makes zero REAPI calls when disabled', async () => {
    const { runREAPIIngestion } = await import('@/lib/ingestion/reapi-engine')
    const { GET } = await import('@/app/api/cron/ingest-distress/route')
    await GET(makeRequest())

    expect(runREAPIIngestion).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('creates zero budget reservations when disabled', async () => {
    const { GET } = await import('@/app/api/cron/ingest-distress/route')
    await GET(makeRequest())
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('consumes zero credits when disabled', async () => {
    const { GET } = await import('@/app/api/cron/ingest-distress/route')
    await GET(makeRequest())
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockFinalize).not.toHaveBeenCalled()
  })

  it('modifies no checkpoints when disabled', async () => {
    const { GET } = await import('@/app/api/cron/ingest-distress/route')
    await GET(makeRequest())
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
