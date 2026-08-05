/**
 * MLS Intelligence Provider — REAPI adapter.
 *
 * Wraps the existing REAPI PropertySearch API and normalizes the response
 * into a UnifiedListing. This is the Phase 6.5 Sprint 1 MLS provider.
 * The RESO direct client (Sprint 2 target) will implement the same interface.
 *
 * Guardrail: this provider fetches data only. It does NOT write to any table.
 * Writes are owned by propertyService.getListingIntelligence().
 */

import type {
  DsoeProviderDef,
  DsoeProviderResult,
  DsoeQuery,
  UnifiedListing,
  MlsStatus,
  UnifiedPriceHistoryEvent,
} from '../types'

const REAPI_BASE = 'https://api.realestateapi.com/v2'

// ── Raw REAPI MLS fields (subset relevant to listing intelligence) ─────────────

interface REAPIListingRaw {
  mlsId?:              string
  mlsNumber?:          string
  mlsStatus?:          string
  mlsActive?:          boolean
  mlsPending?:         boolean
  mlsSold?:            boolean
  mlsListingPrice?:    number
  originalListingPrice?: number
  closePrice?:         number
  listingDate?:        string
  closingDate?:        string
  daysOnMarket?:       number
  cumulativeDaysOnMarket?: number
  priceReductions?:    number
  priceHistory?:       { date: string; price: number; event: string; previousPrice?: number }[]
  listingAgentName?:   string
  listingAgentPhone?:  string
  listingAgentEmail?:  string
  listingBrokerageName?: string
  publicRemarks?:      string
  listingDescription?: string
  photos?:             (string | { url?: string; href?: string })[]
  mlsPhotos?:          string[]
  images?:             (string | { url?: string })[]
  hoaFee?:             number
  associationFee?:     number
  address?:            { address?: string; street?: string; city?: string; state?: string; zip?: string }
  city?:               string
  state?:              string
  zip?:                string
  bedrooms?:           number
  bathrooms?:          number
  squareFeet?:         number
  lotSquareFeet?:      number
  yearBuilt?:          number
  propertyType?:       string
  propertyUse?:        string
  pricePerSquareFoot?: number
  // allow any additional REAPI fields for rawSource
  [key: string]: unknown
}

// ── Status normalization ──────────────────────────────────────────────────────

function normalizeStatus(raw: REAPIListingRaw): MlsStatus {
  const s = (raw.mlsStatus ?? '').toLowerCase()
  if (s.includes('active') && !s.includes('contract')) return 'Active'
  if (s.includes('pending') || s.includes('contract')) return 'Pending'
  if (s.includes('closed') || s.includes('sold')) return 'Closed'
  if (s.includes('expired')) return 'Expired'
  if (s.includes('withdrawn') || s.includes('cancelled')) return 'Withdrawn'
  // Fallback: infer from boolean flags
  if (raw.mlsActive) return 'Active'
  if (raw.mlsPending) return 'Pending'
  if (raw.mlsSold) return 'Closed'
  return 'Unknown'
}

// ── Photo extraction ──────────────────────────────────────────────────────────

function extractPhotos(raw: REAPIListingRaw): string[] {
  const photos = raw.photos ?? raw.mlsPhotos ?? raw.images
  if (!Array.isArray(photos)) return []
  return photos
    .map(p => {
      if (typeof p === 'string') return p
      return (p as { url?: string; href?: string }).url
        ?? (p as { url?: string; href?: string }).href
        ?? ''
    })
    .filter(Boolean)
}

// ── Price history extraction ──────────────────────────────────────────────────

function extractPriceHistory(raw: REAPIListingRaw): UnifiedPriceHistoryEvent[] {
  if (Array.isArray(raw.priceHistory)) {
    return raw.priceHistory.map(h => ({
      date:          h.date,
      price:         h.price,
      event:         h.event,
      previousPrice: h.previousPrice,
    }))
  }
  return []
}

// ── REAPI → UnifiedListing ────────────────────────────────────────────────────

function normalizeToUnifiedListing(raw: REAPIListingRaw): UnifiedListing {
  const sqft = raw.squareFeet ?? null
  const listPrice = raw.mlsListingPrice ?? null
  const pricePerSqFt = raw.pricePerSquareFoot
    ?? (sqft && listPrice ? parseFloat((listPrice / sqft).toFixed(0)) : null)

  const addressStreet = raw.address?.address
    ?? raw.address?.street
    ?? null

  return {
    mlsNumber:          raw.mlsId ?? raw.mlsNumber ?? null,
    source:             'reapi',
    status:             normalizeStatus(raw),
    listPrice,
    closePrice:         raw.closePrice ?? null,
    originalListPrice:  raw.originalListingPrice ?? null,
    listDate:           raw.listingDate ?? null,
    closeDate:          raw.closingDate ?? null,
    daysOnMarket:       raw.daysOnMarket ?? null,
    cumulativeDom:      raw.cumulativeDaysOnMarket ?? null,
    pricePerSqFt,
    priceReductionCount: raw.priceReductions ?? null,
    priceHistory:       extractPriceHistory(raw),
    address: {
      street: addressStreet,
      city:   raw.address?.city ?? raw.city ?? null,
      state:  raw.address?.state ?? raw.state ?? null,
      zip:    raw.address?.zip ?? raw.zip ?? null,
    },
    property: {
      beds:         raw.bedrooms ?? null,
      baths:        raw.bathrooms ?? null,
      sqft,
      yearBuilt:    raw.yearBuilt ?? null,
      lotSqft:      raw.lotSquareFeet ?? null,
      propertyType: raw.propertyUse ?? raw.propertyType ?? null,
    },
    agent: {
      listAgentName:  raw.listingAgentName  ?? null,
      listAgentPhone: raw.listingAgentPhone ?? null,
      listAgentEmail: raw.listingAgentEmail ?? null,
      listOfficeName: raw.listingBrokerageName ?? null,
    },
    photos:    extractPhotos(raw),
    remarks:   raw.publicRemarks ?? raw.listingDescription ?? null,
    hoaAmount: raw.hoaFee ?? raw.associationFee ?? null,
    rawSource: raw as Record<string, unknown>,
    fetchedAt: new Date().toISOString(),
  }
}

// ── Provider fetch ────────────────────────────────────────────────────────────

async function fetchMlsFromReapi(query: DsoeQuery): Promise<DsoeProviderResult> {
  const start = Date.now()
  const key = process.env.REAPI_KEY

  if (!key) {
    return { providerId: 'mls-reapi', data: {}, listing: null, success: false, durationMs: 0, error: 'REAPI_KEY not configured' }
  }

  // Build search body — prefer folio (APN), fall back to address
  const searchBody: Record<string, unknown> = { size: 1 }
  if (query.folio) {
    searchBody.apn = query.folio.replace(/\D/g, '')
  } else if (query.address) {
    searchBody.address = query.address
    if (query.city) searchBody.city = query.city
  } else {
    return { providerId: 'mls-reapi', data: {}, listing: null, success: false, durationMs: 0, error: 'No folio or address to search' }
  }

  try {
    const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body:    JSON.stringify(searchBody),
      signal:  AbortSignal.timeout(12_000),
    })

    const durationMs = Date.now() - start

    if (!res.ok) {
      return {
        providerId: 'mls-reapi',
        data: {},
        listing: null,
        success: false,
        durationMs,
        error: `REAPI HTTP ${res.status}`,
      }
    }

    const json = await res.json()
    const raw: REAPIListingRaw | null = Array.isArray(json.data)
      ? (json.data[0] ?? null)
      : (json.data ?? null)

    if (!raw) {
      return { providerId: 'mls-reapi', data: {}, listing: null, success: true, durationMs }
    }

    const listing = normalizeToUnifiedListing(raw)

    // Build a field map for the properties table (for DSOE field-authority merge)
    const data: Record<string, unknown> = {
      mls_status:        listing.status === 'Unknown' ? null : listing.status,
      mls_listing_price: listing.listPrice,
      mls_active:        listing.status === 'Active',
      mls_number:        listing.mlsNumber,
      mls_dom:           listing.daysOnMarket,
      mls_cdom:          listing.cumulativeDom,
      mls_price_reductions: listing.priceReductionCount,
      mls_original_price: listing.originalListPrice,
      mls_agent_name:    listing.agent.listAgentName,
      mls_agent_phone:   listing.agent.listAgentPhone,
      mls_agent_email:   listing.agent.listAgentEmail,
      mls_broker_name:   listing.agent.listOfficeName,
      mls_remarks_public: listing.remarks,
      mls_hoa_amount:    listing.hoaAmount,
      mls_photos:        listing.photos,
      mls_price_history: listing.priceHistory,
    }

    return { providerId: 'mls-reapi', data, listing, success: true, durationMs }
  } catch (err) {
    return {
      providerId: 'mls-reapi',
      data: {},
      listing: null,
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ── Provider definition ───────────────────────────────────────────────────────

export const mlsReapiProvider: DsoeProviderDef = {
  id:    'mls-reapi',
  group: 'mls_intelligence',
  supports: ['listing', 'comps', 'valuation', 'full_profile'],
  authoritative_fields: [
    'mls_status', 'mls_listing_price', 'mls_active', 'mls_number',
    'mls_dom', 'mls_cdom', 'mls_price_reductions', 'mls_original_price',
    'mls_agent_name', 'mls_agent_phone', 'mls_agent_email', 'mls_broker_name',
    'mls_remarks_public', 'mls_hoa_amount', 'mls_photos', 'mls_price_history',
  ],
  estimatedCostCents:    5,    // ~$0.05/call on current REAPI plan
  freshnessTtlHours:     2,    // active listings change hourly; 2h is aggressive but safe
  confidence:            90,   // MLS is authoritative for listing data
  supportsBatch:         false, // PropertySearch is single-property; bulk not yet used
  supportsWebhooks:      false, // REAPI does not push; polling only (Sprint 2: Spark/RESO webhooks)
  supportsManualRefresh: true,
  fetch: fetchMlsFromReapi,
}
