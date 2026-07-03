/**
 * BatchData.com Skip Trace Provider
 *
 * API: POST https://api.batchdata.com/api/v1/property/skip-trace
 * Auth: x-api-key header
 * Env: BATCHDATA_API_KEY (server-side only, never exposed to browser)
 *
 * Docs: https://developer.batchdata.com/docs/skip-trace
 */

import type { SkipTraceProvider } from '../provider'
import type { SkipTraceContact, SkipTraceEmail, SkipTraceInput, SkipTracePhone, SkipTraceProviderResult } from '../types'

const BASE_URL = 'https://api.batchdata.com/api/v1'

function parseNameParts(fullName: string | null | undefined): { first: string; last: string } {
  if (!fullName) return { first: '', last: '' }
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function normalizePhoneType(raw: string | null | undefined): SkipTracePhone['phone_type'] {
  const t = (raw ?? '').toLowerCase()
  if (t.includes('mobile') || t.includes('cell')) return 'mobile'
  if (t.includes('land'))                          return 'landline'
  if (t.includes('voip'))                          return 'voip'
  return 'other'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPhones(rawPhones: any[]): SkipTracePhone[] {
  return (rawPhones ?? []).map((p, i) => {
    const type = normalizePhoneType(p.phoneType ?? p.type)
    return {
      phone_number:  String(p.phoneNumber ?? p.phone ?? '').replace(/\D/g, '').replace(/^1/, ''),
      phone_type:    type,
      is_mobile:     type === 'mobile',
      is_landline:   type === 'landline',
      is_voip:       type === 'voip',
      is_dnc:        !!(p.doNotCall ?? p.dnc),
      carrier:       p.carrier ?? null,
      priority:      i + 1,
      confidence:    typeof p.confidence === 'number' ? p.confidence : null,
      last_verified: p.lastReported ?? p.lastVerified ?? null,
    }
  }).filter(p => p.phone_number.length >= 10)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEmails(rawEmails: any[]): SkipTraceEmail[] {
  return (rawEmails ?? []).map((e, i) => ({
    email:         String(e.email ?? e.address ?? '').toLowerCase(),
    confidence:    typeof e.confidence === 'number' ? e.confidence : null,
    is_primary:    i === 0,
    last_verified: e.lastReported ?? e.lastVerified ?? null,
  })).filter(e => e.email.includes('@'))
}

export class BatchDataProvider implements SkipTraceProvider {
  readonly name = 'batchdata'

  async run(input: SkipTraceInput): Promise<SkipTraceProviderResult> {
    const key = process.env.BATCHDATA_API_KEY
    if (!key) throw new Error('BATCHDATA_API_KEY is not configured')

    const { first, last } = parseNameParts(
      [input.first_name, input.last_name].filter(Boolean).join(' ') || null
    )

    const requestBody = {
      requests: [{
        owner: {
          names: first || last ? [{ firstName: first, lastName: last }] : [],
        },
        propertyAddress: {
          house:  input.address.split(' ')[0] ?? '',
          street: input.address.split(' ').slice(1).join(' '),
          city:   input.city,
          state:  input.state,
          zip:    input.zip,
        },
      }],
    }

    const t0 = Date.now()
    const res = await fetch(`${BASE_URL}/property/skip-trace`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    key,
      },
      body:   JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    })

    const response_time_ms = Date.now() - t0

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`BatchData API error ${res.status}: ${text.slice(0, 200)}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()

    // BatchData returns results[].person[] or results[].contacts[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawResults: any[] = data?.results ?? data?.data ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPersons: any[] = []
    for (const r of rawResults) {
      const persons = r.persons ?? r.contacts ?? r.person ?? []
      rawPersons.push(...(Array.isArray(persons) ? persons : [persons]))
    }

    const contacts: SkipTraceContact[] = rawPersons.map(person => ({
      full_name:           person.name ?? person.fullName ?? null,
      confidence_score:    typeof person.confidence === 'number' ? person.confidence : null,
      provider_contact_id: person.id ?? person.personId ?? null,
      age:                 typeof person.age === 'number' ? person.age : null,
      phones:              mapPhones(person.phones ?? person.phoneNumbers ?? []),
      emails:              mapEmails(person.emails ?? person.emailAddresses ?? []),
      relatives:           (person.relatives ?? []).map((r: { name?: string; fullName?: string }) => r.name ?? r.fullName ?? '').filter(Boolean),
      address_history:     (person.addressHistory ?? person.addresses ?? []).map((a: { address?: string; full?: string }) => a.address ?? a.full ?? '').filter(Boolean),
    }))

    return {
      provider:         this.name,
      contacts,
      credits_used:     data?.creditsUsed ?? data?.credits ?? 1,
      cost_cents:       null,
      response_time_ms,
      raw:              data,
    }
  }
}
