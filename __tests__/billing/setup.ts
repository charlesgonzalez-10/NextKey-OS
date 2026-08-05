import { vi } from 'vitest'

// Mock the Supabase service client used by all billing services.
// This prevents any real DB connections during tests.

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockUpsert = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockIn = vi.fn()
const mockOr = vi.fn()
const mockLte = vi.fn()
const mockNot = vi.fn()
const mockLt = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()

const chainable = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  upsert: mockUpsert,
  eq: mockEq,
  single: mockSingle,
  in: mockIn,
  or: mockOr,
  lte: mockLte,
  not: mockNot,
  lt: mockLt,
  order: mockOrder,
  limit: mockLimit,
}

// Each method returns itself for chaining, defaulting to an empty success response
for (const key of Object.keys(chainable)) {
  ;(chainable as any)[key].mockReturnValue(chainable)
}
mockSingle.mockResolvedValue({ data: null, error: null })
mockSelect.mockReturnValue({ ...chainable, then: (fn: any) => Promise.resolve(fn({ data: [], error: null })) })

mockFrom.mockReturnValue(chainable)
mockRpc.mockResolvedValue({ data: null, error: null })

vi.mock('@/lib/supabase-service', () => ({
  serviceClient: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

export { mockFrom, mockRpc, mockSelect, mockInsert, mockUpdate, mockEq, mockSingle, mockIn, mockOr, mockLte, mockOrder, mockLimit, mockLt, mockNot, mockUpsert }
