/**
 * Phase 6.5 — Unified Property Intelligence types.
 *
 * Used by:
 *   lib/graph/dsoeRouter.ts      — routing engine
 *   lib/graph/propertyGraph.ts   — PropertyGraphService
 *   lib/graph/providers/*        — individual providers
 *   lib/propertyService.ts       — getListingIntelligence()
 *   app/api/properties/[id]/*    — API routes
 */

// ── DSOE Routing ──────────────────────────────────────────────────────────────

/**
 * What the caller needs to know. Determines which providers are consulted
 * and which field-authority rules apply. Never ask for 'full_profile' when
 * 'listing' or 'ownership' will do — it runs more providers and costs more.
 */
export type DsoeIntent =
  | 'listing'       // MLS vitals — price, status, DOM, photos
  | 'ownership'     // Owner name, mailing address, homestead, entity
  | 'legal_status'  // Foreclosure, probate, liens, lis pendens
  | 'valuation'     // Assessed value, AVM, comparable-based estimate
  | 'comps'         // Comparable sales for CMA
  | 'full_profile'  // All of the above — merge by field authority

export interface DsoeQuery {
  propertyId: string
  intent: DsoeIntent
  folio?: string | null
  address?: string | null
  city?: string | null
  county?: string | null
  lat?: number | null
  lng?: number | null
  /** Skip cache — force a fresh fetch from provider */
  force?: boolean
}

export interface DsoeProviderDef {
  id: string
  group: 'public_records' | 'mls_intelligence' | 'premium_apis' | 'internal'
  supports: DsoeIntent[]
  /**
   * Fields this provider is authoritative for.
   * Used by mergeByAuthority() when intent='full_profile'.
   * A field listed here is taken from this provider even if another provider
   * returned a value for it first.
   */
  authoritative_fields: string[]

  /**
   * Cost metadata — used by the DSOE router for cost tracking and routing decisions.
   * INTENT_STACKS are ordered free-first; this metadata makes the cost explicit
   * so the router can emit accurate savings metrics without hardcoded values.
   */
  estimatedCostCents: number    // 0 = free, >0 = paid (per call)
  freshnessTtlHours:  number    // how long before this provider's data is considered stale
  confidence:         number    // typical data quality score 0–100
  supportsBatch:      boolean   // can fetch multiple properties in one call
  supportsWebhooks:   boolean   // can push updates instead of requiring polling
  supportsManualRefresh: boolean // can be explicitly re-fetched by user action

  fetch(query: DsoeQuery): Promise<DsoeProviderResult>
}

export interface DsoeProviderResult {
  providerId:  string
  /** Normalized field map — field names match properties table columns */
  data:        Record<string, unknown>
  /** Populated when this provider fetched listing data */
  listing?:    UnifiedListing | null
  success:     boolean
  durationMs:  number
  error?:      string
  /** True when data came from DB cache instead of a live provider call */
  cacheHit?:   boolean
  /** If this provider was skipped, why */
  skipReason?: 'cache_warm' | 'intent_not_supported' | 'not_configured' | null
  /** Cost avoided (cents) because a cache hit skipped this provider call */
  avoidedCostCents?: number
}

export interface DsoeResult {
  propertyId:  string
  intent:      DsoeIntent
  providers:   DsoeProviderResult[]
  /** Field-authority merged output of all provider data */
  merged:      Record<string, unknown>
  /** Present when any provider returned listing data */
  listing?:    UnifiedListing | null
  resolvedAt:  string
  /** Total cost of live provider calls this resolution (cents) */
  totalCostCents: number
  /** Total cost avoided via cache hits (cents) */
  avoidedCostCents: number
}

// ── MLS / Listing ─────────────────────────────────────────────────────────────

export type MlsStatus = 'Active' | 'Pending' | 'Closed' | 'Expired' | 'Withdrawn' | 'Unknown'

/**
 * Vendor-agnostic listing provider identifier.
 * Values are provider IDs — adding a new MLS source is a new string literal here,
 * not a new service class. Named ListingProviderSource, not MLSSource, to keep
 * the architecture vendor-agnostic.
 */
export type ListingProviderSource = 'reapi' | 'beaches-mls' | 'reso-direct'

/** @deprecated Use ListingProviderSource. Kept as alias for backward compat. */
export type MlsSource = ListingProviderSource

/**
 * Normalized listing shape returned by any MLS provider.
 * Callers never see raw RESO or REAPI payloads — only this.
 */
export interface UnifiedListing {
  mlsNumber: string | null
  source: ListingProviderSource
  status: MlsStatus
  listPrice: number | null
  closePrice: number | null
  originalListPrice: number | null
  listDate: string | null   // ISO date string
  closeDate: string | null
  daysOnMarket: number | null
  cumulativeDom: number | null
  pricePerSqFt: number | null
  priceReductionCount: number | null
  priceHistory: UnifiedPriceHistoryEvent[]
  address: {
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  property: {
    beds: number | null
    baths: number | null
    sqft: number | null
    yearBuilt: number | null
    lotSqft: number | null
    propertyType: string | null
  }
  agent: {
    listAgentName: string | null
    listAgentPhone: string | null
    listAgentEmail: string | null
    listOfficeName: string | null
  }
  photos: string[]
  remarks: string | null
  hoaAmount: number | null
  /** Original provider payload. Stored in listing_intelligence.raw_source for audit. */
  rawSource: Record<string, unknown>
  fetchedAt: string
}

export interface UnifiedPriceHistoryEvent {
  date: string
  price: number
  event: string
  previousPrice?: number
}

// ── Listing Intelligence ──────────────────────────────────────────────────────

export interface VelocitySignals {
  priceReductionCount?: number | null
  totalReductionPct?: number | null
  backOnMarket?: boolean
  domTrend?: 'accelerating' | 'stalling' | 'normal' | null
  listingCycle?: number | null
}

export interface PricingIntelligence {
  avmSpreadPct?: number | null
  spLpRatio6mo?: number | null
  absorptionMonths?: number | null
  comparableCount?: number | null
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Full explanation of how a score was computed.
 * Stored in listing_intelligence.scoring_breakdown.
 * Every score surface in the UI must expose this — no unexplained numbers.
 *
 * Score directions:
 *   marketStrengthScore (Market Strength):
 *     Higher = stronger listing / better seller position.
 *     100 = brand-new active listing, no reductions, pending contract.
 *     0   = expired/withdrawn, many reductions, very high DOM.
 *
 *   acquisitionOpportunityScore (MLS Acquisition Opportunity):
 *     Higher = more attractive to an investor / buyer.
 *     Scope is MLS-derived signals only until non-MLS sources are wired in.
 *     acquisitionScoreScope = 'mls_only' until county PA + other feeds are incorporated.
 */
export interface ScoreBreakdown {
  /** Formula version — bump when weights or logic change so history is interpretable */
  version:     string
  scoredAt:    string
  inputs: {
    daysOnMarket:        number | null
    priceReductionCount: number | null
    status:              string | null
    backOnMarket:        boolean
    listingCycle:        number
    activeSignalTypes:   string[]
  }
  /** Each named component and its signed contribution to the final score */
  components:  Record<string, number>
  /** Pre-clamp total (useful for debugging formula ceilings) */
  clampedFrom: number
  total:       number
  /**
   * Scope of the acquisition opportunity score.
   * 'mls_only' = only MLS-derived signals were available when scoring.
   * 'full'     = all configured signal sources (MLS + county PA + etc.) were included.
   * UI should label accordingly: "MLS Acquisition Opportunity" when 'mls_only'.
   */
  acquisitionScoreScope?: 'mls_only' | 'full'
}

/** Maps to a row in the listing_intelligence table */
export interface ListingIntelligence {
  id: string
  propertyId: string
  mlsNumber: string | null
  source: ListingProviderSource
  listPrice: number | null
  closePrice: number | null
  originalListPrice: number | null
  listDate: string | null
  closeDate: string | null
  status: MlsStatus | null
  daysOnMarket: number | null
  cumulativeDom: number | null
  pricePerSqFt: number | null
  priceReductionCount: number | null
  marketPositionScore: number | null
  acquisitionOpportunityScore: number | null
  hoaAmount: number | null
  listingCycle: number
  velocitySignals: VelocitySignals
  pricingIntelligence: PricingIntelligence
  scoringBreakdown: ScoreBreakdown | null
  listAgentName: string | null
  listAgentPhone: string | null
  listAgentEmail: string | null
  listOfficeName: string | null
  remarks: string | null
  photoCount: number
  displayAllowed: boolean
  fetchedAt: string
  createdAt: string
  updatedAt: string
}

// ── Opportunity Signals ───────────────────────────────────────────────────────

export type OpportunitySignalType =
  // Public Records
  | 'pre_foreclosure'
  | 'probate'
  | 'tax_deed'
  | 'surplus_funds'
  | 'lis_pendens'
  // MLS — status
  | 'mls_active'
  | 'pending_mls'
  | 'expired_listing'
  // MLS — pricing pressure
  | 'mls_price_reduced'
  | 'multiple_price_reductions'
  | 'high_dom'
  | 'back_on_market'
  // Ownership / Equity
  | 'high_equity'
  | 'free_and_clear'
  | 'investor_owned'
  | 'non_owner_occupied'
  | 'vacant'
  | 'absentee_owner'
  // Market
  | 'no_hoa'
  | 'below_market'

export type OpportunitySignalSource =
  | 'clerk_of_court'
  | 'tax_collector'
  | 'mls'
  | 'county_pa'
  | 'reapi'
  | 'manual'

export interface OpportunitySignal {
  id: string
  propertyId: string
  signalType: OpportunitySignalType
  signalSource: OpportunitySignalSource
  isActive: boolean
  confidence: number   // 0–1
  signalData: Record<string, unknown>
  detectedAt: string
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UpsertOpportunitySignalInput {
  propertyId: string
  signalType: OpportunitySignalType
  signalSource: OpportunitySignalSource
  isActive?: boolean
  confidence?: number
  signalData?: Record<string, unknown>
  detectedAt?: string
  expiresAt?: string | null
}

// ── Property Timeline ─────────────────────────────────────────────────────────

export type TimelineCategory = 'legal' | 'mls' | 'opportunity' | 'internal' | 'document' | 'comms'

export interface PropertyTimelineEvent {
  id: string
  propertyId: string
  occurredAt: string
  category: TimelineCategory
  eventType: string
  title: string
  description?: string | null
  amount?: number | null
  previousAmount?: number | null
  sourceTable: string
  sourceId: string
  visibility: 'agent' | 'shared'
}

export interface PropertyTimelineOptions {
  since?: string
  categories?: TimelineCategory[]
  visibility?: 'agent' | 'shared' | 'all'
  limit?: number
}

// ── Property Graph ────────────────────────────────────────────────────────────

export interface PropertySummary {
  id: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  beds: number | null
  baths: number | null
  sqft: number | null
  yearBuilt: number | null
  ownerName: string | null
  marketValue: number | null
  assessedValue: number | null
  folioNumber: string | null
  lat: number | null
  lng: number | null
  propertyType: string | null
}

export interface PropertyGraphOptions {
  includeListing?: boolean
  includeOpportunitySignals?: boolean
  includeTimeline?: boolean
  includeComparables?: boolean
  includeMarketContext?: boolean
  timelineOpts?: PropertyTimelineOptions
  force?: boolean
}

export interface PropertyGraph {
  propertyId: string
  summary: PropertySummary | null
  listing?: ListingIntelligence | null
  opportunitySignals?: OpportunitySignal[]
  timeline?: PropertyTimelineEvent[]
  scores?: {
    /** Higher = stronger listing / seller position */
    marketPosition: number | null
    /** Higher = more attractive acquisition target. Scope is MLS-only until full signal set wired. */
    acquisitionOpportunity: number | null
    /** Indicates which signal sources were included when acquisitionOpportunity was computed */
    acquisitionScoreScope: 'mls_only' | 'full' | null
  }
  comparables?: ComparableIntelligence | null
  marketContext?: MarketContext | null
  assembledAt: string
}

// ── Spesio Bridge ─────────────────────────────────────────────────────────────

export interface SpesioPropertyPackage {
  propertyId: string
  mlsNumber?: string | null
  listing: {
    status: string
    listPrice: number | null
    daysOnMarket: number | null
    listDate: string | null
    remarks: string | null
    photos: string[]
    address: { street: string | null; city: string | null; state: string | null; zip: string | null }
    property: { beds: number | null; baths: number | null; sqft: number | null; yearBuilt: number | null }
  } | null
  scores: {
    marketPosition: number | null
    acquisitionOpportunity: number | null
  }
  priceHistory: { date: string; price: number; event: string }[]
  attribution: MlsAttribution
  dataAsOf: string
}

export interface MlsAttribution {
  mlsBoardName: string
  lastUpdated: string
  disclaimer: string
}

// ── Comparable Intelligence (Sprint 3) ───────────────────────────────────────

export type CompStatus = 'active' | 'pending' | 'sold' | 'rental' | 'expired'

/**
 * Per-component explanation of why a comp scored as it did.
 * Stored in property_comparables.similarity_breakdown.
 */
export interface CompSelectionBreakdown {
  /** Formula version — bump when weights change */
  version: string
  /** 0–100 aggregate similarity score (higher = more similar) */
  total: number
  components: {
    /** Points from distance (closer = more points, up to weight_max) */
    distance:    number
    /** Points from matching property type */
    propertyType: number
    /** Points based on sqft variance band */
    sqft:        number
    /** Points based on bed/bath proximity */
    bedsBaths:   number
    /** Points based on year-built proximity */
    yearBuilt:   number
    /** Points from sale recency (sold comps only; penalizes older sales) */
    recency:     number
    /** Points from listing status match */
    status:      number
    /** Bonus for matching subdivision */
    subdivision: number
  }
  inputs: {
    distanceMiles:   number | null
    sqftVariancePct: number | null
    bedsDiff:        number | null
    bathsDiff:       number | null
    yearBuiltDiff:   number | null
    daysSinceSold:   number | null
    sameType:        boolean
    sameSubdivision: boolean | null
  }
}

export interface PropertyComparable {
  id: string
  subjectPropertyId: string
  compPropertyId: string | null
  compMlsNumber: string | null
  provenanceId: string | null       // provider-specific deduplication key
  compAddress: {
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  compStatus: CompStatus | null
  relationship: string              // 'active_comp' | 'closed_comp' | 'expired_comp' | 'rental_comp'
  listPrice: number | null
  closePrice: number | null
  sqft: number | null
  beds: number | null
  baths: number | null
  yearBuilt: number | null
  lotSqft: number | null
  daysOnMarket: number | null
  pricePerSqft: number | null
  distanceMiles: number | null
  listDate: string | null
  closeDate: string | null
  subdivision: string | null
  propertyType: string | null
  similarityScore: number | null
  similarityBreakdown: CompSelectionBreakdown | null
  selectionVersion: string
  sourceTimestamp: string | null
  source: string
  generatedAt: string
  expiresAt: string
  createdAt: string
}

/**
 * The assembled comparable intelligence for a property:
 * comps grouped by status + summary statistics derived from the set.
 */
export interface ComparableIntelligence {
  propertyId: string
  active:     PropertyComparable[]
  pending:    PropertyComparable[]
  sold:       PropertyComparable[]
  rental:     PropertyComparable[]
  summary: {
    activeCount:       number
    pendingCount:      number
    soldCount:         number
    medianActivePrice: number | null
    medianSoldPrice:   number | null
    medianPricePerSqft: number | null
    medianDom:         number | null
    /** Null when sample is too small (<3 closed comps) or comp set is stale */
    suggestedValueRange: { low: number; high: number } | null
    sampleSize:        number
    confidence:        'high' | 'medium' | 'low'
    /** ISO timestamp of oldest comp in the set — UI warning when >6 months */
    oldestCompDate:    string | null
  }
  fetchedAt: string
  fromCache: boolean
}

// ── Market Statistics (Sprint 3) ─────────────────────────────────────────────

/**
 * Pre-aggregated market statistics for a geography + time period.
 * Computed from listing_intelligence rows we already hold.
 * No additional provider call required.
 */
export interface MarketStatistics {
  id: string
  marketKey: string          // e.g. 'zip:33101' | 'city:Miami' | 'zip:33101:condo'
  periodStart: string        // ISO date
  periodEnd: string
  periodType: 'monthly' | 'quarterly' | 'annual'
  activeListings: number | null
  pendingCount: number | null
  soldCount: number | null
  newListings: number | null
  closedListings: number | null
  expiredListings: number | null
  medianListPrice: number | null
  medianClosePrice: number | null
  medianPriceSqft: number | null
  medianSpLpRatio: number | null
  medianDom: number | null
  absorptionMonths: number | null
  monthsOfSupply: number | null
  priceReductionRate: number | null
  totalVolume: number | null
  sampleSize: number | null
  /** 'high' = n≥30, 'medium' = n≥10, 'low' = n<10 */
  confidence: 'high' | 'medium' | 'low' | null
  calculationVersion: string
  source: string
  computedAt: string
  createdAt: string
}

/**
 * Market context assembled for a specific property — the statistics for its
 * ZIP code market over the trailing 90 days, plus a position summary.
 */
export interface MarketContext {
  propertyId: string
  marketKey: string
  statistics: MarketStatistics | null
  /** How the subject property compares to the active market */
  positionSummary: {
    /** null when subject has no list price */
    pricingPosition: 'below_market' | 'at_market' | 'above_market' | null
    /** null when subject has no DOM */
    domPosition: 'fast' | 'normal' | 'slow' | null
    /** Sample-size warning threshold — UI should surface this */
    lowConfidence: boolean
  } | null
  fetchedAt: string
  fromCache: boolean
}
