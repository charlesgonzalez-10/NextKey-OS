// Stripe webhook handler — TEST MODE ONLY.
//
// Retry policy:
//   invalid signature              → 400  (Stripe does not retry 4xx)
//   duplicate already-processed    → 200  (idempotent success)
//   permanent_failure already set  → 200  (Stripe should not retry)
//   unsupported event type         → 200  (no handler, not an error)
//   PermanentWebhookError thrown   → record permanent_failure, return 200
//   any other exception            → record retryable_failure, return 500
//                                         (Stripe will retry — correct for transient DB/network outages)
//
// Critical invariants (must never be relaxed):
//   - Raw body is used for HMAC verification — do NOT call req.json() here.
//   - Credits are granted ONLY from verified server-side webhook processing.
//   - Payment must NEVER increase: global API budget, provider budgets,
//     customer_shared pool, owner_reserved, emergency_reserved, or vendor cost caps.
//   - Refunds/disputes update purchase records only — never billing pools.

import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase-service'
import { stripeProvider } from '@/lib/billing/stripe/stripeProvider'
import { subscriptionPlanService, stripeIdToSourceUuid } from '@/lib/billing/subscriptionPlanService'
import { creditProductService } from '@/lib/billing/creditProductService'
import { creditWalletService } from '@/lib/billing/creditWalletService'

export const dynamic = 'force-dynamic'

// ─── Error types ──────────────────────────────────────────────────────────────

// Throw this for business-rule violations that will never resolve on retry
// (missing required metadata, invalid payload structure, etc.).
// The handler records permanent_failure and returns 200 — Stripe won't retry.
class PermanentWebhookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentWebhookError'
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // Raw body required for HMAC — must come before any other parsing
  const rawBody = await req.text()

  // ── Verify HMAC signature ─────────────────────────────────────────────────
  let event
  try {
    event = await stripeProvider.verifyWebhookSignature(rawBody, signature)
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // ── Upsert event row — idempotency + attempt tracking ────────────────────
  // First attempt: INSERT succeeds, attempt_count=1.
  // Stripe retry: INSERT fails with 23505; we SELECT the row and check status.
  const { error: insertError } = await serviceClient
    .from('stripe_events')
    .insert({
      event_id:          event.event_id,
      event_type:        event.event_type,
      payload:           event.payload,
      processing_status: 'received',
      attempt_count:     1,
      first_received_at: now,
      last_attempt_at:   now,
    })

  if (insertError && insertError.code !== '23505') {
    // Transient DB error on insert — return 500 so Stripe retries later
    console.error('[Webhook] DB insert error:', insertError.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // Fetch the canonical row (whether just inserted or existing)
  const { data: eventRow, error: fetchError } = await serviceClient
    .from('stripe_events')
    .select('id, processing_status, attempt_count')
    .eq('event_id', event.event_id)
    .single()

  if (fetchError || !eventRow) {
    console.error('[Webhook] Failed to fetch event row:', fetchError?.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // Already fulfilled — return 200 without re-running any mutations
  if (eventRow.processing_status === 'processed') {
    console.info(`[Webhook] Already processed, skipping: ${event.event_id}`)
    return NextResponse.json({ received: true, status: 'already_processed' })
  }

  // Permanently rejected — return 200 so Stripe stops retrying
  if (eventRow.processing_status === 'permanent_failure') {
    console.warn(`[Webhook] Permanent failure recorded, not retrying: ${event.event_id}`)
    return NextResponse.json({ received: true, status: 'permanent_failure' })
  }

  // ── Mark processing + increment attempt count on retries ─────────────────
  const isRetry = insertError?.code === '23505'
  await serviceClient
    .from('stripe_events')
    .update({
      processing_status: 'processing',
      last_attempt_at:   now,
      ...(isRetry ? { attempt_count: eventRow.attempt_count + 1 } : {}),
    })
    .eq('event_id', event.event_id)

  if (isRetry) {
    console.info(
      `[Webhook] Retry attempt ${eventRow.attempt_count + 1} for ` +
      `${event.event_type} event_id=${event.event_id}`
    )
  }

  // ── Dispatch to handler ───────────────────────────────────────────────────
  let finalStatus: 'processed' | 'permanent_failure' | 'retryable_failure' = 'processed'
  let lastError: string | null = null

  try {
    await routeEvent(event.event_type, event.payload as Record<string, unknown>)
    finalStatus = 'processed'
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)

    if (err instanceof PermanentWebhookError) {
      // Business-rule rejection — Stripe should NOT retry
      finalStatus = 'permanent_failure'
      console.error(`[Webhook] Permanent failure (${event.event_type}):`, lastError)
    } else {
      // Transient DB/network/service error — Stripe SHOULD retry
      finalStatus = 'retryable_failure'
      console.error(`[Webhook] Transient failure (${event.event_type}):`, lastError)
    }
  }

  // ── Persist final outcome ─────────────────────────────────────────────────
  await serviceClient
    .from('stripe_events')
    .update({
      processing_status: finalStatus,
      last_error:        lastError,
      processed_at:      finalStatus === 'processed' ? now : null,
    })
    .eq('event_id', event.event_id)

  if (finalStatus === 'retryable_failure') {
    // Return 500 so Stripe schedules a retry
    return NextResponse.json({ error: 'Transient error, retry scheduled' }, { status: 500 })
  }

  // processed or permanent_failure — both return 200 to stop Stripe from retrying
  return NextResponse.json({ received: true, status: finalStatus })
}

// ─── Event router ─────────────────────────────────────────────────────────────

async function routeEvent(type: string, data: Record<string, unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = (data as any).object as Record<string, unknown>

  switch (type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(obj)

    case 'invoice.paid':
      return handleInvoicePaid(obj)

    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(obj)

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return handleSubscriptionUpdate(obj)

    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(obj)

    case 'charge.refunded':
      return handleChargeRefunded(obj)

    case 'charge.dispute.created':
      return handleDisputeCreated(obj)

    case 'charge.dispute.closed':
      return handleDisputeClosed(obj)

    default:
      // Unsupported event type — log only, return 200 (not an error condition)
      console.info(`[Webhook] Unhandled event type (no-op): ${type}`)
  }
}

// ─── checkout.session.completed ───────────────────────────────────────────────

async function handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
  const mode       = session.mode as string
  const meta       = (session.metadata ?? {}) as Record<string, string>
  const accountId  = (session.client_reference_id as string) ?? meta.account_id

  if (!accountId) {
    // Payload will never gain an account_id on retry — permanent
    throw new PermanentWebhookError(
      `checkout.session.completed: no account_id in session ${session.id}`
    )
  }

  if (mode === 'subscription') {
    // Fulfillment handled entirely by customer.subscription.created/updated.
    console.info(`[Webhook] Subscription checkout completed: account=${accountId}`)
    return
  }

  if (mode === 'payment') {
    const idempotencyKey    = meta.idempotency_key
    const externalPaymentId = session.payment_intent as string
    const amountTotal       = (session.amount_total as number) ?? 0
    const customerId        = session.customer as string

    if (!idempotencyKey) {
      throw new PermanentWebhookError(
        `checkout.session.completed (payment): no idempotency_key in metadata for session ${session.id}`
      )
    }

    // Fetch matching pending purchase — transient failure if DB is unavailable
    const { data: purchaseRow } = await serviceClient
      .from('credit_purchases')
      .select('id, status, credits_purchased')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (!purchaseRow) {
      // No pending purchase record — shouldn't happen but not retryable with same payload
      throw new PermanentWebhookError(
        `checkout.session.completed: no credit_purchase for idempotency_key=${idempotencyKey}`
      )
    }

    // Mark purchase completed — if already completed, skip gracefully
    if (purchaseRow.status !== 'completed') {
      await creditProductService.completePurchase({
        idempotency_key:     idempotencyKey,
        external_payment_id: externalPaymentId,
        amount_paid_cents:   amountTotal,
        payment_provider:    'stripe',
      })
    }

    // Grant purchased credits — idempotent via source_type + source_id uniqueness
    const { data: existingGrant } = await serviceClient
      .from('credit_grants')
      .select('id')
      .eq('source_type', 'credit_purchase')
      .eq('source_id', purchaseRow.id)
      .maybeSingle()

    if (!existingGrant) {
      await creditWalletService.grantCredits(
        accountId,
        purchaseRow.credits_purchased,
        'purchased',
        'credit_purchase',
        purchaseRow.id,
        undefined, // purchased credits do not expire
      )
      console.info(
        `[Webhook] Granted ${purchaseRow.credits_purchased} purchased credits to account=${accountId}`
      )
    } else {
      console.info(`[Webhook] Credit grant already exists for purchase=${purchaseRow.id}, skipping`)
    }

    // Store customer ID for portal lookup
    if (customerId) {
      await serviceClient
        .from('credit_purchases')
        .update({ payment_provider_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('id', purchaseRow.id)
        .is('payment_provider_customer_id', null)
    }
    return
  }

  // Unknown mode — permanent (payload won't change)
  throw new PermanentWebhookError(
    `checkout.session.completed: unknown mode '${mode}' in session ${session.id}`
  )
}

// ─── invoice.paid — subscription renewal ─────────────────────────────────────

async function handleInvoicePaid(invoice: Record<string, unknown>): Promise<void> {
  const subscriptionId = invoice.subscription as string
  // One-time payment invoices have no subscription — handled by checkout.session.completed
  if (!subscriptionId) return

  const billingReason = invoice.billing_reason as string
  // Grant renewal credits only for automatic billing cycles
  if (billingReason !== 'subscription_cycle') return

  const { data: sub } = await serviceClient
    .from('account_subscriptions')
    .select('account_id, id')
    .eq('external_subscription_id', subscriptionId)
    .maybeSingle()

  if (!sub) {
    // Sub not found — could be timing (subscription.created fires after invoice.paid).
    // This is retryable; leave as transient so Stripe will retry.
    throw new Error(
      `invoice.paid: no subscription found for external_id=${subscriptionId}. Will retry.`
    )
  }

  // Business-level idempotency: one renewal grant per Stripe invoice.
  // Using invoice.id (not event.id) so the same billing cycle cannot be applied twice
  // even if two different Stripe events represent it (e.g. resent events, retries).
  // credit_grants.source_id is a uuid column; convert the Stripe invoice ID to a
  // deterministic UUID so the check and the write use the same value.
  const invoiceId = invoice.id as string
  const invoiceSourceUuid = stripeIdToSourceUuid(invoiceId)
  const { data: existing } = await serviceClient
    .from('credit_grants')
    .select('id')
    .eq('source_type', 'subscription')
    .eq('source_id', invoiceSourceUuid)
    .eq('grant_type', 'monthly')
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.info(
      `[Webhook] Monthly renewal credits already granted for invoice=${invoiceId}`
    )
    return
  }

  await subscriptionPlanService.renewMonthlyCredits(sub.account_id, invoiceId)
  console.info(
    `[Webhook] Renewed monthly credits for account=${sub.account_id} invoice=${invoiceId}`
  )
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Record<string, unknown>): Promise<void> {
  const subscriptionId = invoice.subscription as string
  if (!subscriptionId) return

  const { error } = await serviceClient
    .from('account_subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('external_subscription_id', subscriptionId)
    .in('status', ['active', 'trialing'])

  if (error) throw new Error(`handleInvoicePaymentFailed: ${error.message}`)
  console.info(`[Webhook] Subscription marked past_due: external_id=${subscriptionId}`)
}

// ─── customer.subscription.created / updated ──────────────────────────────────

async function handleSubscriptionUpdate(sub: Record<string, unknown>): Promise<void> {
  const externalSubId      = sub.id as string
  const externalCustomerId = sub.customer as string
  const stripeStatus       = sub.status as string
  const metadata           = (sub.metadata ?? {}) as Record<string, string>
  const accountId          = metadata.account_id

  const statusMap: Record<string, string> = {
    active:             'active',
    trialing:           'trialing',
    past_due:           'past_due',
    incomplete:         'incomplete',
    incomplete_expired: 'incomplete_expired',
    unpaid:             'unpaid',
    paused:             'paused',
    canceled:           'cancelled',
  }
  const nextKeyStatus = statusMap[stripeStatus] ?? stripeStatus

  if (!accountId) {
    // Locate by external_subscription_id (status-sync only path)
    const { data: existing } = await serviceClient
      .from('account_subscriptions')
      .select('account_id')
      .eq('external_subscription_id', externalSubId)
      .maybeSingle()

    if (!existing) {
      console.warn(
        `[Webhook] subscription.updated: no NextKey account for sub=${externalSubId}; ` +
        `cannot activate without account_id in metadata`
      )
      return
    }

    const { error } = await serviceClient
      .from('account_subscriptions')
      .update({ status: nextKeyStatus, updated_at: new Date().toISOString() })
      .eq('external_subscription_id', externalSubId)
    if (error) throw new Error(`handleSubscriptionUpdate (status-sync): ${error.message}`)
    return
  }

  // Full activation path: find plan by Stripe price ID
  const subItems = (sub.items as { data?: { price?: { id?: string }; current_period_start?: number; current_period_end?: number }[] })?.data
  const firstItem = subItems?.[0]
  const priceId   = firstItem?.price?.id
  const plan = priceId ? await subscriptionPlanService.getPlanByPriceId(priceId) : null

  // Stripe API 2024+ moved period timestamps to items[0]; fall back to root for older payloads
  const periodStart = (firstItem?.current_period_start ?? sub.current_period_start) as number | undefined
  const periodEnd   = (firstItem?.current_period_end   ?? sub.current_period_end)   as number | undefined

  if (plan && nextKeyStatus === 'active') {
    await subscriptionPlanService.activateSubscription({
      account_id:               accountId,
      plan_id:                  plan.id,
      payment_provider:         'stripe',
      external_customer_id:     externalCustomerId,
      external_subscription_id: externalSubId,
      billing_period_start:     periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
      billing_period_end:       periodEnd   ? new Date(periodEnd   * 1000).toISOString() : new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    console.info(
      `[Webhook] Subscription activated: account=${accountId} plan=${plan.plan_key}`
    )
  } else {
    const { error } = await serviceClient
      .from('account_subscriptions')
      .update({ status: nextKeyStatus, updated_at: new Date().toISOString() })
      .eq('external_subscription_id', externalSubId)
    if (error) throw new Error(`handleSubscriptionUpdate (sync): ${error.message}`)
    console.info(`[Webhook] Subscription status synced: ${externalSubId} → ${nextKeyStatus}`)
  }
}

// ─── customer.subscription.deleted ────────────────────────────────────────────

async function handleSubscriptionDeleted(sub: Record<string, unknown>): Promise<void> {
  const externalSubId = sub.id as string

  const { error } = await serviceClient
    .from('account_subscriptions')
    .update({
      status:       'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq('external_subscription_id', externalSubId)

  if (error) throw new Error(`handleSubscriptionDeleted: ${error.message}`)
  console.info(`[Webhook] Subscription cancelled: ${externalSubId}`)
}

// ─── charge.refunded ──────────────────────────────────────────────────────────
// Records refund status only — never adjusts billing pools, vendor caps, or budgets.

async function handleChargeRefunded(charge: Record<string, unknown>): Promise<void> {
  const paymentIntentId = charge.payment_intent as string
  if (!paymentIntentId) return

  const { error } = await serviceClient
    .from('credit_purchases')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('external_payment_id', paymentIntentId)
    .eq('status', 'completed')

  if (error) throw new Error(`handleChargeRefunded: ${error.message}`)
  console.info(`[Webhook] Purchase marked refunded for payment_intent=${paymentIntentId}`)
}

// ─── charge.dispute.created ───────────────────────────────────────────────────

async function handleDisputeCreated(dispute: Record<string, unknown>): Promise<void> {
  const chargeId = dispute.charge as string
  console.warn(`[Webhook] Dispute opened for charge=${chargeId} — manual review required`)

  const { error } = await serviceClient
    .from('credit_purchases')
    .update({ status: 'disputed', updated_at: new Date().toISOString() })
    .eq('external_payment_id', chargeId)
    .in('status', ['completed', 'refunded'])

  if (error) throw new Error(`handleDisputeCreated: ${error.message}`)
}

// ─── charge.dispute.closed ────────────────────────────────────────────────────

async function handleDisputeClosed(dispute: Record<string, unknown>): Promise<void> {
  const chargeId      = dispute.charge as string
  const disputeStatus = dispute.status as string // won | lost | warning_closed
  console.info(`[Webhook] Dispute closed: charge=${chargeId} outcome=${disputeStatus}`)

  if (disputeStatus === 'lost') {
    // Credits are not auto-revoked — admin handles on a case-by-case basis
    await serviceClient
      .from('credit_purchases')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('external_payment_id', chargeId)
      .eq('status', 'disputed')
  } else if (disputeStatus === 'won') {
    await serviceClient
      .from('credit_purchases')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('external_payment_id', chargeId)
      .eq('status', 'disputed')
  }
}
