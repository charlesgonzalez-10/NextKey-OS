/**
 * REAPI Skip Trace Provider
 *
 * Uses the existing REAPI_KEY — no new credentials required.
 * Endpoint: POST https://api.realestateapi.com/v2/SkipTrace
 * Docs: https://developer.realestateapi.com/reference/skiptrace-v2.md
 */

import type { SkipTraceProvider } from '../provider'
import type { SkipTraceInput, SkipTracePhone, SkipTraceEmail, SkipTraceContact, SkipTraceProviderResult } from '../types'

const ENDPOINT = 'https://api.realestateapi.com/v2/SkipTrace'

// ── Response types ─────────────────────────────────────────────────────────────

interface REAPIPhone {
  phone:              string
  phoneLastSeen?:     string
  phoneUsage12Month?: string
  phoneType?:         string
  phoneFtcDnc?:       string | boolean
}

interface REAPIPerson {
  personId?:    string
  firstName?:   string
  lastName?:    string
  fullName?:    string
  age?:         string
  address?: {
    address?:       string
    streetAddress?: string
    city?:          string
    state?:         string
    zip?:           string
  }
  previousAddress?: {
    address?: string
  }
  emails?: string[]
  phones?: REAPIPhone[]
}

interface REAPISkipTraceResponse {
  requestId?:   string
  requestDate?: string
  persons?:     REAPIPerson[]
}

// ── Phone type normalization ───────────────────────────────────────────────────

function normalizePhoneType(raw: string | undefined): SkipTracePhone['phone_type'] {
  const t = (raw ?? '').toLowerCase()
  // REAPI returns single-letter codes: W=wireless, M=mobile, L=landline, V=voip
  if (t === 'w' || t === 'm' || t.includes('mobile') || t.includes('wireless') || t.includes('cell')) return 'mobile'
  if (t === 'l' || t.includes('landline') || t.includes('land'))                                      return 'landline'
  if (t === 'v' || t.includes('voip'))                                                                return 'voip'
  return 'other'
}

function mapPhone(p: REAPIPhone, priority: number): SkipTracePhone {
  const type = normalizePhoneType(p.phoneType)
  return {
    phone_number:  p.phone,
    phone_type:    type,
    is_mobile:     type === 'mobile',
    is_landline:   type === 'landline',
    is_voip:       type === 'voip',
    is_dnc:        p.phoneFtcDnc === true || p.phoneFtcDnc === 'Y' || p.phoneFtcDnc === 'y',
    carrier:       null,
    priority,
    confidence:    null,
    last_verified: p.phoneLastSeen ?? null,
  }
}

function mapEmails(emails: string[]): SkipTraceEmail[] {
  return emails.map((email, i) => ({
    email,
    confidence:    null,
    is_primary:    i === 0,
    last_verified: null,
  }))
}

function mapPerson(p: REAPIPerson): SkipTraceContact {
  const phones = (p.phones ?? []).map((ph, i) => mapPhone(ph, i + 1))
  const emails = mapEmails(p.emails ?? [])

  const addressHistory: string[] = []
  if (p.previousAddress?.address) addressHistory.push(p.previousAddress.address)

  return {
    full_name:           p.fullName ?? ([p.firstName, p.lastName].filter(Boolean).join(' ') || null),
    confidence_score:    null,
    provider_contact_id: p.personId ?? null,
    age:                 p.age ? parseInt(p.age, 10) || null : null,
    phones,
    emails,
    relatives:           [],
    address_history:     addressHistory,
  }
}

// ── Provider implementation ────────────────────────────────────────────────────

export class REAPISkipTraceProvider implements SkipTraceProvider {
  readonly name = 'reapi'

  async run(input: SkipTraceInput): Promise<SkipTraceProviderResult> {
    const key = process.env.REAPI_KEY
    if (!key) throw new Error('REAPI_KEY environment variable is not set')

    const body: Record<string, string | undefined> = {
      address:    input.address,
      city:       input.city,
      state:      input.state,
      zip:        input.zip,
      first_name: input.first_name ?? undefined,
      last_name:  input.last_name  ?? undefined,
    }

    const t0  = Date.now()
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    key,
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`REAPI SkipTrace HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const data: REAPISkipTraceResponse = await res.json()
    const durationMs = Date.now() - t0

    const contacts = (data.persons ?? []).map(mapPerson)

    return {
      provider:        this.name,
      contacts,
      credits_used:    1,
      cost_cents:      null,
      response_time_ms: durationMs,
      raw:             data,
    }
  }
}
