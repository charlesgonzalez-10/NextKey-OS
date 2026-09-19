import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PricingEngine } from '@/lib/billing/pricingEngine'
import { mockFrom } from './setup'

function makeChain(overrides: Record<string, any> = {}) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'eq', 'single', 'or', 'lte', 'order', 'limit']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  Object.assign(chain, overrides)
  return chain
}

const pricing = (partial: Partial<any> = {}) => ({
  id: 'fpv-1',
  feature_key: 'property_lookup_basic',
  display_name: 'Basic Property Lookup',
  provider_key: 'reapi',
  expected_vendor_cost_cents: 5,
  platform_overhead_cents: 1,
  risk_buffer_cents: 0,
  target_margin_pct: null,
  customer_credit_cost: 1,
  is_enabled: true,
  disable_reason: null,
  requires_confirmed_cost: false,
  effective_from: '2026-07-01T00:00:00Z',
  effective_to: null,
  is_active: true,
  ...partial,
})

describe('PricingEngine', () => {
  let engine: PricingEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new PricingEngine()
  })

  describe('getActivePricing', () => {
    it('returns null for unknown feature', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } })
      mockFrom.mockReturnValue(chain)

      const result = await engine.getActivePricing('unknown_feature')
      expect(result).toBeNull()
    })

    it('returns active pricing for a known feature', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: pricing(), error: null })
      mockFrom.mockReturnValue(chain)

      const result = await engine.getActivePricing('property_lookup_basic')
      expect(result).not.toBeNull()
      expect(result!.customer_credit_cost).toBe(1)
    })
  })

  describe('getCreditCost', () => {
    it('returns credit cost for enabled feature', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: pricing({ customer_credit_cost: 5 }), error: null })
      mockFrom.mockReturnValue(chain)

      const cost = await engine.getCreditCost('property_report_full')
      expect(cost).toBe(5)
    })

    it('returns 0 when feature not found', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      mockFrom.mockReturnValue(chain)

      const cost = await engine.getCreditCost('ghost_feature')
      expect(cost).toBe(0)
    })
  })

  describe('getProfitabilityEstimate', () => {
    it('calculates total cost as sum of vendor + overhead + risk', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({
        data: pricing({ expected_vendor_cost_cents: 5, platform_overhead_cents: 1, risk_buffer_cents: 1 }),
        error: null,
      })
      mockFrom.mockReturnValue(chain)

      const est = await engine.getProfitabilityEstimate('property_lookup_basic')
      expect(est).not.toBeNull()
      expect(est!.total_cost_cents).toBe(7) // 5 + 1 + 1
      expect(est!.overhead_cents).toBe(2)   // 1 + 1
    })

    it('returns null when no pricing found', async () => {
      const chain = makeChain()
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      mockFrom.mockReturnValue(chain)

      const est = await engine.getProfitabilityEstimate('unknown')
      expect(est).toBeNull()
    })
  })

  describe('createPricingVersion', () => {
    it('blocks enabling a feature with unknown vendor cost', async () => {
      await expect(
        engine.createPricingVersion({
          feature_key: 'ai_analysis',
          display_name: 'AI Analysis',
          expected_vendor_cost_cents: 0,
          customer_credit_cost: 2,
          is_enabled: true,
        })
      ).rejects.toThrow('unknown vendor cost')
    })

    it('allows disabling a feature even with zero cost', async () => {
      const chain = makeChain()
      // update call to deactivate existing versions
      chain.update = vi.fn().mockReturnValue(chain)
      // insert new version
      const insertChain = makeChain()
      insertChain.single = vi.fn().mockResolvedValue({ data: pricing({ is_enabled: false }), error: null })
      insertChain.insert = vi.fn().mockReturnValue(insertChain)

      mockFrom.mockReturnValueOnce(chain).mockReturnValueOnce(insertChain)

      await expect(
        engine.createPricingVersion({
          feature_key: 'ai_analysis',
          display_name: 'AI Analysis',
          expected_vendor_cost_cents: 0,
          customer_credit_cost: 2,
          is_enabled: false,
          disable_reason: 'Cost not confirmed',
        })
      ).resolves.not.toThrow()
    })

    it('allows enabling a genuinely free feature (requires_confirmed_cost=false)', async () => {
      const chain = makeChain()
      chain.update = vi.fn().mockReturnValue(chain)
      const insertChain = makeChain()
      insertChain.single = vi.fn().mockResolvedValue({ data: pricing({ expected_vendor_cost_cents: 0 }), error: null })
      insertChain.insert = vi.fn().mockReturnValue(insertChain)

      mockFrom.mockReturnValueOnce(chain).mockReturnValueOnce(insertChain)

      await expect(
        engine.createPricingVersion({
          feature_key: 'geocode',
          display_name: 'Geocoding',
          expected_vendor_cost_cents: 0,
          customer_credit_cost: 0,
          is_enabled: true,
          requires_confirmed_cost: false,
        })
      ).resolves.not.toThrow()
    })
  })
})
