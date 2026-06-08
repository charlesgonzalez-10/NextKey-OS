'use client'

import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CriteriaState {
  search?: string

  // Lead Type multi-select (OR logic within group)
  lead_types?: string[]

  // Location
  county?: string
  city?: string
  zip?: string
  subdivision?: string

  // Property
  property_type?: string
  beds_min?: string
  baths_min?: string
  sqft_min?: string
  sqft_max?: string
  year_min?: string
  year_max?: string
  pool?: boolean

  // Ownership
  homestead?: string       // 'true' | 'false' | ''
  entity_type?: string
  out_of_state?: boolean

  // Distress
  file_from?: string
  file_to?: string
  days_min?: string
  days_max?: string
  plaintiff?: string
  multiple_liens?: boolean

  // Financial
  equity?: string          // 'High' | 'Medium' | 'Low'
  equity_min?: string
  equity_max?: string
  equity_amount_min?: string
  equity_amount_max?: string
  value_min?: string
  value_max?: string
  free_clear?: boolean

  // Operations
  has_phone?: boolean
  starred?: boolean
  in_pipeline?: boolean
  is_lead?: boolean
  pipeline_stage?: string
  ai_score_min?: string
}

// ─── Criteria serialization ───────────────────────────────────────────────────

export function criteriaToParams(c: CriteriaState, extra?: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams()
  if (c.search)              p.set('search', c.search)
  if (c.lead_types?.length)  p.set('lead_types', c.lead_types.join(','))
  if (c.county)              p.set('county', c.county)
  if (c.city)                p.set('city', c.city)
  if (c.zip)                 p.set('zip', c.zip)
  if (c.subdivision)         p.set('subdivision', c.subdivision)
  if (c.property_type)       p.set('property_type', c.property_type)
  if (c.beds_min)            p.set('beds_min', c.beds_min)
  if (c.baths_min)           p.set('baths_min', c.baths_min)
  if (c.sqft_min)            p.set('sqft_min', c.sqft_min)
  if (c.sqft_max)            p.set('sqft_max', c.sqft_max)
  if (c.year_min)            p.set('year_min', c.year_min)
  if (c.year_max)            p.set('year_max', c.year_max)
  if (c.pool)                p.set('pool', 'true')
  if (c.homestead)           p.set('homestead', c.homestead)
  if (c.entity_type)         p.set('entity_type', c.entity_type)
  if (c.out_of_state)        p.set('out_of_state', 'true')
  if (c.file_from)           p.set('file_from', c.file_from)
  if (c.file_to)             p.set('file_to', c.file_to)
  if (c.days_min)            p.set('days_min', c.days_min)
  if (c.days_max)            p.set('days_max', c.days_max)
  if (c.plaintiff)           p.set('plaintiff', c.plaintiff)
  if (c.multiple_liens)      p.set('multiple_liens', 'true')
  if (c.equity)              p.set('equity', c.equity)
  if (c.equity_min)          p.set('equity_min', c.equity_min)
  if (c.equity_max)          p.set('equity_max', c.equity_max)
  if (c.equity_amount_min)   p.set('equity_amount_min', c.equity_amount_min)
  if (c.equity_amount_max)   p.set('equity_amount_max', c.equity_amount_max)
  if (c.value_min)           p.set('value_min', c.value_min)
  if (c.value_max)           p.set('value_max', c.value_max)
  if (c.free_clear)          p.set('free_clear', 'true')
  if (c.has_phone)           p.set('has_phone', 'true')
  if (c.starred)             p.set('starred', 'true')
  if (c.in_pipeline)         p.set('in_pipeline', 'true')
  if (c.is_lead === true)    p.set('is_lead', 'true')
  if (c.is_lead === false)   p.set('is_lead', 'false')
  if (c.pipeline_stage)      p.set('pipeline_stage', c.pipeline_stage)
  if (c.ai_score_min)        p.set('ai_score_min', c.ai_score_min)
  if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v))
  return p
}

export function activeCriteriaCount(c: CriteriaState): number {
  let n = c.lead_types?.length || 0
  const bools = [c.pool, c.out_of_state, c.multiple_liens, c.free_clear, c.has_phone, c.starred, c.in_pipeline, c.is_lead]
  n += bools.filter(Boolean).length
  const strings = [c.county, c.city, c.zip, c.subdivision, c.property_type, c.beds_min, c.baths_min,
    c.homestead, c.entity_type, c.file_from, c.file_to, c.days_min, c.days_max, c.plaintiff,
    c.equity, c.equity_min, c.equity_max, c.equity_amount_min, c.equity_amount_max,
    c.value_min, c.value_max, c.pipeline_stage, c.ai_score_min,
    c.sqft_min || c.sqft_max, c.year_min || c.year_max]
  n += strings.filter(Boolean).length
  return n
}

// ─── Lead type definitions ────────────────────────────────────────────────────

interface LeadTypeDef {
  key: string
  label: string
  color: string
  group: 'distress' | 'occupancy' | 'equity' | 'entity' | 'soon'
  comingSoon?: boolean
}

const LEAD_TYPES: LeadTypeDef[] = [
  // DISTRESS
  { key: 'pre_foreclosure', label: 'Pre-Foreclosure',     color: '#f59e0b', group: 'distress' },
  { key: 'auction',         label: 'Foreclosure Auction', color: '#ef4444', group: 'distress' },
  { key: 'multiple_liens',  label: 'Multiple Liens',      color: '#E07B6A', group: 'distress' },
  // OCCUPANCY
  { key: 'absentee',        label: 'Absentee Owner',      color: '#C9A84C', group: 'occupancy' },
  { key: 'vacant',          label: 'Vacant',              color: '#6ABDE0', group: 'occupancy' },
  { key: 'owner_occupied',  label: 'Owner Occupied',      color: '#4CAF9A', group: 'occupancy' },
  // EQUITY
  { key: 'high_equity',     label: 'High Equity 50%+',    color: '#4CAF9A', group: 'equity' },
  { key: 'medium_equity',   label: 'Medium Equity',       color: '#7B8FD4', group: 'equity' },
  { key: 'low_equity',      label: 'Low Equity',          color: '#E07B6A', group: 'equity' },
  { key: 'free_clear',      label: 'Free & Clear',        color: '#4CAF9A', group: 'equity' },
  // ENTITY TYPE
  { key: 'llc_corp',        label: 'LLC / Corp',          color: '#a78bfa', group: 'entity' },
  { key: 'trust',           label: 'Trust / Estate',      color: '#a78bfa', group: 'entity' },
  { key: 'individual',      label: 'Individual Owner',    color: '#9ca3af', group: 'entity' },
  // COMING SOON
  { key: 'probate',         label: 'Probate',             color: '#a78bfa', group: 'soon', comingSoon: true },
  { key: 'reverse_mortgage',label: 'Reverse Mortgage',    color: '#f59e0b', group: 'soon', comingSoon: true },
  { key: 'tax_delinquent',  label: 'Tax Delinquent',      color: '#f97316', group: 'soon', comingSoon: true },
  { key: 'code_violations', label: 'Code Violations',     color: '#ef4444', group: 'soon', comingSoon: true },
  { key: 'hoa_lien',        label: 'HOA Lien',            color: '#E07B6A', group: 'soon', comingSoon: true },
  { key: 'bankruptcy',      label: 'Bankruptcy',          color: '#9ca3af', group: 'soon', comingSoon: true },
  { key: 'divorce',         label: 'Divorce',             color: '#9ca3af', group: 'soon', comingSoon: true },
  { key: 'tired_landlord',  label: 'Tired Landlord',      color: '#C9A84C', group: 'soon', comingSoon: true },
  { key: 'mls_active',      label: 'MLS Active / For Sale', color: '#6ABDE0', group: 'soon', comingSoon: true },
  { key: 'expired_listing', label: 'Expired Listing',     color: '#9ca3af', group: 'soon', comingSoon: true },
  { key: 'fsbo',            label: 'FSBO',                color: '#9ca3af', group: 'soon', comingSoon: true },
  { key: 'investor_owned',  label: 'Investor Owned',      color: '#C9A84C', group: 'soon', comingSoon: true },
]

const LEAD_TYPE_GROUPS: { key: LeadTypeDef['group']; label: string }[] = [
  { key: 'distress',  label: 'Distress' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'equity',    label: 'Equity' },
  { key: 'entity',    label: 'Ownership Type' },
  { key: 'soon',      label: 'Coming Soon' },
]

// ─── Section config ───────────────────────────────────────────────────────────

const SECTIONS = [
  { key: 'lead_type',  label: 'Lead Type',     defaultOpen: true },
  { key: 'location',   label: 'Location',      defaultOpen: false },
  { key: 'property',   label: 'Property',      defaultOpen: false },
  { key: 'ownership',  label: 'Ownership',     defaultOpen: false },
  { key: 'distress',   label: 'Distress',      defaultOpen: false },
  { key: 'financial',  label: 'Financial',     defaultOpen: false },
  { key: 'market',     label: 'Market Status', defaultOpen: false },
  { key: 'operations', label: 'Operations',    defaultOpen: false },
]

function sectionCount(c: CriteriaState, key: string): number {
  switch (key) {
    case 'lead_type':  return c.lead_types?.length || 0
    case 'location':   return [c.county, c.city, c.zip, c.subdivision].filter(Boolean).length
    case 'property':   return [c.property_type, c.beds_min, c.baths_min, (c.sqft_min || c.sqft_max), (c.year_min || c.year_max), c.pool].filter(Boolean).length
    case 'ownership':  return [c.homestead, c.entity_type, c.out_of_state].filter(Boolean).length
    case 'distress':   return [(c.file_from || c.file_to), (c.days_min || c.days_max), c.plaintiff, c.multiple_liens].filter(Boolean).length
    case 'financial':  return [c.equity, (c.equity_min || c.equity_max), (c.equity_amount_min || c.equity_amount_max), (c.value_min || c.value_max), c.free_clear].filter(Boolean).length
    case 'market':     return 0
    case 'operations': return [c.has_phone, c.starred, c.in_pipeline, c.is_lead !== undefined ? true : null, c.pipeline_stage, c.ai_score_min].filter(Boolean).length
    default:           return 0
  }
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const INP = "text-xs rounded-lg px-2.5 py-1.5 w-full focus:outline-none"
const STY = { backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' } as const
const LABEL = "text-[10px] font-semibold uppercase tracking-wider mb-1 block"

// ─── Section component ────────────────────────────────────────────────────────

function Section({ sectionKey, label, count, open, onToggle, children }: {
  sectionKey: string
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--c-border)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:opacity-80 transition-opacity"
        style={{ backgroundColor: 'var(--c-card-alt)' }}
      >
        <div className="flex items-center gap-2">
          <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--c-primary)' }}>
            {label}
          </span>
          {count > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              {count}
            </span>
          )}
        </div>
        {sectionKey === 'market' && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>
            Coming soon
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 py-3" style={{ backgroundColor: 'var(--c-card)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function PropertySearchPanel({
  criteria,
  onChange,
  onRun,
  onClear,
}: {
  criteria: CriteriaState
  onChange: (c: CriteriaState) => void
  onRun: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map(s => [s.key, s.defaultOpen]))
  )

  const toggle = (key: string) => setOpen(prev => ({ ...prev, [key]: !prev[key] }))
  const set = (k: keyof CriteriaState, v: string | boolean | string[] | undefined) =>
    onChange({ ...criteria, [k]: v || undefined })

  const toggleLeadType = (key: string) => {
    const cur = criteria.lead_types || []
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]
    onChange({ ...criteria, lead_types: next.length ? next : undefined })
  }
  const isLT = (key: string) => (criteria.lead_types || []).includes(key)

  const totalCount = activeCriteriaCount(criteria)

  return (
    <div style={{ backgroundColor: 'var(--c-card)' }}>

      {/* ── Panel header ── */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ backgroundColor: '#0A1F44', borderBottom: '2px solid rgba(201,168,76,0.3)' }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#C9A84C' }}>
            Acquisition Criteria
          </span>
          {totalCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalCount > 0 && (
            <button onClick={onClear}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.15)' }}>
              Clear all
            </button>
          )}
          <button onClick={onRun}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
            Search →
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* LEAD TYPE                                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="lead_type"
        label="Lead Type"
        count={sectionCount(criteria, 'lead_type')}
        open={open.lead_type}
        onToggle={() => toggle('lead_type')}
      >
        <div className="space-y-3">
          {LEAD_TYPE_GROUPS.map(group => {
            const types = LEAD_TYPES.filter(t => t.group === group.key)
            return (
              <div key={group.key}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5"
                  style={{ color: group.key === 'soon' ? 'var(--c-text-3)' : 'var(--c-text-3)' }}>
                  {group.label}
                  {group.key === 'soon' && (
                    <span className="ml-2 normal-case font-normal">— requires import</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {types.map(t => {
                    const active = isLT(t.key)
                    return (
                      <button
                        key={t.key}
                        type="button"
                        disabled={t.comingSoon}
                        onClick={() => !t.comingSoon && toggleLeadType(t.key)}
                        title={t.comingSoon ? 'Requires import — not available yet' : undefined}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all ${t.comingSoon ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'}`}
                        style={active ? {
                          backgroundColor: t.color,
                          color: '#fff',
                          border: `1px solid ${t.color}`,
                        } : {
                          backgroundColor: `${t.color}18`,
                          color: t.comingSoon ? '#6b7280' : t.color,
                          border: `1px solid ${t.comingSoon ? 'transparent' : t.color + '50'}`,
                        }}
                      >
                        {active && '✓ '}{t.label}
                        {t.comingSoon && <span className="ml-1 text-[9px] opacity-70">⊘</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Active lead types summary */}
        {(criteria.lead_types?.length || 0) > 0 && (
          <div className="mt-3 pt-3 flex items-center gap-2 flex-wrap"
            style={{ borderTop: '1px solid var(--c-border)' }}>
            <span className="text-[10px] font-bold" style={{ color: '#C9A84C' }}>
              OR logic:
            </span>
            <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
              Showing properties matching ANY selected type
            </span>
          </div>
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* LOCATION                                                          */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="location"
        label="Location"
        count={sectionCount(criteria, 'location')}
        open={open.location}
        onToggle={() => toggle('location')}
      >
        <div className="space-y-2.5">
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>County</label>
            <div className="flex gap-1.5">
              {[
                { v: '',            l: 'All' },
                { v: 'miami-dade',  l: 'Miami-Dade' },
                { v: 'broward',     l: 'Broward' },
                { v: 'palm-beach',  l: 'Palm Beach' },
              ].map(o => (
                <button key={o.v} type="button"
                  onClick={() => set('county', o.v)}
                  className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-all"
                  style={{
                    backgroundColor: criteria.county === o.v || (!criteria.county && o.v === '') ? '#C9A84C' : 'var(--c-hover)',
                    color: criteria.county === o.v || (!criteria.county && o.v === '') ? '#0A1F44' : 'var(--c-text-2)',
                    border: '1px solid var(--c-border)',
                  }}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>City</label>
              <input value={criteria.city ?? ''} onChange={e => set('city', e.target.value)}
                placeholder="e.g. Miramar" className={INP} style={STY} />
            </div>
            <div>
              <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>ZIP Code</label>
              <input value={criteria.zip ?? ''} onChange={e => set('zip', e.target.value)}
                placeholder="e.g. 33027" className={INP} style={STY} />
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Subdivision</label>
            <input value={criteria.subdivision ?? ''} onChange={e => set('subdivision', e.target.value)}
              placeholder="e.g. Pembroke Isles" className={INP} style={STY} />
          </div>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* PROPERTY                                                          */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="property"
        label="Property"
        count={sectionCount(criteria, 'property')}
        open={open.property}
        onToggle={() => toggle('property')}
      >
        <div className="space-y-2.5">
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Property Type</label>
            <select value={criteria.property_type ?? ''} onChange={e => set('property_type', e.target.value)}
              className={INP} style={STY}>
              <option value="">All Types</option>
              <option value="Single Family">Single Family</option>
              <option value="Condo">Condo / Townhouse</option>
              <option value="Multi-Family">Multi-Family</option>
              <option value="Land">Land / Lot</option>
              <option value="Commercial">Commercial</option>
              <option value="Mobile">Mobile Home</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Beds min</label>
              <input value={criteria.beds_min ?? ''} onChange={e => set('beds_min', e.target.value)}
                type="number" min="0" placeholder="e.g. 2" className={INP} style={STY} />
            </div>
            <div>
              <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Baths min</label>
              <input value={criteria.baths_min ?? ''} onChange={e => set('baths_min', e.target.value)}
                type="number" min="0" step="0.5" placeholder="e.g. 1" className={INP} style={STY} />
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Living Area (sqft)</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.sqft_min ?? ''} onChange={e => set('sqft_min', e.target.value)}
                type="number" placeholder="Min sqft" className={INP} style={STY} />
              <input value={criteria.sqft_max ?? ''} onChange={e => set('sqft_max', e.target.value)}
                type="number" placeholder="Max sqft" className={INP} style={STY} />
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Year Built</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.year_min ?? ''} onChange={e => set('year_min', e.target.value)}
                type="number" placeholder="From year" className={INP} style={STY} />
              <input value={criteria.year_max ?? ''} onChange={e => set('year_max', e.target.value)}
                type="number" placeholder="To year" className={INP} style={STY} />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input type="checkbox" checked={!!criteria.pool}
              onChange={e => set('pool', e.target.checked || undefined)}
              className="rounded" style={{ accentColor: '#C9A84C' }} />
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>Has Pool</span>
          </label>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* OWNERSHIP                                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="ownership"
        label="Ownership"
        count={sectionCount(criteria, 'ownership')}
        open={open.ownership}
        onToggle={() => toggle('ownership')}
      >
        <div className="space-y-2.5">
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Occupancy</label>
            <div className="flex gap-1.5">
              {[
                { v: '',      l: 'All' },
                { v: 'false', l: 'Absentee' },
                { v: 'true',  l: 'Owner Occupied' },
              ].map(o => (
                <button key={o.v} type="button"
                  onClick={() => set('homestead', o.v)}
                  className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-all"
                  style={{
                    backgroundColor: (criteria.homestead ?? '') === o.v ? '#C9A84C' : 'var(--c-hover)',
                    color: (criteria.homestead ?? '') === o.v ? '#0A1F44' : 'var(--c-text-2)',
                    border: '1px solid var(--c-border)',
                  }}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Entity Type</label>
            <select value={criteria.entity_type ?? ''} onChange={e => set('entity_type', e.target.value)}
              className={INP} style={STY}>
              <option value="">All Entities</option>
              <option value="Individual">Individual</option>
              <option value="LLC">LLC</option>
              <option value="Corporation">Corporation</option>
              <option value="Trust">Trust / Estate</option>
              <option value="Partnership">Partnership</option>
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!criteria.out_of_state}
              onChange={e => set('out_of_state', e.target.checked || undefined)}
              className="rounded" style={{ accentColor: '#C9A84C' }} />
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>Out-of-State Owner</span>
          </label>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DISTRESS                                                          */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="distress"
        label="Distress Details"
        count={sectionCount(criteria, 'distress')}
        open={open.distress}
        onToggle={() => toggle('distress')}
      >
        <div className="space-y-2.5">
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Filing Date Range</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.file_from ?? ''} onChange={e => set('file_from', e.target.value)}
                type="date" className={INP} style={STY} />
              <input value={criteria.file_to ?? ''} onChange={e => set('file_to', e.target.value)}
                type="date" className={INP} style={STY} />
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Days Since Filing</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.days_min ?? ''} onChange={e => set('days_min', e.target.value)}
                type="number" placeholder="Min days" className={INP} style={STY} />
              <input value={criteria.days_max ?? ''} onChange={e => set('days_max', e.target.value)}
                type="number" placeholder="Max days" className={INP} style={STY} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--c-text-3)' }}>
              e.g. Filed in last 45 days → Max: 45
            </p>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Plaintiff / Lender</label>
            <input value={criteria.plaintiff ?? ''} onChange={e => set('plaintiff', e.target.value)}
              placeholder="e.g. Wells Fargo, Bank of America" className={INP} style={STY} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!criteria.multiple_liens}
              onChange={e => set('multiple_liens', e.target.checked || undefined)}
              className="rounded" style={{ accentColor: '#C9A84C' }} />
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>Multiple Liens Only</span>
          </label>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* FINANCIAL                                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="financial"
        label="Financial"
        count={sectionCount(criteria, 'financial')}
        open={open.financial}
        onToggle={() => toggle('financial')}
      >
        <div className="space-y-2.5">
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Estimated Value ($)</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.value_min ?? ''} onChange={e => set('value_min', e.target.value)}
                type="number" placeholder="Min" className={INP} style={STY} />
              <input value={criteria.value_max ?? ''} onChange={e => set('value_max', e.target.value)}
                type="number" placeholder="Max" className={INP} style={STY} />
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Equity Tier</label>
            <div className="flex gap-1.5">
              {[
                { v: '',       l: 'All' },
                { v: 'High',   l: 'High 50%+' },
                { v: 'Medium', l: 'Medium' },
                { v: 'Low',    l: 'Low' },
              ].map(o => (
                <button key={o.v} type="button"
                  onClick={() => set('equity', o.v)}
                  className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-all"
                  style={{
                    backgroundColor: (criteria.equity ?? '') === o.v ? '#C9A84C' : 'var(--c-hover)',
                    color: (criteria.equity ?? '') === o.v ? '#0A1F44' : 'var(--c-text-2)',
                    border: '1px solid var(--c-border)',
                  }}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Equity % Range</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.equity_min ?? ''} onChange={e => set('equity_min', e.target.value)}
                type="number" placeholder="Min %" className={INP} style={STY} />
              <input value={criteria.equity_max ?? ''} onChange={e => set('equity_max', e.target.value)}
                type="number" placeholder="Max %" className={INP} style={STY} />
            </div>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Equity Amount ($)</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={criteria.equity_amount_min ?? ''} onChange={e => set('equity_amount_min', e.target.value)}
                type="number" placeholder="Min $" className={INP} style={STY} />
              <input value={criteria.equity_amount_max ?? ''} onChange={e => set('equity_amount_max', e.target.value)}
                type="number" placeholder="Max $" className={INP} style={STY} />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!criteria.free_clear}
              onChange={e => set('free_clear', e.target.checked || undefined)}
              className="rounded" style={{ accentColor: '#C9A84C' }} />
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>Free & Clear (No Mortgage)</span>
          </label>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* MARKET STATUS                                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="market"
        label="Market Status"
        count={0}
        open={open.market}
        onToggle={() => toggle('market')}
      >
        <div className="text-center py-4" style={{ color: 'var(--c-text-3)' }}>
          <p className="text-2xl mb-2">📊</p>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>
            MLS Data — Coming Soon
          </p>
          <p className="text-[11px]">
            For sale status, days on market, list price, price reductions, and MLS history will be available after MLS integration.
          </p>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* OPERATIONS                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <Section
        sectionKey="operations"
        label="Operations"
        count={sectionCount(criteria, 'operations')}
        open={open.operations}
        onToggle={() => toggle('operations')}
      >
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!criteria.has_phone}
                onChange={e => set('has_phone', e.target.checked || undefined)}
                className="rounded" style={{ accentColor: '#C9A84C' }} />
              <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>Has Phone #</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!criteria.starred}
                onChange={e => set('starred', e.target.checked || undefined)}
                className="rounded" style={{ accentColor: '#C9A84C' }} />
              <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>Starred Only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={criteria.is_lead === true}
                onChange={e => onChange({ ...criteria, is_lead: e.target.checked ? true : undefined })}
                className="rounded" style={{ accentColor: '#C9A84C' }} />
              <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>In Leads</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!criteria.in_pipeline}
                onChange={e => set('in_pipeline', e.target.checked || undefined)}
                className="rounded" style={{ accentColor: '#C9A84C' }} />
              <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>In Pipeline</span>
            </label>
          </div>
          <div className="pt-1">
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Pipeline Stage</label>
            <select value={criteria.pipeline_stage ?? ''} onChange={e => set('pipeline_stage', e.target.value)}
              className={INP} style={STY}>
              <option value="">Any Stage</option>
              <option value="unassigned">Unassigned</option>
              <option value="reviewing">Reviewing</option>
              <option value="contacted">Contacted</option>
              <option value="offer">Offer Made</option>
              <option value="dead">Dead</option>
            </select>
          </div>
          <div>
            <label className={LABEL} style={{ color: 'var(--c-text-3)' }}>Min AI Score</label>
            <input value={criteria.ai_score_min ?? ''} onChange={e => set('ai_score_min', e.target.value)}
              type="number" min="1" max="10" placeholder="e.g. 7" className={INP} style={STY} />
          </div>
        </div>
      </Section>

    </div>
  )
}
