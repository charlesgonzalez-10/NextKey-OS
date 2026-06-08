'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PropertySearchPanel, { CriteriaState, criteriaToParams, activeCriteriaCount } from '@/components/PropertySearchPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PropertyResult = Record<string, any>

interface Stats {
  total: number
  highEquity: number
  thisWeek: number
  starred: number
}

interface SavedSearch {
  id: string
  name: string
  emoji: string
  filters: CriteriaState
  owner: string
  is_shared: boolean
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY: CriteriaState = {}

const COUNTY_OPTIONS = [
  { value: '',            label: 'All Counties' },
  { value: 'miami-dade',  label: 'Miami-Dade' },
  { value: 'broward',     label: 'Broward' },
  { value: 'palm-beach',  label: 'Palm Beach' },
]
const COUNTY_COLORS: Record<string, string> = {
  'miami-dade': '#7B8FD4',
  broward:      '#4CAF9A',
  'palm-beach': '#C9A84C',
}
const EQUITY_COLORS: Record<string, string> = {
  High:   '#4CAF9A',
  Medium: '#C9A84C',
  Low:    '#7B8FD4',
  None:   '#9ca3af',
}
const STAGE_COLORS: Record<string, string> = {
  reviewing: '#C9A84C',
  contacted: '#6ABDE0',
  offer:     '#4CAF9A',
  dead:      '#9ca3af',
}
const DISTRESS_COLORS: Record<string, string> = {
  'Lis Pendens':  '#f59e0b',
  'Foreclosure':  '#ef4444',
  'Probate':      '#a78bfa',
  'Tax Deed':     '#f97316',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
function fmt$(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}
// ─── Lead type tag builder ────────────────────────────────────────────────────

function getLeadTypeTags(lead: Lead): { label: string; color: string }[] {
  const tags: { label: string; color: string }[] = []
  if (lead.is_pre_foreclosure) tags.push({ label: 'Pre-FC',      color: '#f59e0b' })
  if (lead.is_auction)         tags.push({ label: 'Auction',     color: '#ef4444' })
  if (lead.multiple_liens)     tags.push({ label: 'Multi-Lien',  color: '#E07B6A' })
  if (lead.free_clear)         tags.push({ label: 'Free&Clear',  color: '#4CAF9A' })
  if (lead.vacant)             tags.push({ label: 'Vacant',      color: '#6ABDE0' })
  if (lead.homestead === false) tags.push({ label: 'Absentee',   color: '#C9A84C' })
  const et = (lead.entity_type as string || '').toLowerCase()
  if (/llc|corp|inc|lp\b/.test(et)) tags.push({ label: 'LLC/Corp', color: '#a78bfa' })
  else if (/trust|estate/.test(et)) tags.push({ label: 'Trust',    color: '#a78bfa' })
  return tags.slice(0, 3) // cap at 3 tags to keep row compact
}

// ─── Property Row ─────────────────────────────────────────────────────────────

function PropertyRow({ lead, selected, onSelect, onStar, onClick }: {
  lead: Lead
  selected: boolean
  onSelect: (id: string, v: boolean) => void
  onStar: (id: string, v: boolean) => void
  onClick: (id: string) => void
}) {
  const [starring, setStarring] = useState(false)
  const days    = daysSince(lead.file_date)
  const ageClr  = distressAgeColor(days)
  const county  = lead.county as string
  const cClr    = COUNTY_COLORS[county] ?? '#9ca3af'
  const eClr    = EQUITY_COLORS[lead.equity_tier as string] ?? '#9ca3af'
  const sClr    = STAGE_COLORS[lead.pipeline_stage as string] ?? '#9ca3af'
  const ltTags  = getLeadTypeTags(lead)

  const toggleStar = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (starring) return
    setStarring(true)
    const next = !lead.starred
    onStar(lead.id, next)
    await fetch(`/api/leads/${lead.id}/stage`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: next }),
    })
    setStarring(false)
  }

  // Detect owner type
  const ownerName = (lead.owner_name || lead.mortgagor || '') as string
  const isLLC     = /\b(LLC|CORP|INC|LTD|TRUST|ESTATE|LP\b)/i.test(ownerName)

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

      {/* Star */}
      <td className="pr-2 py-3 w-8" onClick={toggleStar}>
        <svg className="w-4 h-4 mx-auto" fill={lead.starred ? '#C9A84C' : 'none'} stroke={lead.starred ? '#C9A84C' : '#d1d5db'} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </td>

      {/* Address + county */}
      <td className="py-3 pr-4 min-w-[180px]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cClr }} />
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>
              {lead.property_address || '—'}
            </p>
            <p className="text-[10px] truncate" style={{ color: 'var(--c-text-3)' }}>
              {lead.city}{lead.zip ? ` ${lead.zip}` : ''}
            </p>
          </div>
        </div>
      </td>

      {/* Owner */}
      <td className="py-3 pr-4 min-w-[140px]">
        <p className="text-xs truncate max-w-[150px]" style={{ color: 'var(--c-primary)' }}>
          {ownerName || '—'}
        </p>
        {isLLC && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
            ENTITY
          </span>
        )}
      </td>

      {/* County badge */}
      <td className="py-3 pr-4">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: `${cClr}20`, color: cClr }}>
          {county === 'miami-dade' ? 'MD' : county === 'broward' ? 'BRW' : county === 'palm-beach' ? 'PBC' : county}
        </span>
      </td>

      {/* Lead Type tags */}
      <td className="py-3 pr-4">
        <div className="flex flex-wrap gap-1">
          {ltTags.length > 0 ? ltTags.map(t => (
            <span key={t.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={{ backgroundColor: `${t.color}20`, color: t.color }}>
              {t.label}
            </span>
          )) : (
            <span style={{ color: 'var(--c-text-3)' }}>—</span>
          )}
        </div>
      </td>

      {/* Equity */}
      <td className="py-3 pr-4 text-right">
        {lead.equity_tier ? (
          <div>
            <p className="text-xs font-bold" style={{ color: eClr }}>{lead.equity_tier}</p>
            {lead.equity_percentage != null && (
              <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{Number(lead.equity_percentage).toFixed(0)}%</p>
            )}
          </div>
        ) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>

      {/* Value */}
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

      {/* Property details */}
      <td className="py-3 pr-4">
        <p className="text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>
          {[lead.beds && `${lead.beds}bd`, lead.baths && `${lead.baths}ba`, lead.living_area && `${Number(lead.living_area).toLocaleString()}sf`].filter(Boolean).join(' · ') || '—'}
        </p>
        {lead.year_built && (
          <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{lead.year_built}</p>
        )}
      </td>

      {/* Distress age */}
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
        {lead.phone_1 ? (
          <span className="text-[10px] font-bold" style={{ color: '#4CAF9A' }}>📞</span>
        ) : (
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>
        )}
      </td>

      {/* Stage */}
      <td className="py-3 pr-4">
        {lead.pipeline_stage ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: `${sClr}20`, color: sClr }}>
            {lead.pipeline_stage}
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>
        )}
      </td>

      {/* AI score */}
      <td className="py-3 pr-4 text-right">
        {lead.lead_score != null ? (
          <span className="text-xs font-bold" style={{ color: lead.lead_score >= 70 ? '#4CAF9A' : lead.lead_score >= 40 ? '#C9A84C' : '#9ca3af' }}>
            {lead.lead_score}
          </span>
        ) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>
    </tr>
  )
}

// ─── Property Lookup Panel ────────────────────────────────────────────────────

function PropertyLookupPanel() {
  const [query, setQuery]       = useState('')
  const [result, setResult]     = useState<PropertyResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const router = useRouter()

  const doSearch = async (q = query) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true); setError(null); setSearched(true); setResult(null)
    try {
      const res  = await fetch(`/api/property-search?q=${encodeURIComponent(trimmed)}`)
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Property not found. Try adding city, state, or zip.')
      else setResult(data.result)
    } catch { setError('Search failed — check your connection') }
    finally { setLoading(false) }
  }

  const r = result

  return (
    <div>
      {/* Search bar */}
      <div className="flex items-center rounded-xl overflow-hidden shadow-sm mb-5"
        style={{ border: '2px solid var(--c-primary)', backgroundColor: 'var(--c-card)' }}>
        <div className="pl-4 pr-2 shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            style={{ color: loading ? '#C9A84C' : 'var(--c-primary)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
          </svg>
        </div>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Enter any South Florida address, folio, or owner name…"
          className="flex-1 py-3.5 pr-3 text-sm md:text-base bg-transparent focus:outline-none"
          style={{ color: 'var(--c-primary)' }} />
        {query && (
          <button onClick={() => { setQuery(''); setResult(null); setSearched(false); setError(null) }}
            className="px-3 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>✕</button>
        )}
        <button onClick={() => doSearch()} disabled={loading}
          className="px-5 py-3.5 text-sm font-bold shrink-0 hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
          {loading ? 'Looking up…' : 'Lookup'}
        </button>
      </div>

      {/* Example searches */}
      {!searched && (
        <div className="mb-5">
          <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--c-text-3)' }}>Try an example:</p>
          <div className="flex flex-wrap gap-2">
            {[
              '212 SW 7 AVE, Miami',
              '350 Las Olas Blvd, Fort Lauderdale',
              '456 Clematis St, West Palm Beach',
            ].map(ex => (
              <button key={ex} onClick={() => { setQuery(ex); doSearch(ex) }}
                className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl p-4 text-sm mb-4" style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* Result card */}
      {r && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>

          {/* Header */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)' }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-base font-bold" style={{ color: 'var(--c-primary)' }}>{r.property_address}</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--c-text-2)' }}>
                  {[r.city, r.state, r.zip].filter(Boolean).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{
                    backgroundColor: r.county === 'miami-dade' ? 'rgba(123,143,212,0.15)' : r.county === 'broward' ? 'rgba(76,175,154,0.15)' : 'rgba(201,168,76,0.15)',
                    color: r.county === 'miami-dade' ? '#7B8FD4' : r.county === 'broward' ? '#4CAF9A' : '#C9A84C',
                  }}>
                  {r.county === 'miami-dade' ? 'Miami-Dade' : r.county === 'broward' ? 'Broward' : 'Palm Beach'}
                </span>
                {r.distress && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>⚠ Distressed Lead</span>
                )}
                {r.pa_url && (
                  <a href={r.pa_url} target="_blank" rel="noreferrer"
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                    PA Site ↗
                  </a>
                )}
                {r.distress?.lead_id && (
                  <button onClick={() => router.push(`/leads/${r.distress.lead_id}`)}
                    className="text-xs font-bold px-2.5 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
                    Open Lead →
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 3-col body */}
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: 'var(--c-border)' }}>

            {/* Ownership */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--c-text-3)' }}>Ownership</p>
              <Row label="Owner" value={r.owner_name} />
              {r.absentee_owner && (
                <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
                  Absentee Owner{r.owner_state && r.owner_state !== 'FL' ? ` · Out-of-State (${r.owner_state})` : ''}
                </span>
              )}
              <Row label="Mailing" value={r.mailing_address} />
              <Row label="Folio / APN" value={r.folio} mono />
              <Row label="Legal" value={r.legal_desc} clamp />
            </div>

            {/* Property */}
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--c-text-3)' }}>Property Details</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {([
                  ['Use', r.property_use],
                  ['Beds', r.beds],
                  ['Baths', r.baths],
                  ['Living Sqft', r.living_area?.toLocaleString()],
                  ['Lot Sqft', r.lot_size?.toLocaleString()],
                  ['Year Built', r.year_built],
                  ['Stories', r.stories],
                ] as [string, unknown][]).filter(([, v]) => v != null && v !== '').map(([label, val]) => (
                  <div key={label}>
                    <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{label}</p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>{String(val)}</p>
                  </div>
                ))}
              </div>
              {/* Status flags from REAPI */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {([
                  [r.raw?._vacant,         'Vacant',          '#ef4444'],
                  [r.raw?._high_equity,    'High Equity',     '#4CAF9A'],
                  [r.raw?._free_clear,     'Free & Clear',    '#4CAF9A'],
                  [r.raw?._foreclosure,    'Foreclosure',     '#ef4444'],
                  [r.raw?._pre_foreclosure,'Pre-Foreclosure', '#f59e0b'],
                  [r.raw?._tax_lien,       'Tax Lien',        '#f59e0b'],
                  [r.raw?._mls_active,     'MLS Active',      '#6ABDE0'],
                ] as [boolean, string, string][]).filter(([v]) => v).map(([, label, color]) => (
                  <span key={label} className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${color}20`, color }}>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Financials */}
            <div className="px-5 py-4 space-y-2">
              <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--c-text-3)' }}>Financials</p>
              {([
                ['Market / Est. Value', r.market_value],
                ['Assessed Value',      r.assessed_value],
                ['Land Value',          r.land_value],
                ['Building Value',      r.building_value],
              ] as [string, number | null][]).filter(([, v]) => v != null).map(([label, val]) => (
                <div key={label} className="flex items-center justify-between">
                  <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{label}</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>{fmt$(val)}</p>
                </div>
              ))}
              {r.raw?._estimated_equity != null && (
                <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--c-border)' }}>
                  <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Est. Equity</p>
                  <p className="text-sm font-bold" style={{ color: '#4CAF9A' }}>
                    {fmt$(r.raw._estimated_equity)}{r.raw._equity_percent != null ? ` (${r.raw._equity_percent}%)` : ''}
                  </p>
                </div>
              )}
              {(r.last_sale_date || r.last_sale_amount) && (
                <div className="pt-2" style={{ borderTop: '1px solid var(--c-border)' }}>
                  <p className="text-[10px] font-bold tracking-widest uppercase mb-1.5" style={{ color: 'var(--c-text-3)' }}>Sale History</p>
                  {r.last_sale_date && (
                    <div className="flex justify-between text-xs">
                      <span style={{ color: 'var(--c-text-3)' }}>Last Sale</span>
                      <span className="font-semibold" style={{ color: 'var(--c-primary)' }}>
                        {fmt$(r.last_sale_amount)} · {r.last_sale_date}
                      </span>
                    </div>
                  )}
                  {r.prev_sale_date && (
                    <div className="flex justify-between text-xs mt-1">
                      <span style={{ color: 'var(--c-text-3)' }}>Prior Sale</span>
                      <span style={{ color: 'var(--c-text-2)' }}>{fmt$(r.prev_sale_amount)} · {r.prev_sale_date}</span>
                    </div>
                  )}
                </div>
              )}
              {r.raw?._suggested_rent && (
                <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--c-border)' }}>
                  <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Est. Rent</p>
                  <p className="text-sm font-bold" style={{ color: '#6ABDE0' }}>{fmt$(r.raw._suggested_rent)}/mo</p>
                </div>
              )}
            </div>
          </div>

          {/* Distress row */}
          {r.distress && (
            <div className="px-5 py-3 flex items-center gap-4 flex-wrap"
              style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'rgba(239,68,68,0.04)' }}>
              <span className="text-xs font-bold" style={{ color: '#ef4444' }}>⚠ In Distress Database</span>
              {r.distress.case_type  && <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>{r.distress.case_type}</span>}
              {r.distress.file_date  && <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>Filed {r.distress.file_date}</span>}
              {r.distress.lien_amount && <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>{fmt$(r.distress.lien_amount)} lien</span>}
              {r.distress.lead_id && (
                <button onClick={() => router.push(`/leads/${r.distress.lead_id}`)}
                  className="ml-auto text-xs font-bold px-3 py-1 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                  View Full Lead →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Tiny helper for label+value rows
function Row({ label, value, mono, clamp }: { label: string; value?: string | null; mono?: boolean; clamp?: boolean }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{label}</p>
      <p className={`text-xs ${mono ? 'font-mono' : ''} ${clamp ? 'line-clamp-2' : ''}`}
        style={{ color: 'var(--c-text-2)' }}>{value}</p>
    </div>
  )
}

// ─── Save Spec Modal ──────────────────────────────────────────────────────────

function SaveSpecModal({ criteria, onSave, onClose }: {
  criteria: CriteriaState
  onSave: (s: SavedSearch) => void
  onClose: () => void
}) {
  const EMOJIS = ['🎯','💰','🏚','📍','⚡','🔥','💎','🏠','📊','🧲']
  const [emoji, setEmoji]   = useState('🎯')
  const [name, setName]     = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const res = await fetch('/api/leads/saved-searches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), emoji, filters: criteria, is_shared: false }),
    })
    const s = await res.json()
    onSave(s)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="rounded-2xl p-5 w-full max-w-sm shadow-2xl" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }} onClick={e => e.stopPropagation()}>
        <h3 className="font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Save Buy Box Spec</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--c-text-3)' }}>Save your current criteria as a reusable acquisition spec.</p>
        <div className="flex gap-2 mb-3 flex-wrap">
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              className="w-8 h-8 rounded-lg text-lg flex items-center justify-center"
              style={{ backgroundColor: emoji === e ? 'rgba(201,168,76,0.2)' : 'var(--c-hover)', border: `1px solid ${emoji === e ? '#C9A84C' : 'var(--c-border)'}` }}>
              {e}
            </button>
          ))}
        </div>
        <input value={name} autoFocus placeholder="e.g. Broward Pre-FC High Equity"
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
          className="w-full text-sm px-3 py-2 rounded-lg mb-4 focus:outline-none"
          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
        <div className="flex gap-2">
          <button onClick={save} disabled={saving || !name.trim()}
            className="flex-1 text-sm font-bold py-2 rounded-lg hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            {saving ? 'Saving…' : `${emoji} Save Spec`}
          </button>
          <button onClick={onClose} className="px-4 text-sm font-semibold rounded-lg"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PropertySearchClient({
  initialStats,
  initialCriteria = {},
  mode = 'search',
}: {
  initialStats: Stats
  initialCriteria?: Partial<CriteriaState>
  mode?: 'search' | 'leads'
}) {
  const router = useRouter()

  // Data
  const [leads, setLeads]     = useState<Lead[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pages, setPages]     = useState(1)
  const [loading, setLoading] = useState(true)
  const [stats, setStats]     = useState(initialStats)

  // Search
  const [searchInput, setSearchInput] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inline property lookup (fires when search looks like an address)
  const [lookupResult, setLookupResult]   = useState<PropertyResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Criteria — seed from URL params on first render
  const [criteria, setCriteria]         = useState<CriteriaState>({ ...EMPTY, ...initialCriteria })
  const [showCriteria, setShowCriteria] = useState(true)

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [activeSaved, setActiveSaved]     = useState<string | null>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Sort
  const [sortBy, setSortBy]   = useState<'file_date' | 'equity_percentage' | 'market_value' | 'lead_score'>('file_date')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async (c: CriteriaState, p = 1) => {
    setLoading(true)
    const params = criteriaToParams(c, {
      page:      String(p),
      limit:     '200',
      sort_by:   sortBy,
      sort_dir:  sortDir,
    })
    try {
      const res  = await fetch(`/api/properties?${params}`)
      const data = await res.json()
      setLeads(data.properties || data.leads || [])
      setTotal(data.total || 0)
      setPage(data.page  || 1)
      setPages(data.pages || 1)
    } catch { /* noop */ }
    finally { setLoading(false) }
  }, [sortBy, sortDir])

  // ── Boot ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const boot = { ...EMPTY, ...initialCriteria }
    fetchLeads(boot)
    fetch('/api/leads/saved-searches')
      .then(r => r.json())
      .then(d => Array.isArray(d) && setSavedSearches(d))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run when sort changes
  useEffect(() => { fetchLeads(criteria, 1) }, [sortBy, sortDir]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Property lookup (fires when search looks like a street address) ──────

  // Addresses start with a house number: digits possibly followed by a dash
  const looksLikeAddress = (s: string) => /^\d{1,6}[\s-]/.test(s.trim()) && s.trim().length > 6

  const triggerLookup = useCallback(async (q: string) => {
    if (!looksLikeAddress(q)) { setLookupResult(null); return }
    setLookupLoading(true)
    try {
      const res  = await fetch(`/api/property-search?q=${encodeURIComponent(q.trim())}`)
      const data = await res.json()
      setLookupResult(res.ok ? data.result : null)
    } catch { setLookupResult(null) }
    finally { setLookupLoading(false) }
  }, [])

  // ── Search handler ────────────────────────────────────────────────────────

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (!value) { setLookupResult(null) }

    // Debounce DB search
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      const next = { ...criteria, search: value || undefined }
      setCriteria(next)
      fetchLeads(next, 1)
    }, 300)

    // Debounce property lookup (slower — only when it looks like an address)
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    lookupTimer.current = setTimeout(() => triggerLookup(value), 600)
  }

  const commitSearch = () => {
    const next = { ...criteria, search: searchInput || undefined }
    setCriteria(next)
    fetchLeads(next, 1)
    triggerLookup(searchInput)
  }

  // ── Criteria handlers ─────────────────────────────────────────────────────

  const runSearch = () => {
    const c = { ...criteria, search: searchInput || undefined }
    setCriteria(c)
    setActiveSaved(null)
    fetchLeads(c, 1)
  }

  const clearAll = () => {
    setCriteria(EMPTY)
    setSearchInput('')
    setLookupResult(null)
    setActiveSaved(null)
    fetchLeads(EMPTY, 1)
  }

  // ── Saved searches ────────────────────────────────────────────────────────

  const loadSaved = (s: SavedSearch) => {
    if (activeSaved === s.id) {
      setActiveSaved(null)
      setCriteria(EMPTY); setSearchInput('')
      fetchLeads(EMPTY, 1)
    } else {
      setActiveSaved(s.id)
      setCriteria(s.filters)
      setSearchInput(s.filters.search ?? '')
      fetchLeads(s.filters, 1)
    }
  }

  const deleteSaved = async (id: string) => {
    await fetch(`/api/leads/saved-searches/${id}`, { method: 'DELETE' })
    setSavedSearches(prev => prev.filter(s => s.id !== id))
    if (activeSaved === id) { setActiveSaved(null); fetchLeads(EMPTY, 1) }
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = (id: string, v: boolean) => {
    setSelected(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s })
  }
  const selectAll  = () => setSelected(new Set(leads.map(l => l.id)))
  const clearSelect = () => setSelected(new Set())

  // ── Star ──────────────────────────────────────────────────────────────────

  const handleStar = (id: string, starred: boolean) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, starred } : l))
    setStats(prev => ({ ...prev, starred: starred ? prev.starred + 1 : Math.max(0, prev.starred - 1) }))
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const exportCSV = () => {
    const rows = selected.size > 0 ? leads.filter(l => selected.has(l.id)) : leads
    const cols = ['property_address','city','zip','county','owner_name','phone_1','market_value','equity_tier','equity_percentage','beds','baths','living_area','year_built','file_date','foreclosure_type','foreclosure_amount','pipeline_stage','lead_score']
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `properties-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  const activeCount = activeCriteriaCount(criteria)
  const allSelected = leads.length > 0 && selected.size === leads.length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--c-primary)' }}>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* HEADER                                                            */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="px-4 md:px-8 pt-5 pb-3"
        style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>

        {/* Title + stats + mode tabs */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--c-primary)' }}>
              {mode === 'leads' ? 'My Leads' : 'Property Search'}
            </h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                <span className="font-bold" style={{ color: 'var(--c-primary)' }}>{stats.total.toLocaleString()}</span> total
              </span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                <span className="font-bold" style={{ color: '#4CAF9A' }}>{stats.highEquity.toLocaleString()}</span> high equity
              </span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                <span className="font-bold" style={{ color: '#C9A84C' }}>{stats.thisWeek.toLocaleString()}</span> this week
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV}
              className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export {selected.size > 0 ? `(${selected.size})` : 'All'}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center rounded-xl overflow-hidden shadow-sm"
          style={{ border: '2px solid var(--c-primary)', backgroundColor: 'var(--c-card)' }}>
          <div className="pl-4 pr-2 shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ color: loading || lookupLoading ? '#C9A84C' : 'var(--c-primary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
          </div>
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (looksLikeAddress(searchInput)) {
                  // Address → go straight to property detail page
                  router.push(`/leads/property?q=${encodeURIComponent(searchInput)}`)
                } else {
                  commitSearch()
                }
              }
            }}
            placeholder="Search address, owner, case #, folio, phone, city, ZIP… or press Enter on an address to look it up"
            className="flex-1 py-3 pr-3 text-sm md:text-base bg-transparent focus:outline-none"
            style={{ color: 'var(--c-primary)' }}
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); handleSearchChange(''); setLookupResult(null) }}
              className="px-3 py-3 shrink-0 hover:opacity-60"
              style={{ color: 'var(--c-text-3)' }}>✕</button>
          )}
          {/* Property Lookup button — always visible, navigates to full detail page */}
          {searchInput && (
            <button
              onClick={() => router.push(`/leads/property?q=${encodeURIComponent(searchInput)}`)}
              className="px-3 py-3 text-[11px] font-bold shrink-0 border-l hover:opacity-80 whitespace-nowrap"
              style={{ borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}
              title="Look up this property in the PA database">
              🔍 Lookup
            </button>
          )}
          <button onClick={commitSearch}
            className="px-4 py-3 text-sm font-bold shrink-0 hover:opacity-80"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            Search
          </button>
        </div>
      </div>{/* end header card */}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* CRITERIA / BUY BOX PANEL                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div>
        {/* Collapse toggle */}
        <button
          onClick={() => setShowCriteria(v => !v)}
          className="w-full flex items-center justify-between px-4 md:px-8 py-2 text-left"
          style={{ backgroundColor: 'var(--c-card-alt)', borderBottom: '1px solid var(--c-border)' }}>
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-primary)' }}>
              Acquisition Criteria
            </span>
            {activeCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
                {activeCount} active
              </span>
            )}
          </div>
          <svg className={`w-4 h-4 transition-transform ${showCriteria ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showCriteria && (
          <PropertySearchPanel
            criteria={criteria}
            onChange={setCriteria}
            onRun={runSearch}
            onClear={clearAll}
          />
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SAVED SPECS                                                       */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="px-4 md:px-8 py-2 flex items-center gap-2 flex-wrap"
        style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
        <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--c-text-3)' }}>
          Saved Specs:
        </span>
        {savedSearches.map(s => (
          <div key={s.id} className="flex items-center gap-0.5">
            <button onClick={() => loadSaved(s)}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
              style={{
                backgroundColor: activeSaved === s.id ? 'var(--c-primary)' : 'var(--c-hover)',
                color: activeSaved === s.id ? '#C9A84C' : 'var(--c-text-2)',
                border: `1px solid ${activeSaved === s.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
              }}>
              <span>{s.emoji}</span> {s.name}
            </button>
            <button onClick={() => deleteSaved(s.id)}
              className="text-[10px] px-1 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>×</button>
          </div>
        ))}
        <button onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
          + Save Spec
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* INLINE PROPERTY RECORD (when search looks like an address)       */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {lookupResult && (() => {
        const r = lookupResult
        // Use property_address as-is — REAPI already includes city/state/zip in it
        // Appending city/zip again causes duplicates like "Weston, 33331, Weston, 33331"
        const addrForUrl = r.property_address?.includes(r.city ?? '__NONE__')
          ? r.property_address
          : [r.property_address, r.city, r.state, r.zip].filter(Boolean).join(', ')
        const detailUrl = `/leads/property?q=${encodeURIComponent(addrForUrl)}&county=${r.county ?? ''}`
        return (
          <div className="mx-4 md:mx-8 my-3 rounded-2xl overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => router.push(detailUrl)}
            style={{ border: '1px solid #C9A84C', backgroundColor: 'var(--c-card)' }}>
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-3"
              style={{ backgroundColor: 'rgba(201,168,76,0.06)', borderBottom: '1px solid rgba(201,168,76,0.2)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>PA RECORD</span>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--c-primary)' }}>{r.property_address}</p>
                  <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>{[r.city, r.state, r.zip].filter(Boolean).join(', ')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.distress && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>⚠ Distressed</span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); router.push(detailUrl) }}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                  View Full Details →
                </button>
                {r.distress?.lead_id && (
                  <button onClick={() => router.push(`/leads/${r.distress.lead_id}`)}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                    Open Lead →
                  </button>
                )}
                <button onClick={() => setLookupResult(null)}
                  className="text-[11px] px-2 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>✕</button>
              </div>
            </div>
            {/* Data row */}
            <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2">
              {([
                ['Owner',       r.owner_name],
                ['Beds / Baths', r.beds != null ? `${r.beds} / ${r.baths}` : null],
                ['Living Sqft', r.living_area?.toLocaleString()],
                ['Year Built',  r.year_built],
                ['Est. Value',  r.market_value ? fmt$(r.market_value) : null],
                ['Assessed',    r.assessed_value ? fmt$(r.assessed_value) : null],
                ['Land Value',  r.land_value ? fmt$(r.land_value) : null],
                ['Last Sale',   r.last_sale_date ? `${fmt$(r.last_sale_amount)} · ${r.last_sale_date}` : null],
                ['Folio',       r.folio],
                ['Zoning',      r.zoning],
                ['Subdivision', r.subdivision],
                ['Mailing',     r.owner_state && r.owner_state !== (r.state || 'FL') ? `${r.mailing_address} ⚑ Out-of-State` : r.mailing_address],
              ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([label, val]) => (
                <div key={label}>
                  <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{label}</p>
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>{val}</p>
                </div>
              ))}
              {/* REAPI flags */}
              {(r.raw?._high_equity || r.raw?._free_clear || r.raw?._vacant || r.raw?._suggested_rent) && (
                <div>
                  <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Flags</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {r.raw?._suggested_rent && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(106,189,224,0.15)', color: '#6ABDE0' }}>Rent ~{fmt$(r.raw._suggested_rent)}/mo</span>}
                    {r.raw?._high_equity  && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A' }}>High Equity</span>}
                    {r.raw?._free_clear   && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A' }}>Free & Clear</span>}
                    {r.raw?._vacant       && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>Vacant</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* RESULTS TABLE                                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-auto">

        {/* Table toolbar */}
        <div className="sticky top-0 z-10 px-4 md:px-8 py-2 flex items-center gap-3 flex-wrap"
          style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>

          {/* Selection */}
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <input type="checkbox" checked={allSelected} onChange={e => e.target.checked ? selectAll() : clearSelect()}
              style={{ accentColor: '#C9A84C' }} />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>
              {selected.size > 0 ? `${selected.size} selected` : 'Select All'}
            </span>
          </label>

          {/* Bulk actions (shown when something is selected) */}
          {selected.size > 0 && (
            <>
              <button onClick={exportCSV}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                ↓ Export {selected.size}
              </button>
              <button onClick={clearSelect}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                ✕ Clear
              </button>
            </>
          )}

          {/* Result count */}
          <span className="text-[11px] font-semibold ml-auto" style={{ color: 'var(--c-text-3)' }}>
            {loading ? 'Loading…' : `${total.toLocaleString()} properties`}
            {activeCount > 0 && ` matching ${activeCount} criteria`}
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

        {/* The table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Querying database…</p>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>No properties match your criteria</p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Try loosening your buy box filters</p>
              <button onClick={clearAll} className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                Clear All Criteria
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: '900px' }}>
              <thead className="sticky top-0 z-[5]"
                style={{ backgroundColor: 'var(--c-card-alt)', borderBottom: '2px solid var(--c-border)' }}>
                <tr>
                  {['', '★', 'Address', 'Owner', 'County', 'Lead Type', 'Equity', 'Value', 'Bed/Bath/Sqft', 'Age', 'Phone', 'Stage', 'Score'].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--c-text-3)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <PropertyRow
                    key={lead.id}
                    lead={lead}
                    selected={selected.has(lead.id)}
                    onSelect={toggleSelect}
                    onStar={handleStar}
                    onClick={id => router.push(`/leads/${id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && !loading && (
          <div className="flex items-center justify-center gap-3 py-4 px-8"
            style={{ borderTop: '1px solid var(--c-border)' }}>
            <button onClick={() => fetchLeads(criteria, page - 1)} disabled={page <= 1}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ← Previous
            </button>
            <span className="text-xs font-semibold" style={{ color: 'var(--c-text-3)' }}>
              Page {page} of {pages}
            </span>
            <button onClick={() => fetchLeads(criteria, page + 1)} disabled={page >= pages}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Save spec modal */}
      {showSaveModal && (
        <SaveSpecModal
          criteria={criteria}
          onSave={s => setSavedSearches(prev => [s, ...prev])}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  )
}
