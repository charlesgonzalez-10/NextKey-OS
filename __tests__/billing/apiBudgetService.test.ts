import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiBudgetService } from '@/lib/billing/apiBudgetService'
import { mockFrom, mockRpc, mockSingle, mockEq, mockUpdate, mockSelect, mockOrder } from './setup'

function makeChain(overrides: Record<string, any> = {}) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'eq', 'single', 'in', 'or', 'lte', 'not', 'lt', 'order', 'limit', 'filter']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  Object.assign(chain, overrides)
  return chain
}

const pool = (partial: Partial<any> = {}) => ({
  id: 'pool-1',
  pool_key: 'customer_shared',
  display_name: 'Customer Shared',
  monthly_limit_cents: 5000,
  spent_this_period_cents: 1000,
  period_start: '2026-07-01T00:00:00Z',
  period_end: '2026-08-01T00:00:00Z',
  is_protected: false,
  requires_owner_override: false,
  priority: 10,
  is_active: true,
  ...partial,
})

describe('ApiBudgetService', () => {
  let service: ApiBudgetService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ApiBudgetService()
  })

  describe('getPools', () => {
    it('returns active pools ordered by priority', async () => {
      const chain = makeChain()
      chain.order = vi.fn().mockResolvedValue({ data: [pool()], error: null })
      mockFrom.mockReturnValue(chain)

      const result = await service.getPools()
      expect(result).toHaveLength(1)
      expect(result[0].pool_key).toBe('customer_shared')
      expect(chain.eq).toHaveBeenCalledWith('is_active', true)
    })

    it('throws on database error', async () => {
      const chain = makeChain()
      chain.order = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
      mockFrom.mockReturnValue(chain)

      await expect(service.getPools()).rejects.toThrow('ApiBudgetService.getPools: DB error')
    })
  })

  describe('getBudgetStatus', () => {
    it('calculates global totals across all pools', async () => {
      const pools = [
        pool({ pool_key: 'owner_reserved', monthly_limit_cents: 3000, spent_this_period_cents: 600 }),
        pool({ pool_key: 'customer_shared', monthly_limit_cents: 5000, spent_this_period_cents: 1000 }),
        pool({ pool_key: 'emergency_reserved', monthly_limit_cents: 1500, spent_this_period_cents: 0 }),
        pool({ pool_key: 'background_operations', monthly_limit_cents: 500, spent_this_period_cents: 100 }),
      ]

      const chain = makeChain()
      chain.order = vi.fn().mockResolvedValue({ data: pools, error: null })
      mockFrom.mockReturnValue(chain)

      const status = await service.getBudgetStatus()
      expect(status.global_limit_cents).toBe(10000)
      expect(status.global_spent_cents).toBe(1700)
      expect(status.global_available_cents).toBe(8300)
      expect(status.global_utilization_pct).toBe(17)
      expect(status.pools).toHaveLength(4)
    })

    it('computes per-pool utilization correctly', async () => {
      const pools = [pool({ monthly_limit_cents: 5000, spent_this_period_cents: 4000 })]
      const chain = makeChain()
      chain.order = vi.fn().mockResolvedValue({ data: pools, error: null })
      mockFrom.mockReturnValue(chain)

      const status = await service.getBudgetStatus()
      expect(status.pools[0].utilization_pct).toBe(80)
    })
  })

  describe('updatePoolLimit', () => {
    it('rejects if new limit would push total above 10000¢', async () => {
      const pools = [
        pool({ pool_key: 'owner_reserved', monthly_limit_cents: 3000 }),
        pool({ pool_key: 'customer_shared', monthly_limit_cents: 5000 }),
        pool({ pool_key: 'emergency_reserved', monthly_limit_cents: 1500 }),
        pool({ pool_key: 'background_operations', monthly_limit_cents: 500 }),
      ]

      const chain = makeChain()
      chain.order = vi.fn().mockResolvedValue({ data: pools, error: null })
      mockFrom.mockReturnValue(chain)

      await expect(
        service.updatePoolLimit('customer_shared', 6000)
      ).rejects.toThrow('exceed the $100 platform budget')
    })

    it('allows a limit change that keeps total at or below 10000¢', async () => {
      const pools = [
        pool({ pool_key: 'owner_reserved', monthly_limit_cents: 3000 }),
        pool({ pool_key: 'customer_shared', monthly_limit_cents: 5000 }),
        pool({ pool_key: 'emergency_reserved', monthly_limit_cents: 1500 }),
        pool({ pool_key: 'background_operations', monthly_limit_cents: 500 }),
      ]

      // getPools chain: select → eq → order → resolves
      const getChain = makeChain()
      getChain.order = vi.fn().mockResolvedValue({ data: pools, error: null })

      // updatePoolLimit chain: update → eq → resolves
      const updateChain = makeChain()
      updateChain.update = vi.fn().mockReturnValue(updateChain)
      updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null })

      mockFrom
        .mockReturnValueOnce(getChain)  // getPools call
        .mockReturnValueOnce(updateChain) // update call

      await expect(
        service.updatePoolLimit('customer_shared', 5000) // same = total stays at 10000
      ).resolves.not.toThrow()
    })
  })

  describe('finalizeReservation', () => {
    it('marks reservation as finalized with actual cost', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: {
          id: 'res-1',
          request_id: 'req-1',
          pool_key: 'customer_shared',
          estimated_cost_cents: 5,
        },
        error: null,
      })
      chain.update = vi.fn().mockReturnValue(chain)
      mockFrom.mockReturnValue(chain)
      mockRpc.mockResolvedValue({ data: null, error: null })

      await expect(
        service.finalizeReservation('req-1', 4, 'finalized')
      ).resolves.not.toThrow()
    })

    it('throws if reservation not found', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
      mockFrom.mockReturnValue(chain)

      await expect(
        service.finalizeReservation('nonexistent', 4, 'finalized')
      ).rejects.toThrow('No reservation found')
    })
  })
})
