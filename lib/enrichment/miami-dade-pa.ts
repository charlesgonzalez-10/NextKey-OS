/**
 * Miami-Dade Property Appraiser REST API + GIS Client
 * Public APIs — no key required.
 *
 * Strategy:
 *  1. findFolioByAddressGIS() — queries Miami-Dade GIS address layer to discover
 *     the folio (parcel ID) from a plain-text address. Works reliably.
 *  2. enrichFromMiamiDadePA() — calls the PA API GetPropertySearchByFolio with
 *     the discovered folio, returning the full rich detail response.
 *
 * Call from server-side only (API routes / Server Actions). CORS blocks browser calls.
 */

// ─── Endpoints ───────────────────────────────────────────────────────────────

const PA_BASE =
  'https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx'

// MD_LandInformation layer 26 = Parcels @ PaParcel
// Has TRUE_SITE_ADDR (full plain-text address) + FOLIO + owner/building data
const GIS_PARCEL_URL =
  'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query'

// ─── Raw PA API response types ────────────────────────────────────────────────

interface PAPropertyInfo {
  BedroomCount?:         number
  BathroomCount?:        number
  HalfBathroomCount?:    number
  BuildingHeatedArea?:   number
  BuildingActualArea?:   number
  BuildingGrossArea?:    number
  LotSize?:              number
  FloorCount?:           number
  FolioNumber?:          string
  Municipality?:         string
  NeighborhoodDescription?: string
  PrimaryZone?:          string
  PrimaryZoneDescription?: string
  DORCode?:              string
  DORDescription?:       string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface PAOwnerInfo {
  Name?: string
  PercentageOwn?: number
  Description?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface PAMailingAddress {
  Address1?: string
  Address2?: string
  Address3?: string
  City?:     string
  State?:    string
  ZipCode?:  string
  Country?:  string
}

interface PAAssessmentInfo {
  Year?:             number
  AssessedValue?:    number
  TotalValue?:       number
  LandValue?:        number
  BuildingOnlyValue?: number
  ExtraFeatureValue?: number
}

interface PABuildingInfo {
  BuildingNo?: number
  Actual?:     number   // year built
  HeatedArea?: number
  GrossArea?:  number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface PASaleInfo {
  SaleId?:      number
  DateOfSale?:  string
  SalePrice?:   number
  GranteeName1?: string
  GranteeName2?: string
  GrantorName1?: string
  QualificationDescription?: string
  QualifiedFlag?: string
  SaleInstrument?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface PAFullResponse {
  Completed?:         boolean
  Message?:           string
  PropertyInfo?:      PAPropertyInfo
  OwnerInfos?:        PAOwnerInfo[]
  MailingAddress?:    PAMailingAddress
  Building?:          { BuildingInfos?: PABuildingInfo[] }
  Assessment?:        { AssessmentInfos?: PAAssessmentInfo[] }
  SalesInfos?:        PASaleInfo[]
  LegalDescription?:  { Description?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

// ─── Normalized output ────────────────────────────────────────────────────────

export interface PAEnrichmentResult {
  // Ownership
  owner_name:       string | null
  mailing_address:  string | null
  owner_state:      string | null
  owner_zip:        string | null
  owner_country:    string | null

  // Property
  legal_desc:       string | null
  zoning:           string | null
  property_use:     string | null
  subdivision:      string | null

  // Building
  beds:             number | null
  baths:            number | null
  living_area:      number | null
  year_built:       number | null
  lot_size:         number | null

  // Financial (current year)
  market_value:     number | null
  assessed_value:   number | null
  land_value:       number | null
  building_value:   number | null
  tax_year:         number | null

  // Sale history
  last_sale_date:   string | null
  last_sale_amount: number | null
  prev_sale_date:   string | null
  prev_sale_amount: number | null

  // Raw for storage
  raw: PAFullResponse
}

// ─── Folio normalization ──────────────────────────────────────────────────────

/**
 * Miami-Dade folios look like "01-1234-056-7890" with dashes, or
 * "0112340567890" without. The PA API and GIS both return 13-digit no-dash form.
 */
export function normalizeFolio(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

// ─── Address parser ───────────────────────────────────────────────────────────

interface ParsedAddress {
  stNum:  string
  stDir:  string
  stName: string
  stType: string
}

const DIRS  = new Set(['N','S','E','W','NE','NW','SE','SW'])
const TYPES = new Set([
  'AVE','BLVD','CIR','CT','DR','EXPY','FWY','HWY','LN','LOOP',
  'PKWY','PL','RD','ST','TER','TERR','TRL','WAY',
])

export function parseAddress(raw: string): ParsedAddress | null {
  // "212 SW 7 AVE" → { stNum:'212', stDir:'SW', stName:'7', stType:'AVE' }
  const parts = raw.trim().toUpperCase().split(/\s+/)
  if (parts.length < 2) return null

  const stNum = parts[0]
  if (!/^\d+/.test(stNum)) return null

  const rest = parts.slice(1)
  let stDir  = ''
  let stName = ''
  let stType = ''

  if (DIRS.has(rest[0])) {
    stDir = rest.shift()!
  }

  if (rest.length > 0 && TYPES.has(rest[rest.length - 1])) {
    stType = rest.pop()!
  }

  stName = rest.join(' ')
  if (!stName) return null

  return { stNum, stDir, stName, stType }
}

// ─── GIS-based address → folio lookup ────────────────────────────────────────

interface GISParcelFeature {
  attributes: {
    FOLIO:          string
    TRUE_SITE_ADDR: string
    TRUE_OWNER1?:   string
  }
}

/** Normalize long-form street type words to abbreviations used by the MD GIS */
const STREET_TYPE_MAP: Record<string, string> = {
  AVENUE:    'AVE',
  BOULEVARD: 'BLVD',
  CIRCLE:    'CIR',
  COURT:     'CT',
  DRIVE:     'DR',
  EXPRESSWAY:'EXPY',
  FREEWAY:   'FWY',
  HIGHWAY:   'HWY',
  LANE:      'LN',
  PARKWAY:   'PKWY',
  PLACE:     'PL',
  ROAD:      'RD',
  STREET:    'ST',
  TERRACE:   'TER',
  TRAIL:     'TRL',
}

function normalizeAddressForGIS(raw: string): string {
  let s = raw.trim().toUpperCase()

  // 1. Normalize long-form street type words to GIS abbreviations
  s = s.replace(
    /\b(AVENUE|BOULEVARD|CIRCLE|COURT|DRIVE|EXPRESSWAY|FREEWAY|HIGHWAY|LANE|PARKWAY|PLACE|ROAD|STREET|TERRACE|TRAIL)\b/g,
    (word) => STREET_TYPE_MAP[word] ?? word
  )

  // 2. Strip unit/apartment/suite suffixes — these don't appear in GIS TRUE_SITE_ADDR
  //    e.g. "220 NE 12 AVE 67" → "220 NE 12 AVE"
  //         "2791 NW 87 TER A"  → "2791 NW 87 TER"
  //         "2036 ADAMS ST # 1-5" → "2036 ADAMS ST"
  s = s
    .replace(/\s*#\s*[\w/-]+\s*$/, '')                         // # 1-5 / #A
    .replace(/\s+(?:APT|UNIT|STE|SUITE|FL|FLOOR|RM|ROOM)\s+\S+\s*$/i, '') // APT 1, UNIT B
    .replace(/\s+[A-Z]\s*$/, '')                               // trailing single-letter unit: "TER A" → "TER"
    .replace(/\s+\d+\s*$/, (m, offset, str) => {
      // Strip trailing bare number ONLY if a known street type precedes it
      //   "220 NE 12 AVE 67" → strip "67"
      //   "9941 SW 38 ST"    → "ST" is the last token, no bare number, nothing stripped
      const before = str.slice(0, offset).trimEnd()
      const lastWord = before.split(/\s+/).pop() ?? ''
      return TYPES.has(lastWord) ? '' : m
    })
    .trim()

  return s
}

/**
 * Looks up a Miami-Dade folio number from a plain-text address using the
 * MD_LandInformation parcel layer (layer 26 = PaParcel).
 *
 * Uses TRUE_SITE_ADDR LIKE '{address}%' — the GIS stores addresses in
 * abbreviated form (AVE, ST, etc.), so we normalize the input first.
 * Unit suffixes are stripped before querying.
 *
 * NOTE: URLSearchParams over-encodes SQL single-quotes; build URL manually
 * with encodeURIComponent on just the WHERE value.
 */
export async function findFolioByAddressGIS(
  address: string,
): Promise<{ folio: string; gisAddress: string } | null> {
  const norm = normalizeAddressForGIS(address)
  if (!norm) return null

  // Full-address LIKE: "212 SW 7 AVE%" matches "212 SW 7 AVE" exactly
  // The % also catches GIS entries with unit suffixes we didn't know about
  const where = `TRUE_SITE_ADDR LIKE '${norm}%'`
  const url   = `${GIS_PARCEL_URL}?where=${encodeURIComponent(where)}&outFields=FOLIO,TRUE_SITE_ADDR,TRUE_OWNER1&returnGeometry=false&f=json`

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`GIS HTTP ${res.status}`)

    const data = await res.json() as { features?: GISParcelFeature[] }
    const features = data.features ?? []

    if (!features.length) {
      console.log(`[MD GIS] No parcel found for: ${norm}`)
      return null
    }

    const feat  = features[0]
    const folio = normalizeFolio(feat.attributes.FOLIO ?? '')
    if (!folio) return null

    return {
      folio,
      gisAddress: (feat.attributes.TRUE_SITE_ADDR ?? '').trim(),
    }
  } catch (err) {
    console.error('[MD GIS] Parcel lookup failed:', err)
    return null
  }
}

// ─── Keep old name as alias for API route compatibility ───────────────────────

export async function findFolioByAddress(
  address: string,
  _city?: string
): Promise<{ folio: string; info: Record<string, unknown> } | null> {
  const result = await findFolioByAddressGIS(address)
  if (!result) return null
  return { folio: result.folio, info: { gisAddress: result.gisAddress } }
}

// ─── Main enrichment call ─────────────────────────────────────────────────────

export async function enrichFromMiamiDadePA(
  folioRaw: string
): Promise<PAEnrichmentResult | null> {
  const folio = normalizeFolio(folioRaw)
  if (!folio || folio.length < 10) return null

  let data: PAFullResponse | null = null

  try {
    const url = `${PA_BASE}?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=${folio}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`PA API HTTP ${res.status}`)
    data = await res.json() as PAFullResponse
  } catch (err) {
    console.error('[MD PA] GetPropertySearchByFolio failed:', err)
    return null
  }

  if (!data || !data.PropertyInfo) {
    console.warn('[MD PA] No PropertyInfo in response for folio:', folio)
    return null
  }

  const pi   = data.PropertyInfo
  const mail = data.MailingAddress ?? {}
  const legal = data.LegalDescription?.Description ?? null

  // ── Owner ─────────────────────────────────────────────────────────────────
  const owners = data.OwnerInfos ?? []
  const ownerName = owners.map(o => o.Name).filter(Boolean).join(' / ') || null

  // ── Mailing address ───────────────────────────────────────────────────────
  const mailingParts = [
    mail.Address1,
    mail.Address2,
    mail.Address3,
    mail.City && mail.State
      ? `${mail.City}, ${mail.State} ${mail.ZipCode ?? ''}`.trim()
      : (mail.City ?? null),
  ].filter(Boolean)

  // ── Building ──────────────────────────────────────────────────────────────
  const buildings = data.Building?.BuildingInfos ?? []
  // Year built = earliest Actual year across all buildings
  const yearBuilt = buildings.length
    ? Math.min(...buildings.map(b => b.Actual ?? 9999))
    : null

  // ── Assessment (use most recent year = index 0) ───────────────────────────
  const assessments = data.Assessment?.AssessmentInfos ?? []
  const currentAssessment: PAAssessmentInfo = assessments[0] ?? {}

  // ── Sales ─────────────────────────────────────────────────────────────────
  // Filter to qualified/arm's-length sales for meaningful amounts
  // but don't exclude non-qualified — the DB shows all sales
  const sales = data.SalesInfos ?? []
  const lastSale = sales[0] ?? null
  const prevSale = sales[1] ?? null

  return {
    owner_name:       ownerName,
    mailing_address:  mailingParts.join(', ') || null,
    owner_state:      mail.State   ?? null,
    owner_zip:        mail.ZipCode ?? null,
    owner_country:    mail.Country ?? null,

    legal_desc:    legal,
    zoning:        pi.PrimaryZoneDescription ?? pi.DORDescription ?? null,
    property_use:  pi.DORDescription         ?? null,
    subdivision:   pi.NeighborhoodDescription ?? null,

    beds:        pi.BedroomCount      ?? null,
    baths:       pi.BathroomCount     ?? null,
    living_area: pi.BuildingHeatedArea ?? null,
    year_built:  yearBuilt === 9999   ? null : (yearBuilt ?? null),
    lot_size:    pi.LotSize           ?? null,

    market_value:    currentAssessment.TotalValue       ?? null,
    assessed_value:  currentAssessment.AssessedValue    ?? null,
    land_value:      currentAssessment.LandValue        ?? null,
    building_value:  currentAssessment.BuildingOnlyValue ?? null,
    tax_year:        currentAssessment.Year             ?? null,

    last_sale_date:   lastSale?.DateOfSale  ?? null,
    last_sale_amount: lastSale?.SalePrice   ?? null,
    prev_sale_date:   prevSale?.DateOfSale  ?? null,
    prev_sale_amount: prevSale?.SalePrice   ?? null,

    raw: data,
  }
}
