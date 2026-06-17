import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') // YYYY-MM-DD
  const to   = searchParams.get('to')   // YYYY-MM-DD

  const fromISO = from ? new Date(from).toISOString() : new Date(Date.now() - 30 * 864e5).toISOString()
  const toISO   = to   ? new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString() : new Date().toISOString()

  const svc = serviceClient

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [
    allContactsRes,
    rangeContactsRes,
    allDealsRes,
    leadTypesRes,
    verticalsRes,
    pipelinesRes,
    pipelineStagesRes,
  ] = await Promise.all([
    // All contacts with classification fields
    svc.from('contacts').select('id, lead_type_id, vertical_id, lead_source, source, created_at'),

    // Contacts created in range
    svc.from('contacts')
      .select('id, lead_type_id, vertical_id, lead_source, source, created_at')
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // All non-dead deals
    svc.from('deals')
      .select('id, status, offer_price, desired_profit, pipeline_id, pipeline_stage_id, created_at')
      .neq('status', 'Dead'),

    // Lead type lookup
    svc.from('lead_types').select('id, name, color').eq('is_active', true).order('position'),

    // Vertical lookup
    svc.from('business_verticals').select('id, name, color').eq('is_active', true).order('position'),

    // Pipeline lookup
    svc.from('pipelines').select('id, name, color').eq('is_active', true).order('position'),

    // Pipeline stage lookup
    svc.from('pipeline_stages').select('id, name, pipeline_id').order('position'),
  ])

  const allContacts  = allContactsRes.data  ?? []
  const rangeContacts = rangeContactsRes.data ?? []
  const allDeals     = allDealsRes.data     ?? []
  const leadTypes    = leadTypesRes.data    ?? []
  const verticals    = verticalsRes.data    ?? []
  const pipelines    = pipelinesRes.data    ?? []
  const pipelineStages = pipelineStagesRes.data ?? []

  // ── Contacts in date range for sub-breakdowns ─────────────────────────────
  const rangeDeals = allDeals.filter(d => {
    const t = new Date(d.created_at as string).getTime()
    return t >= new Date(fromISO).getTime() && t <= new Date(toISO).getTime()
  })

  // ── Summary ───────────────────────────────────────────────────────────────
  const activeDeals    = allDeals.filter(d => d.status !== 'Closed')
  const pipelineValue  = activeDeals.reduce((s, d) => s + (Number(d.offer_price) || 0), 0)
  const closedDeals    = allDeals.filter(d => d.status === 'Closed')
  const closedValue    = closedDeals.reduce((s, d) => s + (Number(d.offer_price) || 0), 0)

  const summary = {
    total_contacts:  allContacts.length,
    new_contacts:    rangeContacts.length,
    total_deals:     allDeals.length,
    active_deals:    activeDeals.length,
    pipeline_value:  pipelineValue,
    closed_deals:    closedDeals.length,
    closed_value:    closedValue,
  }

  // ── By lead type (all time) ───────────────────────────────────────────────
  const ltCounts: Record<string, number> = {}
  const ltCountsRange: Record<string, number> = {}
  for (const c of allContacts) {
    if (c.lead_type_id) {
      const id = String(c.lead_type_id)
      ltCounts[id] = (ltCounts[id] ?? 0) + 1
    }
  }
  for (const c of rangeContacts) {
    if (c.lead_type_id) {
      const id = String(c.lead_type_id)
      ltCountsRange[id] = (ltCountsRange[id] ?? 0) + 1
    }
  }
  const by_lead_type = leadTypes.map(lt => ({
    id:          lt.id,
    name:        lt.name,
    color:       lt.color,
    count:       ltCounts[lt.id] ?? 0,
    count_range: ltCountsRange[lt.id] ?? 0,
  })).filter(lt => lt.count > 0).sort((a, b) => b.count - a.count)

  // ── By vertical ───────────────────────────────────────────────────────────
  const vtCounts: Record<string, number> = {}
  const vtCountsRange: Record<string, number> = {}
  for (const c of allContacts) {
    if (c.vertical_id) {
      const id = String(c.vertical_id)
      vtCounts[id] = (vtCounts[id] ?? 0) + 1
    }
  }
  for (const c of rangeContacts) {
    if (c.vertical_id) {
      const id = String(c.vertical_id)
      vtCountsRange[id] = (vtCountsRange[id] ?? 0) + 1
    }
  }
  const by_vertical = verticals.map(v => ({
    id:          v.id,
    name:        v.name,
    color:       v.color,
    count:       vtCounts[v.id] ?? 0,
    count_range: vtCountsRange[v.id] ?? 0,
  })).filter(v => v.count > 0).sort((a, b) => b.count - a.count)

  // ── By source ─────────────────────────────────────────────────────────────
  const srcCounts: Record<string, number> = {}
  const srcCountsRange: Record<string, number> = {}
  for (const c of allContacts) {
    const src = String(c.lead_source || c.source || 'Unknown').trim() || 'Unknown'
    srcCounts[src] = (srcCounts[src] ?? 0) + 1
  }
  for (const c of rangeContacts) {
    const src = String(c.lead_source || c.source || 'Unknown').trim() || 'Unknown'
    srcCountsRange[src] = (srcCountsRange[src] ?? 0) + 1
  }
  const by_source = Object.entries(srcCounts)
    .map(([source, count]) => ({ source, count, count_range: srcCountsRange[source] ?? 0 }))
    .sort((a, b) => b.count - a.count)

  // ── By pipeline ───────────────────────────────────────────────────────────
  const plCounts: Record<string, number>  = {}
  const plValues: Record<string, number>  = {}
  const plStageCounts: Record<string, Record<string, number>> = {}
  const unassignedByStatus: Record<string, number> = {}
  for (const d of allDeals) {
    if (d.pipeline_id) {
      const pid = String(d.pipeline_id)
      plCounts[pid] = (plCounts[pid] ?? 0) + 1
      plValues[pid] = (plValues[pid] ?? 0) + (Number(d.offer_price) || 0)
      if (d.pipeline_stage_id) {
        plStageCounts[pid] = plStageCounts[pid] ?? {}
        const sid = String(d.pipeline_stage_id)
        plStageCounts[pid][sid] = (plStageCounts[pid][sid] ?? 0) + 1
      }
    } else {
      const s = String(d.status ?? 'Lead')
      unassignedByStatus[s] = (unassignedByStatus[s] ?? 0) + 1
    }
  }

  const by_pipeline = pipelines.map(p => {
    const stages = pipelineStages
      .filter(s => s.pipeline_id === p.id)
      .map(s => ({
        id:    s.id,
        name:  s.name,
        count: plStageCounts[p.id]?.[s.id] ?? 0,
      }))
    return {
      id:     p.id,
      name:   p.name,
      color:  p.color,
      count:  plCounts[p.id] ?? 0,
      value:  plValues[p.id] ?? 0,
      stages,
    }
  }).filter(p => p.count > 0).sort((a, b) => b.count - a.count)

  const unassigned_deals = {
    count:      Object.values(unassignedByStatus).reduce((s, n) => s + n, 0),
    by_status:  unassignedByStatus,
  }

  // ── Monthly trend (last 12 months) ────────────────────────────────────────
  const months: Array<{ month: string; contacts: number; deals: number }> = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
    const start = d.toISOString()

    const cCount = allContacts.filter(c => {
      const t = c.created_at as string
      return t >= start && t < next
    }).length

    const dCount = allDeals.filter(d2 => {
      const t = d2.created_at as string
      return t >= start && t < next
    }).length

    months.push({ month: key, contacts: cCount, deals: dCount })
  }

  return NextResponse.json({
    summary,
    by_lead_type,
    by_vertical,
    by_source,
    by_pipeline,
    unassigned_deals,
    monthly_trend: months,
    date_range: { from: fromISO, to: toISO },
  })
}
