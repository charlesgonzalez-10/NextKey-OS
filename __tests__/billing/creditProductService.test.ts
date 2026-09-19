/**
 * CreditProductService — focused tests for purchase lifecycle.
 *
 * PP1: completePurchase records payment_provider = 'stripe' on Stripe completion.
 * PP2: payment_provider is propagated from the params, not hard-coded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreditProductService } from '@/lib/billing/creditProductService'
import { mockFrom } from './setup'

function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'update', 'eq', 'single', 'in', 'not', 'order', 'limit', 'is', 'gt', 'maybeSingle']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single    = vi.fn().mockResolvedValue({ data: null, error: null })
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  Object.assign(chain, overrides)
  return chain
}

const completedPurchase = (partial: Record<string, unknown> = {}) => ({
  id: 'purchase-1',
  account_id: 'account-1',
  wallet_id: 'wallet-1',
  credit_product_id: 'product-1',
  payment_provider: 'stripe',
  external_checkout_id: null,
  external_payment_id: 'pi_test_001',
  idempotency_key: 'ik-001',
  amount_paid_cents: 1200,
  currency: 'USD',
  credits_purchased: 250,
  status: 'completed',
  purchased_at: '2026-09-01T17:10:42.787+00:00',
  discount_amount_cents: 0,
  promotion_code_id: null,
  created_at: '2026-09-01T17:08:00.000Z',
  ...partial,
})

describe('CreditProductService', () => {
  let service: CreditProductService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new CreditProductService()
  })

  // PP1 — Stripe completion sets payment_provider = 'stripe'
  it('PP1: completePurchase records payment_provider=stripe on Stripe completion', async () => {
    const chain = makeChain()
    chain.single = vi.fn().mockResolvedValue({ data: completedPurchase(), error: null })
    const mockUpdate = vi.fn().mockReturnValue(chain)
    mockFrom.mockReturnValue({ update: mockUpdate })

    await service.completePurchase({
      idempotency_key:     'ik-001',
      external_payment_id: 'pi_test_001',
      amount_paid_cents:   1200,
      payment_provider:    'stripe',
    })

    const updatePayload = mockUpdate.mock.calls[0][0]
    expect(updatePayload).toMatchObject({
      status:              'completed',
      payment_provider:    'stripe',
      external_payment_id: 'pi_test_001',
      amount_paid_cents:   1200,
    })
  })

  // PP2 — payment_provider is taken from params (not hard-coded to 'stripe')
  it('PP2: completePurchase propagates any payment_provider from params', async () => {
    const chain = makeChain()
    chain.single = vi.fn().mockResolvedValue({
      data: completedPurchase({ payment_provider: 'promotion' }),
      error: null,
    })
    const mockUpdate = vi.fn().mockReturnValue(chain)
    mockFrom.mockReturnValue({ update: mockUpdate })

    await service.completePurchase({
      idempotency_key:     'ik-002',
      external_payment_id: 'promo_ref_001',
      amount_paid_cents:   0,
      payment_provider:    'promotion',
    })

    const updatePayload = mockUpdate.mock.calls[0][0]
    expect(updatePayload.payment_provider).toBe('promotion')
  })
})
