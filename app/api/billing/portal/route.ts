// Stripe Customer Portal session — TEST MODE ONLY.
// Redirects authenticated users to Stripe's self-service portal where
// they can update payment methods, view invoices, and cancel.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { stripeProvider } from '@/lib/billing/stripe/stripeProvider'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Find the user's Stripe customer ID from their subscription or purchase history
  const externalCustomerId = await findStripeCustomerId(user.id)
  if (!externalCustomerId) {
    return NextResponse.json(
      { error: 'No billing account found. Subscribe to a plan to access the billing portal.' },
      { status: 404 },
    )
  }

  try {
    const portal = await stripeProvider.createPortalSession(
      externalCustomerId,
      `${origin}/billing`,
    )
    return NextResponse.json({ url: portal.url })
  } catch (err) {
    console.error('[Portal] Failed to create portal session:', err)
    return NextResponse.json({ error: 'Failed to open billing portal' }, { status: 500 })
  }
}

async function findStripeCustomerId(account_id: string): Promise<string | null> {
  // Primary: subscription record (populated by webhook)
  const { data: sub } = await serviceClient
    .from('account_subscriptions')
    .select('external_customer_id')
    .eq('account_id', account_id)
    .not('external_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sub?.external_customer_id) return sub.external_customer_id

  // Fallback: credit purchase record (payment_provider_customer_id added in phase66g)
  const { data: purchase } = await serviceClient
    .from('credit_purchases')
    .select('payment_provider_customer_id')
    .eq('account_id', account_id)
    .not('payment_provider_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (purchase as any)?.payment_provider_customer_id ?? null
}
