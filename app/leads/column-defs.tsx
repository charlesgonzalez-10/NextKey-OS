'use client'

import { useState } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Lead = Record<string, any>

export interface RenderCtx {
  onStar:            (id: string, starred: boolean) => void
  onFieldChange?:    (id: string, field: string, value: string | number | boolean | null) => void
  offerPctOverride?: Record<string, number>
}

export interface ColumnDef {
  key: string
  label: string
  headerLabel: string
  category: string
  defaultOn: boolean
  exportHeader: string
  exportValue: (lead: Lead) => string
  renderTd: (lead: Lead, ctx: RenderCtx) => React.ReactNode
}

export const COLUMN_CATEGORIES: { key: string; label: string }[] = [
  { key: 'pipeline',  label: 'Pipeline Info' },
  { key: 'property',  label: 'Property Info' },
  { key: 'ownership', label: 'Ownership Info' },
  { key: 'contact',   label: 'Contact Info' },
  { key: 'distress',  label: 'Distress Info' },
  { key: 'mortgage',  label: 'Mortgage Info' },
  { key: 'value',     label: 'Value / Equity' },
  { key: 'marketing', label: 'Marketing Info' },
]

// ── Style constants ──────────────────────────────────────────────────────────

export const COUNTY_COLORS: Record<string, string> = {
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
const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  'Broward OR Index': { label: 'BRW-OR',     color: '#4CAF9A' },
  'MD OR Index':      { label: 'MD-OR',      color: '#7B8FD4' },
  'PBC OR Index':     { label: 'PBC-OR',     color: '#C9A84C' },
  'REIFax':           { label: 'REIFax',     color: '#E07B6A' },
  'PropStream':       { label: 'PropStream', color: '#6ABDE0' },
  'Palm Beach Bulk':  { label: 'PB-Bulk',    color: '#C9A84C' },
  'CSV Import':       { label: 'CSV',        color: '#9ca3af' },
  'Manual':           { label: 'Manual',     color: '#9ca3af' },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(d: string | null | undefined) {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}
function distressAgeColor(days: number | null) {
  if (days === null) return '#9ca3af'
  if (days <= 30)  return '#4CAF9A'
  if (days <= 90)  return '#C9A84C'
  if (days <= 180) return '#E07B6A'
  return '#ef4444'
}
export function fmt$(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}
export function getSourceBadge(lead: Lead) {
  const src = (lead.data_source || lead.source || '') as string
  for (const [key, cfg] of Object.entries(SOURCE_BADGE)) {
    if (src.toLowerCase().includes(key.toLowerCase())) return cfg
  }
  if (src) return { label: src.slice(0, 8), color: '#9ca3af' }
  return null
}
export function getPALink(lead: Lead): string | null {
  const folio   = lead.folio_number as string | null
  const county  = lead.county as string
  const address = lead.property_address as string | null
  if (county === 'miami-dade' && folio)
    return `https://www.miamidade.gov/Apps/PA/propertysearch/#/?folio=${encodeURIComponent(folio)}`
  if (county === 'broward' && folio)
    return `https://www.bcpa.net/RecInfo.asp?URL_Folio=${encodeURIComponent(folio)}`
  if (county === 'palm-beach' && folio)
    return `https://www.pbcpao.gov/property-details/${encodeURIComponent(folio)}`
  if (address) {
    if (county === 'miami-dade') return `https://www.miamidade.gov/Apps/PA/propertysearch/#/?address=${encodeURIComponent(address)}`
    if (county === 'broward')    return `https://www.bcpa.net/RecInfo.asp?URL_Parcel=&URL_Address=${encodeURIComponent(address)}`
    if (county === 'palm-beach') return `https://www.pbcpao.gov/search?search=${encodeURIComponent(address)}`
  }
  return null
}
export function getLeadTypeTags(lead: Lead): { label: string; color: string }[] {
  const tags: { label: string; color: string }[] = []
  if (lead.is_pre_foreclosure) tags.push({ label: 'Pre-FC',     color: '#f59e0b' })
  if (lead.is_probate)         tags.push({ label: 'Probate',    color: '#a78bfa' })
  if (lead.is_tax_deed)        tags.push({ label: 'Tax Deed',   color: '#f97316' })
  if (lead.is_divorce)         tags.push({ label: 'Divorce',    color: '#6ABDE0' })
  if (lead.is_auction)         tags.push({ label: 'Auction',    color: '#ef4444' })
  if (lead.multiple_liens)     tags.push({ label: 'Multi-Lien', color: '#E07B6A' })
  if (lead.free_clear)         tags.push({ label: 'Free&Clear', color: '#4CAF9A' })
  if (lead.vacant)             tags.push({ label: 'Vacant',     color: '#6ABDE0' })
  if (lead.homestead === false) tags.push({ label: 'Absentee',  color: '#C9A84C' })
  const et = (lead.entity_type as string || '').toLowerCase()
  if (/llc|corp|inc|lp\b/.test(et))  tags.push({ label: 'LLC/Corp', color: '#a78bfa' })
  else if (/trust|estate/.test(et))  tags.push({ label: 'Trust',    color: '#a78bfa' })
  return tags.slice(0, 3)
}

// ── Star Cell (has local state) ───────────────────────────────────────────────

function StarCell({ lead, onStar }: { lead: Lead; onStar: (id: string, v: boolean) => void }) {
  const [starring, setStarring] = useState(false)
  const toggle = async (e: React.MouseEvent) => {
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
  return (
    <td className="pr-2 py-3 w-8 cursor-pointer" onClick={toggle}>
      <svg className="w-4 h-4 mx-auto" fill={lead.starred ? '#C9A84C' : 'none'}
        stroke={lead.starred ? '#C9A84C' : '#d1d5db'} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </td>
  )
}

// ── Column Definitions ───────────────────────────────────────────────────────

export const ALL_COLUMN_DEFS: ColumnDef[] = [

  // ─── Pipeline ────────────────────────────────────────────────────────────

  // Acquisition pipeline
  {
    key: 'acquisition_pipeline', label: 'Acq. Pipeline', headerLabel: 'Pipeline', category: 'pipeline', defaultOn: false,
    exportHeader: 'Acquisition Pipeline',
    exportValue: (l) => l.acquisition_pipeline || '',
    renderTd: (lead) => {
      const PIPELINE_COLORS: Record<string, string> = {
        'wholesale': '#C9A84C', 'retail': '#6ABDE0', 'pre-foreclosure': '#f59e0b',
        'surplus-funds': '#4CAF9A', 'probate': '#a78bfa',
      }
      const PIPELINE_ICONS: Record<string, string> = {
        'wholesale': '🏠', 'retail': '🏡', 'pre-foreclosure': '⚠️',
        'surplus-funds': '💰', 'probate': '📋',
      }
      const p   = lead.acquisition_pipeline as string | null
      const clr = p ? (PIPELINE_COLORS[p] ?? '#9ca3af') : '#9ca3af'
      return (
        <td className="py-3 pr-4 whitespace-nowrap">
          {p
            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${clr}20`, color: clr }}>
                {PIPELINE_ICONS[p] ?? ''} {p.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
              </span>
            : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },

  // Surplus status
  {
    key: 'surplus_status', label: 'Surplus Status', headerLabel: 'Surplus', category: 'pipeline', defaultOn: false,
    exportHeader: 'Surplus Status',
    exportValue: (l) => l.surplus_status || '',
    renderTd: (lead, ctx) => {
      const st = lead.surplus_status as string | null
      const SURPLUS_CFG: Record<string, { label: string; color: string }> = {
        new:          { label: 'New',           color: '#6ABDE0' },
        researching:  { label: 'Researching',   color: '#C9A84C' },
        owner_found:  { label: 'Owner Found',   color: '#a78bfa' },
        contacted:    { label: 'Contacted',     color: '#f59e0b' },
        claim_filed:  { label: 'Claim Filed',   color: '#4CAF9A' },
        paid:         { label: 'Paid',          color: '#22c55e' },
        archived:     { label: 'Archived',      color: '#9ca3af' },
      }
      const cur = st ? (SURPLUS_CFG[st] ?? { label: st, color: '#9ca3af' }) : null
      return (
        <td className="py-3 pr-3 text-center" onClick={e => e.stopPropagation()}>
          <select
            value={st ?? ''}
            onChange={e => ctx.onFieldChange?.(lead.id, 'surplus_status', e.target.value || null)}
            className="text-[10px] font-bold rounded-full px-2 py-0.5 focus:outline-none cursor-pointer"
            style={{
              backgroundColor: cur ? `${cur.color}18` : 'var(--c-hover)',
              color: cur ? cur.color : 'var(--c-text-3)',
              border: `1px solid ${cur ? `${cur.color}40` : 'var(--c-border)'}`,
            }}>
            <option value="">—</option>
            {Object.entries(SURPLUS_CFG).map(([v,c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
        </td>
      )
    },
  },

  // Follow-up date
  {
    key: 'follow_up_at', label: 'Follow-up', headerLabel: 'Follow-up', category: 'pipeline', defaultOn: false,
    exportHeader: 'Follow-up Date',
    exportValue: (l) => l.follow_up_at ? new Date(l.follow_up_at).toLocaleDateString('en-US') : '',
    renderTd: (lead) => {
      const d     = lead.follow_up_at ? new Date(lead.follow_up_at) : null
      const today = new Date()
      const isPast = d && d < today
      const isToday = d && d.toDateString() === today.toDateString()
      return (
        <td className="py-3 pr-4 text-center">
          {d
            ? <span className="text-[10px] font-bold"
                style={{ color: isPast ? '#ef4444' : isToday ? '#C9A84C' : 'var(--c-text-2)' }}>
                {isToday ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },

  {
    key: 'star', label: 'Starred', headerLabel: '★', category: 'pipeline', defaultOn: true,
    exportHeader: 'Starred',
    exportValue: (l) => l.starred ? 'Yes' : 'No',
    renderTd: (lead, ctx) => <StarCell key={lead.id + '_star'} lead={lead} onStar={ctx.onStar} />,
  },
  {
    key: 'stage', label: 'Pipeline Stage', headerLabel: 'Stage', category: 'pipeline', defaultOn: true,
    exportHeader: 'Pipeline Stage',
    exportValue: (l) => l.pipeline_stage || '',
    renderTd: (lead) => {
      const sClr = STAGE_COLORS[lead.pipeline_stage as string] ?? '#9ca3af'
      return (
        <td className="py-3 pr-4">
          {lead.pipeline_stage
            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: `${sClr}20`, color: sClr }}>
                {lead.pipeline_stage}
              </span>
            : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },
  {
    key: 'score', label: 'AI Score', headerLabel: 'Score', category: 'pipeline', defaultOn: true,
    exportHeader: 'AI Score',
    exportValue: (l) => l.lead_score != null ? String(l.lead_score) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-2 text-right">
        {lead.lead_score != null
          ? <span className="text-xs font-bold"
              style={{ color: lead.lead_score >= 70 ? '#4CAF9A' : lead.lead_score >= 40 ? '#C9A84C' : '#9ca3af' }}>
              {lead.lead_score}
            </span>
          : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>
    ),
  },

  // ─── Property Info ───────────────────────────────────────────────────────
  {
    key: 'address', label: 'Address', headerLabel: 'Address', category: 'property', defaultOn: true,
    exportHeader: 'Address',
    exportValue: (l) => [l.property_address, l.city, l.zip].filter(Boolean).join(', '),
    renderTd: (lead) => {
      const cClr     = COUNTY_COLORS[lead.county as string] ?? '#9ca3af'
      const srcBadge = getSourceBadge(lead)
      const paLink   = getPALink(lead)
      return (
        <td className="py-3 pr-4 min-w-[180px]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cClr }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>
                  {lead.property_address || '—'}
                </p>
                {paLink && (
                  <a href={paLink} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded hover:opacity-70"
                    style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                    PA↗
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-[10px] truncate" style={{ color: 'var(--c-text-3)' }}>
                  {lead.city}{lead.zip ? ` ${lead.zip}` : ''}
                </p>
                {srcBadge && (
                  <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0 whitespace-nowrap"
                    style={{ backgroundColor: `${srcBadge.color}18`, color: srcBadge.color }}>
                    {srcBadge.label}
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>
      )
    },
  },
  {
    key: 'county', label: 'County', headerLabel: 'County', category: 'property', defaultOn: true,
    exportHeader: 'County',
    exportValue: (l) => l.county || '',
    renderTd: (lead) => {
      const cClr = COUNTY_COLORS[lead.county as string] ?? '#9ca3af'
      return (
        <td className="py-3 pr-4">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: `${cClr}20`, color: cClr }}>
            {lead.county === 'miami-dade' ? 'MD' : lead.county === 'broward' ? 'BRW' : lead.county === 'palm-beach' ? 'PBC' : lead.county || '—'}
          </span>
        </td>
      )
    },
  },
  {
    key: 'property_details', label: 'Bed / Bath / Sqft', headerLabel: 'Bed/Bath/Sqft', category: 'property', defaultOn: true,
    exportHeader: 'Beds/Baths/Sqft',
    exportValue: (l) => [l.beds && `${l.beds}bd`, l.baths && `${l.baths}ba`, l.living_area && `${l.living_area}sf`].filter(Boolean).join(' / '),
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>
          {[lead.beds && `${lead.beds}bd`, lead.baths && `${lead.baths}ba`, lead.living_area && `${Number(lead.living_area).toLocaleString()}sf`].filter(Boolean).join(' · ') || '—'}
        </p>
        {lead.year_built && <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{lead.year_built}</p>}
      </td>
    ),
  },
  {
    key: 'property_type', label: 'Property Type', headerLabel: 'Type', category: 'property', defaultOn: false,
    exportHeader: 'Property Type',
    exportValue: (l) => l.property_type || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] truncate max-w-[100px]" style={{ color: 'var(--c-text-2)' }}>{lead.property_type || '—'}</p>
      </td>
    ),
  },
  {
    key: 'year_built', label: 'Year Built', headerLabel: 'Year', category: 'property', defaultOn: false,
    exportHeader: 'Year Built',
    exportValue: (l) => l.year_built ? String(l.year_built) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>{lead.year_built || '—'}</p>
      </td>
    ),
  },
  {
    key: 'lot_size', label: 'Lot Size (sqft)', headerLabel: 'Lot Sqft', category: 'property', defaultOn: false,
    exportHeader: 'Lot Sqft',
    exportValue: (l) => l.lot_size ? String(l.lot_size) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
          {lead.lot_size ? Number(lead.lot_size).toLocaleString() : '—'}
        </p>
      </td>
    ),
  },
  {
    key: 'subdivision', label: 'Subdivision', headerLabel: 'Subdivision', category: 'property', defaultOn: false,
    exportHeader: 'Subdivision',
    exportValue: (l) => l.subdivision_name || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] truncate max-w-[130px]" style={{ color: 'var(--c-text-2)' }}>{lead.subdivision_name || '—'}</p>
      </td>
    ),
  },
  {
    key: 'folio', label: 'Folio #', headerLabel: 'Folio #', category: 'property', defaultOn: false,
    exportHeader: 'Folio #',
    exportValue: (l) => l.folio_number || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] font-mono truncate max-w-[120px]" style={{ color: 'var(--c-text-2)' }}>{lead.folio_number || '—'}</p>
      </td>
    ),
  },
  {
    key: 'unit_number', label: 'Unit / Apt #', headerLabel: 'Unit', category: 'property', defaultOn: false,
    exportHeader: 'Unit #',
    exportValue: (l) => l.unit_number || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>{lead.unit_number || '—'}</p>
      </td>
    ),
  },
  {
    key: 'num_units', label: 'Number of Units', headerLabel: '# Units', category: 'property', defaultOn: false,
    exportHeader: '# Units',
    exportValue: (l) => l.num_units != null ? String(l.num_units) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <p className="text-[11px] font-semibold" style={{ color: lead.num_units && lead.num_units > 1 ? '#6ABDE0' : 'var(--c-text-2)' }}>
          {lead.num_units != null ? lead.num_units : '—'}
        </p>
      </td>
    ),
  },
  {
    key: 'zip', label: 'ZIP Code', headerLabel: 'ZIP', category: 'property', defaultOn: false,
    exportHeader: 'ZIP',
    exportValue: (l) => l.zip || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] font-mono" style={{ color: 'var(--c-text-2)' }}>{lead.zip || '—'}</p>
      </td>
    ),
  },
  {
    key: 'auction_date', label: 'Auction Date', headerLabel: 'Auction Date', category: 'property', defaultOn: false,
    exportHeader: 'Auction Date',
    exportValue: (l) => l.auction_date || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <p className="text-[11px]" style={{ color: lead.auction_date ? '#ef4444' : 'var(--c-text-3)' }}>
          {lead.auction_date
            ? new Date(lead.auction_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—'}
        </p>
      </td>
    ),
  },

  // ─── Ownership Info ───────────────────────────────────────────────────────
  {
    key: 'owner', label: 'Owner', headerLabel: 'Owner', category: 'ownership', defaultOn: true,
    exportHeader: 'Owner Name',
    exportValue: (l) => l.owner_name || l.mortgagor || '',
    renderTd: (lead) => {
      const ownerName = (lead.owner_name || lead.mortgagor || '') as string
      const isLLC     = /\b(LLC|CORP|INC|LTD|TRUST|ESTATE|LP\b)/i.test(ownerName)
      return (
        <td className="py-3 pr-4 min-w-[140px]">
          <p className="text-xs truncate max-w-[150px]" style={{ color: 'var(--c-primary)' }}>{ownerName || '—'}</p>
          {isLLC && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>ENTITY</span>
          )}
        </td>
      )
    },
  },
  {
    key: 'homestead', label: 'Homestead', headerLabel: 'Homestead', category: 'ownership', defaultOn: false,
    exportHeader: 'Homestead',
    exportValue: (l) => l.homestead === true ? 'Yes' : l.homestead === false ? 'No' : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: lead.homestead ? 'rgba(76,175,154,0.15)' : 'rgba(239,68,68,0.12)',
            color: lead.homestead ? '#4CAF9A' : lead.homestead === false ? '#ef4444' : 'var(--c-text-3)',
          }}>
          {lead.homestead === true ? 'Yes' : lead.homestead === false ? 'No' : '—'}
        </span>
      </td>
    ),
  },
  {
    key: 'entity_type', label: 'Entity Type', headerLabel: 'Entity', category: 'ownership', defaultOn: false,
    exportHeader: 'Entity Type',
    exportValue: (l) => l.entity_type || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] truncate" style={{ color: 'var(--c-text-2)' }}>{lead.entity_type || '—'}</p>
      </td>
    ),
  },
  {
    key: 'owner_address', label: 'Owner Address', headerLabel: 'Owner Address', category: 'ownership', defaultOn: false,
    exportHeader: 'Owner Address',
    exportValue: (l) => l.mailing_address || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 min-w-[160px]">
        <p className="text-[11px] truncate max-w-[180px]" style={{ color: 'var(--c-text-2)' }}>{lead.mailing_address || '—'}</p>
      </td>
    ),
  },
  {
    key: 'owner_city', label: 'Owner City', headerLabel: 'Owner City', category: 'ownership', defaultOn: false,
    exportHeader: 'Owner City',
    exportValue: (l) => l.owner_city || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] truncate max-w-[120px]" style={{ color: 'var(--c-text-2)' }}>{lead.owner_city || '—'}</p>
      </td>
    ),
  },
  {
    key: 'owner_state', label: 'Owner State', headerLabel: 'Owner State', category: 'ownership', defaultOn: false,
    exportHeader: 'Owner State',
    exportValue: (l) => l.owner_state || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <span className="text-[11px] font-semibold" style={{ color: lead.owner_state && lead.owner_state !== 'FL' ? '#f59e0b' : 'var(--c-text-2)' }}>
          {lead.owner_state || '—'}
        </span>
      </td>
    ),
  },
  {
    key: 'owner_zip', label: 'Owner ZIP', headerLabel: 'Owner ZIP', category: 'ownership', defaultOn: false,
    exportHeader: 'Owner ZIP',
    exportValue: (l) => l.owner_zip || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] font-mono" style={{ color: 'var(--c-text-2)' }}>{lead.owner_zip || '—'}</p>
      </td>
    ),
  },

  // ─── Contact Info ────────────────────────────────────────────────────────
  {
    key: 'phone_indicator', label: 'Phone (has phone)', headerLabel: 'Phone', category: 'contact', defaultOn: true,
    exportHeader: 'Has Phone',
    exportValue: (l) => l.phone_1 ? 'Yes' : 'No',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        {lead.phone_1
          ? <span className="flex items-center justify-center" style={{ color: '#4CAF9A' }}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>
              </svg>
            </span>
          : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>
    ),
  },
  {
    key: 'phone_1', label: 'Phone 1 (number)', headerLabel: 'Phone 1', category: 'contact', defaultOn: false,
    exportHeader: 'Phone 1',
    exportValue: (l) => l.phone_1 || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        {lead.phone_1
          ? <a href={`tel:${lead.phone_1}`} onClick={e => e.stopPropagation()}
              className="text-[11px] font-semibold hover:underline" style={{ color: '#4CAF9A' }}>
              {lead.phone_1}
            </a>
          : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>
    ),
  },
  {
    key: 'all_phones', label: 'All Phones', headerLabel: 'All Phones', category: 'contact', defaultOn: false,
    exportHeader: 'All Phones',
    exportValue: (l) => [l.phone_1, l.phone_2, l.phone_3, l.phone_4, l.phone_5].filter(Boolean).join(' | '),
    renderTd: (lead) => {
      const phones = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5].filter(Boolean)
      return (
        <td className="py-3 pr-4">
          <div className="space-y-0.5">
            {phones.length > 0
              ? phones.map((p: string, i: number) => (
                  <a key={i} href={`tel:${p}`} onClick={e => e.stopPropagation()}
                    className="block text-[10px] font-semibold hover:underline" style={{ color: '#4CAF9A' }}>{p}</a>
                ))
              : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
          </div>
        </td>
      )
    },
  },

  // ─── Distress Info ───────────────────────────────────────────────────────
  {
    key: 'lead_type', label: 'Lead Type', headerLabel: 'Lead Type', category: 'distress', defaultOn: true,
    exportHeader: 'Lead Types',
    exportValue: (l) => getLeadTypeTags(l).map(t => t.label).join(', '),
    renderTd: (lead) => {
      const ltTags = getLeadTypeTags(lead)
      return (
        <td className="py-3 pr-4">
          <div className="flex flex-wrap gap-1">
            {ltTags.length > 0
              ? ltTags.map(t => (
                  <span key={t.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                    style={{ backgroundColor: `${t.color}20`, color: t.color }}>{t.label}</span>
                ))
              : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
          </div>
        </td>
      )
    },
  },
  {
    key: 'case_age', label: 'Case Age (days)', headerLabel: 'Age', category: 'distress', defaultOn: true,
    exportHeader: 'Case Age (days)',
    exportValue: (l) => { const d = daysSince(l.file_date); return d !== null ? String(d) : '' },
    renderTd: (lead) => {
      const days   = daysSince(lead.file_date)
      const ageClr = distressAgeColor(days)
      return (
        <td className="py-3 pr-4 text-center">
          {days !== null
            ? <div>
                <p className="text-xs font-bold" style={{ color: ageClr }}>{days}d</p>
                <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>
                  {lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                </p>
              </div>
            : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },
  {
    key: 'file_date', label: 'File Date', headerLabel: 'Filed', category: 'distress', defaultOn: false,
    exportHeader: 'File Date',
    exportValue: (l) => l.file_date || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
          {lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
        </p>
      </td>
    ),
  },
  {
    key: 'case_number', label: 'Case #', headerLabel: 'Case #', category: 'distress', defaultOn: false,
    exportHeader: 'Case #',
    exportValue: (l) => l.case_number || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] font-mono truncate max-w-[130px]" style={{ color: 'var(--c-text-2)' }}>{lead.case_number || '—'}</p>
      </td>
    ),
  },
  {
    key: 'plaintiff', label: 'Plaintiff / Attorney', headerLabel: 'Plaintiff', category: 'distress', defaultOn: false,
    exportHeader: 'Plaintiff',
    exportValue: (l) => l.plaintiff || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] truncate max-w-[150px]" style={{ color: 'var(--c-text-2)' }}>{lead.plaintiff || '—'}</p>
      </td>
    ),
  },
  {
    key: 'lien_amount', label: 'Lien / Foreclosure Amount', headerLabel: 'Lien $', category: 'distress', defaultOn: false,
    exportHeader: 'Lien Amount',
    exportValue: (l) => l.foreclosure_amount ? String(l.foreclosure_amount) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px] font-semibold" style={{ color: lead.foreclosure_amount ? '#ef4444' : 'var(--c-text-3)' }}>
          {lead.foreclosure_amount ? fmt$(lead.foreclosure_amount) : '—'}
        </p>
      </td>
    ),
  },
  {
    key: 'surplus_funds', label: 'Surplus Funds', headerLabel: 'Surplus $', category: 'distress', defaultOn: false,
    exportHeader: 'Surplus Funds',
    exportValue: (l) => l.surplus_funds_amount ? String(l.surplus_funds_amount) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        {lead.surplus_funds_amount
          ? <div>
              <p className="text-[11px] font-semibold" style={{ color: '#4CAF9A' }}>
                ${Number(lead.surplus_funds_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>owed to owner</p>
            </div>
          : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>
    ),
  },

  // ─── Mortgage Info ───────────────────────────────────────────────────────
  {
    key: 'lender', label: 'Lender', headerLabel: 'Lender', category: 'mortgage', defaultOn: false,
    exportHeader: 'Lender',
    exportValue: (l) => l.lender_name || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px] truncate max-w-[130px]" style={{ color: 'var(--c-text-2)' }}>{lead.lender_name || '—'}</p>
      </td>
    ),
  },
  {
    key: 'known_debt', label: 'Known Debt', headerLabel: 'Known Debt', category: 'mortgage', defaultOn: false,
    exportHeader: 'Known Debt',
    exportValue: (l) => l.known_debt ? String(l.known_debt) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>{lead.known_debt ? fmt$(lead.known_debt) : '—'}</p>
      </td>
    ),
  },
  {
    key: 'foreclosure_type', label: 'Foreclosure Type', headerLabel: 'FC Type', category: 'mortgage', defaultOn: false,
    exportHeader: 'Foreclosure Type',
    exportValue: (l) => l.foreclosure_type || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4">
        <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>{lead.foreclosure_type || '—'}</p>
      </td>
    ),
  },

  // ─── Value / Equity ──────────────────────────────────────────────────────
  {
    key: 'equity', label: 'Equity (tier + %)', headerLabel: 'Equity', category: 'value', defaultOn: true,
    exportHeader: 'Equity Tier',
    exportValue: (l) => [l.equity_tier, l.equity_percentage != null && `${Number(l.equity_percentage).toFixed(0)}%`].filter(Boolean).join(' '),
    renderTd: (lead) => {
      const eClr = EQUITY_COLORS[lead.equity_tier as string] ?? '#9ca3af'
      return (
        <td className="py-3 pr-4 text-right">
          {lead.equity_tier
            ? <div>
                <p className="text-xs font-bold" style={{ color: eClr }}>{lead.equity_tier}</p>
                {lead.equity_percentage != null && (
                  <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{Number(lead.equity_percentage).toFixed(0)}%</p>
                )}
              </div>
            : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },
  {
    key: 'market_value', label: 'Market Value', headerLabel: 'Value', category: 'value', defaultOn: true,
    exportHeader: 'Market Value',
    exportValue: (l) => l.market_value || l.assessed_value ? String(l.market_value || l.assessed_value) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-xs font-semibold" style={{ color: 'var(--c-primary)' }}>{fmt$(lead.market_value || lead.assessed_value)}</p>
        {(lead.foreclosure_amount || lead.lien_amount) && (
          <p className="text-[10px]" style={{ color: '#ef4444' }}>{fmt$(lead.foreclosure_amount || lead.lien_amount)} lien</p>
        )}
      </td>
    ),
  },
  {
    key: 'assessed_value', label: 'Assessed Value', headerLabel: 'Assessed', category: 'value', defaultOn: false,
    exportHeader: 'Assessed Value',
    exportValue: (l) => l.assessed_value ? String(l.assessed_value) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>{lead.assessed_value ? fmt$(lead.assessed_value) : '—'}</p>
      </td>
    ),
  },
  {
    key: 'equity_dollar', label: 'Equity Amount ($)', headerLabel: 'Equity $', category: 'value', defaultOn: false,
    exportHeader: 'Equity Amount',
    exportValue: (l) => l.equity_dollar_amount ? String(l.equity_dollar_amount) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px] font-semibold" style={{ color: lead.equity_dollar_amount ? '#4CAF9A' : 'var(--c-text-3)' }}>
          {lead.equity_dollar_amount ? fmt$(lead.equity_dollar_amount) : '—'}
        </p>
      </td>
    ),
  },
  {
    key: 'equity_pct', label: 'Equity %', headerLabel: 'Equity %', category: 'value', defaultOn: false,
    exportHeader: 'Equity %',
    exportValue: (l) => l.equity_percentage != null ? `${Number(l.equity_percentage).toFixed(1)}%` : '',
    renderTd: (lead) => {
      const eClr = EQUITY_COLORS[lead.equity_tier as string] ?? '#9ca3af'
      return (
        <td className="py-3 pr-4 text-right">
          <p className="text-[11px] font-bold" style={{ color: lead.equity_percentage != null ? eClr : 'var(--c-text-3)' }}>
            {lead.equity_percentage != null ? `${Number(lead.equity_percentage).toFixed(0)}%` : '—'}
          </p>
        </td>
      )
    },
  },
  {
    key: 'suggested_rent', label: 'Estimated Rent', headerLabel: 'Est. Rent', category: 'value', defaultOn: false,
    exportHeader: 'Est. Rent/mo',
    exportValue: (l) => l.suggested_rent ? String(l.suggested_rent) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px] font-semibold" style={{ color: '#6ABDE0' }}>
          {lead.suggested_rent ? `${fmt$(lead.suggested_rent)}/mo` : '—'}
        </p>
      </td>
    ),
  },

  // ─── Notes ───────────────────────────────────────────────────────────────
  {
    key: 'notes', label: 'Notes (quick note)', headerLabel: 'Notes', category: 'pipeline', defaultOn: false,
    exportHeader: 'Notes',
    exportValue: (l) => l.lead_notes || '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 max-w-[200px]">
        {lead.lead_notes
          ? <p className="text-[11px] truncate" style={{ color: 'var(--c-text-2)' }} title={lead.lead_notes}>{lead.lead_notes}</p>
          : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
      </td>
    ),
  },

  // ─── Marketing Info ──────────────────────────────────────────────────────
  {
    key: 'source', label: 'Data Source', headerLabel: 'Source', category: 'marketing', defaultOn: false,
    exportHeader: 'Data Source',
    exportValue: (l) => l.data_source || l.source || '',
    renderTd: (lead) => {
      const srcBadge = getSourceBadge(lead)
      return (
        <td className="py-3 pr-4">
          {srcBadge
            ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: `${srcBadge.color}18`, color: srcBadge.color }}>{srcBadge.label}</span>
            : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },

  // ─── Date Added ─────────────────────────────────────────────────────────
  {
    key: 'date_added', label: 'Date Added', headerLabel: 'Added', category: 'pipeline', defaultOn: false,
    exportHeader: 'Date Added',
    exportValue: (l) => l.lead_added_at ? new Date(l.lead_added_at).toLocaleDateString('en-US') : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
          {lead.lead_added_at
            ? new Date(lead.lead_added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
            : '—'}
        </p>
      </td>
    ),
  },

  // ─── Offer columns ──────────────────────────────────────────────────────
  {
    key: 'listing_price', label: 'Listing Price', headerLabel: 'List Price', category: 'value', defaultOn: false,
    exportHeader: 'Listing Price',
    exportValue: (l) => l.listing_price ? String(l.listing_price) : '',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-right">
        <p className="text-[11px] font-semibold" style={{ color: lead.listing_price ? 'var(--c-primary)' : 'var(--c-text-3)' }}>
          {lead.listing_price ? fmt$(lead.listing_price) : '—'}
        </p>
      </td>
    ),
  },
  {
    key: 'offer_pct', label: 'Offer %', headerLabel: 'Offer %', category: 'value', defaultOn: false,
    exportHeader: 'Offer %',
    exportValue: (l) => l.offer_pct != null ? `${l.offer_pct}%` : '',
    renderTd: (lead, ctx) => {
      const pct = ctx.offerPctOverride?.[lead.id] ?? lead.offer_pct ?? null
      const mv  = Number(lead.market_value || lead.assessed_value || 0)
      const amt = pct && mv ? Math.round(mv * pct / 100) : null
      const options = [50, 55, 60, 65, 70]
      return (
        <td className="py-3 pr-3 text-center" onClick={e => e.stopPropagation()}>
          <select
            value={pct ?? ''}
            onChange={e => {
              const v = e.target.value ? Number(e.target.value) : null
              ctx.onFieldChange?.(lead.id, 'offer_pct', v)
            }}
            className="text-[11px] font-bold rounded-lg px-2 py-1 focus:outline-none cursor-pointer"
            style={{
              backgroundColor: pct ? 'rgba(201,168,76,0.12)' : 'var(--c-hover)',
              color: pct ? '#C9A84C' : 'var(--c-text-3)',
              border: `1px solid ${pct ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
            }}
          >
            <option value="">—%</option>
            {options.map(o => <option key={o} value={o}>{o}%</option>)}
          </select>
          {amt && (
            <p className="text-[9px] font-semibold mt-0.5" style={{ color: '#C9A84C' }}>
              {fmt$(amt)}
            </p>
          )}
        </td>
      )
    },
  },
  {
    key: 'offer_amount', label: 'Offer Amount', headerLabel: 'Offer $', category: 'value', defaultOn: false,
    exportHeader: 'Offer Amount',
    exportValue: (l) => l.offer_amount ? String(l.offer_amount) : '',
    renderTd: (lead, ctx) => {
      const pct  = ctx.offerPctOverride?.[lead.id] ?? lead.offer_pct ?? null
      const mv   = Number(lead.market_value || lead.assessed_value || 0)
      const calc = pct && mv ? Math.round(mv * pct / 100) : null
      const saved = lead.offer_amount ? Number(lead.offer_amount) : null
      const amt  = calc ?? saved
      return (
        <td className="py-3 pr-4 text-right">
          {amt
            ? <div>
                <p className="text-xs font-bold" style={{ color: '#C9A84C' }}>{fmt$(amt)}</p>
                {pct && <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>{pct}% of MV</p>}
              </div>
            : <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>—</span>}
        </td>
      )
    },
  },
  {
    key: 'offer_sent', label: 'Offer Sent', headerLabel: 'Offer', category: 'value', defaultOn: false,
    exportHeader: 'Offer Sent',
    exportValue: (l) => l.offer_sent ? 'Yes' : 'No',
    renderTd: (lead) => (
      <td className="py-3 pr-4 text-center">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: lead.offer_sent ? 'rgba(74,207,154,0.15)' : 'var(--c-hover)',
            color: lead.offer_sent ? '#4CAF9A' : 'var(--c-text-3)',
          }}>
          {lead.offer_sent ? 'Sent' : '—'}
        </span>
      </td>
    ),
  },

  // ─── Communication Status ───────────────────────────────────────────────
  {
    key: 'call_status', label: 'Call Status', headerLabel: 'Called', category: 'contact', defaultOn: false,
    exportHeader: 'Call Status',
    exportValue: (l) => l.call_status || '',
    renderTd: (lead, ctx) => {
      const st = lead.call_status || 'not_called'
      const cfg: Record<string, { label: string; color: string }> = {
        not_called:   { label: 'Not Called',    color: '#9ca3af' },
        called:       { label: 'Called',        color: '#6ABDE0' },
        no_answer:    { label: 'No Answer',     color: '#f59e0b' },
        voicemail:    { label: 'Voicemail',     color: '#C9A84C' },
        wrong_number: { label: 'Wrong #',       color: '#ef4444' },
        talked:       { label: 'Talked',        color: '#4CAF9A' },
      }
      const cur = cfg[st] ?? cfg.not_called
      return (
        <td className="py-3 pr-3 text-center" onClick={e => e.stopPropagation()}>
          <select
            value={st}
            onChange={e => ctx.onFieldChange?.(lead.id, 'call_status', e.target.value)}
            className="text-[10px] font-bold rounded-full px-2 py-0.5 focus:outline-none cursor-pointer"
            style={{ backgroundColor: `${cur.color}18`, color: cur.color, border: `1px solid ${cur.color}40` }}
          >
            {Object.entries(cfg).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
        </td>
      )
    },
  },
  {
    key: 'sms_status', label: 'SMS Status', headerLabel: 'SMS', category: 'contact', defaultOn: false,
    exportHeader: 'SMS Status',
    exportValue: (l) => l.sms_status || '',
    renderTd: (lead, ctx) => {
      const st = lead.sms_status || 'not_sent'
      const cfg: Record<string, { label: string; color: string }> = {
        not_sent:  { label: 'Not Sent',  color: '#9ca3af' },
        sent:      { label: 'Sent',      color: '#6ABDE0' },
        delivered: { label: 'Delivered', color: '#a78bfa' },
        replied:   { label: 'Replied',   color: '#4CAF9A' },
        opted_out: { label: 'Opted Out', color: '#ef4444' },
      }
      const cur = cfg[st] ?? cfg.not_sent
      return (
        <td className="py-3 pr-3 text-center" onClick={e => e.stopPropagation()}>
          <select
            value={st}
            onChange={e => ctx.onFieldChange?.(lead.id, 'sms_status', e.target.value)}
            className="text-[10px] font-bold rounded-full px-2 py-0.5 focus:outline-none cursor-pointer"
            style={{ backgroundColor: `${cur.color}18`, color: cur.color, border: `1px solid ${cur.color}40` }}
          >
            {Object.entries(cfg).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
        </td>
      )
    },
  },
  {
    key: 'email_status', label: 'Email Status', headerLabel: 'Email', category: 'contact', defaultOn: false,
    exportHeader: 'Email Status',
    exportValue: (l) => l.email_status || '',
    renderTd: (lead, ctx) => {
      const st = lead.email_status || 'not_sent'
      const cfg: Record<string, { label: string; color: string }> = {
        not_sent: { label: 'Not Sent', color: '#9ca3af' },
        sent:     { label: 'Sent',     color: '#6ABDE0' },
        opened:   { label: 'Opened',   color: '#a78bfa' },
        replied:  { label: 'Replied',  color: '#4CAF9A' },
        bounced:  { label: 'Bounced',  color: '#ef4444' },
      }
      const cur = cfg[st] ?? cfg.not_sent
      return (
        <td className="py-3 pr-3 text-center" onClick={e => e.stopPropagation()}>
          <select
            value={st}
            onChange={e => ctx.onFieldChange?.(lead.id, 'email_status', e.target.value)}
            className="text-[10px] font-bold rounded-full px-2 py-0.5 focus:outline-none cursor-pointer"
            style={{ backgroundColor: `${cur.color}18`, color: cur.color, border: `1px solid ${cur.color}40` }}
          >
            {Object.entries(cfg).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
        </td>
      )
    },
  },
]

export const COLUMN_DEFS: Record<string, ColumnDef> = Object.fromEntries(
  ALL_COLUMN_DEFS.map(c => [c.key, c])
)

export const DEFAULT_COLUMNS: string[] = ALL_COLUMN_DEFS
  .filter(c => c.defaultOn)
  .map(c => c.key)
