/**
 * Miami-Dade County OR Index Adapter — Commercial Data Web Portal (REST)
 *
 * Miami-Dade Clerk's Commercial Data program provides a credentialed JSON API
 * over HTTPS. Subscribers receive a key that is passed as a query parameter
 * or Authorization header depending on the plan tier.
 *
 * Portal: https://www2.miamidadeclerk.gov/Developers/api/OfficialRecords
 * Auth  : process.env.MIAMI_DADE_CLERK_KEY (required — apply at the portal above)
 *
 * API contract (scaffolded from portal documentation):
 *   GET /SearchByDate?begin_date=YYYY-MM-DD&end_date=YYYY-MM-DD&doc_type=LP
 *
 * Expected JSON shape (update FIELD_MAP below when you have live credentials):
 * [
 *   {
 *     "cfn":              "2025012345678",   // instrument / case number
 *     "recorded_date":    "2025-06-06",
 *     "doc_type":         "LP",
 *     "grantor_name":     "WELLS FARGO BANK NA",
 *     "grantee_name":     "SMITH JOHN A",
 *     "legal_description":"LOTS 1-2 BLK 3 CORAL GABLES SEC 5",
 *     "consideration":    245000,
 *     "book":             "35001",
 *     "page":             "4000"
 *   },
 *   …
 * ]
 *
 * NOTE: If the actual JSON field names differ from the above once you have live
 *       credentials, only update FIELD_MAP below — nothing else needs to change.
 */

import { isDistressType, classifyDocType } from './types'
import type { CountyAdapter, ORRecord, AdapterResult } from './types'

// ─── API base ─────────────────────────────────────────────────────────────────

const API_BASE =
  'https://www2.miamidadeclerk.gov/Developers/api/OfficialRecords'

// ─── JSON field name map ──────────────────────────────────────────────────────
// Update these if the live API returns different key names.

const FIELD_MAP = {
  case_number:       ['cfn', 'instrument_number', 'cf_number', 'cfn_number'],
  recording_date:    ['recorded_date', 'recording_date', 'recordedDate', 'date_recorded'],
  doc_type:          ['doc_type', 'document_type', 'docType', 'documentType'],
  grantor:           ['grantor_name', 'grantor', 'grantorName'],
  grantee:           ['grantee_name', 'grantee', 'granteeName'],
  legal_description: ['legal_description', 'legal_desc', 'legalDescription'],
  consideration:     ['consideration', 'consideration_amount', 'considerationAmount'],
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)   // YYYY-MM-DD
}

/**
 * Pull the first non-empty string value from `obj` by trying a list of
 * candidate key names. Returns '' if none match.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: Record<string, any>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim()
    }
  }
  return ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickNumber(obj: Record<string, any>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null) {
      const n = parseFloat(String(v).replace(/[$,]/g, ''))
      if (!isNaN(n)) return n
    }
  }
  return undefined
}

/** Normalise various date formats to YYYY-MM-DD */
function normalizeDate(raw: string): string {
  if (!raw) return ''
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  // MM/DD/YYYY
  const mmddyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  // Fallback: let Date parse it
  try {
    const parsed = new Date(raw)
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  } catch { /* ignore */ }
  return raw
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(raw: Record<string, any>, source: string): ORRecord | null {
  const caseNum  = pick(raw, FIELD_MAP.case_number)
  const docType  = pick(raw, FIELD_MAP.doc_type)

  if (!caseNum)                return null   // no identifier — skip
  if (!isDistressType(docType)) return null  // not a tracked distress type

  return {
    case_number:       caseNum,
    recording_date:    normalizeDate(pick(raw, FIELD_MAP.recording_date)),
    doc_type:          docType,
    lead_category:     classifyDocType(docType),
    plaintiff:         pick(raw, FIELD_MAP.grantor),
    defendant:         pick(raw, FIELD_MAP.grantee),
    legal_description: pick(raw, FIELD_MAP.legal_description) || undefined,
    consideration:     pickNumber(raw, FIELD_MAP.consideration),
    county:            'miami-dade',
    source_file:       source,
    raw,
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class MiamiDadeORAdapter implements CountyAdapter {
  readonly county = 'miami-dade' as const

  private getKey(): string {
    const key = process.env.MD_CLERK_AUTH_KEY
    if (!key) throw new Error(
      'MD_CLERK_AUTH_KEY environment variable is not set. ' +
      'Apply for access at https://www2.miamidadeclerk.gov/Developers/api/OfficialRecords'
    )
    return key
  }

  async fetchYesterdaysRecords(): Promise<ORRecord[]> {
    const result = await this._fetch()
    return result.records
  }

  async fetch(): Promise<AdapterResult> {
    return this._fetch()
  }

  private async _fetch(): Promise<AdapterResult> {
    const yesterday = yesterdayISO()
    const source    = `MD-Clerk-API:${yesterday}`

    let key: string
    try {
      key = this.getKey()
    } catch (err) {
      return { county: 'miami-dade', records: [], fetched: 0, filtered: 0, source, error: String(err) }
    }

    // ── Build request URL ────────────────────────────────────────────────────
    // The API supports filtering by doc_type=LP directly, so we don't need to
    // pull all document types and filter client-side.
    const url = new URL(`${API_BASE}/SearchByDate`)
    url.searchParams.set('begin_date',  yesterday)
    url.searchParams.set('end_date',    yesterday)
    // No doc_type filter — pull all types and classify client-side.
    // This way a single API call gets LP + PROB + TCD + DOM in one shot.
    url.searchParams.set('api_key',     key)        // some plans pass key as query param

    let raw: unknown
    try {
      const res = await fetch(url.toString(), {
        method:  'GET',
        headers: {
          'Accept':        'application/json',
          'Authorization': `Bearer ${key}`,         // other plans use Bearer header
          'User-Agent':    'NextKeyOS/1.0 (+https://nextkeyos.vercel.app)',
        },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
      }

      raw = await res.json()
    } catch (err) {
      const msg = `API request failed: ${String(err)}`
      console.error(`[Miami-Dade OR] ${msg}`)
      return { county: 'miami-dade', records: [], fetched: 0, filtered: 0, source, error: msg }
    }

    // ── Normalise response ───────────────────────────────────────────────────
    // The API may return an array directly, or wrap it in { data: [...] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, any>[] = Array.isArray(raw)
      ? raw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : Array.isArray((raw as any)?.data)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (raw as any).data
        : []

    const records: ORRecord[] = []
    for (const row of rows) {
      const record = normalizeRecord(row, source)
      if (record) records.push(record)
    }

    console.log(`[Miami-Dade OR] ${source}: ${rows.length} rows total, ${records.length} distress filings`)

    return {
      county:   'miami-dade',
      records,
      fetched:  rows.length,
      filtered: records.length,
      source,
    }
  }
}
