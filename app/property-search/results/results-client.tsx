'use client'

/**
 * Property Search — Step 2: Results
 *
 * This page shows everything that matched the criteria built on Step 1.
 * The table dominates the screen. Clicking a row navigates directly to the
 * canonical /properties/[id] workspace — no intermediate drawer.
 */

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { PropertySearchResult } from '@/lib/enrichment/types'

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = Record<string, any>

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTY_COLORS: Record<string, string> = {
  'miami-dade': '#7B8FD4',
  broward:      '#4CAF9A',
  'palm-beach': '#C9A84C',
}
const EQUITY_COLORS: Record<string, string> = {
  High: '#4CAF9A', Medium: '#C9A84C', Low: '#7B8FD4', None: '#9ca3af',
}
const STAGE_COLORS: Record<string, string> = {
  reviewing: '#C9A84C', contacted: '#6ABDE0', offer: '#4CAF9A', dead: '#9ca3af',
}

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'Broward OR Index':    { bg: 'rgba(76,175,154,0.15)',   text: '#4CAF9A',  label: 'Broward OR' },
  'MD OR Index':         { bg: 'rgba(123,143,212,0.15)',  text: '#7B8FD4',  label: 'MD OR' },
  'PBC OR Index':        { bg: 'rgba(201,168,76,0.15)',   text: '#C9A84C',  label: 'PBC OR' },
  'or-ingestion':        { bg: 'rgba(76,175,154,0.15)',   text: '#4CAF9A',  label: 'OR Feed' },
  REIFax:                { bg: 'rgba(239,68,68,0.12)',    text: '#ef4444',  label: 'REIFax' },
  PropStream:            { bg: 'rgba(96,165,250,0.15)',   text: '#60a5fa',  label: 'PropStream' },
  'Palm Beach Bulk':     { bg: 'rgba(201,168,76,0.15)',   text: '#C9A84C',  label: 'PBC Bulk' },
  'CSV Import':          { bg: 'rgba(156,163,175,0.15)',  text: '#9ca3af',  label: 'CSV' },
}

function getSourceStyle(source: string) {
  return SOURCE_COLORS[source] ?? { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', label: source?.slice(0, 12) || '—' }
}

const PA_URLS: Record<string, (folio: string, address: string) => string> = {
  'miami-dade': (folio) => `https://www.miamidade.gov/Apps/PA/propertysearch/#/?folio=${encodeURIComponent(folio)}`,
  broward:      (folio) => `https://www.bcpa.net/RecInfo.asp?URL_Folio=${encodeURIComponent(folio)}`,
  'palm-beach': (folio) => `https://www.pbcpao.gov/property-details/${encodeURIComponent(folio)}`,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

function daysSince(d: string | null | undefined) {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function distressAgeColor(days: number | null) {
  if (days === null) return '#9ca3af'
  if (days <= 30)   return '#4CAF9A'
  if (days <= 90)   return '#C9A84C'
  if (days <= 180)  return '#E07B6A'
  return '#ef4444'
}

function getLeadTypeTags(lead: Lead): { label: string; color: string }[] {
  const tags: { label: string; color: string }[] = []
  if (lead.is_pre_foreclosure) tags.push({ label: 'Pre-FC',     color: '#f59e0b' })
  if (lead.is_probate)         tags.push({ label: 'Probate',    color: '#a78bfa' })
  if (lead.is_tax_deed)        tags.push({ label: 'Tax Deed',   color: '#f97316' })
  if (lead.is_auction)         tags.push({ label: 'Auction',    color: '#ef4444' })
  if (lead.multiple_liens)     tags.push({ label: 'Multi-Lien', color: '#E07B6A' })
  if (lead.free_clear)         tags.push({ label: 'Free&Clear', color: '#4CAF9A' })
  if (lead.vacant)             tags.push({ label: 'Vacant',     color: '#6ABDE0' })
  return tags.slice(0, 3)
}

// ─── Criteria chips from URL params ──────────────────────────────────────────

function buildChips(params: URLSearchParams): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = []
  const add = (key: string, label: string) => chips.push({ key, label })

  if (params.get('search'))      add('search',    `"${params.get('search')}"`)
  if (params.get('county'))      add('county',    params.get('county')!)
  if (params.get('city'))        add('city',      params.get('city')!)
  if (params.get('zip'))         add('zip',       `ZIP ${params.get('zip')}`)
  if (params.get('lead_types'))  add('lead_types', params.get('lead_types')!.split(',').join(', '))
  if (params.get('equity'))      add('equity',    `Equity: ${params.get('equity')}`)
  if (params.get('value_min') || params.get('value_max')) {
    const min = params.get('value_min') ? fmt$(Number(params.get('value_min'))) : ''
    const max = params.get('value_max') ? fmt$(Number(params.get('value_max'))) : ''
    add('value', `Value: ${min}${min && max ? '–' : ''}${max}`)
  }
  if (params.get('pool') === 'true')         add('pool',        'Has Pool')
  if (params.get('homestead') === 'true')    add('homestead',   'Homestead')
  if (params.get('out_of_state') === 'true') add('out_of_state','Out-of-State Owner')
  if (params.get('free_clear') === 'true')   add('free_clear',  'Free & Clear')
  if (params.get('has_phone') === 'true')    add('has_phone',   'Has Phone')
  if (params.get('zone'))                    add('zone',        'Zone Filter Active')
  return chips
}

// ─── Safe JSON parse (returns null if body is empty or not JSON) ──────────────

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return null
  try { return await res.json() } catch { return null }
}

// ─── SessionStorage cache (back-nav safe, 5-min TTL) ─────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000

interface CachePayload {
  properties: Lead[]
  total: number
  page: number
  pages: number
  db_fallback?: string | null
}

function srCacheKey(params: URLSearchParams): string {
  return `psr:${params.toString()}`
}

function srCacheRead(key: string): CachePayload | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: CachePayload; ts: number }
    if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null }
    return data
  } catch { return null }
}

function srCacheWrite(key: string, data: CachePayload): void {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch { /* storage full */ }
}

// ─── Single-address result normalizer ────────────────────────────────────────

function normalizeSearchResult(r: PropertySearchResult): Lead {
  return {
    id:                r.folio ?? `single-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    folio_number:      r.folio ?? '',
    property_address:  r.property_address ?? '',
    city:              r.city ?? '',
    zip:               r.zip ?? '',
    county:            r.county ?? '',
    owner_name:        r.owner_name ?? '',
    mailing_address:   r.mailing_address ?? '',
    market_value:      r.market_value ?? null,
    assessed_value:    r.assessed_value ?? null,
    land_value:        r.land_value ?? null,
    beds:              r.beds ?? null,
    baths:             r.baths ?? null,
    living_area:       r.living_area ?? null,
    year_built:        r.year_built ?? null,
    equity_tier:       null,
    equity_percentage: null,
    is_pre_foreclosure: Boolean(r.distress),
    is_probate:        false,
    is_tax_deed:       false,
    is_auction:        false,
    multiple_liens:    false,
    free_clear:        false,
    vacant:            false,
    absentee_owner:    r.absentee_owner ?? false,
    data_source:       r.source_display ?? r.source ?? 'REAPI',
    pa_url:            r.pa_url ?? null,
    phone_1:           null,
    pipeline_stage:    null,
    lead_score:        null,
    case_number:       r.distress?.case_number ?? null,
    file_date:         r.distress?.file_date ?? null,
    last_sale_date:    r.last_sale_date ?? null,
    last_sale_amount:  r.last_sale_amount ?? null,
    subdivision:       r.subdivision ?? null,
    property_use:      r.property_use ?? null,
    annual_taxes:      r.annual_taxes ?? null,
    is_lead:           false,
    lead_id:           null,
  }
}

// ─── UUID check (determines if a result is already in the DB) ────────────────

function isDbUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

// ─── Row component ────────────────────────────────────────────────────────────

function ResultRow({
  lead, selected, onSelect, onClick, onAddToLeads,
}: {
  lead: Lead
  selected: boolean
  onSelect: (id: string, v: boolean) => void
  onClick:  (id: string) => void
  onAddToLeads: (id: string) => void
}) {
  const days    = daysSince(lead.file_date)
  const ageClr  = distressAgeColor(days)
  const county  = lead.county as string
  const cClr    = COUNTY_COLORS[county] ?? '#9ca3af'
  const eClr    = EQUITY_COLORS[lead.equity_tier as string] ?? '#9ca3af'
  const sClr    = STAGE_COLORS[lead.pipeline_stage as string] ?? '#9ca3af'
  const ltTags  = getLeadTypeTags(lead)
  const src     = getSourceStyle(lead.data_source || lead.source || '')
  const folio   = lead.folio_number || ''
  const paUrl   = folio && county ? PA_URLS[county]?.(folio, lead.property_address || '') : null
  const ownerName = (lead.owner_name || lead.mortgagor || '') as string

  return (
    <tr
      onClick={() => onClick(lead.id)}
      className="cursor-pointer transition-colors hover:bg-yellow-50/30"
      style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: selected ? 'rgba(201,168,76,0.06)' : undefined }}
    >
      {/* Checkbox */}
      <td className="pl-4 pr-2 py-3 w-8" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected}
          onChange={e => onSelect(lead.id, e.target.checked)}
          className="rounded" style={{ accentColor: '#C9A84C' }} />
      </td>

      {/* Address + source badge + PA link */}
      <td className="py-3 pr-4 min-w-[200px]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cClr }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>
                {lead.property_address || '—'}
              </p>
              {paUrl && (
                <a href={paUrl} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}
                  title="Open in County PA">
                  PA ↗
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[10px] truncate" style={{ color: 'var(--c-text-3)' }}>
                {lead.city}{lead.zip ? ` ${lead.zip}` : ''}
              </p>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: src.bg, color: src.text }}>
                {src.label}
              </span>
            </div>
          </div>
        </div>
      </td>

      {/* Owner */}
      <td className="py-3 pr-4 min-w-[130px]">
        <p className="text-xs truncate max-w-[140px]" style={{ color: 'var(--c-primary)' }}>
          {ownerName || '—'}
        </p>
        {/\b(LLC|CORP|INC|LTD|TRUST|ESTATE)\b/i.test(ownerName) && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
            ENTITY
          </span>
        )}
      </td>

      {/* County */}
      <td className="py-3 pr-4">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: `${cClr}20`, color: cClr }}>
          {county === 'miami-dade' ? 'MD' : county === 'broward' ? 'BRW' : county === 'palm-beach' ? 'PBC' : county}
        </span>
      </td>

      {/* Lead type tags */}
      <td className="py-3 pr-4">
        <div className="flex flex-wrap gap-1">
          {ltTags.length > 0 ? ltTags.map(t => (
            <span key={t.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={{ backgroundColor: `${t.color}20`, color: t.color }}>
              {t.label}
            </span>
          )) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
        </div>
      </td>

      {/* Equity */}
      <td className="py-3 pr-4 text-right">
        {lead.equity_tier ? (
          <div>
            <p className="text-xs font-bold" style={{ color: eClr }}>{lead.equity_tier}</p>
            {lead.equity_percentage != null && (
              <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                {Number(lead.equity_percentage).toFixed(0)}%
              </p>
            )}
          </div>
        ) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>

      {/* Est. Value */}
      <td className="py-3 pr-4 text-right">
        <p className="text-xs font-semibold" style={{ color: 'var(--c-primary)' }}>
          {fmt$(lead.market_value || lead.assessed_value)}
        </p>
        {(lead.foreclosure_amount || lead.lien_amount) && (
          <p className="text-[10px]" style={{ color: '#ef4444' }}>
            {fmt$(lead.foreclosure_amount || lead.lien_amount)} lien
          </p>
        )}
      </td>

      {/* Beds/Baths/Sqft */}
      <td className="py-3 pr-4">
        <p className="text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>
          {[lead.beds && `${lead.beds}bd`, lead.baths && `${lead.baths}ba`, lead.living_area && `${Number(lead.living_area).toLocaleString()}sf`].filter(Boolean).join(' · ') || '—'}
        </p>
        {lead.year_built && (
          <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{lead.year_built}</p>
        )}
      </td>

      {/* Age */}
      <td className="py-3 pr-4 text-center">
        {days !== null ? (
          <div>
            <p className="text-xs font-bold" style={{ color: ageClr }}>{days}d</p>
            <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>
              {lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            </p>
          </div>
        ) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>

      {/* Phone */}
      <td className="py-3 pr-4 text-center">
        {lead.phone_1
          ? <span className="flex items-center justify-center" style={{ color: '#4CAF9A' }}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>
              </svg>
            </span>
          : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>

      {/* Stage */}
      <td className="py-3 pr-4">
        {lead.pipeline_stage ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: `${sClr}20`, color: sClr }}>
            {lead.pipeline_stage}
          </span>
        ) : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>

      {/* Score */}
      <td className="py-3 pr-4 text-right">
        {lead.lead_score != null ? (
          <span className="text-xs font-bold"
            style={{ color: lead.lead_score >= 70 ? '#4CAF9A' : lead.lead_score >= 40 ? '#C9A84C' : '#9ca3af' }}>
            {lead.lead_score}
          </span>
        ) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>

      {/* Add to Contacts */}
      <td className="py-3 pr-4" onClick={e => e.stopPropagation()}>
        {lead.lead_id ? (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A' }}>
            In Contacts
          </span>
        ) : (
          <button onClick={() => onAddToLeads(lead.id)}
            className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap hover:opacity-80"
            style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
            + Contact
          </button>
        )}
      </td>
    </tr>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SearchResultsClient() {
  const router     = useRouter()
  const rawParams  = useSearchParams()
  const isSingleMode = rawParams.get('mode') === 'single'

  const [leads, setLeads]     = useState<Lead[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pages, setPages]     = useState(1)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [sortBy, setSortBy]       = useState<'file_date' | 'equity_percentage' | 'market_value'>('file_date')
  const [sortDir, setSortDir]     = useState<'desc' | 'asc'>('desc')
  const [cached, setCached]       = useState<boolean | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [dbFallback, setDbFallback] = useState<string | null>(null)
  const [navigating, setNavigating] = useState<string | null>(null)

  // ── Fetch — single-address lookup or live bulk search, with sessionStorage cache ──

  const fetchResults = useCallback(async (p = 1) => {
    setLoading(true)
    setError(null)
    setDbFallback(null)
    const params = new URLSearchParams(rawParams.toString())
    params.set('page',     String(p))
    params.set('limit',    '50')
    params.set('sort_by',  sortBy)
    params.set('sort_dir', sortDir)

    const key = srCacheKey(params)
    const hit = srCacheRead(key)
    if (hit) {
      setLeads(hit.properties)
      setTotal(hit.total)
      setPage(hit.page)
      setPages(hit.pages)
      if (hit.db_fallback) setDbFallback(hit.db_fallback)
      setCached(true)
      setLoading(false)
      return
    }

    try {
      if (isSingleMode) {
        const q   = rawParams.get('q') ?? ''
        const res = await fetch(`/api/property-search?q=${encodeURIComponent(q)}`)
        const data = await safeJson(res)
        if (!res.ok || !data?.success) {
          const msg = (data?.error as { message?: string } | null)?.message ?? 'Property not found'
          setError(msg); setLeads([]); setTotal(0); return
        }
        const raw: PropertySearchResult | undefined = (data.results as PropertySearchResult[])?.[0]
        if (!raw || !raw.property_address) { setLeads([]); setTotal(0); setPages(1); return }
        const normalized = normalizeSearchResult(raw)
        const payload: CachePayload = { properties: [normalized], total: 1, page: 1, pages: 1 }
        setLeads(payload.properties)
        setTotal(payload.total)
        setPage(1)
        setPages(1)
        setCached(false)
        srCacheWrite(key, payload)
      } else {
        const res  = await fetch(`/api/property-search/live?${params}`)
        const data = await safeJson(res)
        if (!res.ok || !data?.success) {
          const msg = (data?.error as { message?: string } | null)?.message ?? 'Search failed'
          setError(msg); setLeads([]); setTotal(0); return
        }
        const pagination = data.pagination as { page: number; pageSize: number; totalPages: number } | null
        const payload: CachePayload = {
          properties: (data.results as Lead[]) || [],
          total:      (data.count as number)   || 0,
          page:       pagination?.page          ?? 1,
          pages:      pagination?.totalPages    ?? 1,
        }
        setLeads(payload.properties)
        setTotal(payload.total)
        setPage(payload.page)
        setPages(payload.pages)
        setCached((data.cached as boolean) ?? false)
        srCacheWrite(key, payload)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setLoading(false) }
  }, [rawParams, sortBy, sortDir, isSingleMode])

  useEffect(() => { fetchResults(1) }, [sortBy, sortDir]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation ────────────────────────────────────────────────────────────

  const navigateToProperty = useCallback(async (lead: Lead) => {
    if (navigating) return
    setNavigating(lead.id)
    try {
      if (isDbUUID(lead.id)) {
        router.push(`/properties/${lead.id}`)
        return
      }
      // Live/folio result — upsert to DB to get a canonical property_id
      const res = await fetch('/api/properties/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property: lead }),
      })
      if (res.ok) {
        const { property_id } = await res.json()
        router.push(`/properties/${property_id}`)
      } else {
        // Fallback: navigate with folio as ID (server will handle lookup)
        router.push(`/properties/${lead.folio_number || lead.id}`)
      }
    } catch {
      setNavigating(null)
    }
  }, [navigating, router])

  // ── Actions ──────────────────────────────────────────────────────────────

  const toggleSelect  = (id: string, v: boolean) => setSelected(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s })
  const selectAll     = () => setSelected(new Set(leads.map(l => l.id)))
  const clearSelect   = () => setSelected(new Set())
  const allSelected   = leads.length > 0 && selected.size === leads.length

  /** Save a live search result permanently and add to contacts */
  const addToLeads = async (id: string) => {
    const prop = leads.find(l => l.id === id)
    if (!prop) return
    const res = await fetch('/api/properties/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property: prop }),
    })
    if (res.ok) {
      const { lead_id, property_id } = await res.json()
      setLeads(prev => prev.map(l => l.id === id
        ? { ...l, lead_id, id: property_id, is_lead: true }
        : l
      ))
    }
  }

  const bulkAddToLeads = async () => {
    const toSave = leads.filter(l => selected.has(l.id))
    await Promise.all(toSave.map(prop =>
      fetch('/api/properties/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property: prop }),
      })
    ))
    clearSelect()
    fetchResults(page)
  }

  const exportCSV = () => {
    const rows = selected.size > 0 ? leads.filter(l => selected.has(l.id)) : leads
    const cols = ['property_address','city','zip','county','owner_name','phone_1','market_value','equity_tier','equity_percentage','beds','baths','living_area','year_built','file_date','data_source','pipeline_stage','lead_score']
    const csv  = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a    = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `search-results-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--c-primary)' }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 flex flex-col gap-3"
        style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>

        {/* Top row */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/property-search')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ← Modify Search
            </button>

            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--c-primary)' }}>Search Results</h1>
              <p className="text-xs flex items-center gap-2" style={{ color: 'var(--c-text-3)' }}>
                {loading
                  ? (isSingleMode ? 'Looking up property…' : dbFallback ? 'Searching saved properties…' : 'Querying live market…')
                  : `${total.toLocaleString()} propert${total === 1 ? 'y' : 'ies'}`}
                {!loading && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: dbFallback
                        ? 'rgba(201,168,76,0.15)'
                        : cached ? 'rgba(76,175,154,0.15)' : 'rgba(201,168,76,0.15)',
                      color: dbFallback ? '#C9A84C' : cached ? '#4CAF9A' : '#C9A84C',
                    }}>
                    {dbFallback ? '📦 saved' : cached ? '⚡ cached' : '🔴 live'}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export {selected.size > 0 ? `(${selected.size})` : 'All'}
            </button>
          </div>
        </div>

      </div>

      {/* ── DB Fallback warning banner ─────────────────────────────────────── */}
      {dbFallback && !loading && (
        <div className="px-5 py-2.5 flex items-start gap-3"
          style={{ backgroundColor: 'rgba(201,168,76,0.08)', borderBottom: '1px solid rgba(201,168,76,0.25)' }}>
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold" style={{ color: '#C9A84C' }}>Live Search Unavailable</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{dbFallback}</p>
          </div>
          <a href="https://console.realestateapi.com/dashboard/billing" target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 hover:opacity-80"
            style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
            Add Funds
          </a>
        </div>
      )}

      {/* ── Single-address mode banner ────────────────────────────────────── */}
      {isSingleMode && !loading && (
        <div className="px-5 py-2.5 flex items-center gap-3"
          style={{ backgroundColor: 'rgba(106,189,224,0.08)', borderBottom: '1px solid rgba(106,189,224,0.2)' }}>
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#6ABDE0' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold" style={{ color: '#6ABDE0' }}>Single Property Lookup</p>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--c-text-3)' }}>{rawParams.get('q') ?? ''}</p>
          </div>
          <button onClick={() => router.push('/property-search')}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg shrink-0 hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            New Search
          </button>
        </div>
      )}

      {/* ── Navigating overlay ────────────────────────────────────────────── */}
      {navigating && (
        <div className="px-5 py-2 flex items-center gap-2"
          style={{ backgroundColor: 'rgba(201,168,76,0.08)', borderBottom: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin shrink-0"
            style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
          <p className="text-[11px] font-semibold" style={{ color: '#C9A84C' }}>Opening property workspace…</p>
        </div>
      )}

      {/* ── Table toolbar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 px-5 py-2 flex items-center gap-3 flex-wrap"
        style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>

        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <input type="checkbox" checked={allSelected}
            onChange={e => e.target.checked ? selectAll() : clearSelect()}
            style={{ accentColor: '#C9A84C' }} />
          <span className="text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>
            {selected.size > 0 ? `${selected.size} selected` : 'Select All'}
          </span>
        </label>

        {selected.size > 0 && (
          <>
            <button onClick={bulkAddToLeads}
              className="text-[11px] font-bold px-3 py-1 rounded-xl hover:opacity-80"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              + Add {selected.size} to Contacts
            </button>
            <button onClick={exportCSV}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ↓ Export {selected.size}
            </button>
            <button onClick={clearSelect}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ✕ Clear
            </button>
          </>
        )}

        <span className="text-[11px] font-semibold ml-auto" style={{ color: 'var(--c-text-3)' }}>
          {loading ? 'Loading…' : `${total.toLocaleString()} properties`}
        </span>

        {/* Sort */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Sort:</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="text-[11px] font-semibold rounded-lg px-2 py-1 focus:outline-none"
            style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
            <option value="file_date">Filed Date</option>
            <option value="equity_percentage">Equity %</option>
            <option value="market_value">Value</option>
          </select>
          <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
            {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>
                {isSingleMode ? 'Looking up property…' : 'Searching live market…'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                {isSingleMode ? 'Querying property records' : 'Querying RealEstateAPI'}
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center max-w-md px-6">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)' }}>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#ef4444' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                </svg>
              </div>
              <p className="text-sm font-bold mb-2" style={{ color: 'var(--c-primary)' }}>Search Error</p>
              <p className="text-xs font-mono p-3 rounded-xl mb-4"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </p>
              <button onClick={() => fetchResults(1)}
                className="text-sm font-bold px-4 py-2 rounded-xl hover:opacity-80 mr-2"
                style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
                Retry
              </button>
              <button onClick={() => router.push('/property-search')}
                className="text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                Modify Search
              </button>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'var(--c-hover)' }}>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
                </svg>
              </div>
              <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>
                {isSingleMode ? 'Property not found' : 'No properties match your criteria'}
              </p>
              <p className="text-xs mt-1 mb-5" style={{ color: 'var(--c-text-3)' }}>
                {isSingleMode
                  ? 'No record found for that address. Try a different address or check the spelling.'
                  : 'Try broadening your search or removing some filters'}
              </p>
              <button onClick={() => router.push('/property-search')}
                className="text-sm font-bold px-4 py-2 rounded-xl hover:opacity-80"
                style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                ← Back to Search
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: '1100px' }}>
              <thead className="sticky top-0 z-[5]"
                style={{ backgroundColor: 'var(--c-card-alt)', borderBottom: '2px solid var(--c-border)' }}>
                <tr>
                  {['', 'Address', 'Owner', 'County', 'Lead Type', 'Equity', 'Est. Value', 'Bed/Bath/Sqft', 'Age', 'Phone', 'Stage', 'Score', 'Action'].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                      style={{ color: 'var(--c-text-3)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <ResultRow
                    key={lead.id}
                    lead={lead}
                    selected={selected.has(lead.id)}
                    onSelect={toggleSelect}
                    onClick={id => { const l = leads.find(l => l.id === id); if (l) navigateToProperty(l) }}
                    onAddToLeads={addToLeads}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 py-6">
            <button disabled={page <= 1} onClick={() => fetchResults(page - 1)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-30 hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ← Prev
            </button>
            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
              Page {page} of {pages}
            </span>
            <button disabled={page >= pages} onClick={() => fetchResults(page + 1)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-30 hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
