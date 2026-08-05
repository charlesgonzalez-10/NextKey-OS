/**
 * POST /api/webhooks/mls
 *
 * Stub MLS webhook receiver — Sprint 1 scaffolding only.
 *
 * Sprint 2 will implement:
 *   - Webhook signature verification (HMAC-SHA256 from MLS board)
 *   - Event parsing for: StatusChange, PriceChange, NewListing, Sold, Expired
 *   - Targeted listing_intelligence invalidation (set fetched_at = epoch)
 *   - listing_events append (event-sourcing the change)
 *   - listing_history cycle management (relists)
 *   - opportunity_signals upsert for mls_price_reduced, expired_listing, etc.
 *   - refresh_jobs queue entry for background re-fetch via DSOE router
 *
 * The stub accepts the webhook payload, logs it, and returns 200 immediately.
 * This ensures the MLS board does not mark the endpoint as unavailable when
 * Sprint 1 goes to production.
 *
 * No auth is applied to this route — MLS webhooks come from external systems.
 * Signature verification must be added in Sprint 2 before enabling real events.
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface MlsWebhookPayload {
  event?:     string
  mlsNumber?: string
  [key: string]:  unknown
}

export async function POST(req: NextRequest) {
  let body: MlsWebhookPayload = {}

  try {
    body = await req.json() as MlsWebhookPayload
  } catch {
    // Accept even malformed bodies — don't reject the webhook
  }

  // Sprint 1: log and acknowledge only. Sprint 2 adds processing.
  console.log('[MLS Webhook] received:', {
    event:     body.event ?? 'unknown',
    mlsNumber: body.mlsNumber ?? null,
    keys:      Object.keys(body),
    ts:        new Date().toISOString(),
  })

  // Always acknowledge immediately — MLS boards retry on non-2xx
  return NextResponse.json({ received: true })
}
