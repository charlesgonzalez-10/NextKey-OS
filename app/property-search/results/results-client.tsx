'use client'

/**
 * Property Search — Step 2: Results
 *
 * This page shows everything that matched the criteria built on Step 1.
 * The table dominates the screen. Criteria chips at the top remind the investor
 * what they searched for and allow quick modifications.
 */

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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
  if (params.get('zone'))                    add('zone',        '📍 Zone Filter Active')
  return chips
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
          ? <span className="text-[10px] font-bold" style={{ color: '#4CAF9A' }}>📞</span>
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

      {/* Add to Leads */}
      <td className="py-3 pr-4" onClick={e => e.stopPropagation()}>
        {lead.lead_id ? (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A' }}>
            In Leads
          </span>
        ) : (
          <button onClick={() => onAddToLeads(lead.id)}
            className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap hover:opacity-80"
            style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
            + Lead
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

  const [leads, setLeads]     = useState<Lead[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pages, setPages]     = useState(1)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy]     = useState<'file_date' | 'equity_percentage' | 'market_value' | 'lead_score'>('file_date')
  const [sortDir, setSortDir]   = useState<'desc' | 'asc'>('desc')

  // Build chips from URL params
  const chips = buildChips(rawParams)

  // ── Fetch ───────────────────────────────────────────────────────────────

  const fetchResults = useCallback(async (p = 1) => {
    setLoading(true)
    const params = new URLSearchParams(rawParams.toString())
    params.set('page',     String(p))
    params.set('limit',    '200')
    params.set('sort_by',  sortBy)
    params.set('sort_dir', sortDir)
    params.delete('zone')  // zone is client-side only for now

    try {
      const res  = await fetch(`/api/properties?${params}`)
      const data = await res.json()
      setLeads(data.properties || data.leads || [])
      setTotal(data.total || 0)
      setPage(data.page  || 1)
      setPages(data.pages || 1)
    } catch { /* noop */ }
    finally { setLoading(false) }
  }, [rawParams, sortBy, sortDir])

  useEffect(() => { fetchResults(1) }, [sortBy, sortDir]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchResults(1) }, [])                // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────

  const toggleSelect  = (id: string, v: boolean) => setSelected(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s })
  const selectAll     = () => setSelected(new Set(leads.map(l => l.id)))
  const clearSelect   = () => setSelected(new Set())
  const allSelected   = leads.length > 0 && selected.size === leads.length

  const addToLeads = async (id: string) => {
    const res = await fetch('/api/properties/' + id + '/add-lead', { method: 'POST' })
    if (res.ok) {
      const { lead_id } = await res.json()
      setLeads(prev => prev.map(l => l.id === id ? { ...l, lead_id } : l))
    }
  }

  const bulkAddToLeads = async () => {
    const ids = Array.from(selected)
    await Promise.all(ids.map(id => fetch('/api/properties/' + id + '/add-lead', { method: 'POST' })))
    fetchResults(page)
    clearSelect()
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
            {/* Back button */}
            <button onClick={() => router.push('/property-search')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ← Modify Search
            </button>

            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--c-primary)' }}>Search Results</h1>
              <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                {loading ? 'Searching…' : `${total.toLocaleString()} matching propert${total === 1 ? 'y' : 'ies'}`}
              </p>
            </div>
          </div>

          {/* Actions */}
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

        {/* Applied criteria chips */}
        {chips.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--c-text-3)' }}>
              Filters:
            </span>
            {chips.map(chip => (
              <span key={chip.key}
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}>
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>

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
              + Add {selected.size} to Leads
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
            <option value="lead_score">AI Score</option>
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
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Searching database…</p>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <p className="text-5xl mb-4">🔍</p>
              <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>No properties match your criteria</p>
              <p className="text-xs mt-1 mb-5" style={{ color: 'var(--c-text-3)' }}>Try broadening your search or removing some filters</p>
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
                    onClick={id => router.push(`/leads/${id}`)}
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
