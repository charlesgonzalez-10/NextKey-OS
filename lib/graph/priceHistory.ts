/**
 * Price History Processor — Sprint 2
 *
 * Detects price changes between the previous listing_intelligence state and the
 * newly fetched UnifiedListing, then writes atomic events to listing_price_history.
 *
 * Design rules:
 *   - Pure comparison logic: caller passes previous + current, this file decides what to write
 *   - Duplicate prevention: ON CONFLICT DO NOTHING on (property_id, event_type, event_date)
 *   - Never overwrites an existing event for the same day + type (idempotent)
 *   - Returns the computed totalReductionPct for use in velocity_signals
 *   - Does NOT write to listing_intelligence — caller owns that upsert
 */

import { serviceClient } from '@/lib/supabase-service'
import type { ListingIntelligence, UnifiedListing } from './types'

export interface PriceEvent {
  eventType:     'listed' | 'price_change' | 'relisted' | 'closed' | 'expired' | 'withdrawn'
  price:         number
  previousPrice: number | null
  eventDate:     string   // YYYY-MM-DD
}

export interface PriceHistoryResult {
  eventsWritten:    number
  totalReductionPct: number | null
  newEvents:        PriceEvent[]
}

/**
 * Process price events between the previous listing state and the new data.
 *
 * @param propertyId    - The property being processed
 * @param previous      - The current listing_intelligence row (before the new upsert), or null
 * @param incoming      - The freshly-fetched UnifiedListing
 * @param mlsNumber     - MLS number for the event records
 * @param source        - Provider that fetched the data
 */
export async function processPriceHistory(
  propertyId: string,
  previous:   ListingIntelligence | null,
  incoming:   UnifiedListing,
  source:     string = 'reapi',
): Promise<PriceHistoryResult> {
  const today = new Date().toISOString().substring(0, 10)
  const events: PriceEvent[] = []

  const newPrice  = incoming.listPrice
  const prevPrice = previous?.listPrice ?? null
  const newStatus = incoming.status
  const prevStatus = previous?.status ?? null

  // ── 1. First time seeing this property on MLS ──────────────────────────────
  if (!previous && newPrice != null) {
    events.push({
      eventType:     'listed',
      price:         newPrice,
      previousPrice: null,
      eventDate:     incoming.listDate?.substring(0, 10) ?? today,
    })
  }

  // ── 2. Price changed (same listing cycle, still active/pending) ────────────
  if (
    previous &&
    newPrice != null &&
    prevPrice != null &&
    newPrice !== prevPrice &&
    (newStatus === 'Active' || newStatus === 'Pending')
  ) {
    events.push({
      eventType:     'price_change',
      price:         newPrice,
      previousPrice: prevPrice,
      eventDate:     today,
    })
  }

  // ── 3. Status terminal transitions ──────────────────────────────────────────
  const wasActive = prevStatus === 'Active' || prevStatus === 'Pending'
  if (wasActive && newStatus !== prevStatus) {
    if (newStatus === 'Closed' && incoming.closePrice != null) {
      events.push({
        eventType:     'closed',
        price:         incoming.closePrice,
        previousPrice: prevPrice,
        eventDate:     incoming.closeDate?.substring(0, 10) ?? today,
      })
    } else if (newStatus === 'Expired') {
      events.push({
        eventType:     'expired',
        price:         newPrice ?? prevPrice ?? 0,
        previousPrice: prevPrice,
        eventDate:     today,
      })
    } else if (newStatus === 'Withdrawn') {
      events.push({
        eventType:     'withdrawn',
        price:         newPrice ?? prevPrice ?? 0,
        previousPrice: prevPrice,
        eventDate:     today,
      })
    }
  }

  if (!events.length) {
    return {
      eventsWritten:    0,
      totalReductionPct: computeTotalReductionPct(incoming),
      newEvents:        [],
    }
  }

  // ── Write events — ON CONFLICT DO NOTHING for idempotency ─────────────────
  const rows = events.map(e => ({
    property_id:    propertyId,
    mls_number:     incoming.mlsNumber ?? null,
    event_type:     e.eventType,
    price:          e.price,
    previous_price: e.previousPrice,
    event_date:     e.eventDate,
    source,
  }))

  const { error } = await serviceClient
    .from('listing_price_history')
    .upsert(rows, { onConflict: 'property_id,event_type,event_date,price', ignoreDuplicates: true })

  if (error) {
    console.error('[PriceHistory] write failed:', error.message)
  }

  return {
    eventsWritten:    error ? 0 : events.length,
    totalReductionPct: computeTotalReductionPct(incoming),
    newEvents:        events,
  }
}

/**
 * Compute total reduction percentage from the current listing state.
 * Uses originalListPrice vs current listPrice — no DB query needed.
 *
 * Returns null if there is no original price or no reduction.
 */
export function computeTotalReductionPct(listing: UnifiedListing): number | null {
  const orig = listing.originalListPrice
  const curr = listing.listPrice
  if (orig == null || curr == null || orig <= 0 || curr >= orig) return null
  return parseFloat(((orig - curr) / orig * 100).toFixed(2))
}
