'use client'

import { useState, useEffect } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldSource {
  field_name:   string
  field_value:  string | null
  source:       string
  source_type:  'internal' | 'public' | 'paid'
  source_label: string | null
  confidence:   number | null
  collected_at: string
}

interface DataPassport {
  property_id:  string
  fields:       FieldSource[]
  tier_summary: { internal: number; public: number; paid: number }
  last_updated: string | null
}

// ── Tier config ────────────────────────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  internal: '#7B8FD4',
  public:   '#4CAF9A',
  paid:     '#C9A84C',
}

const TIER_LABEL: Record<string, string> = {
  internal: 'Internal',
  public:   'Public Records',
  paid:     'Premium API',
}

const SOURCE_LABEL: Record<string, string> = {
  'broward-pa':    'Broward County PA',
  'palm-beach-pa': 'Palm Beach County PA',
  'miami-dade-pa': 'Miami-Dade PA',
  'martin-pa':     'Martin County PA',
  'st-lucie-pa':   'St. Lucie County PA',
  'reapi':         'RealEstateAPI',
  'rentcast':      'RentCast',
  'manual-import': 'Manual Import',
  'reapi-ingest':  'REAPI Ingest',
}

const FIELD_LABEL: Record<string, string> = {
  owner_name:      'Owner Name',
  mailing_address: 'Mailing Address',
  owner_city:      'Owner City',
  owner_state:     'Owner State',
  owner_zip:       'Owner ZIP',
  market_value:    'Market Value',
  assessed_value:  'Assessed Value',
  land_value:      'Land Value',
  building_value:  'Building Value',
  taxable_value:   'Taxable Value',
  annual_taxes:    'Annual Taxes',
  tax_year:        'Tax Year',
  last_sale_date:  'Last Sale Date',
  last_sale_amount:'Last Sale Amount',
  beds:            'Bedrooms',
  baths:           'Bathrooms',
  living_area:     'Living Area',
  year_built:      'Year Built',
  lot_size:        'Lot Size',
  legal_desc:      'Legal Description',
  zoning:          'Zoning',
  folio:           'Folio / APN',
  homestead:       'Homestead',
  absentee_owner:  'Absentee Owner',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtConf(n: number | null) {
  if (n === null) return null
  return `${Math.round(n * 100)}%`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TierBadge({ type }: { type: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
      textTransform: 'uppercase' as const,
      padding: '1px 5px', borderRadius: 3,
      background: `${TIER_COLOR[type] ?? '#4a6a9a'}22`,
      color: TIER_COLOR[type] ?? '#4a6a9a',
      border: `1px solid ${TIER_COLOR[type] ?? '#4a6a9a'}44`,
    }}>
      {TIER_LABEL[type] ?? type}
    </span>
  )
}

function FieldRow({ field }: { field: FieldSource }) {
  const label = FIELD_LABEL[field.field_name] ?? field.field_name.replace(/_/g, ' ')
  const sourceLabel = field.source_label ?? SOURCE_LABEL[field.source] ?? field.source
  const conf = fmtConf(field.confidence)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 4,
      padding: '5px 8px',
      borderBottom: '1px solid #0f2038',
      alignItems: 'center',
    }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
        <div style={{ fontSize: 9, color: '#4a6a9a', marginTop: 1, wordBreak: 'break-all' as const }}>
          {field.field_value ?? '—'}
        </div>
      </div>
      <div style={{ textAlign: 'center' as const }}>
        <div style={{ marginBottom: 2 }}>
          <TierBadge type={field.source_type} />
        </div>
        <div style={{ fontSize: 9, color: '#4a6a9a' }}>
          {sourceLabel}
        </div>
      </div>
      <div style={{ textAlign: 'right' as const }}>
        {conf && <div style={{ fontSize: 10, fontWeight: 600, color: '#4CAF9A' }}>{conf}</div>}
        <div style={{ fontSize: 9, color: '#4a6a9a', marginTop: 1 }}>{fmtDate(field.collected_at)}</div>
      </div>
    </div>
  )
}

function TierSummaryBar({ summary }: { summary: { internal: number; public: number; paid: number } }) {
  const total = summary.internal + summary.public + summary.paid
  if (!total) return null

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
      {(['paid', 'public', 'internal'] as const).map(type => {
        const count = summary[type]
        if (!count) return null
        return (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: TIER_COLOR[type] }} />
            <span style={{ fontSize: 10, color: '#4a6a9a' }}>
              {count} {TIER_LABEL[type]}
            </span>
          </div>
        )
      })}
      <span style={{ fontSize: 10, color: '#1a3050', marginLeft: 'auto' }}>{total} fields tracked</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DataPassportPanel() {
  const { lead } = useWorkspace()
  const propertyId = lead?.property_id ?? lead?.id

  const [passport, setPassport]   = useState<DataPassport | null>(null)
  const [loading, setLoading]     = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    if (!expanded || !propertyId || passport) return
    setLoading(true)
    setError(null)
    fetch(`/api/properties/${propertyId}/data-passport`)
      .then(r => r.json())
      .then(d => setPassport(d.passport ?? null))
      .catch(() => setError('Failed to load passport'))
      .finally(() => setLoading(false))
  }, [expanded, propertyId, passport])

  const hasData = passport && passport.fields.length > 0

  return (
    <div style={{
      marginTop: 8,
      background: '#0d1b2e',
      border: '1px solid #1a3050',
      borderRadius: 7,
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🗂</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a' }}>
            Data Passport
          </span>
          {hasData && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              padding: '1px 5px', borderRadius: 3,
              background: '#4CAF9A22', color: '#4CAF9A', border: '1px solid #4CAF9A44',
            }}>
              {passport.fields.length} fields
            </span>
          )}
        </div>
        <span style={{ color: '#4a6a9a', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1a3050' }}>
          {loading && (
            <div style={{ padding: '16px', textAlign: 'center' as const, fontSize: 11, color: '#4a6a9a' }}>
              Loading passport…
            </div>
          )}

          {error && (
            <div style={{ padding: '12px 14px', fontSize: 11, color: '#ef4444' }}>{error}</div>
          )}

          {!loading && !error && !hasData && (
            <div style={{ padding: '16px', textAlign: 'center' as const }}>
              <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 4 }}>No provenance data yet.</div>
              <div style={{ fontSize: 10, color: '#1a3050' }}>
                Field sources are recorded automatically when a property is enriched.
              </div>
            </div>
          )}

          {hasData && (
            <div style={{ padding: '10px 14px 0' }}>
              <TierSummaryBar summary={passport.tier_summary} />

              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 4,
                padding: '4px 8px 6px',
                borderBottom: '1px solid #1a3050',
              }}>
                {['Field / Value', 'Source', 'Confidence'].map(h => (
                  <div key={h} style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
                    textTransform: 'uppercase' as const, color: '#1a3050',
                    textAlign: h === 'Confidence' ? 'right' as const : h === 'Source' ? 'center' as const : 'left' as const,
                  }}>{h}</div>
                ))}
              </div>

              {passport.fields.map(f => <FieldRow key={f.field_name} field={f} />)}

              {passport.last_updated && (
                <div style={{ padding: '8px', textAlign: 'center' as const, fontSize: 9, color: '#1a3050' }}>
                  Last updated {fmtDate(passport.last_updated)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
