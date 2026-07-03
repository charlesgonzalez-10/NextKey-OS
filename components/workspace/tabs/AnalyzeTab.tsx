'use client'

import { useState, useEffect, useRef, Suspense, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { fmtMoneyFull, fmtDateShort, type WorkspaceAISummary } from '@/lib/acquisitionEngine'
import type { PropertyComp } from '@/lib/enrichment/types'

const CompsMap           = dynamic(() => import('@/components/CompsMap'), { ssr: false })
const DataPassportPanel  = dynamic(() => import('@/components/workspace/tabs/DataPassportPanel'), { ssr: false })

// ─── Shared primitives ────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '12px 14px', ...style }}>{children}</div>
}

function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a' }}>{children}</div>
      {action}
    </div>
  )
}

function KV({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ color: '#4a6a9a', fontSize: 11 }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: vColor ?? '#e2e8f0', textAlign: 'right' as const }}>{v ?? <span style={{ color: '#4a6a9a' }}>—</span>}</span>
    </div>
  )
}

function Tile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: '8px 10px', textAlign: 'center' as const }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#e2e8f0' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 1 }}>{sub}</div>}
      <div style={{ fontSize: 9, color: '#4a6a9a', marginTop: 2, letterSpacing: '.04em', textTransform: 'uppercase' as const }}>{label}</div>
    </div>
  )
}

function fmtK(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function distressColor(days: number | null): string {
  if (days == null) return '#4a6a9a'
  if (days <= 30)   return '#4CAF9A'
  if (days <= 90)   return '#C9A84C'
  if (days <= 180)  return '#E07B6A'
  return '#ef4444'
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return '#4a6a9a'
  if (score >= 7)    return '#ef4444'
  if (score >= 5)    return '#C9A84C'
  return '#4CAF9A'
}

function motivationColor(m: string | null | undefined): string {
  if (m === 'desperate') return '#ef4444'
  if (m === 'motivated')  return '#C9A84C'
  return '#4a6a9a'
}

const EQUITY_COLORS: Record<string, string> = {
  high: '#4CAF9A', medium: '#C9A84C', low: '#E07B6A', none: '#ef4444',
}

const COUNTY_LABELS: Record<string, string> = {
  'miami-dade': 'Miami-Dade', 'broward': 'Broward', 'palm-beach': 'Palm Beach',
}

// ─── Foreclosure status constants ────────────────────────────────────────────

const FC_STATUSES = [
  'Active', 'Pending', 'Dismissed', 'Cancelled', 'Reinstated',
  'Sold at Auction', 'Certificate Issued', 'Final Judgment',
  'Bankruptcy Stay', 'Unknown',
] as const

const FC_STATUS_COLORS: Record<string, string> = {
  'Active':             '#ef4444',
  'Pending':            '#f97316',
  'Dismissed':          '#22c55e',
  'Cancelled':          '#6b7280',
  'Reinstated':         '#3b82f6',
  'Sold at Auction':    '#a855f7',
  'Certificate Issued': '#f59e0b',
  'Final Judgment':     '#dc2626',
  'Bankruptcy Stay':    '#7c3aed',
  'Unknown':            '#94a3b8',
}

function deriveREAPIForeclosureStatus(lead: { is_foreclosure?: boolean | null; is_pre_foreclosure?: boolean | null }): string | null {
  if (lead.is_foreclosure)     return 'Active'
  if (lead.is_pre_foreclosure) return 'Pending'
  return null
}

// ─── Foreclosure Status Editor ────────────────────────────────────────────────

function ForeclosureStatusEditor() {
  const { lead, patchLeadLocal } = useWorkspace()
  const propertyId = lead.property_id ?? lead.id

  const [editing,  setEditing]  = useState(false)
  const [pending,  setPending]  = useState<string | null>(null)
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [toast,    setToast]    = useState<string | null>(null)

  const override       = lead.foreclosure_status_override ?? null
  const reapiStatus    = deriveREAPIForeclosureStatus(lead)
  const effectiveStatus = override ?? reapiStatus
  const source          = override ? 'Manual' : (reapiStatus ? 'REAPI' : null)
  const reapiChanged    = lead.foreclosure_reapi_changed === true
  const statusColor     = effectiveStatus ? (FC_STATUS_COLORS[effectiveStatus] ?? '#94a3b8') : '#6b7280'

  async function handleSave() {
    if (!pending) return
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/foreclosure-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: pending, notes: notes.trim() || undefined }),
      })
      if (res.ok) {
        patchLeadLocal({
          foreclosure_status_override: pending,
          foreclosure_status_source:   'Manual',
          foreclosure_reapi_changed:   false,
        })
        setToast('Status updated')
        setEditing(false)
        setNotes('')
        setTimeout(() => setToast(null), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/foreclosure-status`, { method: 'DELETE' })
      if (res.ok) {
        patchLeadLocal({
          foreclosure_status_override: null,
          foreclosure_status_source:   'REAPI',
          foreclosure_reapi_changed:   false,
        })
        setToast('Reset to REAPI')
        setTimeout(() => setToast(null), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card style={{ marginBottom: 10, position: 'relative' }}>
      <CardTitle>Foreclosure Status</CardTitle>

      {reapiChanged && (
        <div style={{
          fontSize: 10, color: '#C9A84C',
          background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.25)',
          borderRadius: 5, padding: '5px 8px', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          ⚠ REAPI data updated — compare with your manual override
        </div>
      )}

      {toast && (
        <span style={{ position: 'absolute', top: 12, right: 14, fontSize: 10, color: '#4CAF9A', fontWeight: 700 }}>
          ✓ {toast}
        </span>
      )}

      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {effectiveStatus ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: statusColor + '22', border: `1px solid ${statusColor}55`,
                borderRadius: 5, padding: '3px 9px',
                fontSize: 12, fontWeight: 700, color: statusColor,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                {effectiveStatus}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>No status set</span>
            )}
            {source && (
              <span style={{ fontSize: 10, color: '#4a6a9a', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 6px' }}>
                {source}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {override && (
              <button
                onClick={handleReset}
                disabled={saving}
                style={{ fontSize: 10, color: '#4a6a9a', background: 'none', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', padding: 0 }}
              >
                {saving ? '...' : '↺ Reset to REAPI'}
              </button>
            )}
            <button
              onClick={() => { setPending(effectiveStatus ?? 'Active'); setEditing(true) }}
              style={{
                fontSize: 11, fontWeight: 600, color: '#0A1F44',
                background: '#C9A84C', border: 'none', borderRadius: 4,
                padding: '3px 10px', cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, marginBottom: 8 }}>
            {FC_STATUSES.map(s => {
              const c = FC_STATUS_COLORS[s]
              const sel = pending === s
              return (
                <button
                  key={s}
                  onClick={() => setPending(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
                    background: sel ? c + '22' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${sel ? c + '66' : '#1a3050'}`,
                    color: sel ? c : '#94a3b8',
                    fontSize: 11, fontWeight: sel ? 700 : 400,
                    textAlign: 'left' as const,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  {s}
                </button>
              )
            })}
          </div>

          <textarea
            placeholder="Optional notes (e.g., Case dismissed per court records)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.04)', border: '1px solid #1a3050',
              borderRadius: 5, color: '#e2e8f0', fontSize: 11, padding: '6px 8px',
              resize: 'none', fontFamily: 'inherit', marginBottom: 6,
            }}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleSave}
              disabled={saving || !pending}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 5, cursor: saving || !pending ? 'not-allowed' : 'pointer',
                background: '#C9A84C', border: 'none', color: '#0A1F44',
                fontSize: 11, fontWeight: 700, opacity: saving || !pending ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Status'}
            </button>
            <button
              onClick={() => { setEditing(false); setPending(null); setNotes('') }}
              style={{
                padding: '7px 12px', borderRadius: 5, cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)', border: '1px solid #1a3050',
                color: '#94a3b8', fontSize: 11,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

const STRATEGY_LABELS: Record<string, string> = {
  'subject-to': 'Subject-To', 'cash-offer': 'Cash Offer', 'wholesale': 'Wholesale',
  'short-sale': 'Short Sale', 'novation': 'Novation', 'creative': 'Creative Finance',
}

// ─── MLS Comps types ──────────────────────────────────────────────────────────

interface MlsComp {
  mls_number:      string | null
  address:         string
  city:            string
  zip:             string
  status:          string
  beds:            number | null
  baths:           number | null
  living_area:     number | null
  year_built:      number | null
  list_price:      number | null
  sold_price:      number | null
  price_per_sqft:  number | null
  sold_date:       string | null
  list_date:       string | null
  days_on_market:  number | null
  distance_miles:  number | null
  property_type:   string | null
  lat?:            number | null
  lng?:            number | null
}

interface MlsCompsResult {
  sold:               MlsComp[]
  active:             MlsComp[]
  pending:            MlsComp[]
  median_sold_price:  number | null
  avg_price_per_sqft: number | null
  avm_estimate?:      number | null
  radius_miles:       number
  fetched_at:         string
  subject_lat?:       number
  subject_lng?:       number
  source?:            string
}

interface CompsFilter {
  radiusMi:     number
  monthsBack:   number
  propertyType: string
  minPrice:     string
  maxPrice:     string
  beds:         string
  baths:        string
}

type SortKey = 'date' | 'price' | 'beds' | 'baths' | 'sqft' | 'ppsf' | 'year' | 'distance' | 'type'
type SortDir = 'asc' | 'desc'

const DEFAULT_FILTER: CompsFilter = {
  radiusMi: 0.5, monthsBack: 12, propertyType: '', minPrice: '', maxPrice: '', beds: '', baths: '',
}

// ─── STR provider registry (future integrations plug in here) ─────────────────

type STRProviderId = 'airdna' | 'rabbu' | 'bnbcalc' | 'pricelabs'

interface STRProvider {
  id:          STRProviderId
  name:        string
  tagline:     string
  status:      'coming_soon' | 'active'
  accentColor: string
}

// To activate a provider: change status to 'active' and wire up its fetch in STRModule
const STR_PROVIDERS: STRProvider[] = [
  { id: 'airdna',     name: 'AirDNA',     tagline: 'STR market intelligence & projections',   status: 'coming_soon', accentColor: '#FF5A5F' },
  { id: 'rabbu',      name: 'Rabbu',       tagline: 'Real-time Airbnb & VRBO analytics',       status: 'coming_soon', accentColor: '#7C3AED' },
  { id: 'bnbcalc',   name: 'BNBCalc',    tagline: 'Revenue & ROI projections',                status: 'coming_soon', accentColor: '#059669' },
  { id: 'pricelabs', name: 'PriceLabs',  tagline: 'Dynamic pricing & occupancy optimization', status: 'coming_soon', accentColor: '#0284C7' },
]

// ─── ModuleCard ───────────────────────────────────────────────────────────────

interface ModuleCardProps {
  icon:             React.ReactNode
  title:            string
  badge?:           string
  badgeColor?:      string
  defaultExpanded?: boolean
  locked?:          boolean
  lockedLabel?:     string
  summaryItems?:    { label: string; value: string; color?: string }[]
  children:         React.ReactNode
}

function ModuleCard({
  icon, title, badge, badgeColor = '#4CAF9A',
  defaultExpanded = false, locked = false, lockedLabel = 'Coming Soon',
  summaryItems, children,
}: ModuleCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded && !locked)

  return (
    <div style={{
      background: '#0d1b2e',
      border: `1px solid ${locked ? 'rgba(74,106,154,0.4)' : '#1a3050'}`,
      borderRadius: 10,
      marginBottom: 10,
      overflow: 'hidden',
      opacity: locked ? 0.85 : 1,
    }}>
      {/* Header */}
      <button
        onClick={() => !locked && setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '11px 14px', background: 'none', border: 'none',
          cursor: locked ? 'not-allowed' : 'pointer', gap: 10,
          borderBottom: expanded ? '1px solid #1a3050' : 'none',
        }}>
        {/* Left: icon + title + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ color: locked ? '#4a6a9a' : badgeColor, flexShrink: 0, display: 'flex' }}>{icon}</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: locked ? '#4a6a9a' : '#e2e8f0', whiteSpace: 'nowrap' }}>{title}</span>
          {badge && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap',
              background: `${badgeColor}18`, color: locked ? '#4a6a9a' : badgeColor,
              border: `1px solid ${badgeColor}35`,
            }}>{badge}</span>
          )}
          {locked && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
              background: 'rgba(74,106,154,0.15)', color: '#4a6a9a', border: '1px solid rgba(74,106,154,0.3)',
            }}>{lockedLabel}</span>
          )}
          {/* Summary items — shown only when collapsed */}
          {!expanded && !locked && summaryItems && summaryItems.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginLeft: 4, flexWrap: 'nowrap' as const, overflow: 'hidden' }}>
              {summaryItems.map(item => (
                <div key={item.label} style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: item.color ?? '#e2e8f0' }}>{item.value}</span>
                  <span style={{ fontSize: 9, color: '#4a6a9a' }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Right: chevron */}
        <svg
          width="14" height="14" fill="none" stroke={locked ? '#4a6a9a' : '#4a6a9a'}
          viewBox="0 0 24 24" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {expanded && !locked && (
        <div style={{ padding: '14px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── CaseNumberRow ────────────────────────────────────────────────────────────

function CaseNumberRow({ propertyId, initialValue, onSaved }: {
  propertyId: string; initialValue: string | null; onSaved: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(initialValue ?? '')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(initialValue ?? '') }, [initialValue])

  const startEdit = () => { setEditing(true); setError(''); setTimeout(() => inputRef.current?.focus(), 50) }
  const cancel    = () => { setEditing(false); setValue(initialValue ?? ''); setError('') }

  const save = async () => {
    const trimmed = value.trim()
    if (!trimmed) { setError('Required'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/case-number`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: trimmed }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      onSaved(trimmed); setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontSize: 11, color: '#4a6a9a' }}>Case Number</span>
      {editing ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input ref={inputRef} value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            placeholder="CACE-25-012345"
            style={{ background: '#060e1a', border: `1px solid ${error ? '#ef4444' : '#1a3050'}`, borderRadius: 4, padding: '3px 7px', color: '#e2e8f0', fontSize: 11, width: 140, outline: 'none' }}
          />
          <button onClick={save} disabled={saving}
            style={{ padding: '2px 7px', background: '#0f2a18', border: '1px solid #1a5c2a44', color: '#4CAF9A', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
            {saving ? '…' : '✓'}
          </button>
          <button onClick={cancel}
            style={{ padding: '2px 7px', background: 'transparent', border: '1px solid #1a3050', color: '#4a6a9a', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
            ✕
          </button>
          {error && <span style={{ fontSize: 10, color: '#ef4444' }}>{error}</span>}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: initialValue ? '#e2e8f0' : '#4a6a9a', fontStyle: initialValue ? 'normal' : 'italic' }}>
            {initialValue || 'Pending lookup'}
          </span>
          <button onClick={startEdit}
            style={{ fontSize: 10, color: '#4a6a9a', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>
            ✎
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Market Analysis Module ───────────────────────────────────────────────────

interface MarketAnalysisProps {
  leadAddress:   string
  mlsComps:      MlsCompsResult | null
  mlsLoading:    boolean
  mlsError:      string | null
  noCredentials: boolean
  mlsCached:     boolean
  onFetch:       (filter?: CompsFilter) => void
}

function MarketAnalysisModule({ leadAddress, mlsComps, mlsLoading, mlsError, noCredentials, mlsCached, onFetch }: MarketAnalysisProps) {
  const { lead, comps } = useWorkspace()
  const [showFilters, setShowFilters] = useState(false)
  const [filter,      setFilter]      = useState<CompsFilter>(DEFAULT_FILTER)
  const [draftFilter, setDraftFilter] = useState<CompsFilter>(DEFAULT_FILTER)
  const [sortKey,     setSortKey]     = useState<SortKey>('date')
  const [sortDir,     setSortDir]     = useState<SortDir>('desc')
  const [activeComp,  setActiveComp]  = useState<MlsComp | null>(null)

  const SORT_OPTS: { k: SortKey; l: string }[] = [
    { k: 'date', l: 'Date' }, { k: 'price', l: 'Price' }, { k: 'beds', l: 'Beds' },
    { k: 'baths', l: 'Baths' }, { k: 'sqft', l: 'Sqft' }, { k: 'ppsf', l: '$/sf' },
    { k: 'year', l: 'Year' }, { k: 'distance', l: 'Dist' }, { k: 'type', l: 'Type' },
  ]

  const sortComps = (items: MlsComp[], priceKey: 'sold_price' | 'list_price'): MlsComp[] => {
    const d = sortDir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      let av: number | string | null | undefined, bv: number | string | null | undefined
      switch (sortKey) {
        case 'price':    av = a[priceKey];        bv = b[priceKey];        break
        case 'date':     av = a.sold_date ?? a.list_date; bv = b.sold_date ?? b.list_date; break
        case 'beds':     av = a.beds;             bv = b.beds;             break
        case 'baths':    av = a.baths;            bv = b.baths;            break
        case 'sqft':     av = a.living_area;      bv = b.living_area;      break
        case 'ppsf':     av = a.price_per_sqft;   bv = b.price_per_sqft;   break
        case 'year':     av = a.year_built;       bv = b.year_built;       break
        case 'distance': av = a.distance_miles;   bv = b.distance_miles;   break
        case 'type':     av = a.property_type ?? ''; bv = b.property_type ?? ''; break
        default: return 0
      }
      if (av == null && bv == null) return 0
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') return d * av.localeCompare(bv)
      return d * ((av as number) - (bv as number))
    })
  }

  const filterActive = (
    filter.radiusMi !== DEFAULT_FILTER.radiusMi || filter.monthsBack !== DEFAULT_FILTER.monthsBack ||
    !!filter.propertyType || !!filter.minPrice || !!filter.maxPrice || !!filter.beds || !!filter.baths
  )

  const applyFilter = () => { setFilter(draftFilter); setShowFilters(false); onFetch(draftFilter) }
  const clearFilter = () => { const f = DEFAULT_FILTER; setDraftFilter(f); setFilter(f); setShowFilters(false); onFetch(f) }

  const CtrlBar = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {mlsComps && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
            {mlsComps.source === 'rentcast' ? 'Rentcast' : 'Beaches MLS'}
          </span>
        )}
        {filterActive && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
            {filter.radiusMi}mi · {filter.monthsBack}mo{filter.propertyType ? ` · ${filter.propertyType.replace('Single Family', 'SF').replace('Condominium', 'Condo')}` : ''}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[
          { label: `Filters${filterActive ? ' ●' : ''}`, action: () => { if (!showFilters) setDraftFilter(filter); setShowFilters(v => !v) }, on: showFilters || filterActive },
          { label: mlsLoading ? 'Fetching…' : '↻ Refresh', action: () => onFetch(filter), on: false },
        ].map(btn => (
          <button key={btn.label} onClick={btn.action} disabled={mlsLoading}
            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: btn.on ? 'rgba(201,168,76,0.1)' : 'transparent',
              color: btn.on ? '#C9A84C' : '#4a6a9a',
              border: `1px solid ${btn.on ? 'rgba(201,168,76,0.35)' : '#1a3050'}` }}>
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )

  // ── DB comps fallback ────────────────────────────────────────────────────────
  if (comps.length > 0 && !mlsComps) {
    const sold    = comps.filter(c => c.status === 'sold')
    const active  = comps.filter(c => c.status === 'active')
    const pending = comps.filter(c => c.status === 'pending')
    const avgSold = sold.length > 0 ? sold.reduce((s, c) => s + (c.sale_price ?? 0), 0) / sold.length : null
    return (
      <div>
        <CtrlBar />
        {avgSold && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            <Tile label="Avg Sold" value={fmtK(avgSold)} color="#4CAF9A" />
            <Tile label="Sold"     value={String(sold.length)} />
            <Tile label="Active"   value={String(active.length)} />
          </div>
        )}
        {[{ label: 'Sold', items: sold, color: '#4CAF9A' }, { label: 'Active', items: active, color: '#C9A84C' }, { label: 'Pending', items: pending, color: '#7B8FD4' }].map(({ label, items, color }) =>
          items.length > 0 && (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color, marginBottom: 6 }}>{label} ({items.length})</div>
              {items.map(comp => (
                <div key={comp.id} style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 5, padding: 9, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{comp.address}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                    {comp.sale_price && <span style={{ fontSize: 11, color, fontWeight: 600 }}>{fmtMoneyFull(comp.sale_price)}</span>}
                    {comp.beds       && <span style={{ fontSize: 10, color: '#4a6a9a' }}>{comp.beds}/{comp.baths}bd</span>}
                    {comp.sqft       && <span style={{ fontSize: 10, color: '#4a6a9a' }}>{comp.sqft?.toLocaleString()} sqft</span>}
                    {comp.distance_miles != null && <span style={{ fontSize: 10, color: '#4a6a9a' }}>{comp.distance_miles.toFixed(1)} mi</span>}
                  </div>
                  {comp.sale_date && <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>Sold {fmtDateShort(comp.sale_date)}</div>}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    )
  }

  // ── No credentials ───────────────────────────────────────────────────────────
  if (noCredentials) return (
    <div>
      <CtrlBar />
      <Card style={{ textAlign: 'center' as const, padding: '24px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>MLS Not Connected</div>
        <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 12 }}>Add a Rentcast API key to pull live comps and active listings.</div>
        <div style={{ background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: 10, textAlign: 'left' as const, maxWidth: 280, margin: '0 auto', fontSize: 10, color: '#94a3b8' }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: '#e2e8f0' }}>Add to Vercel env vars:</div>
          <code style={{ color: '#4CAF9A' }}>RENTCAST_API_KEY=your_key_here</code>
        </div>
        {(lead.market_value || lead.assessed_value) && (
          <div style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: 12, textAlign: 'left' as const, maxWidth: 280, margin: '12px auto 0' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6a9a', marginBottom: 6 }}>PA Reference Values</div>
            {lead.market_value   && <KV k="Market Value"   v={fmtK(lead.market_value)}   vColor="#C9A84C" />}
            {lead.assessed_value && <KV k="Assessed Value" v={fmtK(lead.assessed_value)} />}
            {lead.living_area && lead.market_value && (
              <KV k="Est. $/sqft" v={`$${(Number(lead.market_value) / Number(lead.living_area)).toFixed(0)}/sqft`} vColor="#C9A84C" />
            )}
          </div>
        )}
      </Card>
    </div>
  )

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (mlsLoading && !mlsComps) return (
    <div>
      <CtrlBar />
      {[1, 2, 3].map(i => (
        <div key={i} style={{ height: 64, background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 6, marginBottom: 8 }} />
      ))}
    </div>
  )

  // ── Error ────────────────────────────────────────────────────────────────────
  if (mlsError && !mlsComps) return (
    <div>
      <CtrlBar />
      <Card style={{ textAlign: 'center' as const }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>MLS Error</div>
        <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>{mlsError}</div>
        <button onClick={() => onFetch(filter)}
          style={{ padding: '5px 14px', background: '#1a3050', border: '1px solid #C9A84C44', color: '#C9A84C', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Try Again
        </button>
      </Card>
    </div>
  )

  // ── Not yet fetched ──────────────────────────────────────────────────────────
  if (!mlsComps) return (
    <div>
      <CtrlBar />
      <Card style={{ textAlign: 'center' as const, padding: 20 }}>
        {mlsCached ? (
          // API confirmed data is fresh but we have no comps in state — genuinely no results
          <div style={{ fontSize: 11, color: '#4a6a9a' }}>No MLS comps available.</div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>Click Refresh to pull live comps for this address.</div>
            <button onClick={() => onFetch(filter)} disabled={mlsLoading}
              style={{ padding: '5px 16px', background: '#1a3050', border: '1px solid #4CAF9A44', color: '#4CAF9A', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              {mlsLoading ? 'Fetching…' : '↻ Fetch Comps'}
            </button>
          </>
        )}
      </Card>
    </div>
  )

  const { sold: mlsSold, active: mlsActive, pending: mlsPending, median_sold_price, avg_price_per_sqft } = mlsComps
  const totalComps = mlsSold.length + mlsActive.length + mlsPending.length

  return (
    <div>
      <CtrlBar />

      {mlsCached && (
        <div style={{ fontSize: 10, color: '#4a6a9a', textAlign: 'center' as const, marginBottom: 8 }}>
          ✓ MLS comps are up to date
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <Card style={{ marginBottom: 12, borderColor: 'rgba(201,168,76,0.2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 5 }}>Radius</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {([0.25, 0.5, 1, 2] as const).map(r => (
                  <button key={r} onClick={() => setDraftFilter(d => ({ ...d, radiusMi: r }))}
                    style={{ flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: draftFilter.radiusMi === r ? 'rgba(201,168,76,0.15)' : 'transparent',
                      color: draftFilter.radiusMi === r ? '#C9A84C' : '#4a6a9a',
                      border: `1px solid ${draftFilter.radiusMi === r ? 'rgba(201,168,76,0.4)' : '#1a3050'}` }}>
                    {r}mi
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 5 }}>Months Back</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {([3, 6, 12, 24] as const).map(m => (
                  <button key={m} onClick={() => setDraftFilter(d => ({ ...d, monthsBack: m }))}
                    style={{ flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: draftFilter.monthsBack === m ? 'rgba(201,168,76,0.15)' : 'transparent',
                      color: draftFilter.monthsBack === m ? '#C9A84C' : '#4a6a9a',
                      border: `1px solid ${draftFilter.monthsBack === m ? 'rgba(201,168,76,0.4)' : '#1a3050'}` }}>
                    {m}mo
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 5 }}>Property Type</div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
              {[{ v: '', l: 'All' }, { v: 'Single Family', l: 'Single Family' }, { v: 'Condominium', l: 'Condo' }, { v: 'Townhouse', l: 'Townhouse' }, { v: 'Multi-Family', l: 'Multi-Family' }].map(({ v, l }) => (
                <button key={v} onClick={() => setDraftFilter(d => ({ ...d, propertyType: v }))}
                  style={{ padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: draftFilter.propertyType === v ? 'rgba(201,168,76,0.15)' : 'transparent',
                    color: draftFilter.propertyType === v ? '#C9A84C' : '#4a6a9a',
                    border: `1px solid ${draftFilter.propertyType === v ? 'rgba(201,168,76,0.4)' : '#1a3050'}` }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            {[{ label: 'Min Price', key: 'minPrice', ph: 'No min' }, { label: 'Max Price', key: 'maxPrice', ph: 'No max' }].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 4 }}>{f.label}</div>
                <input type="number" placeholder={f.ph}
                  value={(draftFilter as unknown as Record<string, string>)[f.key]}
                  onChange={e => setDraftFilter(d => ({ ...d, [f.key]: e.target.value }))}
                  style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, padding: '4px 7px', color: '#e2e8f0', fontSize: 11, outline: 'none' }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {[{ label: 'Beds', key: 'beds', opts: ['', '2', '3', '4', '5'] }, { label: 'Baths', key: 'baths', opts: ['', '1', '2', '3', '4'] }].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 5 }}>{f.label}</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {f.opts.map(b => (
                    <button key={b} onClick={() => setDraftFilter(d => ({ ...d, [f.key]: b }))}
                      style={{ flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                        background: (draftFilter as unknown as Record<string, string>)[f.key] === b ? 'rgba(201,168,76,0.15)' : 'transparent',
                        color: (draftFilter as unknown as Record<string, string>)[f.key] === b ? '#C9A84C' : '#4a6a9a',
                        border: `1px solid ${(draftFilter as unknown as Record<string, string>)[f.key] === b ? 'rgba(201,168,76,0.4)' : '#1a3050'}` }}>
                      {b || 'Any'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #1a3050', paddingTop: 10 }}>
            <button onClick={applyFilter} style={{ flex: 1, padding: '6px', borderRadius: 5, background: '#1a3050', border: '1px solid #C9A84C44', color: '#C9A84C', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Apply Filters</button>
            {filterActive && <button onClick={clearFilter} style={{ padding: '6px 12px', borderRadius: 5, background: 'transparent', border: '1px solid #1a3050', color: '#4a6a9a', fontSize: 11, cursor: 'pointer' }}>Clear</button>}
            <button onClick={() => setShowFilters(false)} style={{ padding: '6px 12px', borderRadius: 5, background: 'transparent', border: '1px solid #1a3050', color: '#4a6a9a', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Card>
      )}

      {/* Stats tiles */}
      {totalComps > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
          <Tile label="Median Sold" value={median_sold_price  ? fmtK(median_sold_price)   : '—'} color="#4CAF9A" />
          <Tile label="Avg $/sqft"  value={avg_price_per_sqft ? `$${avg_price_per_sqft}` : '—'} />
          <Tile label="Sold"        value={String(mlsSold.length)} />
          <Tile label="Active"      value={String(mlsActive.length)} />
        </div>
      )}

      {totalComps === 0 && (
        <Card style={{ textAlign: 'center' as const, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#4a6a9a' }}>No comps found within {filter.radiusMi}mi. Try expanding the radius.</div>
        </Card>
      )}

      {/* Sort bar */}
      {totalComps > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const, marginBottom: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: '#4a6a9a' }}>Sort</span>
          {SORT_OPTS.map(({ k, l }) => {
            const isActive = sortKey === k
            return (
              <button key={k} onClick={() => { if (isActive) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('desc') } }}
                style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  background: isActive ? 'rgba(201,168,76,0.12)' : 'transparent',
                  color: isActive ? '#C9A84C' : '#4a6a9a',
                  border: `1px solid ${isActive ? 'rgba(201,168,76,0.35)' : '#1a3050'}` }}>
                {l}{isActive ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
            )
          })}
        </div>
      )}

      {/* Comp lists */}
      {[
        { label: 'Sold',    items: mlsSold,    color: '#4CAF9A', priceKey: 'sold_price' as const },
        { label: 'Active',  items: mlsActive,  color: '#C9A84C', priceKey: 'list_price' as const },
        { label: 'Pending', items: mlsPending, color: '#7B8FD4', priceKey: 'list_price' as const },
      ].map(({ label, items, color, priceKey }) => items.length > 0 && (
        <div key={label} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color, marginBottom: 6 }}>{label} ({items.length})</div>
          {sortComps(items, priceKey).map((comp, i) => (
            <div key={comp.mls_number ?? i} onClick={() => setActiveComp(comp)}
              style={{ background: '#0a1729', border: `1px solid ${activeComp === comp ? color + '50' : '#1a3050'}`, borderRadius: 6, padding: 9, marginBottom: 6, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{comp.address}{comp.city ? `, ${comp.city}` : ''}</div>
                  <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>
                    {[comp.beds ? `${comp.beds}bd` : null, comp.baths ? `${comp.baths}ba` : null, comp.living_area ? `${comp.living_area.toLocaleString()} sf` : null, comp.year_built ? String(comp.year_built) : null, comp.distance_miles ? `${comp.distance_miles}mi` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color }}>{fmtK(comp[priceKey])}</div>
                  {comp.price_per_sqft && <div style={{ fontSize: 10, color: '#4a6a9a' }}>${comp.price_per_sqft}/sf</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                {comp.sold_date && <span style={{ fontSize: 10, color: '#4a6a9a' }}>Sold {new Date(comp.sold_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                {comp.list_date && !comp.sold_date && <span style={{ fontSize: 10, color: '#4a6a9a' }}>Listed {new Date(comp.list_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                {comp.days_on_market != null && <span style={{ fontSize: 10, color: '#4a6a9a' }}>{comp.days_on_market}d on market</span>}
                {comp.mls_number && <span style={{ fontSize: 10, color: '#4a6a9a', fontFamily: 'monospace' }}>MLS#{comp.mls_number}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Comp detail drawer */}
      {activeComp && (() => {
        const dc = activeComp
        const isS = dc.status === 'sold', isA = dc.status === 'active'
        const statusColor = isS ? '#4CAF9A' : isA ? '#C9A84C' : '#7B8FD4'
        const statusLabel = isS ? 'Sold' : isA ? 'Active' : 'Pending'
        const price = dc.sold_price ?? dc.list_price
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.5)' }} onClick={() => setActiveComp(null)} />
            <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, zIndex: 50, width: 340, background: '#060e1a', borderLeft: '1px solid #1a3050', boxShadow: '-8px 0 32px rgba(0,0,0,0.4)', overflowY: 'auto' as const }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #1a3050', position: 'sticky', top: 0, background: '#060e1a', zIndex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>{statusLabel}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>Comp Detail</span>
                </div>
                <button onClick={() => setActiveComp(null)} style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a3050', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.3 }}>{dc.address}</div>
                  {(dc.city || dc.zip) && <div style={{ fontSize: 11, color: '#4a6a9a', marginTop: 2 }}>{dc.city}{dc.zip ? `, ${dc.zip}` : ''}</div>}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: statusColor }}>
                      {price ? (price >= 1_000_000 ? `$${(price / 1_000_000).toFixed(2)}M` : `$${price.toLocaleString()}`) : '—'}
                    </span>
                    {dc.price_per_sqft && <span style={{ fontSize: 11, color: '#4a6a9a' }}>${dc.price_per_sqft}/sf</span>}
                  </div>
                  {isS && dc.list_price && dc.sold_price && dc.list_price !== dc.sold_price && (
                    <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>
                      Listed ${dc.list_price.toLocaleString()} ·{' '}
                      <span style={{ color: dc.sold_price >= dc.list_price ? '#4CAF9A' : '#ef4444' }}>
                        {dc.sold_price >= dc.list_price ? '+' : ''}{(((dc.sold_price - dc.list_price) / dc.list_price) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
                <Card style={{ marginBottom: 10 }}>
                  <CardTitle>Property</CardTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                    {[
                      { l: 'Beds',        v: dc.beds        ? `${dc.beds} bd`                        : null },
                      { l: 'Baths',       v: dc.baths       ? `${dc.baths} ba`                       : null },
                      { l: 'Living Area', v: dc.living_area ? `${dc.living_area.toLocaleString()} sf` : null },
                      { l: 'Year Built',  v: dc.year_built  ? String(dc.year_built)                  : null },
                      { l: 'Type',        v: dc.property_type ?? null },
                      { l: 'Distance',    v: dc.distance_miles != null ? `${dc.distance_miles} mi`   : null },
                    ].filter(r => r.v).map(({ l, v }) => (
                      <div key={l}>
                        <div style={{ fontSize: 9, color: '#4a6a9a', textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>{l}</div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8', marginTop: 1 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card style={{ marginBottom: 10 }}>
                  <CardTitle>Listing</CardTitle>
                  {[
                    { l: 'List Price',     v: dc.list_price      ? `$${dc.list_price.toLocaleString()}`  : null },
                    { l: 'Sold Price',     v: dc.sold_price      ? `$${dc.sold_price.toLocaleString()}`  : null },
                    { l: 'List Date',      v: dc.list_date       ? new Date(dc.list_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null },
                    { l: 'Sold Date',      v: dc.sold_date       ? new Date(dc.sold_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null },
                    { l: 'Days on Market', v: dc.days_on_market != null ? `${dc.days_on_market} days`    : null },
                    { l: 'MLS Number',     v: dc.mls_number ?? null },
                  ].filter(r => r.v).map(({ l, v }) => (
                    <KV key={l} k={l} v={<span style={{ fontFamily: l === 'MLS Number' ? 'monospace' : undefined }}>{v}</span>} />
                  ))}
                </Card>
                {mlsComps?.avm_estimate && (() => {
                  const avm   = mlsComps.avm_estimate!
                  const delta = price ? ((price - avm) / avm) * 100 : null
                  return (
                    <Card>
                      <CardTitle>vs. Subject AVM</CardTitle>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#4a6a9a' }}>Subject AVM</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0' }}>${avm.toLocaleString()}</span>
                          {delta != null && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: Math.abs(delta) < 5 ? 'rgba(76,175,154,0.12)' : 'rgba(201,168,76,0.12)', color: Math.abs(delta) < 5 ? '#4CAF9A' : '#C9A84C' }}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })()}
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ─── Maps Module ──────────────────────────────────────────────────────────────

function MapsModule({ mlsComps, leadAddress }: { mlsComps: MlsCompsResult | null; leadAddress: string }) {
  const subjectLat = mlsComps?.subject_lat ?? null
  const subjectLng = mlsComps?.subject_lng ?? null
  const hasMapData = !!(subjectLat && subjectLng && mlsComps && [...mlsComps.sold, ...mlsComps.active].some(c => c.lat))

  if (!mlsComps) {
    return (
      <Card style={{ textAlign: 'center' as const, padding: 24 }}>
        <svg width="32" height="32" fill="none" stroke="#4a6a9a" viewBox="0 0 24 24" style={{ margin: '0 auto 8px', display: 'block' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Map loads with comps data</div>
        <div style={{ fontSize: 11, color: '#4a6a9a' }}>Expand Market Analysis and fetch comps to enable the map view.</div>
      </Card>
    )
  }

  if (!hasMapData) {
    return (
      <Card style={{ textAlign: 'center' as const, padding: 24 }}>
        <div style={{ fontSize: 11, color: '#4a6a9a' }}>No map coordinates available for this result set.</div>
      </Card>
    )
  }

  const totalComps = mlsComps.sold.length + mlsComps.active.length + mlsComps.pending.length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#4a6a9a' }}>
          {totalComps} comps · {mlsComps.radius_miles}mi radius
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
          {mlsComps.source === 'rentcast' ? 'Rentcast' : 'Beaches MLS'}
        </span>
      </div>
      <div style={{ borderRadius: 7, overflow: 'hidden', border: '1px solid #1a3050' }}>
        <Suspense fallback={<div style={{ height: 380, background: '#071829', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a6a9a', fontSize: 11 }}>Loading map…</div>}>
          <CompsMap
            subjectLat={subjectLat!}
            subjectLng={subjectLng!}
            subjectAddr={leadAddress}
            sold={mlsComps.sold as unknown as PropertyComp[]}
            active={mlsComps.active as unknown as PropertyComp[]}
            pending={mlsComps.pending as unknown as PropertyComp[]}
          />
        </Suspense>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, justifyContent: 'center' }}>
        {[
          { color: '#ef4444', label: 'Subject Property' },
          { color: '#4CAF9A', label: `Sold (${mlsComps.sold.length})` },
          { color: '#C9A84C', label: `Active (${mlsComps.active.length})` },
          { color: '#7B8FD4', label: `Pending (${mlsComps.pending.length})` },
        ].filter((_, i) => i === 0 || [mlsComps.sold.length, mlsComps.active.length, mlsComps.pending.length][i - 1] > 0).map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            <span style={{ fontSize: 10, color: '#4a6a9a' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Distressed Analysis Module ───────────────────────────────────────────────

function DistressedAnalysisModule() {
  const { lead } = useWorkspace()
  const ds   = daysSince(lead.file_date)
  const dClr = distressColor(ds)
  const [caseNumber, setCaseNumber] = useState<string | null>(lead.case_number ?? null)

  const marketVal    = Number(lead.market_value ?? 0)
  const loanBalance  = Number(lead.foreclosure_amount ?? 0)
  const equityDollar = Number(lead.equity_dollar_amount ?? 0)
  const equityPct    = Number(lead.equity_percentage ?? 0)
  const ltv          = marketVal > 0 && loanBalance > 0 ? (loanBalance / marketVal) * 100 : null

  const countyLinks: Record<string, string> = {
    'miami-dade': 'https://www.miami-dadeclerk.com/ocs/CaseSearch.aspx',
    'broward':    'https://www.browardclerk.org/Web2/CaseSearch',
    'palm-beach': 'https://courtrecords.mypalmbeachclerk.com/DORIS',
  }

  const hasDistress = lead.is_foreclosure || lead.is_pre_foreclosure || lead.file_date || lead.foreclosure_status_override

  return (
    <div>
      {/* Foreclosure Status Override */}
      <ForeclosureStatusEditor />

      {/* Distress Timeline */}
      {ds !== null && (
        <div style={{ background: '#0A1F44', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em', color: '#fff' }}>Distress Timeline</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: dClr }}>{ds} days</div>
          </div>
          <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.1)', marginBottom: 6 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 4, background: dClr, width: `${Math.min(100, (ds / 365) * 100)}%`, transition: 'width 0.7s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
            <span>Filed</span>
            <span style={{ color: '#4CAF9A' }}>30d</span>
            <span style={{ color: '#C9A84C' }}>90d</span>
            <span style={{ color: '#E07B6A' }}>180d</span>
            <span style={{ color: '#ef4444' }}>365d</span>
          </div>
          <div style={{ fontSize: 11, marginTop: 8, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
            {ds <= 30  ? 'Early stage — high potential to negotiate before auction'
           : ds <= 90  ? 'Mid stage — owner likely receiving calls. Act now.'
           : ds <= 180 ? 'Late stage — auction may be scheduled. Verify status.'
           : 'Critical — auction imminent or may have occurred. Verify immediately.'}
          </div>
        </div>
      )}

      {!hasDistress && (
        <Card style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#4a6a9a', textAlign: 'center' as const, padding: '8px 0' }}>No active foreclosure data for this property.</div>
        </Card>
      )}

      {/* Mortgage / Equity */}
      {(marketVal > 0 || loanBalance > 0) && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
            <Tile label="Est. Loan Balance" value={fmtK(loanBalance)} color="#E07B6A" sub="from FC filing" />
            <Tile label="Market Value"      value={fmtK(marketVal)}   color="#e2e8f0" />
            <Tile label="Est. Equity"
              value={equityDollar > 0 ? fmtK(equityDollar) : '—'}
              sub={equityPct > 0 ? `${equityPct.toFixed(1)}%` : undefined}
              color={EQUITY_COLORS[lead.equity_tier ?? ''] ?? '#9ca3af'} />
            {ltv !== null && (
              <Tile label="Est. LTV" value={`${ltv.toFixed(1)}%`} color={ltv > 90 ? '#E07B6A' : ltv > 70 ? '#C9A84C' : '#4CAF9A'} />
            )}
          </div>

          {marketVal > 0 && loanBalance > 0 && (
            <Card style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginBottom: 5 }}>
                <span>Loan ({ltv?.toFixed(0)}%)</span>
                <span>Equity ({(100 - (ltv ?? 0)).toFixed(0)}%)</span>
              </div>
              <div style={{ display: 'flex', height: 14, borderRadius: 6, overflow: 'hidden', marginBottom: 5 }}>
                <div style={{ height: '100%', background: '#ef4444', width: `${Math.min(100, ltv ?? 0)}%`, transition: 'width 0.5s' }} />
                <div style={{ height: '100%', flex: 1, background: EQUITY_COLORS[lead.equity_tier ?? ''] ?? '#4CAF9A', opacity: 0.7 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6a9a' }}>
                <span>{fmtK(loanBalance)}</span>
                <span>{fmtK(equityDollar > 0 ? equityDollar : marketVal - loanBalance)}</span>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Case Details */}
      {hasDistress && (
        <Card style={{ marginBottom: 10 }}>
          <CardTitle>Case Details</CardTitle>
          <CaseNumberRow
            propertyId={lead.property_id ?? lead.id}
            initialValue={caseNumber}
            onSaved={val => setCaseNumber(val)}
          />
          <KV k="Folio / APN"    v={lead.folio_number} />
          <KV k="Date Filed"     v={lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null} />
          <KV k="Case Type"      v={lead.foreclosure_type === 'P' ? 'Pre-Foreclosure (Lis Pendens)' : lead.foreclosure_type} />
          <KV k="Plaintiff"      v={lead.plaintiff} />
          <KV k="Lender"         v={lead.lender_name} />
          <KV k="Loan Balance"   v={lead.foreclosure_amount ? fmtMoneyFull(lead.foreclosure_amount) : null} />
          <KV k="Multiple Liens" v={lead.multiple_liens ? 'Yes — Verify all lien positions' : 'No'} />
          <KV k="County"         v={COUNTY_LABELS[lead.county ?? ''] ?? lead.county} />
          <KV k="Data Source"    v={lead.data_source} />
        </Card>
      )}

      {/* Lender detail */}
      {(lead.lender_name || lead.equity_tier) && (
        <Card style={{ marginBottom: 10 }}>
          <KV k="Lender"         v={lead.lender_name} />
          <KV k="Equity Tier"    v={lead.equity_tier} />
          <KV k="Multiple Liens" v={lead.multiple_liens ? 'Yes — verify all positions' : 'No'} />
        </Card>
      )}

      {/* County clerk link */}
      {lead.county && countyLinks[lead.county] && (
        <a href={countyLinks[lead.county]} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 7, background: 'rgba(201,168,76,0.08)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)', textDecoration: 'none', fontSize: 11, fontWeight: 600, marginBottom: 10 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Verify on {COUNTY_LABELS[lead.county] ?? lead.county} Clerk Website →
        </a>
      )}

      <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 7, padding: '10px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#C9A84C', marginBottom: 4 }}>⚠ Data Note</div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          Loan balance is estimated from the foreclosure filing amount and may not reflect current payoff.
          Full mortgage history available via title search or skip trace.
        </div>
      </div>
    </div>
  )
}

// ─── Rental Analysis Module ───────────────────────────────────────────────────

interface RentalEstimate {
  rent:          number | null
  rentRangeLow:  number | null
  rentRangeHigh: number | null
}

function RentalAnalysisModule({ leadAddress }: { leadAddress: string }) {
  const { lead } = useWorkspace()
  const [data,    setData]    = useState<RentalEstimate | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [noKey,   setNoKey]   = useState(false)

  const fetchRental = async () => {
    if (!leadAddress) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/rentals/estimate?address=${encodeURIComponent(leadAddress)}`)
      const d   = await res.json()
      if (!res.ok) {
        if (d.code === 'NO_CREDENTIALS') { setNoKey(true); return }
        setError(d.error ?? 'Failed to fetch rental estimate')
      } else {
        setData(d)
      }
    } catch { setError('Network error — please try again') }
    finally   { setLoading(false) }
  }

  const mv         = Number(lead.market_value ?? 0)
  const monthlyRent = data?.rent ?? 0
  const annualRent  = monthlyRent * 12
  const capRate     = mv > 0 && annualRent > 0 ? ((annualRent * 0.6) / mv) * 100 : null
  const grossYield  = mv > 0 && annualRent > 0 ? (annualRent / mv) * 100 : null
  const grm         = mv > 0 && annualRent > 0 ? mv / annualRent : null

  if (noKey) return (
    <Card style={{ textAlign: 'center' as const, padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Rentcast Key Required</div>
      <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>The same Rentcast API key powers both comps and rental estimates.</div>
      <code style={{ fontSize: 10, color: '#4CAF9A', background: '#060e1a', padding: '4px 8px', borderRadius: 4 }}>RENTCAST_API_KEY=your_key_here</code>
    </Card>
  )

  if (!data && !loading) return (
    <div>
      {mv > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
          <Tile label="Market Value"   value={fmtK(mv)}           color="#e2e8f0" />
          <Tile label="Beds"           value={lead.beds    ? `${lead.beds} bd`  : '—'} />
          <Tile label="Sqft"           value={lead.living_area ? `${lead.living_area.toLocaleString()}` : '—'} />
        </div>
      )}
      <Card style={{ textAlign: 'center' as const, padding: 20 }}>
        <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>Get a long-term rental estimate for this property via Rentcast.</div>
        <button onClick={fetchRental} disabled={loading}
          style={{ padding: '6px 18px', borderRadius: 6, background: '#1a3050', border: '1px solid rgba(76,175,154,0.35)', color: '#4CAF9A', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          ↻ Get Rental Estimate
        </button>
      </Card>
    </div>
  )

  if (loading) return (
    <Card style={{ textAlign: 'center' as const, padding: 28 }}>
      <div style={{ width: 24, height: 24, border: '2px solid #4CAF9A', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
      <div style={{ fontSize: 11, color: '#4a6a9a' }}>Fetching rental estimate…</div>
    </Card>
  )

  if (error) return (
    <Card style={{ textAlign: 'center' as const, padding: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>Fetch Error</div>
      <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>{error}</div>
      <button onClick={fetchRental}
        style={{ padding: '5px 14px', background: '#1a3050', border: '1px solid #C9A84C44', color: '#C9A84C', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
        Try Again
      </button>
    </Card>
  )

  return (
    <div>
      {/* Main rent tile */}
      <div style={{ background: 'linear-gradient(135deg, #0a2518 0%, #0f2d1e 100%)', borderRadius: 8, padding: 16, marginBottom: 12, border: '1px solid rgba(76,175,154,0.25)' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'rgba(76,175,154,0.7)', marginBottom: 8 }}>Long-Term Rental Estimate</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 900, color: '#4CAF9A' }}>{monthlyRent ? `$${monthlyRent.toLocaleString()}` : '—'}</span>
          <span style={{ fontSize: 11, color: 'rgba(76,175,154,0.6)' }}>/mo</span>
        </div>
        {data?.rentRangeLow && data?.rentRangeHigh && (
          <div style={{ fontSize: 11, color: 'rgba(76,175,154,0.6)' }}>
            Range: ${data.rentRangeLow.toLocaleString()} – ${data.rentRangeHigh.toLocaleString()}/mo
          </div>
        )}
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
        <Tile label="Annual Gross"  value={annualRent  ? fmtK(annualRent)          : '—'} color="#4CAF9A" />
        <Tile label="Gross Yield"   value={grossYield  ? `${grossYield.toFixed(1)}%` : '—'} color={grossYield ? (grossYield >= 8 ? '#4CAF9A' : grossYield >= 5 ? '#C9A84C' : '#E07B6A') : undefined} />
        <Tile label="Cap Rate (est)" value={capRate    ? `${capRate.toFixed(1)}%`   : '—'} sub="~40% expenses"
          color={capRate ? (capRate >= 6 ? '#4CAF9A' : capRate >= 4 ? '#C9A84C' : '#E07B6A') : undefined} />
        <Tile label="GRM"           value={grm         ? grm.toFixed(1)              : '—'} sub="lower = better" />
      </div>

      {mv > 0 && (
        <Card style={{ marginBottom: 10 }}>
          <KV k="Market Value"     v={fmtK(mv)}                            vColor="#C9A84C" />
          <KV k="Monthly Rent"     v={monthlyRent ? `$${monthlyRent.toLocaleString()}` : '—'} vColor="#4CAF9A" />
          <KV k="Annual Gross"     v={annualRent  ? fmtK(annualRent)         : '—'} />
          <KV k="Rent-to-Value"    v={grossYield  ? `${(grossYield / 12).toFixed(2)}%/mo` : '—'} />
        </Card>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10, color: '#4a6a9a' }}>Source: Rentcast · Long-term rental AVM</div>
        <button onClick={fetchRental}
          style={{ fontSize: 10, color: '#4a6a9a', background: 'none', border: '1px solid #1a3050', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}

// ─── Financial Analysis Module ────────────────────────────────────────────────

function FinancialAnalysisModule() {
  const { lead, setActiveTab } = useWorkspace()
  const [arv,     setArv]     = useState('')
  const [repairs, setRepairs] = useState('')
  const [hold,    setHold]    = useState('')

  const arvNum      = parseFloat(arv.replace(/[^0-9.]/g, ''))     || 0
  const repairsNum  = parseFloat(repairs.replace(/[^0-9.]/g, '')) || 0
  const holdNum     = parseFloat(hold.replace(/[^0-9.]/g, ''))    || 0
  const closingCost = lead.estimated_value ? Math.round(lead.estimated_value * 0.015) : 0
  const totalIn     = (lead.offer_amount ?? 0) + repairsNum + holdNum + closingCost
  const estProfit   = arvNum > 0 ? arvNum - totalIn : null
  const mv          = lead.estimated_value ?? 0
  const mao         = arvNum > 0 ? arvNum * 0.7 - repairsNum : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div>
        <Card style={{ marginBottom: 12 }}>
          <CardTitle>Valuation Reference</CardTitle>
          {mv > 0              && <KV k="Est. Market Value" v={fmtMoneyFull(mv)}                   vColor="#C9A84C" />}
          {lead.assessed_value && <KV k="Tax Assessed"      v={fmtMoneyFull(lead.assessed_value)}   />}
          {lead.offer_amount   && <KV k="Our Offer"         v={fmtMoneyFull(lead.offer_amount)}     vColor="#C9A84C" />}
          {lead.lead_score != null && <KV k="Lead Score"    v={`${lead.lead_score} / 100`}          vColor="#C9A84C" />}
          {mao !== null        && <KV k="MAO (70% Rule)"    v={fmtMoneyFull(mao)}                   vColor={mao > 0 ? '#4CAF9A' : '#ef4444'} />}
        </Card>

        <Card>
          <CardTitle>Deal Calculator</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {[
              { label: 'ARV ($)',          value: arv,     setter: setArv,     placeholder: 'After-repair value' },
              { label: 'Est. Repairs ($)', value: repairs, setter: setRepairs, placeholder: 'Rehab cost'         },
              { label: 'Hold Costs ($)',   value: hold,    setter: setHold,    placeholder: 'Holding / carry'    },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 2 }}>{f.label}</div>
                <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                  style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, padding: '5px 8px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
            ))}
          </div>

          <div style={{ background: '#060e1a', borderRadius: 5, padding: 10 }}>
            {[
              { label: 'Purchase Price', value: lead.offer_amount ? fmtMoneyFull(lead.offer_amount) : '—' },
              { label: 'Est. Repairs',   value: repairsNum > 0    ? fmtMoneyFull(repairsNum)         : '—' },
              { label: 'Hold Costs',     value: holdNum > 0       ? fmtMoneyFull(holdNum)             : '—' },
              { label: 'Closing Costs',  value: closingCost > 0   ? fmtMoneyFull(closingCost)         : '—' },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ fontSize: 11, color: '#4a6a9a' }}>{r.label}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0' }}>{r.value}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #1a3050', marginTop: 5, paddingTop: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ fontSize: 11, color: '#4a6a9a' }}>Total In</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{totalIn > 0 ? fmtMoneyFull(totalIn) : '—'}</span>
              </div>
            </div>
            <div style={{ borderTop: '1px solid #1a3050', marginTop: 5, paddingTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#4a6a9a' }}>Est. Profit</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: estProfit != null ? (estProfit > 0 ? '#4ade80' : '#ef4444') : '#4a6a9a' }}>
                  {estProfit != null ? fmtMoneyFull(estProfit) : 'Enter ARV →'}
                </span>
              </div>
            </div>
          </div>

          {!lead.offer_amount && (
            <button onClick={() => setActiveTab('offer')}
              style={{ marginTop: 8, width: '100%', padding: '6px', borderRadius: 5, background: '#1a3050', border: '1px solid #C9A84C44', color: '#C9A84C', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Make an Offer →
            </button>
          )}
        </Card>
      </div>

      {/* Right column: quick metrics */}
      <div>
        {mv > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <Tile label="Market Value" value={fmtK(mv)} color="#C9A84C" />
            <Tile label="70% ARV" value={arvNum > 0 ? fmtK(arvNum * 0.7) : '—'} color="#4a6a9a" sub="rule of thumb" />
            <Tile label="Est. Profit" value={estProfit != null ? fmtK(estProfit) : '—'} color={estProfit != null ? (estProfit > 0 ? '#4ade80' : '#ef4444') : undefined} />
            <Tile label="Total In" value={totalIn > 0 ? fmtK(totalIn) : '—'} />
          </div>
        )}
        <Card>
          <CardTitle>Quick Reference</CardTitle>
          <KV k="Property Type" v={lead.property_type} />
          <KV k="Sqft"          v={lead.living_area ? `${lead.living_area.toLocaleString()} sf` : null} />
          <KV k="Year Built"    v={lead.year_built   ? String(lead.year_built) : null} />
          <KV k="Beds / Baths"  v={lead.beds && lead.baths ? `${lead.beds}bd / ${lead.baths}ba` : null} />
          <KV k="Lot Size"      v={lead.lot_size     ? `${lead.lot_size.toLocaleString()} sf` : null} />
          <KV k="Tax Amount"    v={lead.tax_amount   ? fmtMoneyFull(lead.tax_amount) + '/yr' : null} />
        </Card>
      </div>
    </div>
  )
}

// ─── AI Analysis Module ───────────────────────────────────────────────────────

function AIAnalysisModule() {
  const { lead, aiSummary: contextSummary } = useWorkspace()
  const [summary,    setSummary]  = useState<WorkspaceAISummary | null>(contextSummary)
  const [generating, setGen]      = useState(false)
  const [error,      setError]    = useState('')

  const generate = async (force = false) => {
    setGen(true); setError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/ai`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!res.ok) setError('AI analysis failed. Try again.')
      else         setSummary(await res.json())
    } catch { setError('Network error — please try again.') }
    finally   { setGen(false) }
  }

  const motivationLabel = summary?.motivation
    ? summary.motivation.replace('-', ' ').replace(/^\w/, c => c.toUpperCase()) : null
  const strategyLabel   = summary?.strategy
    ? STRATEGY_LABELS[summary.strategy] ?? summary.strategy : null

  if (!summary && !generating) return (
    <Card style={{ textAlign: 'center' as const, padding: '28px 16px' }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #0A1F44, #1a3a6e)', margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" fill="none" stroke="#C9A84C" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>AI Acquisition Analysis</div>
      <div style={{ fontSize: 11, color: '#4a6a9a', maxWidth: 280, margin: '0 auto 14px' }}>
        Distress score, motivation assessment, recommended strategy, and analysis summary.
      </div>
      <button onClick={() => generate(false)}
        style={{ padding: '7px 18px', borderRadius: 7, background: 'linear-gradient(135deg, #0A1F44, #1a3a6e)', color: '#C9A84C', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        ✦ Generate Analysis
      </button>
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 8 }}>{error}</div>}
    </Card>
  )

  if (generating) return (
    <Card style={{ textAlign: 'center' as const, padding: '32px' }}>
      <div style={{ width: 28, height: 28, border: '2px solid #C9A84C', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>Analyzing lead…</div>
      <div style={{ fontSize: 11, color: '#4a6a9a' }}>Evaluating distress signals, equity position, and acquisition potential</div>
    </Card>
  )

  return (
    <div>
      <div style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0f2d5e 100%)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em', color: '#fff' }}>AI Acquisition Assessment</div>
          <button onClick={() => generate(true)}
            style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
            ↺ Regenerate
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
          {[
            { label: 'Distress Score', value: summary?.distress_score, pct: (summary?.distress_score ?? 0) * 10 },
            { label: 'Lead Quality',   value: summary?.lead_quality,   pct: (summary?.lead_quality   ?? 0) * 10 },
          ].map(({ label, value, pct }) => (
            <div key={label} style={{ textAlign: 'center' as const }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(value) }}>{value ?? '—'}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{label.toUpperCase()}</div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, width: 48, margin: '5px auto 0' }}>
                <div style={{ height: '100%', borderRadius: 2, background: scoreColor(value), width: `${pct}%` }} />
              </div>
            </div>
          ))}
          {motivationLabel && (
            <div style={{ textAlign: 'center' as const }}>
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${motivationColor(summary?.motivation)}25`, color: motivationColor(summary?.motivation) }}>{motivationLabel}</span>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>MOTIVATION</div>
            </div>
          )}
          {summary?.urgency && (
            <div style={{ textAlign: 'center' as const }}>
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' as const, background: summary.urgency === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(201,168,76,0.2)', color: summary.urgency === 'high' ? '#ef4444' : '#C9A84C' }}>{summary.urgency.replace('-', ' ')}</span>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>URGENCY</div>
            </div>
          )}
        </div>
        {strategyLabel && (
          <div style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(201,168,76,0.7)' }}>RECOMMENDED STRATEGY</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C9A84C', marginTop: 2 }}>{strategyLabel}</div>
          </div>
        )}
      </div>
      {summary?.summary && (
        <Card style={{ marginBottom: 10 }}>
          <CardTitle>Analysis Summary</CardTitle>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>{summary.summary}</div>
        </Card>
      )}
      {summary?.highlights && summary.highlights.length > 0 && (
        <Card style={{ marginBottom: 10 }}>
          <CardTitle>Key Signals</CardTitle>
          {summary.highlights.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, padding: '3px 0' }}>
              <span style={{ color: '#C9A84C', marginTop: 1, flexShrink: 0 }}>▸</span>
              <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{h}</span>
            </div>
          ))}
        </Card>
      )}
      <div style={{ fontSize: 10, color: '#4a6a9a', textAlign: 'center' as const }}>
        Internal use only · Powered by {summary?.model ?? 'Claude'}
        {summary?.created_at ? ` · ${new Date(summary.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
      </div>
    </div>
  )
}

// ─── Short-Term Rental Module (Coming Soon) ───────────────────────────────────
// Architecture is provider-agnostic. To activate a provider:
//   1. Change its status from 'coming_soon' → 'active' in STR_PROVIDERS above
//   2. Add the API fetch logic in the active provider's render branch below
//   3. The card shell, tabs, and tile layout require no changes

function STRModule() {
  const [activeProvider, setActiveProvider] = useState<STRProviderId>('airdna')
  const provider = STR_PROVIDERS.find(p => p.id === activeProvider)!

  const placeholderTiles = [
    { label: 'Avg Nightly Rate', value: '$—',  color: '#4CAF9A' },
    { label: 'Occupancy Rate',   value: '—%',  color: '#C9A84C' },
    { label: 'Monthly Revenue',  value: '$—',  color: '#e2e8f0' },
    { label: 'Annual Revenue',   value: '$—',  color: '#e2e8f0' },
    { label: 'RevPAR',           value: '$—',  color: '#4a6a9a' },
    { label: 'ADR',              value: '$—',  color: '#4a6a9a' },
  ]

  return (
    <div style={{ position: 'relative' }}>
      {/* Provider tabs */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 14, borderBottom: '1px solid #1a3050', paddingBottom: 8 }}>
        {STR_PROVIDERS.map(p => (
          <button key={p.id} onClick={() => setActiveProvider(p.id)}
            style={{
              padding: '4px 11px', borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer',
              background: activeProvider === p.id ? `${p.accentColor}18` : 'transparent',
              color: activeProvider === p.id ? p.accentColor : '#4a6a9a',
              border: `1px solid ${activeProvider === p.id ? `${p.accentColor}40` : 'transparent'}`,
              transition: 'all 0.15s',
            }}>
            {p.name}
          </button>
        ))}
      </div>

      {/* Provider description */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#4a6a9a' }}>{provider.tagline}</div>
      </div>

      {/* Placeholder tiles — blurred when coming soon */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12, filter: 'blur(3px)', pointerEvents: 'none', userSelect: 'none' as const }}>
          {placeholderTiles.map(t => (
            <Tile key={t.label} label={t.label} value={t.value} color={t.color} />
          ))}
        </div>

        <div style={{ filter: 'blur(3px)', pointerEvents: 'none', userSelect: 'none' as const }}>
          <Card style={{ marginBottom: 10 }}>
            <CardTitle>Revenue Projection</CardTitle>
            <div style={{ height: 80, background: '#0a1729', borderRadius: 4 }} />
          </Card>
          <Card>
            <CardTitle>Occupancy Trend</CardTitle>
            <div style={{ height: 60, background: '#0a1729', borderRadius: 4 }} />
          </Card>
        </div>

        {/* Coming Soon overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(6,14,26,0.75)', borderRadius: 8,
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{ textAlign: 'center', padding: '0 24px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `${provider.accentColor}18`, border: `1px solid ${provider.accentColor}30`, margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" fill="none" stroke={provider.accentColor} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>{provider.name} Integration</div>
            <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 12, lineHeight: 1.5 }}>
              Short-term rental analysis coming soon.<br />
              {provider.tagline}.
            </div>
            <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: `${provider.accentColor}18`, color: provider.accentColor, border: `1px solid ${provider.accentColor}40` }}>
              Coming Soon
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Module icons ─────────────────────────────────────────────────────────────

const Icons = {
  market:    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  maps:      <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
  distress:  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  rental:    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  financial: <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
  ai:        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
  str:       <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>,
}

// ─── Main AnalyzeTab ──────────────────────────────────────────────────────────

export default function AnalyzeTab() {
  const { lead, comps, aiSummary } = useWorkspace()

  const leadAddress = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')

  // MLS comps state — lifted here so Market Analysis + Maps share the same fetch
  const [mlsComps,      setMlsComps]      = useState<MlsCompsResult | null>(null)
  const [mlsLoading,    setMlsLoading]    = useState(false)
  const [mlsError,      setMlsError]      = useState<string | null>(null)
  const [noCredentials, setNoCredentials] = useState(false)
  const [mlsCached,     setMlsCached]     = useState(false)

  const fetchComps = useCallback(async (filter: CompsFilter = DEFAULT_FILTER) => {
    if (!leadAddress) return
    setMlsLoading(true); setMlsError(null)
    try {
      const p = new URLSearchParams({ address: leadAddress })
      p.set('radius', String(filter.radiusMi))
      p.set('months', String(filter.monthsBack))
      if (filter.propertyType) p.set('propertyType', filter.propertyType)
      if (filter.minPrice)     p.set('minPrice', filter.minPrice)
      if (filter.maxPrice)     p.set('maxPrice', filter.maxPrice)
      if (filter.beds)         p.set('beds', filter.beds)
      if (filter.baths)        p.set('baths', filter.baths)
      // Pass property_id so the API can gate on the comps freshness TTL (14 days)
      const pid = lead.property_id ?? lead.id
      if (pid) p.set('property_id', pid)
      const res  = await fetch(`/api/mls/comps?${p}`)
      const data = await res.json()
      if (!res.ok) {
        setMlsCached(false)
        if (data.code === 'NO_CREDENTIALS') setNoCredentials(true)
        else setMlsError(data.error ?? 'Failed to fetch comps')
      } else if (data.cached) {
        // Data is within the 14-day freshness window — keep existing comp state unchanged
        setMlsCached(true)
      } else {
        setMlsCached(false)
        setMlsComps(data as MlsCompsResult)
      }
    } catch { setMlsCached(false); setMlsError('Network error — please try again') }
    finally   { setMlsLoading(false) }
  }, [leadAddress])

  // Auto-fetch on mount when no cached comps
  useEffect(() => { if (comps.length === 0) fetchComps() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Summary values for collapsed module headers
  const hasDistress   = !!(lead.is_foreclosure || lead.is_pre_foreclosure || lead.file_date || lead.foreclosure_status_override)
  const effectiveFC   = lead.foreclosure_status_override ?? (lead.is_foreclosure ? 'Active FC' : lead.is_pre_foreclosure ? 'Pre-FC' : null)
  const distressDays  = daysSince(lead.file_date)
  const marketVal     = Number(lead.market_value ?? 0)
  const loanBalance   = Number(lead.foreclosure_amount ?? 0)
  const ltv           = marketVal > 0 && loanBalance > 0 ? (loanBalance / marketVal) * 100 : null
  const compCount     = mlsComps ? mlsComps.sold.length + mlsComps.active.length : comps.length
  const hasAI         = !!aiSummary

  return (
    <div>
      {/* ── Market Analysis ─────────────────────────────────────────────────── */}
      <ModuleCard
        icon={Icons.market}
        title="Market Analysis"
        badge="MLS Comps"
        badgeColor="#4CAF9A"
        defaultExpanded={true}
        summaryItems={compCount > 0 ? [
          { label: 'comps', value: String(compCount), color: '#4CAF9A' },
          ...(mlsComps?.median_sold_price ? [{ label: 'median', value: fmtK(mlsComps.median_sold_price), color: '#C9A84C' }] : []),
        ] : undefined}
      >
        <MarketAnalysisModule
          leadAddress={leadAddress}
          mlsComps={mlsComps}
          mlsLoading={mlsLoading}
          mlsError={mlsError}
          noCredentials={noCredentials}
          mlsCached={mlsCached}
          onFetch={fetchComps}
        />
      </ModuleCard>

      {/* ── Maps ────────────────────────────────────────────────────────────── */}
      <ModuleCard
        icon={Icons.maps}
        title="Maps"
        badge={mlsComps ? `${compCount} pins` : undefined}
        badgeColor="#6B9FD4"
        defaultExpanded={!!mlsComps}
        summaryItems={mlsComps ? [{ label: 'radius', value: `${mlsComps.radius_miles}mi` }] : undefined}
      >
        <MapsModule mlsComps={mlsComps} leadAddress={leadAddress} />
      </ModuleCard>

      {/* ── Distressed Analysis ─────────────────────────────────────────────── */}
      <ModuleCard
        icon={Icons.distress}
        title="Distressed Analysis"
        badge={hasDistress && effectiveFC ? effectiveFC : undefined}
        badgeColor={effectiveFC ? (FC_STATUS_COLORS[effectiveFC] ?? '#E07B6A') : '#E07B6A'}
        defaultExpanded={hasDistress}
        summaryItems={[
          ...(distressDays != null ? [{ label: 'days', value: String(distressDays), color: distressColor(distressDays) }] : []),
          ...(ltv != null ? [{ label: 'LTV', value: `${ltv.toFixed(0)}%`, color: ltv > 90 ? '#E07B6A' : ltv > 70 ? '#C9A84C' : '#4CAF9A' }] : []),
          ...(marketVal > 0 ? [{ label: 'value', value: fmtK(marketVal) }] : []),
        ]}
      >
        <DistressedAnalysisModule />
      </ModuleCard>

      {/* ── Rental Analysis ─────────────────────────────────────────────────── */}
      <ModuleCard
        icon={Icons.rental}
        title="Rental Analysis"
        badge="Long-Term"
        badgeColor="#4CAF9A"
        defaultExpanded={false}
        summaryItems={marketVal > 0 ? [{ label: 'value', value: fmtK(marketVal) }] : undefined}
      >
        <RentalAnalysisModule leadAddress={leadAddress} />
      </ModuleCard>

      {/* ── Financial Analysis ───────────────────────────────────────────────── */}
      <ModuleCard
        icon={Icons.financial}
        title="Financial Analysis"
        badge="Deal Calculator"
        badgeColor="#C9A84C"
        defaultExpanded={false}
        summaryItems={[
          ...(lead.offer_amount ? [{ label: 'offer', value: fmtK(lead.offer_amount), color: '#C9A84C' }] : []),
          ...(marketVal > 0 ? [{ label: 'value', value: fmtK(marketVal) }] : []),
        ]}
      >
        <FinancialAnalysisModule />
      </ModuleCard>

      {/* ── AI Analysis ─────────────────────────────────────────────────────── */}
      <ModuleCard
        icon={Icons.ai}
        title="AI Analysis"
        badge={hasAI ? `Score ${aiSummary?.distress_score ?? '—'}/10` : 'Claude'}
        badgeColor="#C9A84C"
        defaultExpanded={false}
        summaryItems={hasAI ? [
          { label: 'distress', value: String(aiSummary?.distress_score ?? '—'), color: scoreColor(aiSummary?.distress_score) },
          ...(aiSummary?.strategy ? [{ label: '', value: STRATEGY_LABELS[aiSummary.strategy] ?? aiSummary.strategy, color: '#C9A84C' }] : []),
        ] : undefined}
      >
        <AIAnalysisModule />
      </ModuleCard>

      {/* ── Short-Term Rental (Coming Soon) ─────────────────────────────────── */}
      <ModuleCard
        icon={Icons.str}
        title="Short-Term Rental"
        badge="Airbnb / VRBO"
        badgeColor="#FF5A5F"
        locked={true}
        lockedLabel="Coming Soon"
        defaultExpanded={false}
      >
        <STRModule />
      </ModuleCard>

      {/* ── Data Passport ────────────────────────────────────────────────────── */}
      <DataPassportPanel />
    </div>
  )
}
