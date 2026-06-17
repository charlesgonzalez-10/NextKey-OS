'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PropertyMapCard from '@/components/PropertyMapCard'

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

type TabKey = 'overview' | 'foreclosure' | 'mortgage' | 'comps' | 'communications' | 'ai'

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
            {ds <= 30  ? '✓ Early stage — high potential to negotiate before auction' :
             ds <= 90  ? '⚡ Mid stage — owner likely receiving calls. Act now.' :
             ds <= 180 ? '⚠ Late stage — auction may be scheduled. Verify status.' :
             '🔴 Critical — auction imminent or may have occurred. Verify immediately.'}
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
        <InfoRow label="Multiple Liens" value={lead.multiple_liens ? '⚠ Yes — Verify all lien positions' : 'No'} />
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
        <InfoRow label="Multiple Liens" value={lead.multiple_liens ? '⚠ Yes — verify all positions' : 'No'} />
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
}

interface MlsCompsResult {
  sold:               MlsComp[]
  active:             MlsComp[]
  pending:            MlsComp[]
  median_sold_price:  number | null
  avg_price_per_sqft: number | null
  radius_miles:       number
  fetched_at:         string
}

function CompsTab({ lead, comps }: { lead: Lead; comps: Comp[] }) {
  const [mlsComps,   setMlsComps]   = useState<MlsCompsResult | null>(null)
  const [mlsLoading, setMlsLoading] = useState(false)
  const [mlsError,   setMlsError]   = useState<string | null>(null)
  const [mlsRadius,  setMlsRadius]  = useState(0.5)
  const [noCredentials, setNoCredentials] = useState(false)

  const fetchMlsComps = async (radiusMi = mlsRadius) => {
    const addrFull = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
    if (!addrFull) return
    setMlsLoading(true)
    setMlsError(null)
    try {
      const params = new URLSearchParams({ address: addrFull, radius: String(radiusMi) })
      if (lead.beds)        params.set('beds', String(lead.beds))
      if (lead.living_area) params.set('sqft', String(lead.living_area))
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

  // Header row: source badge + radius toggle + refresh
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
      </div>
      <div className="flex items-center gap-2">
        {/* Radius toggle */}
        <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--c-text-3)' }}>
          {[0.25, 0.5, 1].map(r => (
            <button key={r}
              onClick={() => { setMlsRadius(r); fetchMlsComps(r) }}
              className="px-2 py-0.5 rounded-lg font-bold transition-all"
              style={{
                backgroundColor: mlsRadius === r ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                color:           mlsRadius === r ? '#C9A84C' : 'var(--c-text-3)',
                border:          `1px solid ${mlsRadius === r ? 'rgba(201,168,76,0.35)' : 'var(--c-border)'}`,
              }}>
              {r}mi
            </button>
          ))}
        </div>
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
          <p className="text-2xl mb-3">🔑</p>
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
  const totalComps = mlsSold.length + mlsActive.length + mlsPending.length

  return (
    <div className="space-y-5">
      <Header />

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
          <p className="text-sm mb-1" style={{ color: 'var(--c-text-3)' }}>No comps found within {mlsRadius}mi</p>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Try expanding the radius above</p>
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
            {items.map((comp, i) => (
              <div key={comp.mls_number ?? i}
                className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
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
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color }}>{fmtK(comp[priceKey])}</p>
                    {comp.price_per_sqft && (
                      <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>${comp.price_per_sqft}/sf</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {comp.sold_date && (
                    <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      Sold {new Date(comp.sold_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
  const [sms, setSms]           = useState('')
  const [sending, setSending]   = useState(false)
  const [noteBody, setNoteBody] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [addingToPipeline, setAddingToPipeline] = useState(false)
  const [pipelineResult, setPipelineResult] = useState<{ ok: boolean; contact_id?: string; already?: boolean } | null>(null)
  const [localMessages, setLocalMessages] = useState<Message[]>(messages)
  const msgEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [localMessages])

  const sendSms = async () => {
    if (!contact || !sms.trim()) return
    setSending(true)
    const tempId = `temp-${Date.now()}`
    const tempMsg: Message = { id: tempId, direction: 'outbound', body: sms.trim(), status: 'sending', created_at: new Date().toISOString() }
    setLocalMessages(prev => [...prev, tempMsg])
    setSms('')

    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id, body: tempMsg.body }),
    })
    const data = await res.json()
    if (data.message?.id) {
      setLocalMessages(prev => prev.map(m => m.id === tempId ? data.message : m))
    }
    setSending(false)
  }

  const saveNote = async () => {
    if (!noteBody.trim()) return
    setSavingNote(true)
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
    setSavingNote(false)
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
    if (data.ok && !data.already) {
      // Reload page to get linked contact data
      setTimeout(() => window.location.reload(), 1000)
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
          {contact && (
            <a href={`/contacts/${contact.id}`}
              className="text-xs font-semibold hover:underline"
              style={{ color: '#C9A84C' }}>
              View Contact →
            </a>
          )}
        </div>

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
                    {msg.direction === 'outbound' && msg.status === 'sending' ? ' · Sending…' : ''}
                  </p>
                </div>
              </div>
            </div>
          ))}
          <div ref={msgEndRef} />
        </div>

        <div className="flex gap-2 px-4 py-3" style={{ backgroundColor: 'var(--c-card)', borderTop: '1px solid var(--c-border)' }}>
          <input
            type="text"
            value={sms}
            onChange={e => setSms(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendSms()}
            placeholder="Type a message…"
            className="flex-1 text-sm px-3 py-2 rounded-xl focus:outline-none"
            style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
          />
          <button
            onClick={sendSms}
            disabled={sending || !sms.trim() || !contact}
            className="px-4 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          >
            Send
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
    setGen(false)
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
    { key: 'communications',  label: 'Communications' },
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
            <span className="px-2.5 py-1 rounded-full text-xs font-bold"
              style={{ backgroundColor: 'rgba(224,123,106,0.2)', color: '#E07B6A' }}>
              {lead.foreclosure_type === 'P' ? 'Pre-Foreclosure' : 'Foreclosure'}
            </span>
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
        {tab === 'communications' && (
          <CommunicationsTab
            lead={lead}
            messages={typedMessages}
            contact={typedContact}
            notes={notes}
            onNoteSaved={note => setNotes(prev => [note, ...prev])}
          />
        )}
        {tab === 'ai' && <AIAnalysisTab lead={lead} aiSummary={aiSummary} />}
      </div>
    </div>
  )
}
