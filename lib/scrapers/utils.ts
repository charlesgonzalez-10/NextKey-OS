import type { EquityTier, EntityType, EnrichedLead } from './types'

// ─── Equity Calculations ─────────────────────────────────────────────────────

export function calcEquityTier(pct: number): EquityTier {
  if (pct > 50)  return 'High'
  if (pct > 25)  return 'Medium'
  if (pct > 0)   return 'Low'
  return 'None'
}

export function calcEquity(lead: EnrichedLead): Partial<EnrichedLead> {
  const marketValue = lead.assessed_value || lead.sold_price || 0
  const debt = lead.foreclosure_amount || 0

  if (!marketValue || !debt) return {}

  const equityDollar = marketValue - debt
  const equityPct = (equityDollar / marketValue) * 100

  return {
    known_debt: debt,
    market_value: marketValue,
    equity_dollar_amount: Math.round(equityDollar),
    equity_percentage: Math.round(equityPct * 10) / 10,
    equity_tier: calcEquityTier(equityPct),
    price_per_sqft: lead.living_area && marketValue
      ? Math.round(marketValue / lead.living_area)
      : undefined,
  }
}

// ─── Entity Detection ─────────────────────────────────────────────────────────

const LLC_PATTERNS  = /\bllc\b|\bl\.l\.c\b/i
const CORP_PATTERNS = /\bcorp\b|\binc\b|\bincorporated\b/i
const TRUST_PATTERNS = /\btrust\b|\btrustee\b|\btr\b/i
const INVEST_PATTERNS = /\bholdings\b|\bproperties\b|\binvestments\b|\bventures\b|\bgroup\b|\bassociates\b|\brealty\b/i

export function detectEntityType(name: string): EntityType {
  if (!name) return 'Individual'
  if (LLC_PATTERNS.test(name))    return 'LLC'
  if (CORP_PATTERNS.test(name))   return 'Corporation'
  if (TRUST_PATTERNS.test(name))  return 'Trust'
  if (INVEST_PATTERNS.test(name)) return 'Investment Company'
  return 'Individual'
}

// ─── Name Helpers ─────────────────────────────────────────────────────────────

export function extractFirstName(fullName: string): string {
  if (!fullName) return ''
  // Handle "LAST, FIRST MIDDLE" format (common in Florida records)
  if (fullName.includes(',')) {
    const parts = fullName.split(',')
    const firstParts = (parts[1] || '').trim().split(' ')
    return firstParts[0] || ''
  }
  return fullName.split(' ')[0] || ''
}

export function normalizePhone(phone: string): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`
  return phone
}

export function parseDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return undefined
    return d.toISOString().split('T')[0]
  } catch { return undefined }
}

export function parseMoney(val: string | number | undefined): number | undefined {
  if (val === undefined || val === null || val === '') return undefined
  if (typeof val === 'number') return val
  const clean = val.toString().replace(/[$,\s]/g, '')
  const n = parseFloat(clean)
  return isNaN(n) ? undefined : n
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function getWeekAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}

// Format date as MM/DD/YYYY for county search forms
export function toFormDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${m}/${d}/${y}`
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

// Returns true if the folio or case already exists in our DB
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isDuplicate(
  supabase: any,
  { folio_number, case_number }: { folio_number?: string; case_number?: string }
): Promise<{ duplicate: boolean; reason?: string }> {
  if (folio_number) {
    const { data } = await supabase
      .from('scraper_leads')
      .select('id')
      .eq('folio_number', folio_number)
      .maybeSingle()
    if (data) return { duplicate: true, reason: `Folio ${folio_number} already exists` }

    // Also check contacts table
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .ilike('notes', `%folio:${folio_number}%`)
      .maybeSingle()
    if (contact) return { duplicate: true, reason: `Folio ${folio_number} already in contacts` }
  }

  if (case_number) {
    const { data } = await supabase
      .from('scraper_leads')
      .select('id')
      .eq('case_number', case_number)
      .maybeSingle()
    if (data) return { duplicate: true, reason: `Case ${case_number} already exists` }
  }

  return { duplicate: false }
}
