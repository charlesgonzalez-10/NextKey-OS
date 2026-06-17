import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const today = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}
const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString()
const monthStart = () => {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString()
}
const daysBetween = (a: string) =>
  Math.floor((Date.now() - new Date(a).getTime()) / 864e5)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = serviceClient

  // Run all queries in parallel, fail gracefully on each
  const [
    leadsResult,
    leadStatusResult,
    contactResult,
    dealResult,
    newTodayResult,
    newWeekResult,
    followUpResult,
    opportunityResult,
    documentsResult,
    recentCommsResult,
    monthlyLeadsResult,
    monthlyDealsResult,
    profileResult,
    monthlyContactsResult,
    goalsResult,
  ] = await Promise.allSettled([
    // Total lead count
    svc.from('leads').select('*', { count: 'exact', head: true }),

    // Leads by status
    svc.from('leads').select('status, pipeline_stage, updated_at, id, property_id'),

    // Contacts
    svc.from('contacts').select('*', { count: 'exact', head: true }),

    // Deals
    svc.from('deals').select('id, address, status, offer_price, desired_profit, created_at').neq('status', 'Dead').order('created_at', { ascending: false }).limit(20),

    // New properties today
    svc.from('properties').select('*', { count: 'exact', head: true }).gte('created_at', today()),

    // New properties this week
    svc.from('properties').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo()),

    // Follow-ups: contacted leads, ordered by oldest update
    svc.from('leads')
      .select('id, property_id, status, updated_at, properties(address, owner_name)')
      .eq('status', 'contacted')
      .order('updated_at', { ascending: true })
      .limit(20),

    // Opportunity leads: high distress / foreclosure signals
    svc.from('properties')
      .select('id, address, owner_name, estimated_value, equity_percent, is_pre_foreclosure, is_foreclosure, is_auction, high_equity, absentee_owner, leads(id, status, ai_score, lead_score), lead_ai_summaries(distress_score)')
      .order('created_at', { ascending: false })
      .limit(15),

    // Documents by status
    svc.from('documents').select('status').limit(500),

    // Recent communications
    svc.from('communications').select('id, type, subject, from_email, to_email, direction, created_at').order('created_at', { ascending: false }).limit(10),

    // Monthly leads added
    svc.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', monthStart()),

    // Monthly deals activity
    svc.from('deals').select('status, created_at').gte('created_at', monthStart()),

    // User profile for name
    svc.from('user_profiles').select('my_name, display_name, dashboard_config').eq('id', user.id).single(),

    // Monthly contacts added
    svc.from('contacts').select('*', { count: 'exact', head: true }).gte('created_at', monthStart()),

    // User goals for this month
    svc.from('user_goals')
      .select('lead_goal, deal_goal, contract_goal, revenue_goal')
      .eq('user_id', user.id)
      .eq('month', monthStart().slice(0, 10))
      .maybeSingle(),
  ])

  // ── Lead type breakdown (separate query — needs join) ─────────────────────
  const [leadTypeBreakdownRaw, leadTypesListRaw] = await Promise.all([
    svc.from('contacts').select('lead_type_id').not('lead_type_id', 'is', null),
    svc.from('lead_types').select('id, name, color').eq('is_active', true).order('position'),
  ])
  const ltCounts: Record<string, number> = {}
  for (const row of (leadTypeBreakdownRaw.data ?? [])) {
    const id = String(row.lead_type_id)
    ltCounts[id] = (ltCounts[id] ?? 0) + 1
  }
  const ltList = (leadTypesListRaw.data ?? []) as { id: string; name: string; color: string }[]
  const lead_type_breakdown = ltList
    .map(lt => ({ id: lt.id, name: lt.name, color: lt.color, count: ltCounts[lt.id] ?? 0 }))
    .filter(lt => lt.count > 0)
    .sort((a, b) => b.count - a.count)

  // ── Extract results ────────────────────────────────────────────────────────
  const totalLeads    = leadsResult.status === 'fulfilled' ? (leadsResult.value.count ?? 0) : 0
  const leadRows      = leadStatusResult.status === 'fulfilled' ? (leadStatusResult.value.data ?? []) : []
  const totalContacts = contactResult.status === 'fulfilled' ? (contactResult.value.count ?? 0) : 0
  const dealRows      = dealResult.status === 'fulfilled' ? (dealResult.value.data ?? []) : []
  const newToday      = newTodayResult.status === 'fulfilled' ? (newTodayResult.value.count ?? 0) : 0
  const newWeek       = newWeekResult.status === 'fulfilled' ? (newWeekResult.value.count ?? 0) : 0
  const followUpRows  = followUpResult.status === 'fulfilled' ? (followUpResult.value.data ?? []) : []
  const opRows        = opportunityResult.status === 'fulfilled' ? (opportunityResult.value.data ?? []) : []
  const docRows       = documentsResult.status === 'fulfilled' ? (documentsResult.value.data ?? []) : []
  const commsRows     = recentCommsResult.status === 'fulfilled' ? (recentCommsResult.value.data ?? []) : []
  const monthlyLeads    = monthlyLeadsResult.status === 'fulfilled' ? (monthlyLeadsResult.value.count ?? 0) : 0
  const monthlyDealRows = monthlyDealsResult.status === 'fulfilled' ? (monthlyDealsResult.value.data ?? []) : []
  const profile         = profileResult.status === 'fulfilled' ? (profileResult.value.data ?? {}) : {}
  const monthlyContacts = monthlyContactsResult.status === 'fulfilled' ? (monthlyContactsResult.value.count ?? 0) : 0
  const goalsData       = goalsResult.status === 'fulfilled' ? (goalsResult.value.data ?? null) : null
  const goals = {
    lead_goal:     goalsData?.lead_goal     ?? 50,
    deal_goal:     goalsData?.deal_goal     ?? 5,
    contract_goal: goalsData?.contract_goal ?? 2,
    revenue_goal:  goalsData?.revenue_goal  ?? 0,
  }

  // ── Lead status counts ────────────────────────────────────────────────────
  const leadByStatus  = leadRows.reduce((acc: Record<string, number>, l: Record<string, unknown>) => {
    const s = String(l.status ?? 'new'); acc[s] = (acc[s] ?? 0) + 1; return acc
  }, {})

  // ── Deal stats ────────────────────────────────────────────────────────────
  const activeDealRows  = dealRows.filter((d: Record<string, unknown>) => d.status !== 'Closed' && d.status !== 'Dead')
  const underContract   = dealRows.filter((d: Record<string, unknown>) => d.status === 'Under Contract').length
  const closedMonth     = monthlyDealRows.filter((d: Record<string, unknown>) => d.status === 'Closed').length
  const pipelineValue   = activeDealRows.reduce((s: number, d: Record<string, unknown>) => s + (Number(d.offer_price) || 0), 0)

  // ── Documents stats ───────────────────────────────────────────────────────
  const docByStatus = docRows.reduce((acc: Record<string, number>, d: Record<string, unknown>) => {
    const s = String(d.status ?? 'draft'); acc[s] = (acc[s] ?? 0) + 1; return acc
  }, {})
  const contractsSent       = (docByStatus.sent ?? 0) + (docByStatus.signed_by_me ?? 0)
  const awaitingSignature   = docByStatus.signed_by_me ?? 0
  const awaitingOfferResp   = docByStatus.sent ?? 0

  // ── Follow-ups ────────────────────────────────────────────────────────────
  const followUps = followUpRows.map((l: Record<string, unknown>) => {
    const prop = l.properties as Record<string, unknown> | null
    const days = daysBetween(String(l.updated_at ?? new Date().toISOString()))
    return {
      id:         String(l.id),
      lead_id:    String(l.id),
      property_id: String(l.property_id),
      address:    String(prop?.address ?? 'Unknown'),
      owner_name: String(prop?.owner_name ?? 'Unknown Owner'),
      days_since: days,
      status:     String(l.status ?? 'contacted'),
    }
  })

  // ── Opportunity leads ─────────────────────────────────────────────────────
  const opportunityLeads = opRows
    .map((p: Record<string, unknown>) => {
      const leads = Array.isArray(p.leads) ? p.leads : (p.leads ? [p.leads] : [])
      const aisArr = Array.isArray(p.lead_ai_summaries) ? p.lead_ai_summaries : (p.lead_ai_summaries ? [p.lead_ai_summaries] : [])
      const lead   = leads[0] as Record<string, unknown> | undefined
      const ais    = aisArr[0] as Record<string, unknown> | undefined
      const types: string[] = []
      if (p.is_pre_foreclosure) types.push('Pre-Foreclosure')
      if (p.is_foreclosure)     types.push('Foreclosure')
      if (p.is_auction)         types.push('Auction')
      if (p.high_equity)        types.push('High Equity')
      if (p.absentee_owner)     types.push('Absentee')
      const score = Number(ais?.distress_score ?? lead?.ai_score ?? lead?.lead_score ?? 0)
      return {
        id:             String(p.id),
        address:        String(p.address ?? ''),
        owner_name:     String(p.owner_name ?? ''),
        lead_types:     types,
        estimated_value: Number(p.estimated_value ?? 0) || null,
        equity_percent: Number(p.equity_percent ?? 0) || null,
        distress_score: score,
        lead_id:        lead ? String(lead.id) : null,
        lead_status:    lead ? String(lead.status) : null,
      }
    })
    .filter((p: { lead_types: string[]; distress_score: number }) => p.lead_types.length > 0 || p.distress_score > 0)
    .sort((a: { distress_score: number }, b: { distress_score: number }) => b.distress_score - a.distress_score)
    .slice(0, 10)

  // ── Priorities ────────────────────────────────────────────────────────────
  const priorities: Array<{ id: string; type: string; label: string; href: string; urgency: string }> = []

  // Overdue follow-ups (>7 days since contact)
  const overdueFollowUps = followUps.filter(f => f.days_since >= 7).slice(0, 3)
  for (const f of overdueFollowUps) {
    priorities.push({
      id:      `fu-${f.id}`,
      type:    'followup',
      label:   `Follow up with ${f.owner_name} — ${f.address} (${f.days_since}d)`,
      href:    `/leads/${f.property_id}`,
      urgency: f.days_since >= 14 ? 'high' : 'medium',
    })
  }

  // Offers awaiting response
  if (awaitingOfferResp > 0) {
    priorities.push({ id: 'offers', type: 'offer', label: `${awaitingOfferResp} offer${awaitingOfferResp > 1 ? 's' : ''} awaiting response`, href: '/documents', urgency: 'high' })
  }

  // New foreclosure leads
  const foreclosureLeads = opRows.filter((p: Record<string, unknown>) => p.is_pre_foreclosure || p.is_foreclosure).length
  if (foreclosureLeads > 0) {
    priorities.push({ id: 'foreclosure', type: 'new_lead', label: `Review ${foreclosureLeads} foreclosure lead${foreclosureLeads > 1 ? 's' : ''}`, href: '/leads', urgency: 'medium' })
  }

  // Contracts awaiting signature
  if (awaitingSignature > 0) {
    priorities.push({ id: 'contracts', type: 'contract', label: `${awaitingSignature} contract awaiting signature`, href: '/documents', urgency: 'high' })
  }

  // New leads today
  if (newToday > 0) {
    priorities.push({ id: 'new-today', type: 'new_lead', label: `${newToday} new lead${newToday > 1 ? 's' : ''} added today`, href: '/leads', urgency: 'low' })
  }

  // Sort priorities by urgency
  const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  priorities.sort((a, b) => (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2))

  // ── Recent activity ───────────────────────────────────────────────────────
  const recentActivity = [
    ...commsRows.map((c: Record<string, unknown>) => ({
      id:         String(c.id),
      type:       'communication',
      label:      c.subject ? `Email: ${c.subject}` : `${c.direction === 'inbound' ? 'Received' : 'Sent'} communication`,
      href:       '/inbox',
      created_at: String(c.created_at),
    })),
    ...dealRows.slice(0, 5).map((d: Record<string, unknown>) => ({
      id:         String(d.id),
      type:       'deal',
      label:      `Deal: ${d.address}`,
      href:       `/deals/${d.id}`,
      created_at: String(d.created_at),
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)

  // ── User name ─────────────────────────────────────────────────────────────
  const userName = String((profile as Record<string, unknown>).my_name ?? (profile as Record<string, unknown>).display_name ?? user.email?.split('@')[0] ?? 'Charles')

  // ── Assemble response ─────────────────────────────────────────────────────
  return NextResponse.json({
    user_name: userName,
    morning_briefing: {
      follow_ups_due:               followUps.length,
      overdue_follow_ups:           overdueFollowUps.length,
      new_leads_week:               newWeek,
      offers_awaiting:              awaitingOfferResp,
      contracts_awaiting_signature: awaitingSignature,
      pipeline_value:               pipelineValue,
    },
    kpis: {
      total_leads:      totalLeads,
      total_contacts:   totalContacts,
      active_deals:     activeDealRows.length,
      pipeline_value:   pipelineValue,
      new_leads_today:  newToday,
      new_leads_week:   newWeek,
      follow_ups_due:   followUps.length,
      contracts_sent:   contractsSent,
      under_contract:   underContract,
      closed_month:     closedMonth,
    },
    priorities: priorities.slice(0, 8),
    follow_ups: followUps.slice(0, 10),
    pipeline_funnel: {
      total:          totalLeads,
      reviewing:      leadByStatus.reviewing ?? 0,
      contacted:      leadByStatus.contacted ?? 0,
      offer:          leadByStatus.offer ?? 0,
      under_contract: underContract,
      closed:         closedMonth,
    },
    opportunity_leads: opportunityLeads,
    active_deals: activeDealRows.slice(0, 8).map((d: Record<string, unknown>) => ({
      id:              String(d.id),
      address:         String(d.address ?? ''),
      status:          String(d.status ?? ''),
      offer_price:     Number(d.offer_price) || null,
      desired_profit:  Number(d.desired_profit) || null,
      created_at:      String(d.created_at),
    })),
    offers_contracts: {
      draft:          docByStatus.draft        ?? 0,
      generated:      docByStatus.generated    ?? 0,
      signed_by_me:   docByStatus.signed_by_me ?? 0,
      sent:           docByStatus.sent         ?? 0,
      fully_signed:   docByStatus.fully_signed ?? 0,
      expired:        docByStatus.expired      ?? 0,
    },
    recent_activity: recentActivity,
    monthly_kpis: {
      leads_added:      monthlyLeads,
      contacts_created: monthlyContacts,
      offers_sent:      (docByStatus.sent ?? 0) + (docByStatus.signed_by_me ?? 0),
      contracts_signed: docByStatus.fully_signed ?? 0,
      deals_closed:     closedMonth,
      deals_active:     activeDealRows.length,
    },
    goals,
    lead_type_breakdown,
    dashboard_config: (profile as Record<string, unknown>).dashboard_config ?? null,
  })
}
