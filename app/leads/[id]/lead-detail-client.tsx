'use client'

import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import PropertyMapCard from '@/components/PropertyMapCard'
import dynamic from 'next/dynamic'
import type { CompsResult } from '@/lib/mls/beaches-mls'

const CompsMap = lazy(() => import('@/components/CompsMap'))
const EmailComposer = dynamic(() => import('@/components/EmailComposer'), { ssr: false })
const DocumentsTab  = dynamic(() => import('@/components/DocumentsTab'),  { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = Record<string, any>

interface AISummary {
  id?: string
  distress_score?: number
  motivation?: string
  strategy?: string
  urgency?: string
  lead_quality?: number
  summary?: string
  highlights?: string[]
  model?: string
  created_at?: string
}

interface Note {
  id: string
  body: string
  author: string
  created_at: string
}

interface Comp {
  id: string
  address: string
  sale_price: number | null
  list_price: number | null
  status: string
  beds: number | null
  baths: number | null
  sqft: number | null
  year_built: number | null
  distance_miles: number | null
  price_per_sqft: number | null
  sale_date: string | null
}

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  created_at: string
}

interface Contact {
  id: string
  name: string
  phone: string
  email: string
}

type TabKey = 'overview' | 'foreclosure' | 'mortgage' | 'comps' | 'contacts' | 'communications' | 'documents' | 'ai'

// ─── Lead-Contact types ───────────────────────────────────────────────────────

interface LinkedContact {
  id:                string
  relationship_type: string
  is_primary:        boolean
  notes:             string | null
  created_at:        string
  contact: {
    id:       string
    name:     string
    phone:    string | null
    email:    string | null
    address:  string | null
    category: string | null
    status:   string | null
  }
}

const RELATIONSHIP_TYPES = [
  'Owner', 'Co-owner', 'Heir', 'Spouse', 'Attorney',
  'Agent', 'Lender', 'Buyer', 'Wholesaler', 'Other',
]

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTY_LABELS: Record<string, string> = {
  'miami-dade': 'Miami-Dade',
  'broward':    'Broward',
  'palm-beach': 'Palm Beach',
}

const EQUITY_COLORS: Record<string, string> = {
  High:   '#4CAF9A',
  Medium: '#C9A84C',
  Low:    '#7B8FD4',
  None:   '#9ca3af',
}

const STRATEGY_LABELS: Record<string, string> = {
  'cash':             'Cash Offer',
  'creative-finance': 'Creative Finance',
  'list':             'List & Sell',
  'skip':             'Skip — Low Priority',
}

const STAGE_OPTIONS = [
  { value: '',           label: 'No Stage' },
  { value: 'reviewing',  label: 'Reviewing' },
  { value: 'contacted',  label: 'Contacted' },
  { value: 'offer',      label: 'Offer' },
  { value: 'dead',       label: 'Dead' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function fmtK(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function distressColor(days: number | null): string {
  if (days === null) return '#9ca3af'
  if (days <= 30)   return '#4CAF9A'
  if (days <= 90)   return '#C9A84C'
  if (days <= 180)  return '#E07B6A'
  return '#ef4444'
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return '#9ca3af'
  if (score >= 8)    return '#4CAF9A'
  if (score >= 5)    return '#C9A84C'
  return '#E07B6A'
}

function motivationColor(m: string | null | undefined): string {
  if (!m) return '#9ca3af'
  if (m === 'very-high') return '#ef4444'
  if (m === 'high')      return '#E07B6A'
  if (m === 'medium')    return '#C9A84C'
  return '#9ca3af'
}

// ─── Stat Tile ────────────────────────────────────────────────────────────────

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: color ?? 'var(--c-primary)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{sub}</p>}
    </div>
  )
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-xs shrink-0 w-36 pt-0.5" style={{ color: 'var(--c-text-2)' }}>{label}</span>
      <span className="text-sm font-medium text-right" style={{ color: 'var(--c-primary)' }}>{value || '—'}</span>
    </div>
  )
}

// ─── Editable Case Number Row ─────────────────────────────────────────────────

function CaseNumberRow({
  propertyId,
  initialValue,
  onSaved,
}: {
  propertyId: string
  initialValue: string | null
  onSaved: (val: string) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [value,   setValue]     = useState(initialValue ?? '')
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // If we get a value from parent (e.g. REAPI filled it in), update state
  useEffect(() => { setValue(initialValue ?? '') }, [initialValue])

  const startEdit = () => {
    setEditing(true)
    setError('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const cancel = () => {
    setEditing(false)
    setValue(initialValue ?? '')
    setError('')
  }

  const save = async () => {
    const trimmed = value.trim()
    if (!trimmed) { setError('Case number cannot be empty'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/properties/${propertyId}/case-number`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: trimmed }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      onSaved(trimmed)
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const hasValue = Boolean(initialValue)

  return (
    <div className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-xs shrink-0 w-36 pt-0.5" style={{ color: 'var(--c-text-2)' }}>Case Number</span>

      {editing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            placeholder="e.g. CACE-25-012345"
            className="text-sm rounded-lg px-2 py-1 w-44"
            style={{
              backgroundColor: 'var(--c-card-alt)',
              border: `1px solid ${error ? '#ef4444' : 'var(--c-border)'}`,
              color: 'var(--c-primary)',
              outline: 'none',
            }}
          />
          <button
            onClick={save}
            disabled={saving}
            className="text-xs font-semibold px-2 py-1 rounded-lg transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.3)' }}
          >
            {saving ? '…' : '✓'}
          </button>
          <button
            onClick={cancel}
            className="text-xs px-2 py-1 rounded-lg transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium text-right"
            style={{ color: hasValue ? 'var(--c-primary)' : 'rgba(255,255,255,0.25)', fontStyle: hasValue ? 'normal' : 'italic' }}
          >
            {hasValue ? initialValue : 'Pending lookup'}
          </span>
          <button
            onClick={startEdit}
            title="Edit case number"
            className="text-xs transition-opacity hover:opacity-80"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            ✎
          </button>
        </div>
      )}

      {error && (
        <div className="absolute text-[10px] mt-8 right-5" style={{ color: '#ef4444' }}>{error}</div>
      )}
    </div>
  )
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, label, size = 80 }: { score: number | null | undefined; label: string; size?: number }) {
  const n = score ?? 0
  const r = (size / 2) - 8
  const circ = 2 * Math.PI * r
  const filled = (n / 10) * circ
  const color = scoreColor(score)

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} stroke="var(--c-border)" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={6}
          stroke={color}
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
          className="rotate-90" style={{ fontSize: size * 0.28, fontWeight: 700, fill: color, transform: `rotate(90deg) translate(0, -${size/2}px)` }}>
        </text>
      </svg>
      <div className="text-center -mt-1">
        <p className="text-2xl font-black" style={{ color }}>{score ?? '—'}</p>
        <p className="text-[11px] font-semibold" style={{ color: 'var(--c-text-3)' }}>{label}</p>
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ lead, onReenrich, enriching, onDeepEnrich, deepEnriching, deepEnrichMsg }: {
  lead: Lead
  onReenrich: () => void
  enriching: boolean
  onDeepEnrich?: () => void
  deepEnriching?: boolean
  deepEnrichMsg?: string
}) {
  const phones = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5].filter(Boolean)

  return (
    <div className="space-y-5">
      {/* Property Details + Map side-by-side */}
      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Left: Property Details */}
        <div className="flex-1 min-w-0 rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Property Details</h3>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <Tile label="Beds" value={lead.beds ?? '—'} />
            <Tile label="Baths" value={lead.baths ?? '—'} />
            <Tile label="Sqft" value={lead.living_area ? Number(lead.living_area).toLocaleString() : '—'} sub="living area" />
            <Tile label="Year Built" value={lead.year_built ?? '—'} />
            {lead.lot_size && <Tile label="Lot Size" value={Number(lead.lot_size).toLocaleString()} sub="sqft" />}
            {lead.property_type && <Tile label="Type" value={lead.property_type} />}
            {lead.subdivision_name && <Tile label="Subdivision" value={lead.subdivision_name} />}
            <Tile
              label="Occupancy"
              value={lead.homestead ? 'Owner-Occupied' : lead.vacant ? 'Vacant' : 'Unknown'}
              color={lead.homestead ? '#4CAF9A' : lead.vacant ? '#E07B6A' : '#9ca3af'}
            />
          </div>
          <div>
            <InfoRow label="Property Address" value={lead.property_address} />
            <InfoRow label="City / State / ZIP" value={`${lead.city || ''}${lead.city && lead.zip ? ', ' : ''}${lead.zip ? `FL ${lead.zip}` : ''}`} />
            <InfoRow label="County" value={COUNTY_LABELS[lead.county] ?? lead.county} />
            {lead.subdivision_name && <InfoRow label="Subdivision" value={lead.subdivision_name} />}
          </div>
        </div>

        {/* Right: Map Card */}
        <div className="w-full md:w-72 shrink-0">
          <PropertyMapCard
            address={lead.property_address ?? ''}
            city={lead.city}
            zip={lead.zip}
            county={lead.county}
            folio={lead.folio_number}
          />
        </div>
      </div>

      {/* Data Source badge + Deep Enrich button */}
      {(lead.enrichment_src || lead.enriched_at) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>
              {lead.enrichment_src === 'miami-dade-pa' ? 'Miami-Dade Property Appraiser'
                : lead.enrichment_src === 'broward-pa'    ? 'Broward County Property Appraiser'
                : lead.enrichment_src === 'palm-beach-pa' ? 'Palm Beach County Property Appraiser'
                : lead.enrichment_src === 'reapi'         ? 'RealEstateAPI.com'
                : lead.enrichment_src ?? 'Property Appraiser'}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: lead.enrichment_src === 'reapi'
                  ? 'rgba(107,189,224,0.15)' : 'rgba(76,175,154,0.15)',
                color: lead.enrichment_src === 'reapi' ? '#6ABDE0' : '#4CAF9A',
              }}>
              {lead.enrichment_src === 'reapi' ? 'Paid' : 'Public'}
            </span>
            {lead.enriched_at && (
              <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                · updated {new Date(lead.enriched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          {lead.enrichment_src !== 'reapi' && onDeepEnrich && (
            <div className="flex items-center gap-2">
              {deepEnrichMsg && (
                <span className="text-[10px]"
                  style={{ color: deepEnrichMsg.startsWith('Enriched') || deepEnrichMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>
                  {deepEnrichMsg}
                </span>
              )}
              <button
                onClick={onDeepEnrich}
                disabled={deepEnriching}
                className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: 'rgba(107,189,224,0.15)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.3)' }}>
                {deepEnriching ? '…' : 'Deep Enrich'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Valuation */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Valuation</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Tile label="Market Value"  value={fmtK(lead.market_value)}   color="var(--c-primary)" />
          <Tile label="Assessed Value" value={fmtK(lead.assessed_value)} color="var(--c-text-2)" />
          <Tile
            label="Equity"
            value={lead.equity_dollar_amount ? fmtK(lead.equity_dollar_amount) : '—'}
            sub={lead.equity_percentage ? `${Number(lead.equity_percentage).toFixed(1)}% — ${lead.equity_tier}` : undefined}
            color={EQUITY_COLORS[lead.equity_tier] ?? '#9ca3af'}
          />
          {lead.foreclosure_amount && (
            <Tile label="Loan Balance" value={fmtK(lead.foreclosure_amount)} sub="estimated" color="#E07B6A" />
          )}
        </div>
      </div>

      {/* Ownership */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Ownership</h3>
        <InfoRow label="Owner Name"      value={lead.owner_name || lead.mortgagor} />
        <InfoRow label="Entity Type"     value={lead.entity_type} />
        <InfoRow label="Homestead"       value={lead.homestead ? '✓ Yes — Owner Occupied' : 'No'} />
        <InfoRow label="Vacant"          value={lead.vacant ? '✓ Yes' : 'No'} />
        <InfoRow label="Multiple Liens"  value={lead.multiple_liens ? '⚠ Yes' : 'No'} />
        {lead.mailing_address && (
          <InfoRow label="Mailing Address" value={lead.mailing_address} />
        )}
        {lead.owner_state && lead.owner_state !== 'FL' && (
          <InfoRow label="Owner State" value={
            <span className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
              Out-of-State · {lead.owner_state}
            </span>
          } />
        )}
        {phones.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--c-text-3)' }}>PHONE NUMBERS</p>
            <div className="flex flex-wrap gap-2">
              {phones.map((p: string, i: number) => (
                <a
                  key={i}
                  href={`tel:${p}`}
                  className="px-3 py-1.5 rounded-lg text-sm font-mono font-medium hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: 'rgba(123,143,212,0.1)', color: '#7B8FD4', border: '1px solid rgba(123,143,212,0.2)' }}
                >
                  {p}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* PA Enrichment Data — shown when enriched */}
      {lead.enriched_at && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid rgba(76,175,154,0.3)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#4CAF9A' }}>
              PA Enrichment Data
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: 'rgba(76,175,154,0.12)', color: '#4CAF9A' }}>
                Miami-Dade PA · {new Date(lead.enriched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <button onClick={onReenrich} disabled={enriching}
                className="text-[10px] hover:underline disabled:opacity-40"
                style={{ color: 'var(--c-text-3)' }}
                title="Re-pull from Miami-Dade PA">
                {enriching ? '…' : '↻ Refresh'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {/* Left col */}
            <div>
              {lead.legal_description && (
                <InfoRow label="Legal Description" value={
                  <span className="text-xs font-mono leading-relaxed">{lead.legal_description}</span>
                } />
              )}
              {lead.zoning && <InfoRow label="Zoning" value={lead.zoning} />}
              {lead.subdivision_name && <InfoRow label="Subdivision" value={lead.subdivision_name} />}
              {lead.tax_year && lead.tax_amount && (
                <InfoRow label={`Tax (${lead.tax_year})`} value={`$${Number(lead.tax_amount).toLocaleString()}`} />
              )}
            </div>

            {/* Right col — sale history */}
            <div>
              {lead.last_sale_date && (
                <InfoRow label="Last Sale" value={
                  <span>
                    {lead.sold_price ? `$${Number(lead.sold_price).toLocaleString()}` : '—'}
                    <span className="ml-1 text-xs" style={{ color: 'var(--c-text-3)' }}>
                      · {new Date(lead.last_sale_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                } />
              )}
              {lead.year_built && <InfoRow label="Year Built (PA)" value={String(lead.year_built)} />}
              {lead.living_area && (
                <InfoRow label="Living Area (PA)" value={`${Number(lead.living_area).toLocaleString()} sqft`} />
              )}
            </div>
          </div>

          {/* Folio + PA link */}
          {lead.folio_number && (
            <div className="mt-3 pt-3 border-t flex items-center gap-3" style={{ borderColor: 'var(--c-border)' }}>
              <span className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                Folio: {lead.folio_number}
              </span>
              <a
                href={`https://www.miamidade.gov/propertysearch/#/?folio=${lead.folio_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold hover:underline"
                style={{ color: '#7B8FD4' }}
              >
                View on Miami-Dade PA →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Foreclosure Tab ──────────────────────────────────────────────────────────

function ForeclosureTab({ lead, propertyId }: { lead: Lead; propertyId: string }) {
  const ds   = daysSince(lead.file_date)
  const dClr = distressColor(ds)
  const [caseNumber, setCaseNumber] = useState<string | null>(lead.case_number ?? null)

  const countyLinks: Record<string, string> = {
    'miami-dade': 'https://www.miami-dadeclerk.com/ocs/CaseSearch.aspx',
    'broward':    'https://www.browardclerk.org/Web2/CaseSearch',
    'palm-beach': 'https://courtrecords.mypalmbeachclerk.com/DORIS',
  }

  return (
    <div className="space-y-5">
      {/* Distress timeline visual */}
      {ds !== null && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: '#0A1F44' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Distress Timeline</h3>
            <span className="text-3xl font-black" style={{ color: dClr }}>{ds} days</span>
          </div>
          <div className="relative h-2 rounded-full mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, (ds / 365) * 100)}%`,
                backgroundColor: dClr,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span>Filed</span>
            <span style={{ color: '#4CAF9A' }}>30d</span>
            <span style={{ color: '#C9A84C' }}>90d</span>
            <span style={{ color: '#E07B6A' }}>180d</span>
            <span style={{ color: '#ef4444' }}>365d</span>
          </div>
          <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {ds <= 30  ? 'Early stage — high potential to negotiate before auction' :
             ds <= 90  ? 'Mid stage — owner likely receiving calls. Act now.' :
             ds <= 180 ? 'Late stage — auction may be scheduled. Verify status.' :
             'Critical — auction imminent or may have occurred. Verify immediately.'}
          </p>
        </div>
      )}

      {/* Case Details */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Case Details</h3>
        <CaseNumberRow
          propertyId={propertyId}
          initialValue={caseNumber}
          onSaved={val => setCaseNumber(val)}
        />
        <InfoRow label="Folio / APN"   value={lead.folio_number} />
        <InfoRow label="Date Filed"    value={lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null} />
        <InfoRow label="Case Type"     value={lead.foreclosure_type === 'P' ? 'Pre-Foreclosure (Lis Pendens)' : lead.foreclosure_type} />
        <InfoRow label="Plaintiff"     value={lead.plaintiff} />
        <InfoRow label="Lender"        value={lead.lender_name} />
        <InfoRow label="Loan Balance"  value={fmt$(lead.foreclosure_amount)} />
        <InfoRow label="Multiple Liens" value={lead.multiple_liens ? 'Yes — Verify all lien positions' : 'No'} />
        <InfoRow label="County"        value={COUNTY_LABELS[lead.county] ?? lead.county} />
        <InfoRow label="Data Source"   value={lead.data_source} />
      </div>

      {/* County clerk link */}
      {countyLinks[lead.county] && (
        <a
          href={countyLinks[lead.county]}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Verify on {COUNTY_LABELS[lead.county] ?? lead.county} Clerk Website →
        </a>
      )}
    </div>
  )
}

// ─── Mortgage Tab ─────────────────────────────────────────────────────────────

function MortgageTab({ lead }: { lead: Lead }) {
  const marketVal    = Number(lead.market_value ?? 0)
  const loanBalance  = Number(lead.foreclosure_amount ?? 0)
  const equityDollar = Number(lead.equity_dollar_amount ?? 0)
  const equityPct    = Number(lead.equity_percentage ?? 0)
  const ltv          = marketVal > 0 && loanBalance > 0 ? (loanBalance / marketVal) * 100 : null

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Mortgage Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <Tile label="Est. Loan Balance" value={fmtK(loanBalance)} color="#E07B6A" sub="from FC filing" />
          <Tile label="Market Value" value={fmtK(marketVal)} color="var(--c-primary)" />
          <Tile label="Est. Equity"
            value={equityDollar > 0 ? fmtK(equityDollar) : '—'}
            sub={equityPct > 0 ? `${equityPct.toFixed(1)}%` : undefined}
            color={EQUITY_COLORS[lead.equity_tier] ?? '#9ca3af'}
          />
          {ltv !== null && <Tile label="Est. LTV" value={`${ltv.toFixed(1)}%`} color={ltv > 90 ? '#E07B6A' : ltv > 70 ? '#C9A84C' : '#4CAF9A'} />}
        </div>

        {/* Equity bar */}
        {marketVal > 0 && loanBalance > 0 && (
          <div className="mb-5">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--c-text-2)' }}>
              <span>Loan ({ltv?.toFixed(0)}%)</span>
              <span>Equity ({(100 - (ltv ?? 0)).toFixed(0)}%)</span>
            </div>
            <div className="flex h-4 rounded-lg overflow-hidden">
              <div className="h-full bg-red-400 transition-all" style={{ width: `${Math.min(100, ltv ?? 0)}%` }} />
              <div className="h-full flex-1" style={{ backgroundColor: EQUITY_COLORS[lead.equity_tier] ?? '#4CAF9A', opacity: 0.7 }} />
            </div>
            <div className="flex justify-between text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
              <span>{fmtK(loanBalance)}</span>
              <span>{fmtK(equityDollar > 0 ? equityDollar : marketVal - loanBalance)}</span>
            </div>
          </div>
        )}

        <InfoRow label="Lender" value={lead.lender_name} />
        <InfoRow label="Equity Tier" value={lead.equity_tier} />
        <InfoRow label="Multiple Liens" value={lead.multiple_liens ? 'Yes — verify all positions' : 'No'} />
      </div>

      <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: '#C9A84C' }}>⚠ Data Note</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
          Loan balance is estimated from the foreclosure filing amount and may not reflect current payoff.
          Full mortgage history and refinance records available via title search or skip trace.
          Rentcast enrichment (when connected) will provide more accurate mortgage data.
        </p>
      </div>
    </div>
  )
}

// ─── Comps Tab ────────────────────────────────────────────────────────────────

interface MlsComp {
  mls_number:    string | null
  address:       string
  city:          string
  zip:           string
  status:        string
  beds:          number | null
  baths:         number | null
  living_area:   number | null
  year_built:    number | null
  list_price:    number | null
  sold_price:    number | null
  price_per_sqft: number | null
  sold_date:     string | null
  list_date:     string | null
  days_on_market: number | null
  distance_miles: number | null
  property_type: string | null
  lat?:          number | null
  lng?:          number | null
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

const DEFAULT_COMPS_FILTER: CompsFilter = {
  radiusMi:     0.5,
  monthsBack:   12,
  propertyType: '',
  minPrice:     '',
  maxPrice:     '',
  beds:         '',
  baths:        '',
}

function CompsTab({ lead, comps }: { lead: Lead; comps: Comp[] }) {
  const [mlsComps,      setMlsComps]      = useState<MlsCompsResult | null>(null)
  const [mlsLoading,    setMlsLoading]    = useState(false)
  const [mlsError,      setMlsError]      = useState<string | null>(null)
  const [noCredentials, setNoCredentials] = useState(false)
  const [showMap,       setShowMap]       = useState(true)
  const [showFilters,   setShowFilters]   = useState(false)
  const [filter,        setFilter]        = useState<CompsFilter>(DEFAULT_COMPS_FILTER)
  const [draftFilter,   setDraftFilter]   = useState<CompsFilter>(DEFAULT_COMPS_FILTER)
  const [sortKey,       setSortKey]       = useState<SortKey>('date')
  const [sortDir,       setSortDir]       = useState<SortDir>('desc')
  const [activeComp,    setActiveComp]    = useState<MlsComp | null>(null)

  const fetchMlsComps = async (f = filter) => {
    const addrFull = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
    if (!addrFull) return
    setMlsLoading(true)
    setMlsError(null)
    try {
      const params = new URLSearchParams({ address: addrFull })
      params.set('radius',  String(f.radiusMi))
      params.set('months',  String(f.monthsBack))
      if (f.propertyType) params.set('propertyType', f.propertyType)
      if (f.minPrice)     params.set('minPrice',     f.minPrice)
      if (f.maxPrice)     params.set('maxPrice',     f.maxPrice)
      if (f.beds)         params.set('beds',         f.beds)
      if (f.baths)        params.set('baths',        f.baths)
      const res  = await fetch(`/api/mls/comps?${params}`)
      const data = await res.json()
      if (!res.ok) {
        if (data.code === 'NO_CREDENTIALS') setNoCredentials(true)
        else setMlsError(data.error ?? 'Failed to fetch comps')
      } else {
        setMlsComps(data as MlsCompsResult)
      }
    } catch {
      setMlsError('Network error — please try again')
    } finally {
      setMlsLoading(false)
    }
  }

  // Auto-fetch on mount when no DB comps (non-blocking)
  useEffect(() => {
    if (comps.length === 0) fetchMlsComps()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── DB comps still take priority if present ───────────────────────────────
  if (comps.length > 0) {
    const sold    = comps.filter(c => c.status === 'sold')
    const active  = comps.filter(c => c.status === 'active')
    const pending = comps.filter(c => c.status === 'pending')
    const avgSold = sold.length > 0
      ? sold.reduce((s, c) => s + (c.sale_price ?? 0), 0) / sold.length : null

    return (
      <div className="space-y-5">
        {avgSold && (
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Avg Sold Price" value={fmtK(avgSold)} color="#4CAF9A" />
            <Tile label="Sold Comps"     value={String(sold.length)} />
            <Tile label="Active"         value={String(active.length)} />
          </div>
        )}
        {[
          { label: 'Sold',    items: sold,    color: '#4CAF9A' },
          { label: 'Active',  items: active,  color: '#C9A84C' },
          { label: 'Pending', items: pending, color: '#7B8FD4' },
        ].map(({ label, items, color }) => items.length > 0 && (
          <div key={label}>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color }}>{label} ({items.length})</h3>
            <div className="space-y-2">
              {items.map(comp => (
                <div key={comp.id} className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>{comp.address}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-2)' }}>
                        {comp.beds}bd / {comp.baths}ba
                        {comp.sqft ? ` · ${Number(comp.sqft).toLocaleString()} sqft` : ''}
                        {comp.year_built ? ` · ${comp.year_built}` : ''}
                        {comp.distance_miles ? ` · ${comp.distance_miles}mi` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color }}>{fmtK(comp.sale_price ?? comp.list_price)}</p>
                      {comp.price_per_sqft && <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>${comp.price_per_sqft}/sqft</p>}
                    </div>
                  </div>
                  {comp.sale_date && (
                    <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      Sold {new Date(comp.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── MLS live comps ─────────────────────────────────────────────────────────

  // ── Sort ──────────────────────────────────────────────────────────────────────
  const sortComps = (items: MlsComp[], priceKey: 'sold_price' | 'list_price'): MlsComp[] => {
    const d = sortDir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      let av: number | string | null | undefined
      let bv: number | string | null | undefined
      switch (sortKey) {
        case 'price':    av = a[priceKey];     bv = b[priceKey];     break
        case 'date':     av = a.sold_date ?? a.list_date; bv = b.sold_date ?? b.list_date; break
        case 'beds':     av = a.beds;          bv = b.beds;          break
        case 'baths':    av = a.baths;         bv = b.baths;         break
        case 'sqft':     av = a.living_area;   bv = b.living_area;   break
        case 'ppsf':     av = a.price_per_sqft; bv = b.price_per_sqft; break
        case 'year':     av = a.year_built;    bv = b.year_built;    break
        case 'distance': av = a.distance_miles; bv = b.distance_miles; break
        case 'type':     av = a.property_type ?? ''; bv = b.property_type ?? ''; break
        default:         return 0
      }
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') return d * av.localeCompare(bv)
      return d * ((av as number) - (bv as number))
    })
  }

  const SORT_OPTIONS: { k: SortKey; l: string }[] = [
    { k: 'date',     l: 'Date'    },
    { k: 'price',    l: 'Price'   },
    { k: 'beds',     l: 'Beds'    },
    { k: 'baths',    l: 'Baths'   },
    { k: 'sqft',     l: 'Sqft'    },
    { k: 'ppsf',     l: '$/sf'    },
    { k: 'year',     l: 'Year'    },
    { k: 'distance', l: 'Dist'    },
    { k: 'type',     l: 'Type'    },
  ]

  // ── Header ────────────────────────────────────────────────────────────────────
  const filterIsActive = (
    filter.radiusMi     !== DEFAULT_COMPS_FILTER.radiusMi     ||
    filter.monthsBack   !== DEFAULT_COMPS_FILTER.monthsBack   ||
    !!filter.propertyType || !!filter.minPrice || !!filter.maxPrice ||
    !!filter.beds || !!filter.baths
  )

  const Header = () => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>
          Comps
        </span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
          {mlsComps ? (mlsComps as MlsCompsResult & { source?: string }).source === 'rentcast' ? 'Rentcast' : 'Beaches MLS' : 'MLS'}
        </span>
        {filterIsActive && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
            {filter.radiusMi}mi · {filter.monthsBack}mo
            {filter.propertyType ? ` · ${filter.propertyType.replace('Single Family', 'SF').replace('Condominium', 'Condo')}` : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (!showFilters) setDraftFilter(filter); setShowFilters(v => !v) }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:opacity-80"
          style={{
            backgroundColor: showFilters ? 'rgba(201,168,76,0.12)' : filterIsActive ? 'rgba(201,168,76,0.08)' : 'var(--c-hover)',
            color: showFilters || filterIsActive ? '#C9A84C' : 'var(--c-text-3)',
            border: `1px solid ${showFilters || filterIsActive ? 'rgba(201,168,76,0.35)' : 'var(--c-border)'}`,
          }}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>
          </svg>
          Filters{filterIsActive ? ' ●' : ''}
        </button>
        <button
          onClick={() => setShowMap(v => !v)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:opacity-80"
          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
          {showMap ? 'Hide Map' : 'Map'}
        </button>
        <button
          onClick={() => fetchMlsComps()}
          disabled={mlsLoading}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:opacity-80"
          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
          {mlsLoading
            ? <><div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} /> Fetching…</>
            : '↻ Refresh'
          }
        </button>
      </div>
    </div>
  )

  // Not yet credentialed
  if (noCredentials) {
    return (
      <div className="space-y-5">
        <Header />
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: 'var(--c-hover)' }}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
            </svg>
          </div>
          <p className="font-bold text-sm mb-1" style={{ color: 'var(--c-primary)' }}>Comps Not Connected</p>
          <p className="text-sm mb-4" style={{ color: 'var(--c-text-2)' }}>
            Add a Rentcast API key to pull live comps and active listings.
          </p>
          <div className="text-left max-w-sm mx-auto rounded-xl p-4 space-y-2 text-xs"
            style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
            <p className="font-bold" style={{ color: 'var(--c-text-2)' }}>How to get your key:</p>
            <p style={{ color: 'var(--c-text-3)' }}>1. Sign up at <strong>app.rentcast.io</strong></p>
            <p style={{ color: 'var(--c-text-3)' }}>2. Go to <em>API Keys</em> and generate one</p>
            <p style={{ color: 'var(--c-text-3)' }}>3. Add to Vercel env vars:</p>
            <pre className="text-[10px] rounded p-2 mt-1" style={{ backgroundColor: 'var(--c-hover)', color: '#4CAF9A' }}>
              RENTCAST_API_KEY=your_key_here
            </pre>
          </div>
          {/* Still show PA reference points */}
          {(lead.market_value || lead.assessed_value) && (
            <div className="text-left max-w-sm mx-auto rounded-xl p-4 mt-4"
              style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
              <p className="text-xs font-bold mb-2" style={{ color: 'var(--c-text-2)' }}>PA Reference Values</p>
              <div className="space-y-1.5">
                {lead.market_value && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--c-text-2)' }}>Market Value</span>
                    <span className="font-bold" style={{ color: 'var(--c-primary)' }}>{fmtK(lead.market_value)}</span>
                  </div>
                )}
                {lead.assessed_value && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--c-text-2)' }}>Assessed Value</span>
                    <span className="font-bold" style={{ color: 'var(--c-text-2)' }}>{fmtK(lead.assessed_value)}</span>
                  </div>
                )}
                {lead.living_area && lead.market_value && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--c-text-2)' }}>Est. $/sqft</span>
                    <span className="font-bold" style={{ color: '#C9A84C' }}>
                      ${(Number(lead.market_value) / Number(lead.living_area)).toFixed(0)}/sqft
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Loading skeleton
  if (mlsLoading && !mlsComps) {
    return (
      <div className="space-y-4">
        <Header />
        {[1,2,3].map(i => (
          <div key={i} className="rounded-xl h-20 animate-pulse" style={{ backgroundColor: 'var(--c-card)' }} />
        ))}
      </div>
    )
  }

  // Error state
  if (mlsError && !mlsComps) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm font-bold mb-1" style={{ color: '#E74C3C' }}>MLS Error</p>
          <p className="text-xs mb-4" style={{ color: 'var(--c-text-3)' }}>{mlsError}</p>
          <button onClick={() => fetchMlsComps()}
            className="px-4 py-2 rounded-xl text-sm font-bold"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // No MLS comps result yet (shouldn't normally reach here, but handle gracefully)
  if (!mlsComps) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Click Refresh to pull comps.</p>
        </div>
      </div>
    )
  }

  const { sold: mlsSold, active: mlsActive, pending: mlsPending,
          median_sold_price, avg_price_per_sqft } = mlsComps
  const totalComps  = mlsSold.length + mlsActive.length + mlsPending.length
  const subjectLat  = (mlsComps as MlsCompsResult & { subject_lat?: number }).subject_lat ?? null
  const subjectLng  = (mlsComps as MlsCompsResult & { subject_lng?: number }).subject_lng ?? null
  const hasMapData  = !!(subjectLat && subjectLng && [...mlsSold, ...mlsActive].some(c => (c as MlsComp & { lat?: number }).lat))

  // ── Filter panel apply/clear handlers ─────────────────────────────────────────
  const applyDraftFilter = () => {
    setFilter(draftFilter)
    setShowFilters(false)
    fetchMlsComps(draftFilter)
  }
  const clearFilters = () => {
    setDraftFilter(DEFAULT_COMPS_FILTER)
    setFilter(DEFAULT_COMPS_FILTER)
    setShowFilters(false)
    fetchMlsComps(DEFAULT_COMPS_FILTER)
  }

  return (
    <div className="space-y-4">
      <Header />

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid rgba(201,168,76,0.2)' }}>
          {/* Radius + Months */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Radius</p>
              <div className="flex gap-1">
                {([0.25, 0.5, 1, 2] as const).map(r => (
                  <button key={r}
                    onClick={() => setDraftFilter(d => ({ ...d, radiusMi: r }))}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      backgroundColor: draftFilter.radiusMi === r ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                      color:           draftFilter.radiusMi === r ? '#C9A84C' : 'var(--c-text-3)',
                      border:          `1px solid ${draftFilter.radiusMi === r ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
                    }}>{r}mi</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Months Back</p>
              <div className="flex gap-1">
                {([3, 6, 12, 24] as const).map(m => (
                  <button key={m}
                    onClick={() => setDraftFilter(d => ({ ...d, monthsBack: m }))}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      backgroundColor: draftFilter.monthsBack === m ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                      color:           draftFilter.monthsBack === m ? '#C9A84C' : 'var(--c-text-3)',
                      border:          `1px solid ${draftFilter.monthsBack === m ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
                    }}>{m}mo</button>
                ))}
              </div>
            </div>
          </div>

          {/* Property type */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Property Type</p>
            <div className="flex flex-wrap gap-1">
              {[
                { v: '',               l: 'All'           },
                { v: 'Single Family',  l: 'Single Family' },
                { v: 'Condominium',    l: 'Condo'         },
                { v: 'Townhouse',      l: 'Townhouse'     },
                { v: 'Multi-Family',   l: 'Multi-Family'  },
              ].map(({ v, l }) => (
                <button key={v}
                  onClick={() => setDraftFilter(d => ({ ...d, propertyType: v }))}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={{
                    backgroundColor: draftFilter.propertyType === v ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                    color:           draftFilter.propertyType === v ? '#C9A84C' : 'var(--c-text-3)',
                    border:          `1px solid ${draftFilter.propertyType === v ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
                  }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Price range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--c-text-3)' }}>Min Price</p>
              <input
                type="number" placeholder="No min"
                value={draftFilter.minPrice}
                onChange={e => setDraftFilter(d => ({ ...d, minPrice: e.target.value }))}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', outline: 'none' }}
              />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--c-text-3)' }}>Max Price</p>
              <input
                type="number" placeholder="No max"
                value={draftFilter.maxPrice}
                onChange={e => setDraftFilter(d => ({ ...d, maxPrice: e.target.value }))}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', outline: 'none' }}
              />
            </div>
          </div>

          {/* Beds + Baths */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Beds (exact)</p>
              <div className="flex gap-1">
                {['', '2', '3', '4', '5'].map(b => (
                  <button key={b}
                    onClick={() => setDraftFilter(d => ({ ...d, beds: b }))}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      backgroundColor: draftFilter.beds === b ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                      color:           draftFilter.beds === b ? '#C9A84C' : 'var(--c-text-3)',
                      border:          `1px solid ${draftFilter.beds === b ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
                    }}>{b || 'Any'}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Baths (exact)</p>
              <div className="flex gap-1">
                {['', '1', '2', '3', '4'].map(b => (
                  <button key={b}
                    onClick={() => setDraftFilter(d => ({ ...d, baths: b }))}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      backgroundColor: draftFilter.baths === b ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                      color:           draftFilter.baths === b ? '#C9A84C' : 'var(--c-text-3)',
                      border:          `1px solid ${draftFilter.baths === b ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
                    }}>{b || 'Any'}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1 border-t" style={{ borderColor: 'var(--c-border)' }}>
            <button onClick={applyDraftFilter}
              className="flex-1 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
              Apply Filters
            </button>
            {filterIsActive && (
              <button onClick={clearFilters}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
                Clear
              </button>
            )}
            <button onClick={() => setShowFilters(false)}
              className="px-4 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Comps map */}
      {hasMapData && showMap && (
        <Suspense fallback={
          <div className="rounded-2xl flex items-center justify-center" style={{ height: 340, backgroundColor: '#071829', border: '1px solid var(--c-border)' }}>
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
          </div>
        }>
          <CompsMap
            subjectLat={subjectLat}
            subjectLng={subjectLng}
            subjectAddr={lead.property_address ?? ''}
            sold={mlsSold as Parameters<typeof CompsMap>[0]['sold']}
            active={mlsActive as Parameters<typeof CompsMap>[0]['active']}
            pending={mlsPending as Parameters<typeof CompsMap>[0]['pending']}
          />
        </Suspense>
      )}

      {/* Stats */}
      {totalComps > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <Tile label="Median Sold"  value={median_sold_price   ? fmtK(median_sold_price)             : '—'} color="#4CAF9A" />
          <Tile label="Avg $/sqft"   value={avg_price_per_sqft  ? `$${avg_price_per_sqft}`            : '—'} />
          <Tile label="Sold Comps"   value={String(mlsSold.length)} />
          <Tile label="Active"       value={String(mlsActive.length)} />
        </div>
      )}

      {totalComps === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm mb-1" style={{ color: 'var(--c-text-3)' }}>No comps found within {filter.radiusMi}mi</p>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Try expanding the radius in Filters</p>
        </div>
      )}

      {/* Sort bar */}
      {totalComps > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Sort</span>
          {SORT_OPTIONS.map(({ k, l }) => {
            const active = sortKey === k
            return (
              <button key={k}
                onClick={() => {
                  if (active) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                  else { setSortKey(k); setSortDir('desc') }
                }}
                className="px-2 py-0.5 rounded-md text-[10px] font-bold transition-all"
                style={{
                  backgroundColor: active ? 'rgba(201,168,76,0.12)' : 'var(--c-hover)',
                  color:           active ? '#C9A84C'                : 'var(--c-text-3)',
                  border:          `1px solid ${active ? 'rgba(201,168,76,0.35)' : 'var(--c-border)'}`,
                }}>
                {l}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
            )
          })}
        </div>
      )}

      {[
        { label: 'Sold',    items: mlsSold,    color: '#4CAF9A', priceKey: 'sold_price'  as const },
        { label: 'Active',  items: mlsActive,  color: '#C9A84C', priceKey: 'list_price'  as const },
        { label: 'Pending', items: mlsPending, color: '#7B8FD4', priceKey: 'list_price'  as const },
      ].map(({ label, items, color, priceKey }) => items.length > 0 && (
        <div key={label}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color }}>
            {label} ({items.length})
          </h3>
          <div className="space-y-2">
            {sortComps(items, priceKey).map((comp, i) => (
              <div key={comp.mls_number ?? i}
                onClick={() => setActiveComp(comp)}
                className="rounded-xl p-4 cursor-pointer transition-all hover:opacity-90"
                style={{
                  backgroundColor: 'var(--c-card)',
                  border: `1px solid ${activeComp === comp ? color + '50' : 'var(--c-border)'}`,
                  boxShadow: activeComp === comp ? `0 0 0 1px ${color}30` : undefined,
                }}>
                <div className="flex items-start justify-between mb-1.5">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>
                      {comp.address}{comp.city ? `, ${comp.city}` : ''}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-2)' }}>
                      {[
                        comp.beds        ? `${comp.beds}bd`                          : null,
                        comp.baths       ? `${comp.baths}ba`                         : null,
                        comp.living_area ? `${comp.living_area.toLocaleString()} sf` : null,
                        comp.year_built  ? `${comp.year_built}`                      : null,
                        comp.distance_miles ? `${comp.distance_miles}mi`             : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color }}>{fmtK(comp[priceKey])}</p>
                      {comp.price_per_sqft && (
                        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>${comp.price_per_sqft}/sf</p>
                      )}
                    </div>
                    <span className="text-[10px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>›</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {comp.sold_date && (
                    <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      Sold {new Date(comp.sold_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {comp.list_date && !comp.sold_date && (
                    <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      Listed {new Date(comp.list_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {comp.days_on_market != null && (
                    <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      {comp.days_on_market}d on market
                    </p>
                  )}
                  {comp.mls_number && (
                    <p className="text-[10px] font-mono" style={{ color: 'var(--c-text-3)' }}>MLS#{comp.mls_number}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Comp detail drawer */}
      {activeComp && (() => {
        const dc = activeComp
        const isS = dc.status === 'sold'
        const isA = dc.status === 'active'
        const statusColor = isS ? '#4CAF9A' : isA ? '#C9A84C' : '#7B8FD4'
        const statusLabel = isS ? 'Sold' : isA ? 'Active' : 'Pending'
        const price = dc.sold_price ?? dc.list_price

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
              onClick={() => setActiveComp(null)}
            />
            {/* Drawer */}
            <div
              className="fixed right-0 top-0 bottom-0 z-50 overflow-y-auto"
              style={{
                width: 340,
                backgroundColor: 'var(--c-bg)',
                borderLeft: '1px solid var(--c-border)',
                boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
              }}>
              {/* Drawer header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
                style={{ backgroundColor: 'var(--c-bg)', borderBottom: '1px solid var(--c-border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>
                    {statusLabel}
                  </span>
                  <span className="text-xs font-bold" style={{ color: 'var(--c-text-2)' }}>Comp Detail</span>
                </div>
                <button
                  onClick={() => setActiveComp(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-sm hover:opacity-70 transition-opacity"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>✕</button>
              </div>

              <div className="px-5 py-4 space-y-5">
                {/* Address + price */}
                <div>
                  <p className="text-base font-bold leading-tight" style={{ color: 'var(--c-primary)' }}>{dc.address}</p>
                  {(dc.city || dc.zip) && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                      {dc.city}{dc.zip ? `, ${dc.zip}` : ''}
                    </p>
                  )}
                  <div className="flex items-baseline gap-2 mt-3">
                    <p className="text-2xl font-bold" style={{ color: statusColor }}>
                      {price ? (price >= 1_000_000 ? `$${(price / 1_000_000).toFixed(2)}M` : `$${price.toLocaleString()}`) : '—'}
                    </p>
                    {dc.price_per_sqft && (
                      <p className="text-xs font-bold" style={{ color: 'var(--c-text-3)' }}>${dc.price_per_sqft}/sf</p>
                    )}
                  </div>
                  {isS && dc.list_price && dc.sold_price && dc.list_price !== dc.sold_price && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                      Listed at ${dc.list_price.toLocaleString()} ·{' '}
                      <span style={{ color: dc.sold_price >= dc.list_price ? '#4CAF9A' : '#E74C3C' }}>
                        {dc.sold_price >= dc.list_price ? '+' : ''}{(((dc.sold_price - dc.list_price) / dc.list_price) * 100).toFixed(1)}%
                      </span>
                    </p>
                  )}
                </div>

                {/* Property details */}
                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Property</p>
                  <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
                    {[
                      { l: 'Beds',         v: dc.beds       ? `${dc.beds} bd`                                : null },
                      { l: 'Baths',        v: dc.baths      ? `${dc.baths} ba`                              : null },
                      { l: 'Living Area',  v: dc.living_area? `${dc.living_area.toLocaleString()} sf`        : null },
                      { l: 'Year Built',   v: dc.year_built ? String(dc.year_built)                         : null },
                      { l: 'Type',         v: dc.property_type ?? null },
                      { l: 'Distance',     v: dc.distance_miles != null ? `${dc.distance_miles} mi`         : null },
                    ].filter(r => r.v).map(({ l, v }) => (
                      <div key={l}>
                        <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>{l}</p>
                        <p className="text-xs font-semibold mt-0.5" style={{ color: 'var(--c-text-2)' }}>{v}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Listing timeline */}
                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Listing</p>
                  <div className="space-y-2.5">
                    {[
                      { l: 'List Price',      v: dc.list_price  ? `$${dc.list_price.toLocaleString()}`  : null },
                      { l: 'Sold Price',      v: dc.sold_price  ? `$${dc.sold_price.toLocaleString()}`  : null },
                      { l: 'List Date',       v: dc.list_date   ? new Date(dc.list_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null },
                      { l: 'Sold Date',       v: dc.sold_date   ? new Date(dc.sold_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null },
                      { l: 'Days on Market',  v: dc.days_on_market != null ? `${dc.days_on_market} days` : null },
                      { l: 'MLS Number',      v: dc.mls_number ?? null },
                    ].filter(r => r.v).map(({ l, v }) => (
                      <div key={l} className="flex items-center justify-between">
                        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>{l}</p>
                        <p className="text-xs font-semibold" style={{ color: 'var(--c-text-2)', fontFamily: l === 'MLS Number' ? 'monospace' : undefined }}>{v}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Compare to subject */}
                {(mlsComps as MlsCompsResult & { avm_estimate?: number | null }).avm_estimate && (
                  <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>vs. Subject AVM</p>
                    {(() => {
                      const avm = (mlsComps as MlsCompsResult & { avm_estimate?: number | null }).avm_estimate!
                      const delta = price ? ((price - avm) / avm) * 100 : null
                      return (
                        <div className="flex items-center justify-between">
                          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Subject AVM</p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>${avm.toLocaleString()}</p>
                            {delta != null && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: Math.abs(delta) < 5 ? 'rgba(76,175,154,0.12)' : 'rgba(201,168,76,0.12)',
                                  color: Math.abs(delta) < 5 ? '#4CAF9A' : '#C9A84C',
                                }}>
                                {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────

function ContactsTab({ propertyId }: { propertyId: string }) {
  const [links,        setLinks]        = useState<LinkedContact[]>([])
  const [loading,      setLoading]      = useState(true)
  const [panel,        setPanel]        = useState<'none' | 'link' | 'create'>('none')

  // Link-existing search state
  const [searchQ,      setSearchQ]      = useState('')
  const [searchRes,    setSearchRes]    = useState<LinkedContact['contact'][]>([])
  const [searching,    setSearching]    = useState(false)
  const [linkRelType,  setLinkRelType]  = useState('Owner')
  const [linkPrimary,  setLinkPrimary]  = useState(false)

  // Create-new form state
  const [newName,      setNewName]      = useState('')
  const [newPhone,     setNewPhone]     = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [newAddr,      setNewAddr]      = useState('')
  const [newRelType,   setNewRelType]   = useState('Owner')
  const [newPrimary,   setNewPrimary]   = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saveErr,      setSaveErr]      = useState<string | null>(null)

  // Load linked contacts
  useEffect(() => {
    setLoading(true)
    fetch(`/api/properties/${propertyId}/contacts`)
      .then(r => r.json())
      .then(d => setLinks(d.contacts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [propertyId])

  // Debounced contact search
  useEffect(() => {
    if (!searchQ.trim()) { setSearchRes([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/contacts/search?q=${encodeURIComponent(searchQ)}`)
        const data = await res.json()
        setSearchRes(data.contacts ?? [])
      } catch { /* ignore */ }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ])

  const linkExisting = async (contactId: string) => {
    setSaving(true); setSaveErr(null)
    try {
      const res = await fetch(`/api/properties/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, relationship_type: linkRelType, is_primary: linkPrimary }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveErr(data.error); return }
      // Merge: update existing or prepend new
      setLinks(prev => {
        const exists = prev.find(l => l.contact.id === contactId)
        const updated = data.link as LinkedContact
        if (exists) return prev.map(l => l.contact.id === contactId ? updated : (linkPrimary ? { ...l, is_primary: false } : l))
        return [updated, ...(linkPrimary ? prev.map(l => ({ ...l, is_primary: false })) : prev)]
      })
      setPanel('none'); setSearchQ(''); setSearchRes([])
    } catch (e) { setSaveErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const createAndLink = async () => {
    if (!newName.trim()) { setSaveErr('Name is required'); return }
    setSaving(true); setSaveErr(null)
    try {
      const res = await fetch(`/api/properties/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(), phone: newPhone.trim() || undefined,
          email: newEmail.trim() || undefined, address: newAddr.trim() || undefined,
          relationship_type: newRelType, is_primary: newPrimary,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveErr(data.error); return }
      const updated = data.link as LinkedContact
      setLinks(prev => [updated, ...(newPrimary ? prev.map(l => ({ ...l, is_primary: false })) : prev)])
      setPanel('none'); setNewName(''); setNewPhone(''); setNewEmail(''); setNewAddr('')
    } catch (e) { setSaveErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const makePrimary = async (contactId: string) => {
    const res = await fetch(`/api/properties/${propertyId}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    })
    if (res.ok) setLinks(prev => prev.map(l => ({ ...l, is_primary: l.contact.id === contactId })))
  }

  const removeContact = async (contactId: string) => {
    await fetch(`/api/properties/${propertyId}/contacts/${contactId}`, { method: 'DELETE' })
    setLinks(prev => prev.filter(l => l.contact.id !== contactId))
  }

  const updateRelType = async (contactId: string, rel: string) => {
    await fetch(`/api/properties/${propertyId}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relationship_type: rel }),
    })
    setLinks(prev => prev.map(l => l.contact.id === contactId ? { ...l, relationship_type: rel } : l))
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--c-card)',
    border: '1px solid var(--c-border)',
    borderRadius: '16px',
    overflow: 'hidden',
    marginBottom: '12px',
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>Linked Contacts</h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            People and entities associated with this property lead
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPanel(p => p === 'link' ? 'none' : 'link')}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.35)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
            </svg>
            Link Existing
          </button>
          <button onClick={() => setPanel(p => p === 'create' ? 'none' : 'create')}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            + New Contact
          </button>
        </div>
      </div>

      {/* Link Existing Panel */}
      {panel === 'link' && (
        <div style={{ ...cardStyle, marginBottom: '16px', border: '1px solid rgba(76,175,154,0.3)' }}>
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(76,175,154,0.05)' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#4CAF9A' }}>Link Existing Contact</p>
          </div>
          <div className="p-4 space-y-3">
            <input
              autoFocus
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="w-full px-3 py-2 text-sm rounded-xl focus:outline-none"
              style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            />
            {searching && <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Searching…</p>}
            {searchRes.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {searchRes.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-xl hover:opacity-80 cursor-pointer"
                    style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)' }}
                    onClick={() => linkExisting(c.id)}>
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: 'var(--c-primary)' }}>{c.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                        {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact info'}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: '#4CAF9A' }}>Link →</span>
                  </div>
                ))}
              </div>
            )}
            {searchQ.trim() && !searching && searchRes.length === 0 && (
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>No contacts found — try "New Contact" to create one.</p>
            )}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--c-text-3)' }}>Relationship</label>
                <select value={linkRelType} onChange={e => setLinkRelType(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                  {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold mt-4 cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
                <input type="checkbox" checked={linkPrimary} onChange={e => setLinkPrimary(e.target.checked)}
                  style={{ accentColor: '#C9A84C' }} />
                Primary
              </label>
            </div>
            {saveErr && <p className="text-[11px]" style={{ color: '#ef4444' }}>{saveErr}</p>}
          </div>
        </div>
      )}

      {/* Create New Contact Panel */}
      {panel === 'create' && (
        <div style={{ ...cardStyle, marginBottom: '16px', border: '1px solid rgba(201,168,76,0.3)' }}>
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(201,168,76,0.05)' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#C9A84C' }}>Create & Link New Contact</p>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { label: 'Full Name *', val: newName,  set: setNewName,  ph: 'John Smith',          col: 'col-span-2' },
              { label: 'Phone',       val: newPhone, set: setNewPhone, ph: '(954) 555-1234',      col: '' },
              { label: 'Email',       val: newEmail, set: setNewEmail, ph: 'john@example.com',    col: '' },
              { label: 'Address',     val: newAddr,  set: setNewAddr,  ph: '123 Main St, City FL', col: 'col-span-2' },
            ].map(({ label, val, set, ph, col }) => (
              <div key={label} className={col}>
                <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--c-text-3)' }}>{label}</label>
                <input type="text" value={val} onChange={e => set(e.target.value)} placeholder={ph}
                  className="w-full px-3 py-2 text-sm rounded-xl focus:outline-none"
                  style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
              </div>
            ))}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--c-text-3)' }}>Relationship</label>
              <select value={newRelType} onChange={e => setNewRelType(e.target.value)}
                className="w-full text-sm px-2 py-1.5 rounded-lg focus:outline-none"
                style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
                <input type="checkbox" checked={newPrimary} onChange={e => setNewPrimary(e.target.checked)}
                  style={{ accentColor: '#C9A84C' }} />
                Mark as primary contact
              </label>
            </div>
            {saveErr && <p className="text-[11px] col-span-2" style={{ color: '#ef4444' }}>{saveErr}</p>}
            <div className="col-span-2 flex gap-2 pt-1">
              <button onClick={createAndLink} disabled={saving}
                className="flex-1 py-2 text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                {saving ? 'Saving…' : 'Create & Link'}
              </button>
              <button onClick={() => { setPanel('none'); setSaveErr(null) }}
                className="px-4 py-2 text-sm rounded-xl hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Linked contacts list */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
        </div>
      ) : links.length === 0 ? (
        <div className="text-center py-10" style={{ border: '1px dashed var(--c-border)', borderRadius: '16px' }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2"
            style={{ backgroundColor: 'var(--c-hover)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
            </svg>
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No contacts linked yet</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>Link an existing contact or create a new one above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <div key={link.contact.id} style={cardStyle}>
              {/* Contact header */}
              <div className="flex items-start justify-between px-4 pt-3 pb-2.5">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                    {link.contact.name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold" style={{ color: 'var(--c-primary)' }}>{link.contact.name}</span>
                      {link.is_primary && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' }}>
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <select
                        value={link.relationship_type}
                        onChange={e => updateRelType(link.contact.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full focus:outline-none"
                        style={{ backgroundColor: 'rgba(107,159,212,0.12)', color: '#6B9FD4', border: '1px solid rgba(107,159,212,0.3)', cursor: 'pointer' }}>
                        {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {!link.is_primary && (
                    <button onClick={() => makePrimary(link.contact.id)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:opacity-80"
                      style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
                      title="Make primary contact">
                      ★ Primary
                    </button>
                  )}
                  <a href={`/contacts/${link.contact.id}`}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'var(--c-hover)', color: '#6B9FD4', border: '1px solid var(--c-border)' }}>
                    View →
                  </a>
                  <button onClick={() => removeContact(link.contact.id)}
                    className="text-[10px] px-2 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
                    title="Remove from this lead">
                    ✕
                  </button>
                </div>
              </div>

              {/* Contact info */}
              {(link.contact.phone || link.contact.email || link.contact.address) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3">
                  {link.contact.phone && (
                    <a href={`tel:${link.contact.phone}`}
                      className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-80"
                      style={{ color: '#4CAF9A' }}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      {link.contact.phone}
                    </a>
                  )}
                  {link.contact.email && (
                    <a href={`mailto:${link.contact.email}`}
                      className="text-[11px] font-semibold hover:opacity-80"
                      style={{ color: '#6B9FD4' }}>
                      {link.contact.email}
                    </a>
                  )}
                  {link.contact.address && (
                    <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      {link.contact.address}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Communications Tab ───────────────────────────────────────────────────────

function CommunicationsTab({ lead, messages, contact, notes, onNoteSaved }: {
  lead: Lead
  messages: Message[]
  contact: Contact | null
  notes: Note[]
  onNoteSaved: (note: Note) => void
}) {
  const router = useRouter()
  const [sms, setSms]           = useState('')
  const [sending, setSending]   = useState(false)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [addingToPipeline, setAddingToPipeline] = useState(false)
  const [pipelineResult, setPipelineResult] = useState<{ ok: boolean; contact_id?: string; already?: boolean } | null>(null)
  const [localMessages, setLocalMessages] = useState<Message[]>(messages)
  const [showEmailComposer, setShowEmailComposer] = useState(false)
  const msgEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [localMessages])

  const sendSms = async () => {
    if (!contact || !sms.trim()) return
    setSending(true)
    setSmsError(null)
    const tempId = `temp-${Date.now()}`
    const tempMsg: Message = { id: tempId, direction: 'outbound', body: sms.trim(), status: 'sending', created_at: new Date().toISOString() }
    setLocalMessages(prev => [...prev, tempMsg])
    setSms('')

    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contact.id, body: tempMsg.body }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Remove temp bubble, show error
        setLocalMessages(prev => prev.filter(m => m.id !== tempId))
        setSmsError(data.error ?? 'Failed to send. Check Twilio configuration.')
      } else if (data.message?.id) {
        setLocalMessages(prev => prev.map(m => m.id === tempId ? data.message : m))
        if (data.warning) setSmsError(`Sent but Twilio reported: ${data.warning}`)
      } else {
        setLocalMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m))
      }
    } catch {
      setLocalMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m))
      setSmsError('Network error — message may not have sent.')
    }
    setSending(false)
  }

  const saveNote = async () => {
    if (!noteBody.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody.trim() }),
      })
      if (res.ok) {
        const note = await res.json()
        onNoteSaved(note)
        setNoteBody('')
      }
    } catch { /* network error — noteBody preserved so user can retry */ }
    finally { setSavingNote(false) }
  }

  const addToPipeline = async () => {
    setAddingToPipeline(true)
    const res = await fetch('/api/leads/add-to-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: lead.id }),
    })
    const data = await res.json()
    setPipelineResult(data)
    setAddingToPipeline(false)
    if (data.ok && data.contact_id) {
      setTimeout(() => router.push(`/contacts/${data.contact_id}`), 800)
    }
  }

  // Notes section (always visible)
  const NotesSection = (
    <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
      <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Operator Notes</h3>
      <div className="space-y-2 mb-4">
        {notes.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No notes yet.</p>
        )}
        {notes.map(note => (
          <div key={note.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
            <p className="text-sm" style={{ color: 'var(--c-primary)' }}>{note.body}</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
              {note.author} · {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <textarea
          value={noteBody}
          onChange={e => setNoteBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="flex-1 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none"
          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
        />
        <button
          onClick={saveNote}
          disabled={savingNote || !noteBody.trim()}
          className="px-4 py-2 rounded-xl text-xs font-bold self-end transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}
        >
          {savingNote ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )

  if (!contact && !pipelineResult?.ok) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(201,168,76,0.1)' }}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
            </svg>
          </div>
          <p className="font-bold text-sm mb-1" style={{ color: 'var(--c-primary)' }}>Add to Pipeline to Enable Messaging</p>
          <p className="text-sm mb-5" style={{ color: 'var(--c-text-2)' }}>
            Creating a contact record links this lead to the messaging system so you can send SMS and track communications.
          </p>
          <button
            onClick={addToPipeline}
            disabled={addingToPipeline}
            className="px-6 py-2.5 rounded-xl font-bold text-sm transition-opacity hover:opacity-80 disabled:opacity-60"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          >
            {addingToPipeline ? 'Creating Contact…' : '+ Add to Pipeline'}
          </button>
          {pipelineResult && !pipelineResult.ok && (
            <p className="text-red-500 text-sm mt-3">Failed to add to pipeline. Try again.</p>
          )}
        </div>
        {NotesSection}
      </div>
    )
  }

  // Message date grouping
  const withDateGroups = localMessages.reduce<{ date: string | null; msg: Message }[]>((acc, msg, i) => {
    const d = new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const prev = i > 0 ? new Date(localMessages[i - 1].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
    acc.push({ date: d !== prev ? d : null, msg })
    return acc
  }, [])

  return (
    <div className="space-y-5">
      {/* SMS Thread */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <p className="font-bold text-sm" style={{ color: 'var(--c-primary)' }}>
              {contact?.name ?? lead.owner_name ?? 'Unknown'}
            </p>
            <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>{contact?.phone ?? lead.phone_1}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {contact?.email && (
              <button
                onClick={() => setShowEmailComposer(true)}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C',
                  border: '1px solid rgba(201,168,76,0.25)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
                Send Email
              </button>
            )}
            {contact && (
              <a href={`/contacts/${contact.id}`}
                className="text-xs font-semibold hover:underline"
                style={{ color: '#C9A84C' }}>
                View Contact →
              </a>
            )}
          </div>
        </div>

        {showEmailComposer && contact?.email && (
          <EmailComposer
            defaultTo={contact.email}
            contactId={contact.id}
            leadId={lead.id}
            contactName={contact.name}
            propertyAddress={lead.address}
            onClose={() => setShowEmailComposer(false)}
          />
        )}

        <div className="px-4 py-4 space-y-1 min-h-48 max-h-96 overflow-y-auto"
          style={{ backgroundColor: 'var(--c-card-alt)' }}>
          {withDateGroups.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: 'var(--c-text-3)' }}>No messages yet. Send the first one below.</p>
          )}
          {withDateGroups.map(({ date, msg }, i) => (
            <div key={msg.id}>
              {date && (
                <p className="text-center text-[11px] py-2" style={{ color: 'var(--c-text-3)' }}>{date}</p>
              )}
              <div className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'} mb-1`}>
                <div
                  className="max-w-[75%] rounded-2xl px-3 py-2"
                  style={{
                    backgroundColor: msg.direction === 'outbound' ? '#0A1F44' : 'var(--c-card)',
                    border: msg.direction === 'inbound' ? '1px solid var(--c-border)' : 'none',
                  }}
                >
                  <p className="text-sm" style={{ color: msg.direction === 'outbound' ? '#fff' : 'var(--c-primary)' }}>
                    {msg.body}
                  </p>
                  <p className="text-[10px] mt-0.5"
                    style={{ color: msg.direction === 'outbound' ? 'rgba(255,255,255,0.4)' : 'var(--c-text-3)', textAlign: msg.direction === 'outbound' ? 'right' : 'left' }}>
                    {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    {msg.direction === 'outbound' && (
                      msg.status === 'sending' ? <span> · Sending…</span>
                      : msg.status === 'failed' ? <span style={{ color: '#f87171' }}> · Failed</span>
                      : msg.status === 'mock'   ? <span style={{ color: '#f59e0b' }}> · Mock (Twilio not configured)</span>
                      : null
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
          <div ref={msgEndRef} />
        </div>

        {/* Error banner */}
        {smsError && (
          <div className="px-4 py-2 flex items-center justify-between gap-2"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-xs" style={{ color: '#f87171' }}>{smsError}</p>
            <button onClick={() => setSmsError(null)} className="text-xs" style={{ color: '#f87171' }}>✕</button>
          </div>
        )}

        {/* No phone warning */}
        {contact && !contact.phone && (
          <div className="px-4 py-2"
            style={{ backgroundColor: 'rgba(245,158,11,0.08)', borderTop: '1px solid rgba(245,158,11,0.2)' }}>
            <p className="text-xs" style={{ color: '#f59e0b' }}>
              No phone number on file — add one in the contact record to enable SMS.
            </p>
          </div>
        )}

        <div className="flex gap-2 px-4 py-3" style={{ backgroundColor: 'var(--c-card)', borderTop: '1px solid var(--c-border)' }}>
          <input
            type="text"
            value={sms}
            onChange={e => { setSms(e.target.value); if (smsError) setSmsError(null) }}
            onKeyDown={e => e.key === 'Enter' && sendSms()}
            placeholder={contact?.phone ? 'Type a message…' : 'Add a phone number to send SMS'}
            disabled={!contact?.phone}
            className="flex-1 text-sm px-3 py-2 rounded-xl focus:outline-none disabled:opacity-40"
            style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
          />
          <button
            onClick={sendSms}
            disabled={sending || !sms.trim() || !contact?.phone}
            className="px-4 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {NotesSection}
    </div>
  )
}

// ─── AI Analysis Tab ──────────────────────────────────────────────────────────

function AIAnalysisTab({ lead, aiSummary: initialSummary }: { lead: Lead; aiSummary: AISummary | null }) {
  const [summary, setSummary]   = useState<AISummary | null>(initialSummary)
  const [generating, setGen]    = useState(false)
  const [error, setError]       = useState('')

  const generate = async (force = false) => {
    setGen(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!res.ok) {
        setError('AI analysis failed. Try again.')
      } else {
        const data = await res.json()
        setSummary(data)
      }
    } catch {
      setError('Network error — please check your connection and try again.')
    } finally {
      setGen(false)
    }
  }

  const motivationLabel = summary?.motivation
    ? summary.motivation.replace('-', ' ').replace(/^\w/, c => c.toUpperCase())
    : null

  const strategyLabel = summary?.strategy ? STRATEGY_LABELS[summary.strategy] ?? summary.strategy : null

  return (
    <div className="space-y-5">
      {!summary && !generating && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0A1F44, #1a3a6e)' }}>
            <svg className="w-7 h-7" fill="none" stroke="#C9A84C" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <p className="font-bold text-sm mb-1" style={{ color: 'var(--c-primary)' }}>AI Acquisition Analysis</p>
          <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: 'var(--c-text-2)' }}>
            Get an instant distress score, motivation assessment, recommended strategy, and AI summary for this lead.
          </p>
          <button
            onClick={() => generate(false)}
            className="px-6 py-2.5 rounded-xl font-bold text-sm transition-opacity hover:opacity-80"
            style={{ background: 'linear-gradient(135deg, #0A1F44, #1a3a6e)', color: '#C9A84C' }}
          >
            ✦ Generate Analysis
          </button>
          {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
        </div>
      )}

      {generating && (
        <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="font-semibold text-sm" style={{ color: 'var(--c-primary)' }}>Analyzing lead…</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-text-2)' }}>Evaluating distress signals, equity position, and acquisition potential</p>
        </div>
      )}

      {summary && !generating && (
        <>
          {/* Score header */}
          <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0f2d5e 100%)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-white text-sm uppercase tracking-wider">AI Acquisition Assessment</h3>
              <button
                onClick={() => generate(true)}
                className="text-[11px] font-semibold px-3 py-1 rounded-lg transition-opacity hover:opacity-70"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
              >
                ↺ Regenerate
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              <div className="text-center">
                <p className="text-3xl font-black" style={{ color: scoreColor(summary.distress_score) }}>
                  {summary.distress_score ?? '—'}
                </p>
                <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>DISTRESS SCORE</p>
                <div className="h-1 rounded-full mt-2 mx-auto" style={{ width: 48, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full" style={{
                    width: `${(summary.distress_score ?? 0) * 10}%`,
                    backgroundColor: scoreColor(summary.distress_score)
                  }} />
                </div>
              </div>

              <div className="text-center">
                <p className="text-3xl font-black" style={{ color: scoreColor(summary.lead_quality) }}>
                  {summary.lead_quality ?? '—'}
                </p>
                <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>LEAD QUALITY</p>
                <div className="h-1 rounded-full mt-2 mx-auto" style={{ width: 48, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full" style={{
                    width: `${(summary.lead_quality ?? 0) * 10}%`,
                    backgroundColor: scoreColor(summary.lead_quality)
                  }} />
                </div>
              </div>

              <div className="text-center">
                {motivationLabel && (
                  <>
                    <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold"
                      style={{ backgroundColor: `${motivationColor(summary.motivation)}25`, color: motivationColor(summary.motivation) }}>
                      {motivationLabel}
                    </span>
                    <p className="text-[11px] font-semibold mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>MOTIVATION</p>
                  </>
                )}
              </div>

              <div className="text-center">
                {summary.urgency && (
                  <>
                    <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold capitalize"
                      style={{
                        backgroundColor: summary.urgency === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(201,168,76,0.2)',
                        color: summary.urgency === 'high' ? '#ef4444' : '#C9A84C',
                      }}>
                      {summary.urgency.replace('-', ' ')}
                    </span>
                    <p className="text-[11px] font-semibold mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>URGENCY</p>
                  </>
                )}
              </div>
            </div>

            {/* Recommended strategy */}
            {strategyLabel && (
              <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)' }}>
                <p className="text-[11px] font-semibold mb-0.5" style={{ color: 'rgba(201,168,76,0.7)' }}>RECOMMENDED STRATEGY</p>
                <p className="font-bold" style={{ color: '#C9A84C' }}>{strategyLabel}</p>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-2)' }}>Analysis Summary</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--c-primary)' }}>{summary.summary}</p>
          </div>

          {/* Highlights */}
          {summary.highlights && summary.highlights.length > 0 && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-2)' }}>Key Signals</h3>
              <div className="space-y-2">
                {summary.highlights.map((h, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span style={{ color: '#C9A84C', marginTop: 2 }}>▸</span>
                    <p className="text-sm" style={{ color: 'var(--c-primary)' }}>{h}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-center" style={{ color: 'var(--c-text-3)' }}>
            Internal use only · Powered by {summary.model ?? 'Claude'} ·{' '}
            {summary.created_at ? new Date(summary.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
          </p>
        </>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LeadDetailClient({
  lead: initialLead,
  aiSummary,
  notes: initialNotes,
  comps,
  messages,
  contact,
}: {
  lead: Lead
  aiSummary: AISummary | null
  notes: Note[]
  comps: Comp[]
  messages: unknown[]
  contact: unknown
}) {
  const router  = useRouter()
  const [lead, setLead]   = useState(initialLead)
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [tab, setTab]     = useState<TabKey>('overview')
  const [stage, setStage] = useState<string>(lead.pipeline_stage ?? '')
  const [starred, setStarred] = useState(Boolean(lead.starred))
  const [addingPipeline, setAddingPipeline] = useState(false)
  const [pipelineMsg, setPipelineMsg] = useState('')
  const [enriching, setEnriching]     = useState(false)
  const [enrichMsg, setEnrichMsg]     = useState('')
  const [deepEnriching, setDeepEnriching] = useState(false)
  const [deepEnrichMsg, setDeepEnrichMsg] = useState('')
  const [leadTypeId,  setLeadTypeId]  = useState<string>(lead.lead_type_id ?? '')
  const [verticalId,  setVerticalId]  = useState<string>(lead.vertical_id  ?? '')
  const [leadTypes,   setLeadTypes]   = useState<{ id: string; name: string; color: string }[]>([])
  const [verticals,   setVerticals]   = useState<{ id: string; name: string; color: string }[]>([])

  // Defined early so useEffect below can reference it
  // silent=true suppresses error messages (used for auto-enrich on mount)
  const enrichLead = async (force = false, silent = false) => {
    setEnriching(true)
    setEnrichMsg('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/enrich${force ? '?force=true' : ''}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.lead) {
        setLead(data.lead)
        if (!silent) setEnrichMsg(`✓ ${data.fields_updated?.length ?? 0} fields enriched from Miami-Dade PA`)
      } else if (data.skipped) {
        // silently skip — already enriched
      } else if (!silent) {
        setEnrichMsg(data.error ?? 'Enrichment failed.')
      }
    } catch {
      if (!silent) setEnrichMsg('Enrichment request failed.')
    }
    setTimeout(() => setEnrichMsg(''), 5000)
    setEnriching(false)
  }

  const deepEnrichLead = async () => {
    const propertyId = lead.property_id ?? lead.id
    if (!propertyId) return
    setDeepEnriching(true)
    setDeepEnrichMsg('')
    try {
      const res = await fetch(`/api/properties/deep-enrich/${propertyId}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.result) {
        setLead((prev: Lead) => ({ ...prev, ...data.updated, enrichment_src: 'reapi' }))
        setDeepEnrichMsg(`✓ ${data.fields_updated?.length ?? 0} fields enriched from RealEstateAPI`)
      } else {
        setDeepEnrichMsg(data.error ?? 'Deep enrich failed')
      }
    } catch {
      setDeepEnrichMsg('Deep enrich request failed')
    } finally {
      setDeepEnriching(false)
      setTimeout(() => setDeepEnrichMsg(''), 6000)
    }
  }

  // Auto-enrich Miami-Dade leads silently on first open
  // Works with or without a folio — discovers folio via GIS if needed
  useEffect(() => {
    const isMD   = initialLead.county === 'miami-dade'
    const notYet = !initialLead.enriched_at
    if (isMD && notYet) enrichLead(false, true)   // silent — no error toast on first load

    // Load lead types and verticals for the selectors
    Promise.all([
      fetch('/api/lead-types').then(r => r.ok ? r.json() : []),
      fetch('/api/business-verticals').then(r => r.ok ? r.json() : []),
    ]).then(([types, verts]) => {
      setLeadTypes((types as { id: string; name: string; color: string; is_active: boolean }[]).filter(t => t.is_active))
      setVerticals((verts as { id: string; name: string; color: string; is_active: boolean }[]).filter(v => v.is_active))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ds    = daysSince(lead.file_date)
  const dClr  = distressColor(ds)
  const eClr  = EQUITY_COLORS[lead.equity_tier] ?? '#9ca3af'

  const typedMessages = messages as Message[]
  const typedContact  = contact as Contact | null

  const updateStage = async (newStage: string) => {
    setStage(newStage)
    await fetch(`/api/leads/${lead.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline_stage: newStage || null }),
    })
  }

  const updateLeadType = async (val: string) => {
    setLeadTypeId(val)
    await fetch(`/api/leads/${lead.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_type_id: val || null }),
    })
  }

  const updateVertical = async (val: string) => {
    setVerticalId(val)
    await fetch(`/api/leads/${lead.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertical_id: val || null }),
    })
  }

  const toggleStar = async () => {
    const next = !starred
    setStarred(next)
    await fetch(`/api/leads/${lead.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: next }),
    })
  }

  const addToPipeline = async () => {
    if (lead.imported_to_contact) {
      router.push(`/contacts/${lead.imported_to_contact}`)
      return
    }
    setAddingPipeline(true)
    const res = await fetch('/api/leads/add-to-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: lead.id }),
    })
    const data = await res.json()
    if (data.ok) {
      if (data.already) {
        router.push(`/contacts/${data.contact_id}`)
      } else {
        setPipelineMsg('Contact created!')
        setLead((prev: Lead) => ({ ...prev, imported_to_contact: data.contact_id }))
        setTimeout(() => setPipelineMsg(''), 3000)
      }
    }
    setAddingPipeline(false)
  }

  const createDeal = async () => {
    if (!lead.imported_to_contact) {
      // Add to pipeline first, then create deal
      const res = await fetch('/api/leads/add-to-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      const data = await res.json()
      if (data.ok) {
        router.push(`/deals/new?contact_id=${data.contact_id}&address=${encodeURIComponent(lead.property_address || '')}`)
      }
    } else {
      router.push(`/deals/new?contact_id=${lead.imported_to_contact}&address=${encodeURIComponent(lead.property_address || '')}`)
    }
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'overview',        label: 'Overview' },
    { key: 'foreclosure',     label: 'Foreclosure' },
    { key: 'mortgage',        label: 'Mortgage' },
    { key: 'comps',           label: 'Comps' },
    { key: 'contacts',        label: '👤 Contacts' },
    { key: 'communications',  label: 'Communications' },
    { key: 'documents',       label: 'Documents' },
    { key: 'ai',              label: '✦ AI Analysis' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ color: 'var(--c-primary)' }}>

      {/* ── Property Header ── */}
      <div style={{ backgroundColor: '#0A1F44', flexShrink: 0 }}>
        <div className="px-4 md:px-8 pt-4 md:pt-6 pb-0">

          {/* Top row: back + action buttons */}
          <div className="flex items-center gap-3 mb-4">
            <a href="/leads" className="transition-opacity hover:opacity-70 shrink-0">
              <svg className="w-5 h-5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </a>

            <div className="flex-1" />

            {/* Star */}
            <button onClick={toggleStar} className="transition-opacity hover:opacity-70">
              <svg className="w-5 h-5" fill={starred ? '#C9A84C' : 'none'} stroke={starred ? '#C9A84C' : 'rgba(255,255,255,0.4)'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>

            {/* Lead type selector */}
            {leadTypes.length > 0 && (
              <select
                value={leadTypeId}
                onChange={e => updateLeadType(e.target.value)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg focus:outline-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: leadTypeId ? '#C9A84C' : 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}
                title="Lead Type"
              >
                <option value="">Lead Type</option>
                {leadTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}

            {/* Vertical selector */}
            {verticals.length > 0 && (
              <select
                value={verticalId}
                onChange={e => updateVertical(e.target.value)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg focus:outline-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: verticalId ? '#7B8FD4' : 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}
                title="Business Vertical"
              >
                <option value="">Vertical</option>
                {verticals.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            )}

            {/* Stage selector */}
            <select
              value={stage}
              onChange={e => updateStage(e.target.value)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg focus:outline-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.2)' }}
            >
              {STAGE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Property identity */}
          <div className="mb-4">
            <h1 className="text-lg md:text-2xl font-bold text-white leading-tight">
              {lead.property_address || 'Unknown Address'}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {[lead.city, lead.zip ? `FL ${lead.zip}` : null, COUNTY_LABELS[lead.county] ?? lead.county].filter(Boolean).join(' · ')}
            </p>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {lead.owner_name || lead.mortgagor || 'Unknown Owner'}
              {lead.entity_type ? ` · ${lead.entity_type}` : ''}
              {lead.homestead ? ' · 🏠 Owner-Occupied' : lead.vacant ? ' · 📭 Vacant' : ''}
            </p>
          </div>

          {/* Distress badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(lead.is_pre_foreclosure || lead.is_foreclosure) && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: 'rgba(224,123,106,0.2)', color: '#E07B6A' }}>
                {lead.foreclosure_type === 'P' ? 'Pre-Foreclosure' : 'Foreclosure'}
              </span>
            )}
            {lead.equity_tier && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: `${eClr}25`, color: eClr }}>
                {lead.equity_tier} Equity
              </span>
            )}
            {ds !== null && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: `${dClr}25`, color: dClr }}>
                {ds} days filed
              </span>
            )}
            {lead.multiple_liens && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                ⚠ Multiple Liens
              </span>
            )}
            {lead.imported_to_contact && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: 'rgba(76,175,154,0.2)', color: '#4CAF9A' }}>
                ✓ In Pipeline
              </span>
            )}
            {leadTypeId && leadTypes.length > 0 && (() => {
              const lt = leadTypes.find(t => t.id === leadTypeId)
              return lt ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: `${lt.color}25`, color: lt.color, border: `1px solid ${lt.color}50` }}>
                  {lt.name}
                </span>
              ) : null
            })()}
          </div>

          {/* Key stats */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-sm">
            {lead.market_value && (
              <span className="font-semibold text-white">{fmtK(lead.market_value)} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>market</span></span>
            )}
            {lead.equity_dollar_amount && (
              <span className="font-semibold" style={{ color: eClr }}>{fmtK(lead.equity_dollar_amount)} <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>equity ({lead.equity_percentage != null ? Number(lead.equity_percentage).toFixed(0) : '?'}%)</span></span>
            )}
            {lead.beds != null && (
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>{lead.beds}bd / {lead.baths ?? '?'}ba</span>
            )}
            {lead.living_area && (
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>{Number(lead.living_area).toLocaleString()} sqft</span>
            )}
            {lead.year_built && (
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>Built {lead.year_built}</span>
            )}
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap gap-2 pb-4">
            {lead.phone_1 && (
              <a
                href={`tel:${lead.phone_1}`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'rgba(76,175,154,0.2)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.3)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call
              </a>
            )}

            <button
              onClick={() => setTab('communications')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'rgba(107,189,224,0.2)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.3)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
              </svg>
              Text
            </button>

            <button
              onClick={addToPipeline}
              disabled={addingPipeline}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {addingPipeline ? 'Adding…' : lead.imported_to_contact ? 'View Contact' : '+ Pipeline'}
            </button>

            <button
              onClick={createDeal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'rgba(123,143,212,0.2)', color: '#7B8FD4', border: '1px solid rgba(123,143,212,0.3)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Create Deal
            </button>

            <button
              onClick={() => setTab('ai')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
              style={{ background: 'linear-gradient(135deg, rgba(201,168,76,0.3), rgba(123,143,212,0.3))', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}
            >
              ✦ AI Analysis
            </button>

            {/* Subtle PA enrichment status indicator */}
            {lead.county === 'miami-dade' && enriching && (
              <span className="flex items-center gap-1.5 px-3 py-2 text-xs"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                Enriching…
              </span>
            )}
          </div>

          {pipelineMsg && (
            <p className="text-xs font-semibold mb-2" style={{ color: '#4CAF9A' }}>✓ {pipelineMsg}</p>
          )}
          {enrichMsg && (
            <p className="text-xs font-semibold mb-2" style={{ color: enrichMsg.startsWith('✓') ? '#4CAF9A' : '#C9A84C' }}>{enrichMsg}</p>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex overflow-x-auto px-4 md:px-8" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-4 py-3 text-xs font-semibold whitespace-nowrap transition-colors shrink-0"
              style={{
                color: tab === t.key ? '#C9A84C' : 'rgba(255,255,255,0.4)',
                borderBottom: tab === t.key ? '2px solid #C9A84C' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        {tab === 'overview'       && <OverviewTab lead={lead} onReenrich={() => enrichLead(true)} enriching={enriching} onDeepEnrich={deepEnrichLead} deepEnriching={deepEnriching} deepEnrichMsg={deepEnrichMsg} />}
        {tab === 'foreclosure'    && <ForeclosureTab lead={lead} propertyId={lead.property_id ?? lead.id} />}
        {tab === 'mortgage'       && <MortgageTab lead={lead} />}
        {tab === 'comps'          && <CompsTab lead={lead} comps={comps} />}
        {tab === 'contacts'       && <ContactsTab propertyId={lead.property_id ?? lead.id} />}
        {tab === 'communications' && (
          <CommunicationsTab
            lead={lead}
            messages={typedMessages}
            contact={typedContact}
            notes={notes}
            onNoteSaved={note => setNotes(prev => [note, ...prev])}
          />
        )}
        {tab === 'documents' && (
          <Suspense fallback={null}>
            <DocumentsTab leadId={lead.id} propertyId={lead.property_id ?? undefined} />
          </Suspense>
        )}
        {tab === 'ai' && <AIAnalysisTab lead={lead} aiSummary={aiSummary} />}
      </div>
    </div>
  )
}
