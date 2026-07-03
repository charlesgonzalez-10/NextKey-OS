/**
 * Skip Trace Service
 *
 * Orchestrates provider calls with freshness gating, persistent storage,
 * credit tracking, and activity logging. Mirrors the Property Intelligence
 * pattern: check freshness → call provider if stale → store results →
 * mark refreshed → log activity.
 */

import { serviceClient } from '../supabase-service'
import { shouldRefreshModule, markModuleRefreshed } from '../propertyService'
import { REAPISkipTraceProvider } from './providers/reapi'
import type { SkipTraceInput, SkipTraceStoredResult } from './types'

const PROVIDER = new REAPISkipTraceProvider()
const ST_TTL_DAYS = 90

// ── Fetch stored results ───────────────────────────────────────────────────────

export async function getLatestSkipTrace(propertyId: string): Promise<SkipTraceStoredResult | null> {
  // Most recent completed request for this property
  const { data: req } = await serviceClient
    .from('skiptrace_requests')
    .select('id, provider, status, credits_used, cost_cents, response_time_ms, requested_at, completed_at')
    .eq('property_id', propertyId)
    .eq('status', 'completed')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!req) return null

  const { data: results } = await serviceClient
    .from('skiptrace_results')
    .select('id, full_name, confidence_score, provider_contact_id, age, relatives, address_history')
    .eq('request_id', req.id)

  const enriched = await Promise.all((results ?? []).map(async result => {
    const { data: phones } = await serviceClient
      .from('skiptrace_phones')
      .select('phone_number, phone_type, is_mobile, is_landline, is_voip, is_dnc, carrier, priority, confidence, last_verified')
      .eq('skiptrace_result_id', result.id)
      .order('priority')

    const { data: emails } = await serviceClient
      .from('skiptrace_emails')
      .select('email, confidence, is_primary, last_verified')
      .eq('skiptrace_result_id', result.id)
      .order('is_primary', { ascending: false })

    return {
      ...result,
      relatives:       (result.relatives as string[] | null) ?? [],
      address_history: (result.address_history as string[] | null) ?? [],
      phones:  phones  ?? [],
      emails:  emails  ?? [],
    }
  }))

  const daysSince = req.completed_at
    ? Math.floor((Date.now() - new Date(req.completed_at).getTime()) / 86_400_000)
    : null

  return {
    request:    req,
    results:    enriched,
    days_since: daysSince,
    is_fresh:   daysSince !== null && daysSince < ST_TTL_DAYS,
  }
}

// ── Run a new skip trace ───────────────────────────────────────────────────────

export async function runSkipTrace(opts: {
  propertyId: string
  leadId:     string | null
  input:      SkipTraceInput
  userId:     string
  userEmail:  string
  force?:     boolean
}): Promise<{ stored: SkipTraceStoredResult; fromCache: boolean }> {

  // Freshness gate — skip provider call if data is still fresh
  if (!opts.force) {
    const needsRefresh = await shouldRefreshModule(opts.propertyId, 'skiptrace')
    if (!needsRefresh) {
      const cached = await getLatestSkipTrace(opts.propertyId)
      if (cached) return { stored: cached, fromCache: true }
    }
  }

  // Create a pending request record
  const { data: reqRow } = await serviceClient
    .from('skiptrace_requests')
    .insert({
      property_id:     opts.propertyId,
      lead_id:         opts.leadId,
      provider:        PROVIDER.name,
      status:          'pending',
      request_payload: {
        address:    opts.input.address,
        city:       opts.input.city,
        state:      opts.input.state,
        zip:        opts.input.zip,
        first_name: opts.input.first_name ?? null,
        last_name:  opts.input.last_name  ?? null,
      },
      created_by: opts.userId,
    })
    .select('id')
    .single()

  if (!reqRow) throw new Error('Failed to create skiptrace_requests row')

  const reqId = reqRow.id
  const now   = new Date().toISOString()

  try {
    const result = await PROVIDER.run(opts.input)

    // Persist provider result
    await serviceClient
      .from('skiptrace_requests')
      .update({
        status:          'completed',
        credits_used:    result.credits_used,
        cost_cents:      result.cost_cents,
        response_time_ms: result.response_time_ms,
        completed_at:    now,
      })
      .eq('id', reqId)

    // Collect first phones across all contacts for backward-compat columns
    const allPhones: string[] = []

    for (const contact of result.contacts) {
      const { data: resultRow } = await serviceClient
        .from('skiptrace_results')
        .insert({
          request_id:          reqId,
          property_id:         opts.propertyId,
          full_name:           contact.full_name,
          confidence_score:    contact.confidence_score,
          provider_contact_id: contact.provider_contact_id,
          age:                 contact.age,
          relatives:           contact.relatives,
          address_history:     contact.address_history,
          raw_response:        result.raw,
        })
        .select('id')
        .single()

      if (!resultRow) continue
      const resultId = resultRow.id

      if (contact.phones.length) {
        await serviceClient.from('skiptrace_phones').insert(
          contact.phones.map(p => ({
            skiptrace_result_id: resultId,
            property_id:         opts.propertyId,
            ...p,
          }))
        )
        contact.phones.forEach(p => {
          if (p.phone_number) allPhones.push(p.phone_number)
        })
      }

      if (contact.emails.length) {
        await serviceClient.from('skiptrace_emails').insert(
          contact.emails.map(e => ({
            skiptrace_result_id: resultId,
            property_id:         opts.propertyId,
            ...e,
          }))
        )
      }
    }

    // Back-fill phone_1–5 on properties so the existing workspace display picks them up
    const phoneUpdate: Record<string, string | null> = {
      phone_1: allPhones[0] ?? null,
      phone_2: allPhones[1] ?? null,
      phone_3: allPhones[2] ?? null,
      phone_4: allPhones[3] ?? null,
      phone_5: allPhones[4] ?? null,
    }
    await serviceClient.from('properties').update({ ...phoneUpdate, updated_at: now }).eq('id', opts.propertyId)

    // Mark module refreshed so freshness gate works on next open
    await markModuleRefreshed(opts.propertyId, 'skiptrace', PROVIDER.name)

    // Activity log
    const totalContacts = result.contacts.length
    const totalPhones   = allPhones.length
    const totalEmails   = result.contacts.reduce((n, c) => n + c.emails.length, 0)
    await serviceClient.from('lead_notes').insert({
      lead_id:   opts.leadId ?? opts.propertyId,
      note_type: 'skip_trace',
      author:    opts.userEmail,
      body:      `Skip Trace completed via ${PROVIDER.name}. Found ${totalContacts} contact${totalContacts !== 1 ? 's' : ''} · ${totalPhones} phone${totalPhones !== 1 ? 's' : ''} · ${totalEmails} email${totalEmails !== 1 ? 's' : ''}. Credits used: ${result.credits_used}.`,
    })

    const stored = await getLatestSkipTrace(opts.propertyId)
    return { stored: stored!, fromCache: false }

  } catch (err) {
    // Mark the request as failed but don't swallow the error
    await serviceClient
      .from('skiptrace_requests')
      .update({ status: 'failed', completed_at: now })
      .eq('id', reqId)

    // Activity log the failure
    void serviceClient.from('lead_notes').insert({
      lead_id:   opts.leadId ?? opts.propertyId,
      note_type: 'skip_trace',
      author:    opts.userEmail,
      body:      `Skip Trace failed (${PROVIDER.name}): ${err instanceof Error ? err.message : 'Unknown error'}`,
    })

    throw err
  }
}

// ── Bulk skip trace ────────────────────────────────────────────────────────────

export async function bulkSkipTrace(opts: {
  propertyIds: string[]
  userId:      string
  userEmail:   string
  force?:      boolean
}): Promise<{ processed: number; skipped: number; errors: number; credits_used: number }> {
  let processed = 0, skipped = 0, errors = 0, credits_used = 0

  for (const propertyId of opts.propertyIds) {
    try {
      const { data: prop } = await serviceClient
        .from('properties')
        .select('id, property_address, city, state, zip, owner_name')
        .eq('id', propertyId)
        .maybeSingle()

      if (!prop?.property_address) { skipped++; continue }

      const { data: lead } = await serviceClient
        .from('leads')
        .select('id')
        .eq('property_id', propertyId)
        .maybeSingle()

      const nameParts = (prop.owner_name ?? '').trim().split(/\s+/)
      const input: SkipTraceInput = {
        address:    prop.property_address,
        city:       prop.city  ?? '',
        state:      prop.state ?? 'FL',
        zip:        prop.zip   ?? '',
        first_name: nameParts[0] ?? null,
        last_name:  nameParts.slice(1).join(' ') || null,
      }

      const { stored, fromCache } = await runSkipTrace({
        propertyId,
        leadId:    lead?.id ?? null,
        input,
        userId:    opts.userId,
        userEmail: opts.userEmail,
        force:     opts.force,
      })

      if (fromCache) {
        skipped++
      } else {
        processed++
        credits_used += stored.request.credits_used ?? 1
      }
    } catch {
      errors++
    }
  }

  return { processed, skipped, errors, credits_used }
}
