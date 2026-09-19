/**
 * Classified reconciliation service tests.
 *
 * Covers:
 *   - classifyStaleReservations: A (no event), B (success event), C (failed event)
 *   - reconcileStaleReservations: zero when empty; category processing; idempotency
 *   - detectReservedCreditsDrift: zero, positive, negative
 *   - Category B never writes a duplicate usage event (source code invariant)
 *   - Active (non-expired) reservations are never touched (source code invariant)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockServiceFrom, mockServiceRpc } = vi.hoisted(() => ({
  mockServiceFrom: vi.fn(),
  mockServiceRpc:  vi.fn(),
}))

vi.mock('@/lib/supabase-service', () => ({
  serviceClient: {
    from: mockServiceFrom,
    rpc:  mockServiceRpc,
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import {
  classifyStaleReservations,
  reconcileStaleReservations,
  detectReservedCreditsDrift,
} from '@/lib/billing/reconciliationService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(overrides: Record<string, any> = {}): any {
  const chain: Record<string, unknown> = {
    select:      () => chain,
    eq:          () => chain,
    gt:          () => chain,
    lt:          () => chain,
    gte:         () => chain,
    single:      () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then:        (fn: (v: { data: unknown; error: null; count: number | null }) => unknown) =>
                   Promise.resolve(fn({ data: [], error: null, count: 0 })),
    insert:      () => ({ then: (fn: (v: { data: null; error: null }) => unknown) => Promise.resolve(fn({ data: null, error: null })) }),
    update:      () => chain,
    ...overrides,
  }
  return chain
}

const pastDate = new Date(Date.now() - 3_600_000).toISOString()

// ─── classifyStaleReservations ─────────────────────────────────────────────────

describe('classifyStaleReservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServiceRpc.mockResolvedValue({ data: null, error: null })
  })

  it('returns empty array when no stale reservations', async () => {
    mockServiceFrom.mockReturnValue(makeChain({
      then: (fn: (v: { data: []; error: null }) => unknown) => Promise.resolve(fn({ data: [], error: null })),
    }))

    const result = await classifyStaleReservations()
    expect(result).toEqual([])
  })

  it('classifies as A when no usage event exists', async () => {
    const staleRes = {
      id: 'bud-1', request_id: 'req-A', account_id: 'acct-A',
      pool_key: 'customer_shared', provider_key: 'reapi', feature_key: 'property_search',
      estimated_cost_cents: 5, expires_at: pastDate,
    }

    let callIndex = 0
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'api_budget_reservations') {
        // First call: SELECT stale
        if (callIndex++ === 0) {
          return makeChain({
            then: (fn: (v: { data: typeof staleRes[]; error: null }) => unknown) =>
              Promise.resolve(fn({ data: [staleRes], error: null })),
          })
        }
      }
      if (table === 'credit_reservations') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })
      }
      if (table === 'api_usage_events') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })
      }
      return makeChain()
    })

    const result = await classifyStaleReservations()
    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('A')
    expect(result[0].usage_event_found).toBe(false)
    expect(result[0].request_id).toBe('req-A')
  })

  it('classifies as B when usage event with success=true exists', async () => {
    const staleRes = {
      id: 'bud-2', request_id: 'req-B', account_id: 'acct-B',
      pool_key: 'customer_shared', provider_key: 'reapi', feature_key: 'property_search',
      estimated_cost_cents: 5, expires_at: pastDate,
    }
    const usageEvent = { success: true, provider_called: true, actual_cost_cents: 5 }

    let callIndex = 0
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'api_budget_reservations' && callIndex++ === 0) {
        return makeChain({
          then: (fn: (v: { data: typeof staleRes[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [staleRes], error: null })),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: { id: 'cr-1', reserved_credits: 1 }, error: null }) })
      }
      if (table === 'api_usage_events') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: usageEvent, error: null }) })
      }
      return makeChain()
    })

    const result = await classifyStaleReservations()
    expect(result[0].category).toBe('B')
    expect(result[0].usage_event_found).toBe(true)
    expect(result[0].usage_success).toBe(true)
    expect(result[0].actual_cost_cents).toBe(5)
  })

  it('classifies as C when usage event with success=false exists', async () => {
    const staleRes = {
      id: 'bud-3', request_id: 'req-C', account_id: 'acct-C',
      pool_key: 'customer_shared', provider_key: 'reapi', feature_key: 'property_search',
      estimated_cost_cents: 5, expires_at: pastDate,
    }
    const usageEvent = { success: false, provider_called: true, actual_cost_cents: 0 }

    let callIndex = 0
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'api_budget_reservations' && callIndex++ === 0) {
        return makeChain({
          then: (fn: (v: { data: typeof staleRes[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [staleRes], error: null })),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })
      }
      if (table === 'api_usage_events') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: usageEvent, error: null }) })
      }
      return makeChain()
    })

    const result = await classifyStaleReservations()
    expect(result[0].category).toBe('C')
    expect(result[0].usage_success).toBe(false)
  })
})

// ─── reconcileStaleReservations ────────────────────────────────────────────────

describe('reconcileStaleReservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServiceRpc.mockResolvedValue({ data: null, error: null })
  })

  it('returns zero counts and empty errors when nothing is stale', async () => {
    mockServiceFrom.mockImplementation(() => makeChain({
      then: (fn: (v: { data: []; error: null; count: 0 }) => unknown) =>
        Promise.resolve(fn({ data: [], error: null, count: 0 })),
    }))

    const result = await reconcileStaleReservations()
    expect(result.category_A_processed).toBe(0)
    expect(result.category_B_processed).toBe(0)
    expect(result.category_C_needs_review).toBe(0)
    expect(result.drift_corrected).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('includes run_at timestamp', async () => {
    mockServiceFrom.mockImplementation(() => makeChain({
      then: (fn: (v: { data: []; error: null; count: 0 }) => unknown) =>
        Promise.resolve(fn({ data: [], error: null, count: 0 })),
    }))

    const before = new Date().toISOString()
    const result = await reconcileStaleReservations()
    const after  = new Date().toISOString()
    expect(result.run_at >= before).toBe(true)
    expect(result.run_at <= after).toBe(true)
  })

  it('is idempotent: guard returns 0 rows → no pool/credit adjustments called', async () => {
    // Simulates: stale reservation found, but UPDATE budget WHERE status='reserved' affects 0 rows
    // (already processed by a previous run)
    const staleRes = {
      id: 'bud-idem', request_id: 'req-idem', account_id: 'acct-idem',
      pool_key: 'customer_shared', provider_key: 'reapi', feature_key: 'property_search',
      estimated_cost_cents: 5, expires_at: pastDate,
    }

    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'api_budget_reservations') {
        return makeChain({
          // SELECT stale returns 1 row
          then: (fn: (v: { data: typeof staleRes[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [staleRes], error: null })),
          // UPDATE ...select('id') returns 0 rows (already updated)
          select: () => makeChain({
            then: (fn: (v: { data: []; error: null }) => unknown) =>
              Promise.resolve(fn({ data: [], error: null })),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })
      }
      if (table === 'api_usage_events') {
        return makeChain({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })
      }
      if (table === 'credit_wallets') {
        return makeChain({
          then: (fn: (v: { data: []; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [], error: null })),
        })
      }
      return makeChain()
    })

    await reconcileStaleReservations()

    // Pool/cap/credit adjustments should NOT have been called (guard returned 0 rows)
    const rpcCalls = mockServiceRpc.mock.calls.map(c => c[0] as string)
    expect(rpcCalls).not.toContain('fn_adjust_pool_spent')
    expect(rpcCalls).not.toContain('fn_adjust_account_cost')
    expect(rpcCalls).not.toContain('fn_adjust_reserved_credits')
  })

  it('corrects positive wallet drift via fn_adjust_reserved_credits', async () => {
    // All tables: empty stale reservations, but wallet has positive drift
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'api_budget_reservations') {
        return makeChain({
          then: (fn: (v: { data: []; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [], error: null })),
        })
      }
      if (table === 'credit_wallets') {
        return makeChain({
          then: (fn: (v: { data: { id: string; account_id: string; reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [{ id: 'wid-1', account_id: 'acct-drift', reserved_credits: 10 }], error: null })),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({
          then: (fn: (v: { data: []; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [], error: null })),  // 0 active → drift = +10
        })
      }
      return makeChain()
    })

    const result = await reconcileStaleReservations()
    expect(result.drift_corrected).toBe(1)
    expect(mockServiceRpc).toHaveBeenCalledWith('fn_adjust_reserved_credits', {
      p_account_id: 'acct-drift',
      p_delta:      -10,
    })
  })

  it('does NOT correct negative drift (under-reserved)', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'api_budget_reservations') {
        return makeChain({
          then: (fn: (v: { data: []; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [], error: null })),
        })
      }
      if (table === 'credit_wallets') {
        return makeChain({
          then: (fn: (v: { data: { id: string; account_id: string; reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [{ id: 'wid-neg', account_id: 'acct-neg', reserved_credits: 1 }], error: null })),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({
          then: (fn: (v: { data: { wallet_id: string; reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [
              { wallet_id: 'wid-neg', reserved_credits: 2 },
              { wallet_id: 'wid-neg', reserved_credits: 2 },
            ], error: null })),  // actual=4 > wallet=1 → drift=-3 (negative, not corrected)
        })
      }
      return makeChain()
    })

    const result = await reconcileStaleReservations()
    expect(result.drift_corrected).toBe(0)
    const rpcCalls = mockServiceRpc.mock.calls.map(c => c[0] as string)
    expect(rpcCalls).not.toContain('fn_adjust_reserved_credits')
  })
})

// ─── detectReservedCreditsDrift ────────────────────────────────────────────────

describe('detectReservedCreditsDrift', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no wallets', async () => {
    mockServiceFrom.mockReturnValue(makeChain({
      then: (fn: (v: { data: []; error: null }) => unknown) =>
        Promise.resolve(fn({ data: [], error: null })),
    }))
    const result = await detectReservedCreditsDrift()
    expect(result).toEqual([])
  })

  it('reports zero drift when wallet matches active credit_reservations', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'credit_wallets') {
        return makeChain({
          then: (fn: (v: { data: { id: string; account_id: string; reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [{ id: 'w1', account_id: 'a1', reserved_credits: 3 }], error: null })),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({
          then: (fn: (v: { data: { reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [{ reserved_credits: 1 }, { reserved_credits: 2 }], error: null })),
        })
      }
      return makeChain()
    })

    const result = await detectReservedCreditsDrift()
    expect(result).toHaveLength(1)
    expect(result[0].drift).toBe(0)
    expect(result[0].wallet_reserved).toBe(3)
    expect(result[0].actual_active).toBe(3)
  })

  it('reports positive drift (over-reserved)', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'credit_wallets') {
        return makeChain({
          then: (fn: (v: { data: { id: string; account_id: string; reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [{ id: 'w2', account_id: 'a2', reserved_credits: 16 }], error: null })),
        })
      }
      if (table === 'credit_reservations') {
        return makeChain({
          then: (fn: (v: { data: { reserved_credits: number }[]; error: null }) => unknown) =>
            Promise.resolve(fn({ data: [{ reserved_credits: 1 }], error: null })),
        })
      }
      return makeChain()
    })

    const result = await detectReservedCreditsDrift()
    expect(result[0].drift).toBe(15)
    expect(result[0].wallet_reserved).toBe(16)
    expect(result[0].actual_active).toBe(1)
  })
})

// ─── Source code invariants ────────────────────────────────────────────────────

describe('Category B invariant: no duplicate usage event INSERT', () => {
  it('reconcileCategoryB never calls api_usage_events.insert', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(process.cwd(), 'lib/billing/reconciliationService.ts'), 'utf-8')

    // Find the reconcileCategoryB function
    const fnStart = source.indexOf('async function reconcileCategoryB')
    const fnEnd   = source.indexOf('\nasync function reconcileCategoryC')
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const catBSource = source.slice(fnStart, fnEnd)

    // Must not insert to api_usage_events within Category B
    expect(catBSource).not.toContain("from('api_usage_events')")
    expect(catBSource).not.toContain('.insert(')
  })

  it('comment in Category B explains why no usage event is inserted', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(process.cwd(), 'lib/billing/reconciliationService.ts'), 'utf-8')
    expect(source).toContain('UNIQUE')
    expect(source).toContain('usage event')
  })
})

describe('Active reservation protection: filters by expires_at', () => {
  it('classifyStaleReservations uses expires_at < now filter (active reservations are never touched)', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(process.cwd(), 'lib/billing/reconciliationService.ts'), 'utf-8')

    const fnStart = source.indexOf('export async function classifyStaleReservations')
    expect(fnStart).toBeGreaterThan(-1)
    const fnSnippet = source.slice(fnStart, fnStart + 800)

    expect(fnSnippet).toContain("eq('status', 'reserved')")
    expect(fnSnippet).toContain("lt('expires_at', now)")
  })
})

describe('Category C invariant: no credit changes', () => {
  it('reconcileCategoryC never calls fn_adjust_reserved_credits', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(process.cwd(), 'lib/billing/reconciliationService.ts'), 'utf-8')

    const fnStart = source.indexOf('async function reconcileCategoryC')
    const fnEnd   = source.indexOf('\nexport async function reconcileStaleReservations')
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const catCSource = source.slice(fnStart, fnEnd)

    expect(catCSource).not.toContain('fn_adjust_reserved_credits')
    expect(catCSource).not.toContain('fn_adjust_pool_spent')
    expect(catCSource).not.toContain('fn_adjust_account_cost')
  })
})
