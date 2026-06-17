/**
 * Four-tier data refresh model for the Property Intelligence Engine.
 *
 * Level 1 — Static:       Never refresh automatically (year_built, sqft, etc.)
 * Level 2 — Slow-changing: 90–180 days (owner, valuation, mortgage, tax)
 * Level 3 — Market data:  Refresh when TTL expires or user requests it
 * Level 4 — Internal:     Never from external APIs (AI, offers, comms, docs)
 */

export type ModuleName =
  | 'details'     // L1 — beds/baths/sqft/year/lot (static, never refresh)
  | 'ownership'   // L2 — owner/mailing/homestead/entity
  | 'valuation'   // L2 — market value/assessed/equity
  | 'mortgage'    // L2 — loan balance/lender info
  | 'tax'         // L2 — tax assessment/annual taxes
  | 'foreclosure' // L2 — foreclosure status, case, auction date
  | 'mls'         // L3 — listing status/price/DOM/agent
  | 'rental'      // L3 — Rentcast rent estimate
  | 'comps'       // L3 — comparable sales
  | 'ai'          // L4 — AI analysis/scores (manual refresh only)

export type RefreshLevel = 1 | 2 | 3 | 4

export interface TierConfig {
  level: RefreshLevel
  ttlDays: number        // Infinity for L1 and L4
  activeTtlDays?: number // shorter TTL when MLS status is Active or Pending
  description: string
  snapshotKeys: string[] // properties table columns to snapshot before overwriting
}

export const REFRESH_TIERS: Record<ModuleName, TierConfig> = {

  // ── Level 1: Static ───────────────────────────────────────────────────────
  details: {
    level:        1,
    ttlDays:      Infinity,
    description:  'Physical characteristics — never change after construction',
    snapshotKeys: [],
  },

  // ── Level 2: Slow-changing ────────────────────────────────────────────────
  ownership: {
    level:        2,
    ttlDays:      120,
    description:  'Owner name, mailing address, homestead, entity type',
    snapshotKeys: ['owner_name', 'mailing_address', 'owner_state', 'homestead'],
  },
  valuation: {
    level:        2,
    ttlDays:      90,
    description:  'Market value, assessed value, equity tier and percentage',
    snapshotKeys: ['market_value', 'assessed_value', 'equity_dollar_amount', 'equity_percentage', 'equity_tier'],
  },
  mortgage: {
    level:        2,
    ttlDays:      90,
    description:  'Estimated loan balance, lender name',
    snapshotKeys: ['foreclosure_amount', 'lender_name'],
  },
  tax: {
    level:        2,
    ttlDays:      365,
    description:  'Annual tax assessment — changes once per year at most',
    snapshotKeys: ['tax_amount', 'tax_year', 'assessed_value'],
  },
  foreclosure: {
    level:        2,
    ttlDays:      30,
    description:  'Foreclosure type, case #, auction date — changes frequently during active case',
    snapshotKeys: ['foreclosure_type', 'foreclosure_amount', 'auction_date', 'file_date', 'is_pre_foreclosure', 'is_foreclosure'],
  },

  // ── Level 3: Market data ──────────────────────────────────────────────────
  mls: {
    level:         3,
    ttlDays:       7,
    activeTtlDays: 1, // active/pending listings: refresh daily
    description:   'MLS listing status, price, DOM, agent info, photos',
    snapshotKeys:  ['mls_status', 'mls_listing_price', 'mls_dom', 'mls_price_reductions', 'mls_active'],
  },
  rental: {
    level:        3,
    ttlDays:      7,
    description:  'Rentcast monthly rent estimate and range',
    snapshotKeys: ['rent_estimate', 'suggested_rent', 'rent_range_low', 'rent_range_high'],
  },
  comps: {
    level:        3,
    ttlDays:      14,
    description:  'Comparable sales from Rentcast or Beaches MLS',
    snapshotKeys: [], // comps stored in lead_comps, not columns on properties
  },

  // ── Level 4: Internal intelligence ───────────────────────────────────────
  ai: {
    level:        4,
    ttlDays:      Infinity,
    description:  'AI analysis, opportunity scores — manual refresh only',
    snapshotKeys: ['opportunity_score', 'opportunity_label'],
  },
}

// Convenience sets used for validation in route guards

export const STATIC_FIELDS = new Set<string>([
  'year_built', 'lot_size', 'living_area', 'sqft', 'beds', 'baths',
  'property_type', 'folio_number', 'legal_description', 'zoning',
  'subdivision_name', 'stories', 'building_area',
])

export const MARKET_FIELDS = new Set<string>([
  'mls_status', 'mls_listing_price', 'mls_active', 'mls_dom',
  'mls_price_reductions', 'mls_original_price', 'mls_cdom',
  'mls_agent_name', 'mls_agent_phone', 'mls_photos', 'mls_remarks_public',
  'rent_estimate', 'suggested_rent', 'rent_range_low', 'rent_range_high',
])
