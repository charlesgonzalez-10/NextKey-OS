// Stripe implementation of IPaymentProvider.
// TEST MODE ONLY — never use live keys or live payment collection.
//
// Required env vars (never commit values):
//   STRIPE_SECRET_KEY          — sk_test_…
//   STRIPE_WEBHOOK_SECRET      — whsec_…
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — pk_test_…

import Stripe from 'stripe'
import type {
  IPaymentProvider,
  PaymentProviderCustomer,
  CheckoutSessionRequest,
  CheckoutSessionResult,
  SubscriptionRecord,
  PaymentRecord,
  WebhookEvent,
} from '@/lib/billing/paymentProvider'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2026-07-29.dahlia' })
}

/** Map a Stripe Subscription to our SubscriptionRecord shape */
function mapSubscription(sub: Stripe.Subscription): SubscriptionRecord {
  const periodStart = sub.items.data[0]?.current_period_start
  const periodEnd   = sub.items.data[0]?.current_period_end
  return {
    external_subscription_id: sub.id,
    external_customer_id:     sub.customer as string,
    status:                   sub.status,
    current_period_start:     periodStart ? new Date(periodStart * 1000).toISOString() : '',
    current_period_end:       periodEnd   ? new Date(periodEnd   * 1000).toISOString() : '',
    cancel_at_period_end:     sub.cancel_at_period_end,
    metadata:                 (sub.metadata ?? {}) as Record<string, string>,
  }
}

export class StripePaymentProvider implements IPaymentProvider {
  name = 'stripe'

  async createCustomer(
    account_id: string,
    email: string,
    name?: string,
  ): Promise<PaymentProviderCustomer> {
    const stripe = getStripe()
    const customer = await stripe.customers.create(
      { email, name, metadata: { account_id } },
      { idempotencyKey: `customer:${account_id}` },
    )
    return {
      external_customer_id: customer.id,
      email: customer.email ?? email,
      name:  customer.name  ?? name,
      metadata: { account_id },
    }
  }

  async createCheckoutSession(
    req: CheckoutSessionRequest,
  ): Promise<CheckoutSessionResult> {
    const stripe = getStripe()

    const mode = req.mode ?? 'subscription'

    const params: Stripe.Checkout.SessionCreateParams = {
      mode,
      customer:   req.external_customer_id,
      line_items: req.line_items.map(li => ({
        price:    li.price_id,
        quantity: li.quantity,
      })),
      success_url: req.success_url,
      cancel_url:  req.cancel_url,
      metadata: {
        account_id:      req.account_id,
        idempotency_key: req.idempotency_key,
        ...req.metadata,
      },
      client_reference_id: req.account_id,
    }

    if (req.promotion_code) {
      // Look up the promotion code ID from the code string
      const promos = await stripe.promotionCodes.list({ code: req.promotion_code, limit: 1, active: true })
      if (promos.data.length > 0) {
        params.discounts = [{ promotion_code: promos.data[0].id }]
      }
    } else {
      // Allow Stripe-hosted code entry only when no code was pre-applied
      params.allow_promotion_codes = true
    }

    // Payment method collection: subscriptions collect during checkout,
    // one-time payments do not need to save a payment method.
    if (mode === 'subscription') {
      params.payment_method_collection = 'always'
      // Propagate account_id onto the Stripe subscription object so the
      // customer.subscription.created/updated webhook can activate the subscription.
      params.subscription_data = {
        metadata: { account_id: req.account_id },
      }
    }

    // Managed Payments requires a product tax_code on both one-time payment and
    // subscription sessions. Opt out until all products have tax codes in Stripe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(params as any).managed_payments = { enabled: false }

    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: req.idempotency_key,
    })

    return {
      session_id:   session.id,
      checkout_url: session.url ?? '',
      expires_at:   session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : '',
    }
  }

  async getSubscription(external_subscription_id: string): Promise<SubscriptionRecord> {
    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(external_subscription_id)
    return mapSubscription(sub)
  }

  async cancelSubscription(
    external_subscription_id: string,
    at_period_end: boolean,
  ): Promise<SubscriptionRecord> {
    const stripe = getStripe()
    const sub = await stripe.subscriptions.update(external_subscription_id, {
      cancel_at_period_end: at_period_end,
    })
    return mapSubscription(sub)
  }

  async verifyWebhookSignature(
    payload: string,
    signature: string,
  ): Promise<WebhookEvent> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
    const stripe = getStripe()

    // constructEvent throws if the signature is invalid
    const event = stripe.webhooks.constructEvent(payload, signature, secret)

    return {
      event_id:    event.id,
      event_type:  event.type,
      provider:    'stripe',
      payload:     event.data as unknown as Record<string, unknown>,
      received_at: new Date(event.created * 1000).toISOString(),
    }
  }

  async getPayment(external_payment_id: string): Promise<PaymentRecord> {
    const stripe = getStripe()
    const intent = await stripe.paymentIntents.retrieve(external_payment_id)
    return {
      external_payment_id: intent.id,
      amount_cents:        intent.amount,
      currency:            intent.currency,
      status:              intent.status,
      metadata:            (intent.metadata ?? {}) as Record<string, string>,
    }
  }

  async createPortalSession(
    external_customer_id: string,
    return_url: string,
  ): Promise<{ url: string }> {
    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer:   external_customer_id,
      return_url,
    })
    return { url: session.url }
  }
}

export const stripeProvider = new StripePaymentProvider()
