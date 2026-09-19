/**
 * PropertyGraphService — the canonical intelligence layer.
 *
 * This is the single authorized entry point for any code that needs to
 * know something about a property from an intelligence perspective.
 * It orchestrates reads from domain services; it does NOT own any writes.
 *
 * Rules:
 *   ✓ Reads only — all writes stay in their domain service
 *   ✓ Each domain owns its own business rules and refresh logic
 *   ✓ Callers import { propertyGraph } and never the underlying services
 *   ✗ Do not add write methods here
 *   ✗ Do not add business logic here — delegate to domain services
 *   ✗ Do not become a God Service — keep methods thin
 *
 * Relationship data (contacts, comms, offers) is user-context-specific and
 * is explicitly scoped by userId to prevent cross-agent data leakage.
 *
 * Sprint 1 methods:
 *   getPropertySummary()        — basic property facts from properties table
 *   getListingIntelligence()    — MLS intelligence via DSOE router
 *   getOpportunitySignals()     — active signals from opportunity_signals
 *   getPropertyTimeline()       — merge-at-read from all event sources
 *   getPropertyGraph()          — assembled intelligence package
 *   getPublicProfile()          — Spesio bridge surface (compliance-gated)
 */

import { serviceClient }                          from '@/lib/supabase-service'
import {
  getListingIntelligence,
  getComparableIntelligenceForProperty,
  getMarketContextForProperty,
}                                                  from '@/lib/propertyService'
import type { GetCompsOptions }                     from '@/lib/graph/comparables'
import type { GetMarketContextOptions }             from '@/lib/graph/marketStats'
import { estimateIntentCost, listProviders }        from './dsoeRouter'
import type { DsoeIntent }                         from './types'
import type {
  PropertySummary,
  ListingIntelligence,
  OpportunitySignal,
  OpportunitySignalType,
  OpportunitySignalSource,
  PropertyTimelineEvent,
  PropertyTimelineOptions,
  PropertyGraph,
  PropertyGraphOptions,
  ComparableIntelligence,
  MarketContext,
  SpesioPropertyPackage,
  MlsAttribution,
} from './types'

// ── Property Summary ──────────────────────────────────────────────────────────

async function getPropertySummary(propertyId: string): Promise<PropertySummary | null> {
  const { data } = await serviceClient
    .from('properties')
    .select(`
      id, property_address, city, state, zip, county,
      beds, baths, living_area, year_built, owner_name,
      market_value, assessed_value, folio_number,
      latitude, longitude, property_type
    `)
    .eq('id', propertyId)
    .single()

  if (!data) return null

  return {
    id:            data.id as string,
    address:       (data.property_address as string | null) ?? null,
    city:          (data.city as string | null) ?? null,
    state:         (data.state as string | null) ?? null,
    zip:           (data.zip as string | null) ?? null,
    county:        (data.county as string | null) ?? null,
    beds:          (data.beds as number | null) ?? null,
    baths:         (data.baths as number | null) ?? null,
    sqft:          (data.living_area as number | null) ?? null,
    yearBuilt:     (data.year_built as number | null) ?? null,
    ownerName:     (data.owner_name as string | null) ?? null,
    marketValue:   (data.market_value as number | null) ?? null,
    assessedValue: (data.assessed_value as number | null) ?? null,
    folioNumber:   (data.folio_number as string | null) ?? null,
    lat:           (data.latitude as number | null) ?? null,
    lng:           (data.longitude as number | null) ?? null,
    propertyType:  (data.property_type as string | null) ?? null,
  }
}

// ── Opportunity Signals ───────────────────────────────────────────────────────

async function getOpportunitySignals(propertyId: string): Promise<OpportunitySignal[]> {
  const { data } = await serviceClient
    .from('opportunity_signals')
    .select('*')
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .order('confidence', { ascending: false })

  if (!data?.length) return []

  return data.map(row => ({
    id:           row.id as string,
    propertyId:   row.property_id as string,
    signalType:   row.signal_type as OpportunitySignalType,
    signalSource: row.signal_source as OpportunitySignalSource,
    isActive:     row.is_active as boolean,
    confidence:   row.confidence as number,
    signalData:   (row.signal_data as Record<string, unknown>) ?? {},
    detectedAt:   row.detected_at as string,
    expiresAt:    (row.expires_at as string | null) ?? null,
    createdAt:    row.created_at as string,
    updatedAt:    row.updated_at as string,
  }))
}

// ── Property Timeline (merge-at-read) ─────────────────────────────────────────
// Each domain table owns its events. This function queries all sources and
// merges them into a unified chronological stream.
// Adding a new event source = add a query here. No migration, no double-write.

async function getPropertyTimeline(
  propertyId: string,
  opts: PropertyTimelineOptions = {},
): Promise<PropertyTimelineEvent[]> {
  const { since, categories, visibility = 'all', limit = 100 } = opts
  const events: PropertyTimelineEvent[] = []

  const sinceFilter = since ?? '2000-01-01T00:00:00Z'

  // ── MLS Events (listing_events) ──
  if (!categories || categories.includes('mls')) {
    const query = serviceClient
      .from('listing_events')
      .select('id, property_id, mls_number, event_type, title, description, amount, previous_amount, occurred_at, visibility')
      .eq('property_id', propertyId)
      .gte('occurred_at', sinceFilter)
    if (visibility !== 'all') {
      void query.eq('visibility', visibility)
    }
    const { data: mlsEvents } = await query.order('occurred_at', { ascending: false })
    for (const e of mlsEvents ?? []) {
      events.push({
        id:             e.id as string,
        propertyId:     e.property_id as string,
        occurredAt:     e.occurred_at as string,
        category:       'mls',
        eventType:      e.event_type as string,
        title:          e.title as string,
        description:    (e.description as string | null) ?? null,
        amount:         (e.amount as number | null) ?? null,
        previousAmount: (e.previous_amount as number | null) ?? null,
        sourceTable:    'listing_events',
        sourceId:       e.id as string,
        visibility:     (e.visibility as 'agent' | 'shared') ?? 'agent',
      })
    }
  }

  // ── Opportunity Signal activations / expirations (opportunity_signals) ──
  if (!categories || categories.includes('opportunity')) {
    const { data: signals } = await serviceClient
      .from('opportunity_signals')
      .select('id, property_id, signal_type, signal_source, detected_at, expires_at, is_active, confidence, signal_data')
      .eq('property_id', propertyId)
      .gte('detected_at', sinceFilter)
      .order('detected_at', { ascending: false })

    for (const s of signals ?? []) {
      events.push({
        id:          s.id as string,
        propertyId:  s.property_id as string,
        occurredAt:  s.detected_at as string,
        category:    'opportunity',
        eventType:   `signal_detected:${s.signal_type}`,
        title:       formatSignalTitle(s.signal_type as string, true),
        description: null,
        amount:      null,
        sourceTable: 'opportunity_signals',
        sourceId:    s.id as string,
        visibility:  'agent',
      })
    }
  }

  // ── MLS Price History (listing_price_history) ──
  if (!categories || categories.includes('mls')) {
    const { data: priceEvents } = await serviceClient
      .from('listing_price_history')
      .select('id, property_id, event_type, price, previous_price, event_date')
      .eq('property_id', propertyId)
      .gte('event_date', sinceFilter.substring(0, 10))
      .order('event_date', { ascending: false })

    for (const p of priceEvents ?? []) {
      events.push({
        id:             p.id as string,
        propertyId:     p.property_id as string,
        occurredAt:     `${p.event_date as string}T00:00:00Z`,
        category:       'mls',
        eventType:      p.event_type as string,
        title:          formatPriceEventTitle(p.event_type as string, p.price as number, p.previous_price as number | null),
        description:    null,
        amount:         p.price as number,
        previousAmount: (p.previous_price as number | null) ?? null,
        sourceTable:    'listing_price_history',
        sourceId:       p.id as string,
        visibility:     'shared',
      })
    }
  }

  // ── Sort all sources by occurredAt descending, apply limit ──
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  return events.slice(0, limit)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSignalTitle(signalType: string, activated: boolean): string {
  const labels: Record<string, string> = {
    pre_foreclosure: 'Pre-Foreclosure Filed',
    probate:         'Probate Opened',
    tax_deed:        'Tax Deed Eligible',
    surplus_funds:   'Surplus Funds Available',
    lis_pendens:     'Lis Pendens Filed',
    mls_active:      'Listed on MLS',
    mls_price_reduced: 'Price Reduced',
    high_dom:        '90+ Days on Market',
    back_on_market:  'Back on Market',
    expired_listing: 'Listing Expired',
    high_equity:     'High Equity Detected',
    free_and_clear:  'Free & Clear (No Mortgage)',
    investor_owned:  'Investor Owned',
    non_owner_occupied: 'Non-Owner Occupied',
    vacant:          'Vacant Property',
    absentee_owner:  'Absentee Owner',
    no_hoa:          'No HOA',
    below_market:    'Below Market Value',
  }
  const label = labels[signalType] ?? signalType.replace(/_/g, ' ')
  return activated ? label : `${label} (Resolved)`
}

function formatPriceEventTitle(
  eventType: string,
  price: number,
  previousPrice: number | null,
): string {
  const fmt = (n: number) => `$${n.toLocaleString()}`
  switch (eventType) {
    case 'listed':       return `Listed at ${fmt(price)}`
    case 'price_change': {
      const dir = previousPrice != null && price < previousPrice ? 'Reduced' : 'Increased'
      return `Price ${dir} to ${fmt(price)}`
    }
    case 'relisted':     return `Relisted at ${fmt(price)}`
    case 'closed':       return `Closed at ${fmt(price)}`
    case 'expired':      return `Expired at ${fmt(price)}`
    case 'withdrawn':    return `Withdrawn at ${fmt(price)}`
    default:             return `${eventType} — ${fmt(price)}`
  }
}

// ── Assembled graph ───────────────────────────────────────────────────────────

async function getPropertyGraph(
  propertyId: string,
  opts: PropertyGraphOptions = {},
): Promise<PropertyGraph> {
  const {
    includeListing = false,
    includeOpportunitySignals = false,
    includeTimeline = false,
    includeComparables = false,
    includeMarketContext = false,
    timelineOpts,
    force = false,
  } = opts

  const [summary, listing, signals, timeline, comparables, marketCtx] = await Promise.all([
    getPropertySummary(propertyId),
    includeListing
      ? getListingIntelligence(propertyId, { force })
      : Promise.resolve(undefined),
    includeOpportunitySignals
      ? getOpportunitySignals(propertyId)
      : Promise.resolve(undefined),
    includeTimeline
      ? getPropertyTimeline(propertyId, timelineOpts)
      : Promise.resolve(undefined),
    includeComparables
      ? getComparableIntelligenceForProperty(propertyId, { force })
      : Promise.resolve(undefined),
    includeMarketContext
      ? getMarketContextForProperty(propertyId, { force })
      : Promise.resolve(undefined),
  ])

  const graph: PropertyGraph = {
    propertyId,
    summary,
    assembledAt: new Date().toISOString(),
  }

  if (listing !== undefined)     graph.listing = listing
  if (signals !== undefined)     graph.opportunitySignals = signals
  if (timeline !== undefined)    graph.timeline = timeline
  if (comparables !== undefined) graph.comparables = comparables
  if (marketCtx !== undefined)   graph.marketContext = marketCtx

  if (listing) {
    graph.scores = {
      marketPosition:          listing.marketPositionScore ?? null,
      acquisitionOpportunity:  listing.acquisitionOpportunityScore ?? null,
      acquisitionScoreScope:   (listing.scoringBreakdown?.acquisitionScoreScope) ?? 'mls_only',
    }
  }

  return graph
}

// ── Comparable Intelligence (read-only delegation) ────────────────────────────

async function getComparableIntelligence(
  propertyId: string,
  opts?: GetCompsOptions,
): Promise<ComparableIntelligence | null> {
  return getComparableIntelligenceForProperty(propertyId, opts)
}

// ── Market Context (read-only delegation) ─────────────────────────────────────

async function getMarketContext(
  propertyId: string,
  opts?: GetMarketContextOptions,
): Promise<MarketContext | null> {
  return getMarketContextForProperty(propertyId, opts)
}

// ── Spesio Bridge surface ─────────────────────────────────────────────────────
// Compliance-gated. Returns null if listing_intelligence.display_allowed = false.
// Spesio callers never see: opportunity signals, agent-only events, raw MLS fields,
// acquisition scores breakdown, or other agents' offer data.

async function getPublicProfile(propertyId: string): Promise<SpesioPropertyPackage | null> {
  const [summary, listing] = await Promise.all([
    getPropertySummary(propertyId),
    getListingIntelligence(propertyId),
  ])

  if (!summary) return null

  // Compliance gate — display_allowed must be true for MLS data
  const listingAllowed = listing?.displayAllowed === true

  // Price history: only include if listing is display-allowed
  let priceHistory: { date: string; price: number; event: string }[] = []
  if (listingAllowed) {
    const { data } = await serviceClient
      .from('listing_price_history')
      .select('event_date, price, event_type')
      .eq('property_id', propertyId)
      .order('event_date', { ascending: false })
      .limit(20)
    priceHistory = (data ?? []).map(r => ({
      date:  r.event_date as string,
      price: r.price as number,
      event: r.event_type as string,
    }))
  }

  const attribution: MlsAttribution = {
    mlsBoardName: 'Beaches MLS / SunMLS',
    lastUpdated:  listing?.fetchedAt ?? new Date().toISOString(),
    disclaimer:   'Information is deemed reliable but not guaranteed. © Beaches MLS.',
  }

  return {
    propertyId,
    mlsNumber: listing?.mlsNumber ?? null,
    listing: listingAllowed && listing ? {
      status:       listing.status ?? 'Unknown',
      listPrice:    listing.listPrice,
      daysOnMarket: listing.daysOnMarket,
      listDate:     listing.listDate,
      remarks:      listing.remarks,
      photos:       [],  // fetched separately via listing_photos (Sprint 2 UI)
      address: {
        street: summary.address,
        city:   summary.city,
        state:  summary.state,
        zip:    summary.zip,
      },
      property: {
        beds:      summary.beds,
        baths:     summary.baths,
        sqft:      summary.sqft,
        yearBuilt: summary.yearBuilt,
      },
    } : null,
    scores: {
      marketPosition:         listing?.marketPositionScore ?? null,
      acquisitionOpportunity: null, // never exposed to public
    },
    priceHistory,
    attribution,
    dataAsOf: listing?.fetchedAt ?? new Date().toISOString(),
  }
}

// ── Cost introspection (Principle 7) ─────────────────────────────────────────
// Callers can ask "what will this cost?" before triggering enrichment.
// Lazy enrichment (Principle 6) means enrichment should only happen when
// explicitly needed — these helpers support that decision.

function getProviderCatalog() {
  return listProviders()
}

function getIntentCostCents(intent: DsoeIntent): number {
  return estimateIntentCost(intent)
}

// ── Singleton export ──────────────────────────────────────────────────────────

class PropertyGraphService {
  getPropertySummary            = getPropertySummary
  getListingIntelligence        = getListingIntelligence
  getOpportunitySignals         = getOpportunitySignals
  getPropertyTimeline           = getPropertyTimeline
  getPropertyGraph              = getPropertyGraph
  getPublicProfile              = getPublicProfile
  /** Sprint 3: Comparable properties — scored + deduplicated, grouped by status */
  getComparableIntelligence     = getComparableIntelligence
  /** Sprint 3: Market statistics + position summary for the property's ZIP market */
  getMarketContext              = getMarketContext
  /** Returns cost metadata for all registered providers */
  getProviderCatalog            = getProviderCatalog
  /** Returns estimated cost in cents before triggering a DSOE intent */
  getIntentCostCents            = getIntentCostCents
}

/** The one interface all consumers call. Never import domain services directly. */
export const propertyGraph = new PropertyGraphService()
