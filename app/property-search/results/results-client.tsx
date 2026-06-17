'use client'

/**
 * Property Search — Step 2: Results
 *
 * This page shows everything that matched the criteria built on Step 1.
 * The table dominates the screen. Criteria chips at the top remind the investor
 * what they searched for and allow quick modifications.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
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
  if (params.get('zone'))                    add('zone',        'Zone Filter Active')
  return chips
}

// ─── Property Detail Drawer ───────────────────────────────────────────────────

type DrawerTab = 'overview' | 'case' | 'comps'

function DRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-xs shrink-0 w-32 pt-0.5" style={{ color: 'var(--c-text-2)' }}>{label}</span>
      <span className="text-sm font-medium text-right" style={{ color: 'var(--c-primary)' }}>{value}</span>
    </div>
  )
}

function DrawerCaseNumberRow({
  propertyId,
  initialValue,
  onSaved,
}: {
  propertyId: string | null
  initialValue: string | null
  onSaved: (val: string) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [value,   setValue]     = useState(initialValue ?? '')
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(initialValue ?? '') }, [initialValue])

  const startEdit = () => {
    if (!propertyId) return
    setEditing(true); setError('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }
  const cancel = () => { setEditing(false); setValue(initialValue ?? ''); setError('') }
  const save = async () => {
    const trimmed = value.trim()
    if (!trimmed || !propertyId) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/properties/${propertyId}/case-number`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: trimmed }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onSaved(trimmed); setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const hasValue  = Boolean(initialValue)
  const canEdit   = Boolean(propertyId) // can only edit saved properties

  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-xs shrink-0 w-32" style={{ color: 'var(--c-text-2)' }}>Case Number</span>
      {editing ? (
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="text" value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            placeholder="e.g. CACE-25-012345"
            className="text-xs rounded-lg px-2 py-1 w-36"
            style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)', color: 'var(--c-primary)', outline: 'none' }} />
          <button onClick={save} disabled={saving}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.3)' }}>
            {saving ? '…' : '✓'}
          </button>
          <button onClick={cancel}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium"
            style={{ color: hasValue ? 'var(--c-primary)' : 'rgba(255,255,255,0.25)', fontStyle: hasValue ? 'normal' : 'italic' }}>
            {hasValue ? initialValue : canEdit ? 'Pending lookup' : 'Save first'}
          </span>
          {canEdit && (
            <button onClick={startEdit} title="Edit case number" className="text-xs hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.35)' }}>✎</button>
          )}
        </div>
      )}
      {error && <span className="text-[10px] ml-2" style={{ color: '#ef4444' }}>{error}</span>}
    </div>
  )
}

const COUNTY_CLERK_URLS: Record<string, string> = {
  'miami-dade': 'https://www.miami-dadeclerk.com/ocs/CaseSearch.aspx',
  'broward':    'https://www.browardclerk.org/Web2/CaseSearch',
  'palm-beach': 'https://courtrecords.mypalmbeachclerk.com/DORIS',
}

// ─── Drawer Comps Panel ───────────────────────────────────────────────────────

interface DrawerComp {
  mls_number:     string | null
  address:        string
  city:           string
  status:         string
  beds:           number | null
  baths:          number | null
  living_area:    number | null
  year_built:     number | null
  list_price:     number | null
  sold_price:     number | null
  price_per_sqft: number | null
  sold_date:      string | null
  days_on_market: number | null
  distance_miles: number | null
}
interface DrawerCompsResult {
  sold:               DrawerComp[]
  active:             DrawerComp[]
  pending:            DrawerComp[]
  median_sold_price:  number | null
  avg_price_per_sqft: number | null
}

function DrawerComps({ lead }: { lead: Lead }) {
  const [result,  setResult]  = useState<DrawerCompsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [noKey,   setNoKey]   = useState(false)
  const [radius,  setRadius]  = useState(0.5)

  const load = async (r = radius) => {
    const addrFull = [lead.property_address, lead.city, lead.state ?? 'FL', lead.zip].filter(Boolean).join(', ')
    setLoading(true); setError(null)
    try {
      const p = new URLSearchParams({ address: addrFull, radius: String(r) })
      if (lead.beds)        p.set('beds', String(lead.beds))
      if (lead.living_area) p.set('sqft', String(lead.living_area))
      const res  = await fetch(`/api/mls/comps?${p}`)
      const data = await res.json()
      if (!res.ok) {
        if (data.code === 'NO_CREDENTIALS') setNoKey(true)
        else setError(data.error ?? 'MLS error')
      } else {
        setResult(data as DrawerCompsResult)
      }
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (noKey) {
    return (
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2"
          style={{ backgroundColor: 'var(--c-hover)' }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
          </svg>
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Beaches MLS Not Connected</p>
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          Add <code className="px-1 rounded" style={{ backgroundColor: 'var(--c-hover)' }}>RENTCAST_API_KEY</code> to Vercel environment variables to enable live comps.
        </p>
      </div>
    )
  }

  const RadiusBar = () => (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
          {result ? ((result as DrawerCompsResult & { source?: string }).source === 'rentcast' ? 'Rentcast' : 'Beaches MLS') : 'MLS'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {[0.25, 0.5, 1].map(r => (
          <button key={r} onClick={() => { setRadius(r); load(r) }}
            className="px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all"
            style={{
              backgroundColor: radius === r ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
              color:           radius === r ? '#C9A84C' : 'var(--c-text-3)',
              border:          `1px solid ${radius === r ? 'rgba(201,168,76,0.35)' : 'var(--c-border)'}`,
            }}>
            {r}mi
          </button>
        ))}
        <button onClick={() => load()} disabled={loading}
          className="px-2 py-0.5 text-[10px] font-bold rounded-lg hover:opacity-80 ml-1"
          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
          {loading ? '…' : '↻'}
        </button>
      </div>
    </div>
  )

  if (loading && !result) {
    return (
      <div>
        <RadiusBar />
        {[1,2,3].map(i => <div key={i} className="rounded-xl h-16 mb-2 animate-pulse" style={{ backgroundColor: 'var(--c-card)' }} />)}
      </div>
    )
  }

  if (error && !result) {
    return (
      <div>
        <RadiusBar />
        <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <p className="text-xs" style={{ color: '#E74C3C' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!result) return null

  const { sold, active, pending, median_sold_price, avg_price_per_sqft } = result

  return (
    <div>
      <RadiusBar />

      {/* Stats */}
      {(median_sold_price || avg_price_per_sqft) && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Median Sold',  value: median_sold_price  ? fmt$(median_sold_price)       : '—', color: '#4CAF9A' },
            { label: 'Avg $/sqft',   value: avg_price_per_sqft ? `$${avg_price_per_sqft}/sf`   : '—' },
            { label: 'Comps',        value: `${sold.length}s / ${active.length}a` },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>{s.label}</p>
              <p className="text-sm font-bold" style={{ color: (s as { color?: string }).color ?? 'var(--c-primary)' }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {sold.length + active.length + pending.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: 'var(--c-text-3)' }}>
          No comps found within {radius}mi — try expanding the radius
        </p>
      )}

      {[
        { label: 'Sold',    items: sold,    color: '#4CAF9A', pk: 'sold_price' as const },
        { label: 'Active',  items: active,  color: '#C9A84C', pk: 'list_price' as const },
        { label: 'Pending', items: pending, color: '#7B8FD4', pk: 'list_price' as const },
      ].map(({ label, items, color, pk }) => items.length > 0 && (
        <div key={label} className="mb-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color }}>
            {label} ({items.length})
          </h4>
          <div className="space-y-2">
            {items.map((c, i) => (
              <div key={c.mls_number ?? i} className="rounded-lg p-3"
                style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>
                      {c.address}{c.city ? `, ${c.city}` : ''}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                      {[
                        c.beds        ? `${c.beds}bd`                          : null,
                        c.baths       ? `${c.baths}ba`                         : null,
                        c.living_area ? `${c.living_area.toLocaleString()} sf` : null,
                        c.distance_miles ? `${c.distance_miles}mi`             : null,
                        c.sold_date   ? new Date(c.sold_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null,
                        c.days_on_market != null ? `${c.days_on_market}d`      : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color }}>{fmt$(c[pk])}</p>
                    {c.price_per_sqft && <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>${c.price_per_sqft}/sf</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Property Drawer ─────────────────────────────────────────────────────────

function PropertyDrawer({
  lead,
  onClose,
  onSave,
  onCaseNumberUpdate,
}: {
  lead: Lead
  onClose: () => void
  onSave:  (id: string) => void
  onCaseNumberUpdate: (id: string, caseNum: string) => void
}) {
  const router = useRouter()
  const [tab, setTab] = useState<DrawerTab>('overview')
  const [saving, setSaving] = useState(false)

  const isSaved   = Boolean(lead.lead_id || lead.is_lead)
  const propertyId = isSaved ? (lead.property_id ?? lead.id) : null
  const days      = daysSince(lead.file_date)
  const ageClr    = distressAgeColor(days)
  const countyClerkUrl = COUNTY_CLERK_URLS[lead.county]

  const ltTags = getLeadTypeTags(lead)

  const handleSave = async () => {
    setSaving(true)
    await onSave(lead.id)
    setSaving(false)
  }

  // Filter out synthetic REAPI- ids for navigation
  const canNavigate = isSaved && propertyId && !String(propertyId).startsWith('REAPI-')

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          width: 'min(480px, 95vw)',
          backgroundColor: 'var(--c-bg)',
          borderLeft: '1px solid var(--c-border)',
          boxShadow: '-4px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between gap-3"
          style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--c-primary)' }}>
              {lead.property_address || '—'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
              {lead.city}{lead.zip ? `, FL ${lead.zip}` : ''} · {lead.county === 'miami-dade' ? 'Miami-Dade' : lead.county === 'broward' ? 'Broward' : lead.county === 'palm-beach' ? 'Palm Beach' : lead.county}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {ltTags.map(t => (
                <span key={t.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: `${t.color}20`, color: t.color }}>{t.label}</span>
              ))}
              {isSaved && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A' }}>✓ In Contacts</span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            className="shrink-0 text-lg leading-none hover:opacity-60"
            style={{ color: 'var(--c-text-3)' }}>✕</button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 pt-3 gap-1"
          style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
          {([['overview', 'Overview'], ['case', 'Case Details'], ['comps', 'Comps']] as [DrawerTab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className="text-xs font-semibold px-3 py-2 rounded-t-lg transition-colors"
              style={{
                color: tab === k ? '#C9A84C' : 'var(--c-text-3)',
                borderBottom: `2px solid ${tab === k ? '#C9A84C' : 'transparent'}`,
                backgroundColor: tab === k ? 'rgba(201,168,76,0.06)' : 'transparent',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <>
              {/* Key stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Est. Value',  value: fmt$(lead.market_value || lead.assessed_value), color: 'var(--c-primary)' },
                  { label: 'Equity',      value: lead.equity_tier ?? '—', color: EQUITY_COLORS[lead.equity_tier] ?? '#9ca3af' },
                  { label: 'Filed',       value: days !== null ? `${days}d` : '—', color: ageClr },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-3" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>{s.label}</p>
                    <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Owner */}
              <div className="rounded-xl p-4 space-y-0.5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <h4 className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-2)' }}>Owner</h4>
                <DRow label="Owner Name"  value={lead.owner_name || lead.mortgagor} />
                <DRow label="Entity Type" value={lead.entity_type} />
                <DRow label="Homestead"   value={lead.homestead ? '✓ Owner-Occupied' : 'No'} />
                <DRow label="Absentee"    value={lead.absentee_owner ? '✓ Yes' : null} />
              </div>

              {/* Property */}
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <h4 className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-2)' }}>Property</h4>
                <DRow label="Beds / Baths" value={[lead.beds && `${lead.beds} bd`, lead.baths && `${lead.baths} ba`].filter(Boolean).join(' · ') || null} />
                <DRow label="Living Area"  value={lead.living_area ? `${Number(lead.living_area).toLocaleString()} sqft` : null} />
                <DRow label="Year Built"   value={lead.year_built} />
                <DRow label="Type"         value={lead.property_type} />
                <DRow label="Lender"       value={lead.lender_name} />
                <DRow label="Loan Balance" value={lead.known_debt ? fmt$(lead.known_debt) : null} />
              </div>
            </>
          )}

          {/* ── COMPS ── */}
          {tab === 'comps' && (
            <DrawerComps lead={lead} />
          )}

          {/* ── CASE DETAILS ── */}
          {tab === 'case' && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <h4 className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-2)' }}>Case Details</h4>

              <DrawerCaseNumberRow
                propertyId={propertyId}
                initialValue={lead.case_number ?? null}
                onSaved={val => onCaseNumberUpdate(lead.id, val)}
              />

              <DRow label="Folio / APN"  value={<span className="font-mono text-xs">{lead.folio_number}</span>} />
              <DRow label="Date Filed"   value={lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null} />
              <DRow label="Case Type"    value={
                lead.foreclosure_type === 'P' ? 'Pre-Foreclosure (Lis Pendens)'
                : lead.foreclosure_type === 'F' ? 'Foreclosure'
                : lead.foreclosure_type === 'A' ? 'Auction'
                : lead.foreclosure_type
              } />
              <DRow label="Plaintiff"    value={lead.plaintiff} />
              <DRow label="Lender"       value={lead.lender_name} />
              <DRow label="Loan Balance" value={lead.known_debt ? fmt$(lead.known_debt) : null} />
              <DRow label="Data Source"  value={lead.data_source} />

              {!isSaved && (
                <p className="text-xs mt-4 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: 'rgba(201,168,76,0.08)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.2)' }}>
                  ⚡ Case number will be looked up from REAPI when you save this property.
                </p>
              )}

              {countyClerkUrl && (
                <a href={countyClerkUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 mt-4 text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Verify on {lead.county === 'miami-dade' ? 'Miami-Dade' : lead.county === 'broward' ? 'Broward' : 'Palm Beach'} Clerk →
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 flex gap-3"
          style={{ backgroundColor: 'var(--c-card)', borderTop: '1px solid var(--c-border)' }}>
          {canNavigate ? (
            <button onClick={() => router.push(`/leads/${propertyId}`)}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              Open Full Lead →
            </button>
          ) : !isSaved ? (
            <button onClick={handleSave} disabled={saving}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              {saving ? 'Saving…' : '+ Save to Contacts'}
            </button>
          ) : null}
          <button onClick={onClose}
            className="px-4 text-sm font-semibold py-2.5 rounded-xl hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            Close
          </button>
        </div>
      </div>
    </>
  )
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

  const [leads, setLeads]     = useState<Lead[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pages, setPages]     = useState(1)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy]     = useState<'file_date' | 'equity_percentage' | 'market_value'>('file_date')
  const [sortDir, setSortDir]   = useState<'desc' | 'asc'>('desc')
  const [cached, setCached]     = useState<boolean | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [dbFallback, setDbFallback] = useState<string | null>(null)  // warning msg when showing saved DB results
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null)

  // ── Fetch — calls live REAPI search API (with smart caching) ─────────────

  const fetchResults = useCallback(async (p = 1) => {
    setLoading(true)
    setError(null)
    setDbFallback(null)
    const params = new URLSearchParams(rawParams.toString())
    params.set('page',     String(p))
    params.set('limit',    '50')
    params.set('sort_by',  sortBy)
    params.set('sort_dir', sortDir)

    try {
      const res  = await fetch(`/api/property-search/live?${params}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Search failed')
        setLeads([])
        setTotal(0)
        return
      }

      // DB fallback: REAPI unavailable — show warning banner but still render results
      if (data.db_fallback) {
        setDbFallback(data.warning ?? 'Showing saved properties — live search unavailable.')
      }

      setLeads(data.properties || [])
      setTotal(data.total || 0)
      setPage(data.page  || 1)
      setPages(data.pages || 1)
      setCached(data.cached ?? false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setLoading(false) }
  }, [rawParams, sortBy, sortDir])

  useEffect(() => { fetchResults(1) }, [sortBy, sortDir]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Update both the list and the open drawer
      setLeads(prev => prev.map(l => l.id === id
        ? { ...l, lead_id, id: property_id, is_lead: true }
        : l
      ))
      setDrawerLead(prev => prev?.id === id ? { ...prev, lead_id, id: property_id, is_lead: true } : prev)
    }
  }

  /** Update case number in local state after manual edit */
  const handleCaseNumberUpdate = (id: string, caseNum: string) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, case_number: caseNum } : l))
    setDrawerLead(prev => prev?.id === id ? { ...prev, case_number: caseNum } : prev)
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
            {/* Back button */}
            <button onClick={() => router.push('/property-search')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ← Modify Search
            </button>

            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--c-primary)' }}>Search Results</h1>
              <p className="text-xs flex items-center gap-2" style={{ color: 'var(--c-text-3)' }}>
                {loading ? (dbFallback ? 'Searching saved properties…' : 'Querying live market…') : `${total.toLocaleString()} propert${total === 1 ? 'y' : 'ies'}`}
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
              <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>Searching live market…</p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Querying RealEstateAPI</p>
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
                    onClick={id => setDrawerLead(leads.find(l => l.id === id) ?? null)}
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

      {/* ── Property Detail Drawer ─────────────────────────────────────── */}
      {drawerLead && (
        <PropertyDrawer
          lead={drawerLead}
          onClose={() => setDrawerLead(null)}
          onSave={addToLeads}
          onCaseNumberUpdate={handleCaseNumberUpdate}
        />
      )}
    </div>
  )
}
