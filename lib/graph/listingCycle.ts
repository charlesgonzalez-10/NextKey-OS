/**
 * Listing Cycle Manager — Sprint 2
 *
 * Detects status transitions and relists, maintains listing_history cycles,
 * and appends events to listing_events.
 *
 * Design rules:
 *   - Caller passes previous state and new data; this module decides what to write
 *   - listing_history is write-once per cycle (archive on close/expire/withdraw)
 *   - listing_events is append-only (never updated, never deleted)
 *   - back_on_market = previous cycle existed AND current is Active again
 *   - Does NOT touch listing_intelligence — caller owns that upsert
 */

import { serviceClient } from '@/lib/supabase-service'
import type { ListingIntelligence, UnifiedListing } from './types'

export interface CycleResult {
  listingCycle:    number
  backOnMarket:    boolean
  eventsWritten:   number
  cycleArchived:   boolean
}

const TERMINAL_STATUSES = new Set(['Closed', 'Expired', 'Withdrawn'])
const ACTIVE_STATUSES   = new Set(['Active', 'Pending'])

/**
 * Process listing cycle transitions.
 *
 * Called BEFORE the new listing_intelligence upsert so we can compare
 * previous state to incoming state.
 *
 * @param propertyId  - Property being processed
 * @param previous    - Current listing_intelligence row (before new upsert), or null
 * @param incoming    - Freshly-fetched UnifiedListing
 * @param source      - Data source identifier
 */
export async function processListingCycle(
  propertyId: string,
  previous:   ListingIntelligence | null,
  incoming:   UnifiedListing,
  source:     string = 'reapi',
): Promise<CycleResult> {
  const now        = new Date().toISOString()
  const today      = now.substring(0, 10)
  const prevStatus = previous?.status ?? null
  const newStatus  = incoming.status
  const prevCycle  = previous?.listingCycle ?? 1
  const newPrice   = incoming.listPrice
  const prevPrice  = previous?.listPrice ?? null

  let listingCycle  = prevCycle
  let backOnMarket  = previous?.velocitySignals?.backOnMarket ?? false
  let eventsWritten = 0
  let cycleArchived = false

  // ── 1. No previous record: first time seeing this property ────────────────
  if (!previous) {
    await writeEvent(propertyId, incoming.mlsNumber, {
      eventType:   'listed',
      title:       newPrice != null
        ? `Listed at $${newPrice.toLocaleString()}`
        : 'Listed on MLS',
      amount:      newPrice,
      occurredAt:  incoming.listDate
        ? `${incoming.listDate}T00:00:00Z`
        : now,
      visibility:  'shared',
      eventData:   { status: newStatus, cycle: 1 },
      source,
    })
    eventsWritten++
    return { listingCycle: 1, backOnMarket: false, eventsWritten, cycleArchived: false }
  }

  // ── 2. Active → Terminal: archive the current cycle ────────────────────────
  if (prevStatus && ACTIVE_STATUSES.has(prevStatus) && TERMINAL_STATUSES.has(newStatus)) {
    await archiveCycle(propertyId, previous, incoming, source)
    cycleArchived = true

    await writeEvent(propertyId, incoming.mlsNumber, {
      eventType:   newStatus.toLowerCase() as string,
      title:       formatTerminalTitle(newStatus, newPrice ?? prevPrice),
      amount:      newStatus === 'Closed' ? (incoming.closePrice ?? newPrice) : newPrice,
      previousAmount: prevPrice,
      occurredAt:  now,
      visibility:  newStatus === 'Closed' ? 'shared' : 'agent',
      eventData:   { fromStatus: prevStatus, toStatus: newStatus, cycle: prevCycle },
      source,
    })
    eventsWritten++

    return { listingCycle: prevCycle, backOnMarket, eventsWritten, cycleArchived }
  }

  // ── 3. Terminal → Active: relist (new cycle) ──────────────────────────────
  if (prevStatus && TERMINAL_STATUSES.has(prevStatus) && ACTIVE_STATUSES.has(newStatus)) {
    listingCycle  = prevCycle + 1
    backOnMarket  = true

    await writeEvent(propertyId, incoming.mlsNumber, {
      eventType:   'relisted',
      title:       newPrice != null
        ? `Relisted at $${newPrice.toLocaleString()}`
        : 'Relisted on MLS',
      amount:      newPrice,
      occurredAt:  incoming.listDate ? `${incoming.listDate}T00:00:00Z` : now,
      visibility:  'shared',
      eventData:   { prevStatus, cycle: listingCycle, backOnMarket: true },
      source,
    })
    eventsWritten++

    return { listingCycle, backOnMarket, eventsWritten, cycleArchived }
  }

  // ── 4. Status change within active/pending ─────────────────────────────────
  if (prevStatus && prevStatus !== newStatus &&
      ACTIVE_STATUSES.has(prevStatus) && ACTIVE_STATUSES.has(newStatus)) {
    await writeEvent(propertyId, incoming.mlsNumber, {
      eventType:   'status_change',
      title:       `Status changed: ${prevStatus} → ${newStatus}`,
      occurredAt:  now,
      visibility:  'agent',
      eventData:   { fromStatus: prevStatus, toStatus: newStatus, cycle: prevCycle },
      source,
    })
    eventsWritten++
  }

  // ── 5. Price change event (written here for listing_events; price history
  //       table is handled separately by priceHistory.ts) ─────────────────────
  if (newPrice != null && prevPrice != null && newPrice !== prevPrice &&
      ACTIVE_STATUSES.has(newStatus)) {
    const dir = newPrice < prevPrice ? 'reduced' : 'increased'
    await writeEvent(propertyId, incoming.mlsNumber, {
      eventType:     'price_reduction',
      title:         `Price ${dir} to $${newPrice.toLocaleString()}`,
      amount:        newPrice,
      previousAmount: prevPrice,
      occurredAt:    today + 'T00:00:00Z',
      visibility:    'shared',
      eventData:     { dir, cycle: prevCycle },
      source,
    })
    eventsWritten++
  }

  return { listingCycle, backOnMarket, eventsWritten, cycleArchived }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function archiveCycle(
  propertyId: string,
  previous:   ListingIntelligence,
  incoming:   UnifiedListing,
  source:     string,
): Promise<void> {
  const { error } = await serviceClient.from('listing_history').insert({
    property_id:          propertyId,
    mls_number:           previous.mlsNumber ?? incoming.mlsNumber,
    listing_cycle:        previous.listingCycle,
    list_price:           previous.listPrice,
    close_price:          incoming.status === 'Closed' ? incoming.closePrice : null,
    original_list_price:  previous.originalListPrice,
    list_date:            previous.listDate,
    close_date:           incoming.status === 'Closed'
      ? incoming.closeDate
      : new Date().toISOString().substring(0, 10),
    status:               incoming.status,
    days_on_market:       previous.daysOnMarket,
    price_reduction_count: previous.priceReductionCount,
    list_agent_name:      previous.listAgentName,
    list_agent_phone:     previous.listAgentPhone,
    list_office_name:     previous.listOfficeName,
    back_on_market:       previous.velocitySignals?.backOnMarket ?? false,
    opened_at:            previous.createdAt,
    closed_at:            new Date().toISOString(),
    source,
  })
  if (error) console.error('[ListingCycle] archive failed:', error.message)
}

interface EventPayload {
  eventType:      string
  title:          string
  description?:   string
  amount?:        number | null
  previousAmount?: number | null
  occurredAt:     string
  visibility:     'agent' | 'shared'
  eventData?:     Record<string, unknown>
  source:         string
}

async function writeEvent(
  propertyId: string,
  mlsNumber:  string | null | undefined,
  payload:    EventPayload,
): Promise<void> {
  const { error } = await serviceClient.from('listing_events').insert({
    property_id:     propertyId,
    mls_number:      mlsNumber ?? null,
    event_type:      payload.eventType,
    title:           payload.title,
    description:     payload.description ?? null,
    amount:          payload.amount ?? null,
    previous_amount: payload.previousAmount ?? null,
    occurred_at:     payload.occurredAt,
    visibility:      payload.visibility,
    event_data:      payload.eventData ?? {},
    source:          payload.source,
  })
  if (error) console.error('[ListingCycle] event write failed:', error.message)
}

function formatTerminalTitle(status: string, price: number | null): string {
  const fmt = price != null ? ` at $${price.toLocaleString()}` : ''
  switch (status) {
    case 'Closed':    return `Sold${fmt}`
    case 'Expired':   return `Listing expired${fmt}`
    case 'Withdrawn': return `Listing withdrawn${fmt}`
    default:          return `Status: ${status}${fmt}`
  }
}
