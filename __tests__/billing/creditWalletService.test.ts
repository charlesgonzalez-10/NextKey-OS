import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreditWalletService } from '@/lib/billing/creditWalletService'
import { mockFrom } from './setup'

function makeChain(overrides: Record<string, any> = {}) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'eq', 'single', 'in', 'or', 'lte', 'not', 'lt', 'order', 'limit']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  Object.assign(chain, overrides)
  return chain
}

const wallet = (partial: Partial<any> = {}) => ({
  id: 'wallet-1',
  account_id: 'user-1',
  status: 'active' as const,
  available_monthly_credits: 500,
  available_purchased_credits: 0,
  available_bonus_credits: 0,
  reserved_credits: 0,
  lifetime_purchased_credits: 0,
  lifetime_consumed_credits: 0,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...partial,
})

describe('CreditWalletService', () => {
  let service: CreditWalletService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new CreditWalletService()
  })

  describe('getWallet', () => {
    it('returns wallet for a known account', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: wallet(), error: null })
      mockFrom.mockReturnValue(chain)

      const w = await service.getWallet('user-1')
      expect(w).not.toBeNull()
      expect(w!.available_monthly_credits).toBe(500)
    })

    it('returns null for unknown account (PGRST116)', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      mockFrom.mockReturnValue(chain)

      const w = await service.getWallet('nonexistent')
      expect(w).toBeNull()
    })
  })

  describe('getAvailableCredits', () => {
    it('sums all buckets minus reserved', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: wallet({ available_monthly_credits: 300, available_purchased_credits: 100, available_bonus_credits: 50, reserved_credits: 20 }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      const available = await service.getAvailableCredits('user-1')
      expect(available).toBe(430) // 300 + 100 + 50 - 20
    })

    it('returns 0 when wallet does not exist', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      mockFrom.mockReturnValue(chain)

      const available = await service.getAvailableCredits('ghost')
      expect(available).toBe(0)
    })
  })

  describe('grantCredits', () => {
    it('throws when amount is zero or negative', async () => {
      await expect(
        service.grantCredits('user-1', 0, 'monthly', 'subscription')
      ).rejects.toThrow('Credit grant amount must be positive')

      await expect(
        service.grantCredits('user-1', -10, 'monthly', 'subscription')
      ).rejects.toThrow('Credit grant amount must be positive')
    })

    it('updates available_monthly_credits for monthly grants', async () => {
      const insertChain = makeChain()
      insertChain.single = vi.fn().mockResolvedValue({
        data: { id: 'grant-1' },
        error: null,
      })

      let updateCalled = false
      const updateChain = makeChain()
      updateChain.update = vi.fn().mockImplementation((data: any) => {
        if ('available_monthly_credits' in data) updateCalled = true
        return updateChain
      })

      // getWallet call
      let callCount = 0
      mockFrom.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // ensureWalletExists -> getWallet
          const c = makeChain()
          c.single = vi.fn().mockResolvedValue({ data: wallet(), error: null })
          return c
        }
        if (callCount === 2) {
          // insert grant
          return insertChain
        }
        // wallet update + transaction append
        return updateChain
      })

      await service.grantCredits('user-1', 100, 'monthly', 'subscription')
      expect(updateCalled).toBe(true)
    })

    it('updates available_purchased_credits and lifetime_purchased for purchased grants', async () => {
      let purchasedCreditsCalled = false

      mockFrom.mockImplementation(() => {
        const c = makeChain()
        c.single = vi.fn().mockResolvedValue({ data: wallet(), error: null })
        c.update = vi.fn().mockImplementation((data: any) => {
          if ('available_purchased_credits' in data && 'lifetime_purchased_credits' in data) {
            purchasedCreditsCalled = true
          }
          return c
        })
        c.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'grant-1' }, error: null }),
          }),
        })
        return c
      })

      await service.grantCredits('user-1', 50, 'purchased', 'credit_purchase')
      expect(purchasedCreditsCalled).toBe(true)
    })
  })

  describe('consumeCredits', () => {
    it('throws when insufficient credits', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: wallet({ available_monthly_credits: 5, available_purchased_credits: 0, available_bonus_credits: 0, reserved_credits: 0 }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      await expect(
        service.consumeCredits('user-1', 100, 'property_lookup', 'reapi', 'req-1')
      ).rejects.toThrow('Insufficient credits')
    })

    it('throws when wallet not found', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      mockFrom.mockReturnValue(chain)

      await expect(
        service.consumeCredits('ghost', 1, 'feature', 'provider', 'req-1')
      ).rejects.toThrow('No wallet found')
    })

    it('draws from bonus first, then monthly, then purchased', async () => {
      let updateData: any = null
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: wallet({
          available_monthly_credits: 100,
          available_purchased_credits: 100,
          available_bonus_credits: 50,
          reserved_credits: 0,
        }),
        error: null,
      })
      chain.update = vi.fn().mockImplementation((d: any) => {
        updateData = d
        return chain
      })
      mockFrom.mockReturnValue(chain)

      // Request 60 credits: should consume 50 bonus + 10 monthly
      await service.consumeCredits('user-1', 60, 'feature', 'provider', 'req-1')

      expect(updateData).not.toBeNull()
      expect(updateData.available_bonus_credits).toBe(0)   // 50 → 0
      expect(updateData.available_monthly_credits).toBe(90) // 100 → 90
      // purchased untouched
      expect(updateData.available_purchased_credits).toBeUndefined()
    })
  })

  describe('toCustomerResponse', () => {
    it('does not expose reserved_credits or internal fields', () => {
      const w = wallet({ available_monthly_credits: 300, available_purchased_credits: 50, available_bonus_credits: 20, reserved_credits: 10 })
      const response = service.toCustomerResponse(w)

      expect(response.available_credits).toBe(360) // 300 + 50 + 20 - 10
      expect(response.breakdown.monthly).toBe(300)
      expect(response.breakdown.purchased).toBe(50)
      expect(response.breakdown.bonus).toBe(20)
      expect((response as any).reserved_credits).toBeUndefined()
      expect((response as any).wallet_id).toBeUndefined()
      expect((response as any).account_id).toBeUndefined()
    })
  })

  describe('toAdminResponse', () => {
    it('includes internal fields for admin view', () => {
      const w = wallet({ reserved_credits: 5, lifetime_purchased_credits: 200, lifetime_consumed_credits: 100 })
      const response = service.toAdminResponse(w)

      expect(response.reserved_credits).toBe(5)
      expect(response.lifetime_purchased).toBe(200)
      expect(response.lifetime_consumed).toBe(100)
      expect(response.wallet_id).toBe('wallet-1')
      expect(response.account_id).toBe('user-1')
    })
  })
})
