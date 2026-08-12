// Stripe Checkout Session creation — TEST MODE ONLY.
//
// POST body:
//   { type: 'subscription', plan_key: string, promotion_code?: string }
//   { type: 'credit_pack',  product_key: string, promotion_code?: string }
//
// Security rules (must never be relaxed):
//   - Price IDs are read from the DB, never from the client.
//   - Credits are only granted from the verified webhook — never here.
//   - Customer payment must NOT increase global budget, provider budgets, or vendor caps.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { stripeProvider } from '@/lib/billing/stripe/stripeProvider'
import { subscriptionPlanService } from '@/lib/billing/subscriptionPlanService'
import { creditProductService } from '@/lib/billing/creditProductService'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const type           = body.type as string
  const promotionCode  = typeof body.promotion_code === 'string' ? body.promotion_code : undefined

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (type === 'subscription') {
    const planKey = typeof body.plan_key === 'string' ? body.plan_key : null
    if (!planKey) return NextResponse.json({ error: 'plan_key is required' }, { status: 400 })

    const plan = await subscriptionPlanService.getPlan(planKey)
    if (!plan || !plan.is_active) {
      return NextResponse.json({ error: 'Plan not found or not active' }, { status: 404 })
    }
    // Price ID must come from the DB — never from the client
    const priceId = plan.external_price_id_monthly
    if (!priceId) {
      return NextResponse.json({ error: 'Plan has no configured price. Contact support.' }, { status: 422 })
    }

    // Find or create Stripe customer
    const externalCustomerId = await ensureStripeCustomer(user.id, user.email ?? '')

    // Day-stable idempotency: one checkout session per account+plan per calendar day.
    // Prevents duplicate Stripe objects if the connection drops and the client retries.
    const dayEpoch = Math.floor(Date.now() / 86_400_000)
    const stripeIdempotencyKey = `checkout:subscription:${user.id}:${plan.id}:${dayEpoch}`

    try {
      const session = await stripeProvider.createCheckoutSession({
        account_id:           user.id,
        external_customer_id: externalCustomerId,
        line_items:           [{ price_id: priceId, quantity: 1 }],
        success_url:          `${origin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:           `${origin}/billing?checkout=cancelled`,
        mode:                 'subscription',
        idempotency_key:      stripeIdempotencyKey,
        metadata:             { plan_key: planKey, plan_id: plan.id },
        promotion_code:       promotionCode,
      })
      return NextResponse.json({ checkout_url: session.checkout_url })
    } catch (err) {
      console.error('[Checkout] Subscription session creation failed:', err)
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
    }
  }

  if (type === 'credit_pack') {
    const productKey = typeof body.product_key === 'string' ? body.product_key : null
    if (!productKey) return NextResponse.json({ error: 'product_key is required' }, { status: 400 })

    const product = await creditProductService.getProduct(productKey)
    if (!product || !product.is_active) {
      return NextResponse.json({ error: 'Credit product not found or not active' }, { status: 404 })
    }
    // Price ID must come from the DB — never from the client
    const priceId = product.external_price_id
    if (!priceId) {
      return NextResponse.json({ error: 'Product has no configured price. Contact support.' }, { status: 422 })
    }

    // Find or create Stripe customer
    const externalCustomerId = await ensureStripeCustomer(user.id, user.email ?? '')

    // Ensure wallet exists (needed for completePurchase)
    const { data: wallet } = await serviceClient
      .from('credit_wallets')
      .select('id')
      .eq('account_id', user.id)
      .maybeSingle()
    if (!wallet) return NextResponse.json({ error: 'Wallet not found. Please contact support.' }, { status: 422 })

    // Stable key for webhook correlation — stored in credit_purchases.idempotency_key
    // and echoed back in Stripe session metadata so the webhook can locate the row.
    const purchaseIdempotencyKey = crypto.randomUUID()

    // Create pending purchase record before checkout so we have the row ID.
    // This row ID drives the Stripe API idempotency key (prevents duplicate sessions
    // on connection-drop retries while still allowing a new attempt if the user cancels).
    const purchase = await creditProductService.createPendingPurchase({
      account_id:        user.id,
      wallet_id:         wallet.id,
      credit_product_id: product.id,
      idempotency_key:   purchaseIdempotencyKey,
    })

    // Stripe API idempotency key scoped to this specific DB purchase record.
    const stripeIdempotencyKey = `checkout:credits:${user.id}:${product.id}:${purchase.id}`

    try {
      const session = await stripeProvider.createCheckoutSession({
        account_id:           user.id,
        external_customer_id: externalCustomerId,
        line_items:           [{ price_id: priceId, quantity: 1 }],
        success_url:          `${origin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:           `${origin}/billing?checkout=cancelled`,
        mode:                 'payment',
        idempotency_key:      stripeIdempotencyKey,
        metadata:             {
          product_key:     productKey,
          product_id:      product.id,
          idempotency_key: purchaseIdempotencyKey,
        },
        promotion_code:       promotionCode,
      })
      return NextResponse.json({ checkout_url: session.checkout_url })
    } catch (err) {
      console.error('[Checkout] Credit pack session creation failed:', err)
      await creditProductService.failPurchase(purchaseIdempotencyKey).catch(() => {})
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: `Unknown checkout type: ${type}` }, { status: 400 })
}

/** Find existing Stripe customer ID or create a new one */
async function ensureStripeCustomer(account_id: string, email: string): Promise<string> {
  // Check for existing customer ID stored in account_subscriptions
  const { data: existing } = await serviceClient
    .from('account_subscriptions')
    .select('external_customer_id')
    .eq('account_id', account_id)
    .not('external_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.external_customer_id) return existing.external_customer_id

  // Check credit_purchases (payment_provider_customer_id added in phase66g migration)
  const { data: existingPurchase } = await serviceClient
    .from('credit_purchases')
    .select('payment_provider_customer_id')
    .eq('account_id', account_id)
    .not('payment_provider_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((existingPurchase as any)?.payment_provider_customer_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (existingPurchase as any).payment_provider_customer_id
  }

  // Create new Stripe customer
  const customer = await stripeProvider.createCustomer(account_id, email)
  return customer.external_customer_id
}
