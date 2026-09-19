// Credit pack catalog and purchase record service.
// Purchase fulfillment (credit grant) happens only in the webhook handler,
// never here — this service only manages catalog reads and purchase records.

import { serviceClient } from '@/lib/supabase-service'
import type { CreditProduct } from './types'

export interface CreditPurchaseRecord {
  id: string
  account_id: string
  wallet_id: string
  credit_product_id: string
  payment_provider: string
  external_checkout_id: string | null
  external_payment_id: string | null
  idempotency_key: string
  amount_paid_cents: number
  currency: string
  credits_purchased: number
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'disputed' | 'expired'
  purchased_at: string | null
  discount_amount_cents: number
  promotion_code_id: string | null
  created_at: string
}

export class CreditProductService {

  async getProducts(include_inactive: boolean = false): Promise<CreditProduct[]> {
    let query = serviceClient
      .from('credit_products')
      .select('*')

    if (!include_inactive) query = query.eq('is_active', true)
    query = query.order('display_order', { ascending: true })

    const { data, error } = await query
    if (error) throw new Error(`CreditProductService.getProducts: ${error.message}`)
    return data as CreditProduct[]
  }

  async getProduct(product_key: string): Promise<CreditProduct | null> {
    const { data, error } = await serviceClient
      .from('credit_products')
      .select('*')
      .eq('product_key', product_key)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`CreditProductService.getProduct: ${error.message}`)
    }
    return data as CreditProduct | null
  }

  // Create a pending purchase record before sending the user to checkout.
  // The actual credit grant happens in the webhook handler after payment confirmation.
  async createPendingPurchase(params: {
    account_id: string
    wallet_id: string
    credit_product_id: string
    idempotency_key: string
    promotion_code_id?: string
    discount_amount_cents?: number
  }): Promise<CreditPurchaseRecord> {
    const product = await this.getProductById(params.credit_product_id)
    if (!product) {
      throw new Error(`Credit product not found: ${params.credit_product_id}`)
    }
    if (!product.is_active) {
      throw new Error(`Credit product is not active: ${product.product_key}`)
    }

    // Check purchase limit if set
    if (product.purchase_limit) {
      const { count } = await serviceClient
        .from('credit_purchases')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', params.account_id)
        .eq('credit_product_id', params.credit_product_id)
        .in('status', ['completed'])

      if ((count ?? 0) >= product.purchase_limit) {
        throw new Error(
          `Purchase limit reached for product: ${product.product_key}`
        )
      }
    }

    const { data, error } = await serviceClient
      .from('credit_purchases')
      .insert({
        account_id: params.account_id,
        wallet_id: params.wallet_id,
        credit_product_id: params.credit_product_id,
        idempotency_key: params.idempotency_key,
        amount_paid_cents: 0,
        credits_purchased: product.credit_quantity,
        status: 'pending',
        promotion_code_id: params.promotion_code_id ?? null,
        discount_amount_cents: params.discount_amount_cents ?? 0,
      })
      .select()
      .single()

    if (error) throw new Error(`CreditProductService.createPendingPurchase: ${error.message}`)
    return data as CreditPurchaseRecord
  }

  // Called by webhook handler after payment confirmation.
  // Updates purchase status — credit grant is handled by CreditWalletService separately.
  async completePurchase(params: {
    idempotency_key: string
    external_payment_id: string
    amount_paid_cents: number
    payment_provider: string
  }): Promise<CreditPurchaseRecord> {
    const { data, error } = await serviceClient
      .from('credit_purchases')
      .update({
        status: 'completed',
        external_payment_id: params.external_payment_id,
        amount_paid_cents: params.amount_paid_cents,
        payment_provider: params.payment_provider,
        purchased_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('idempotency_key', params.idempotency_key)
      .eq('status', 'pending')
      .select()
      .single()

    if (error) throw new Error(`CreditProductService.completePurchase: ${error.message}`)
    return data as CreditPurchaseRecord
  }

  async failPurchase(idempotency_key: string): Promise<void> {
    await serviceClient
      .from('credit_purchases')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('idempotency_key', idempotency_key)
      .eq('status', 'pending')
  }

  async getPurchaseHistory(
    account_id: string,
    limit: number = 20
  ): Promise<CreditPurchaseRecord[]> {
    const { data, error } = await serviceClient
      .from('credit_purchases')
      .select('*')
      .eq('account_id', account_id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`CreditProductService.getPurchaseHistory: ${error.message}`)
    return data as CreditPurchaseRecord[]
  }

  async getPurchaseByIdempotencyKey(
    idempotency_key: string
  ): Promise<CreditPurchaseRecord | null> {
    const { data, error } = await serviceClient
      .from('credit_purchases')
      .select('*')
      .eq('idempotency_key', idempotency_key)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`CreditProductService.getPurchaseByIdempotencyKey: ${error.message}`)
    }
    return data as CreditPurchaseRecord | null
  }

  private async getProductById(id: string): Promise<CreditProduct | null> {
    const { data, error } = await serviceClient
      .from('credit_products')
      .select('*')
      .eq('id', id)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`CreditProductService.getProductById: ${error.message}`)
    }
    return data as CreditProduct | null
  }
}

export const creditProductService = new CreditProductService()
