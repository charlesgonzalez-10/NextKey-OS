'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PropertySearchResult } from '@/lib/enrichment/types'

// ─── Helpers (identical to lead-detail-client) ────────────────────────────────

function fmtK(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}
function fmt$(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// ─── Tile — same as lead detail ───────────────────────────────────────────────

function Tile({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: color ?? 'var(--c-primary)' }}>{String(value)}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{sub}</p>}
    </div>
  )
}

// ─── InfoRow — same as lead detail ────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-xs shrink-0 w-36 pt-0.5" style={{ color: 'var(--c-text-2)' }}>{label}</span>
      <span className="text-sm font-medium text-right" style={{ color: 'var(--c-primary)' }}>{value}</span>
    </div>
  )
}

// ─── PropertyMedia — same as lead detail ──────────────────────────────────────

function PropertyMedia({ address, city, zip }: { address: string; city?: string; zip?: string }) {
  const [streetViewOk, setStreetViewOk] = useState(true)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  const fullAddress = [address, city, zip ? `FL ${zip}` : 'FL'].filter(Boolean).join(', ')
  const encoded = encodeURIComponent(fullAddress)

  if (!apiKey) return null

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
      {streetViewOk ? (
        <div className="relative w-full" style={{ height: 220 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://maps.googleapis.com/maps/api/streetview?size=900x440&location=${encoded}&fov=90&pitch=5&key=${apiKey}`}
            alt={`Street view of ${address}`}
            className="w-full h-full object-cover"
            onError={() => setStreetViewOk(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }}>
            <p className="text-white text-xs font-semibold">{address}</p>
            <p className="text-white/60 text-[11px]">{city}{zip ? `, FL ${zip}` : ''}</p>
          </div>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encoded}`}
            target="_blank" rel="noopener noreferrer"
            className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-1 rounded-lg"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)' }}>
            Open in Maps ↗
          </a>
        </div>
      ) : (
        <div className="flex items-center justify-center h-24 text-sm"
          style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-3)' }}>
          Street view not available
        </div>
      )}
      <div style={{ height: 200 }}>
        <iframe title="Property location" width="100%" height="200"
          style={{ border: 'none', display: 'block' }} loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          src={`https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encoded}&zoom=16`}
        />
      </div>
    </div>
  )
}

// ─── Sales history table ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSalesHistory(raw: Record<string, any> | undefined) {
  if (!raw) return []

  // Miami-Dade PA: SalesInfos array (full history)
  if (Array.isArray(raw.SalesInfos)) {
    return raw.SalesInfos
      .filter((s: Record<string, unknown>) => s.DateOfSale)
      .map((s: Record<string, unknown>) => ({
        date:       String(s.DateOfSale ?? ''),
        price:      s.SalePrice != null ? Number(s.SalePrice) : null,
        instrument: String(s.SaleInstrument ?? '—'),
        grantor:    String(s.GrantorName1 ?? '—'),
        grantee:    String(s.GranteeName1 ?? '—'),
        book:       s.OfficialRecordBook ? String(s.OfficialRecordBook) : '',
        page:       s.OfficialRecordPage ? String(s.OfficialRecordPage) : '',
      }))
  }

  // REAPI: last + prior only
  const sales = []
  const lastDate  = raw.lastSaleDate  ?? raw.last_sale_date
  const lastAmt   = raw.lastSaleAmount ?? raw.last_sale_amount
  const priorDate = raw.priorSaleDate ?? raw.prior_sale_date
  const priorAmt  = raw.priorSaleAmount ?? raw.prior_sale_amount
  if (lastDate)  sales.push({ date: String(lastDate),  price: lastAmt  != null ? Number(lastAmt)  : null, instrument: String(raw.documentType ?? '—'), grantor: '—', grantee: '—', book: '', page: '' })
  if (priorDate) sales.push({ date: String(priorDate), price: priorAmt != null ? Number(priorAmt) : null, instrument: '—', grantor: '—', grantee: '—', book: '', page: '' })
  return sales
}

// ─── Main Component ───────────────────────────────────────────────────────────

type TabKey = 'overview' | 'ownership' | 'financials' | 'history' | 'comps'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',   label: 'Overview' },
  { key: 'ownership',  label: 'Ownership' },
  { key: 'financials', label: 'Financials' },
  { key: 'history',    label: 'Sale History' },
  { key: 'comps',      label: 'Comps' },
]

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

export default function PropertyDetailClient({
  query,
  property,
  error,
}: {
  query: string
  property: PropertySearchResult | null
  error: string | null
}) {
  const router = useRouter()
  const [lookupInput, setLookupInput] = useState(query)
  const [tab, setTab] = useState<TabKey>('overview')

  const p   = property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = p?.raw as Record<string, any> | undefined
  const sales = extractSalesHistory(raw)

  const countyLabel = p ? (COUNTY_LABELS[p.county] ?? p.county) : ''

  // Equity tier from REAPI flags
  const equityTier = raw?._high_equity ? 'High' : raw?._equity_percent > 30 ? 'Medium' : raw?._equity_percent > 0 ? 'Low' : null
  const equityColor = equityTier ? EQUITY_COLORS[equityTier] : '#9ca3af'

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--c-primary)' }}>

      {/* ── Dark header (identical to lead detail) ────────────────────── */}
      <div style={{ backgroundColor: '#0A1F44' }}>

        {/* Address row */}
        <div className="px-4 md:px-6 pt-4 pb-3">

          {/* Back + search bar */}
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => router.back()}
              className="shrink-0 hover:opacity-60"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 flex items-center rounded-xl overflow-hidden"
              style={{ backgroundColor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <svg className="w-4 h-4 ml-3 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
              </svg>
              <input type="text" value={lookupInput}
                onChange={e => setLookupInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && lookupInput.trim()) router.push(`/leads/property?q=${encodeURIComponent(lookupInput.trim())}`) }}
                placeholder="Look up any South Florida property…"
                className="flex-1 py-2 pr-2 text-sm bg-transparent focus:outline-none"
                style={{ color: 'white' }} />
              <button onClick={() => { if (lookupInput.trim()) router.push(`/leads/property?q=${encodeURIComponent(lookupInput.trim())}`) }}
                className="px-3 py-2 text-[11px] font-bold shrink-0 hover:opacity-80"
                style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
                Look Up
              </button>
            </div>
          </div>

          {/* Not found state */}
          {(error || !p) && (
            <div className="py-8 text-center">
              <p className="text-4xl mb-3">🏠</p>
              <p className="font-bold text-white mb-1">{error ?? 'Property not found'}</p>
              <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Try adding city and state — e.g. &quot;{query.split(',')[0].trim()}, Weston FL 33331&quot;
              </p>
              <button onClick={() => router.back()}
                className="text-sm font-bold px-4 py-2 rounded-xl"
                style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
                ← Back to Property Search
              </button>
            </div>
          )}

          {p && (
            <>
              {/* Address + county */}
              <h1 className="text-2xl font-bold text-white">{p.property_address}</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {[p.city, p.state, p.zip].filter(Boolean).join(', ')} · {countyLabel}
              </p>

              {/* Owner */}
              {p.owner_name && (
                <p className="text-sm mt-1 font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {p.owner_name}
                  {p.absentee_owner && (
                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(201,168,76,0.25)', color: '#C9A84C' }}>
                      Absentee{p.owner_state && p.owner_state !== 'FL' ? ` · Out-of-State (${p.owner_state})` : ' · In-State'}
                    </span>
                  )}
                </p>
              )}

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {p.distress?.case_type && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ff6b6b' }}>
                    {p.distress.case_type}
                  </span>
                )}
                {equityTier && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: `${equityColor}25`, color: equityColor }}>
                    {equityTier} Equity
                  </span>
                )}
                {p.distress?.file_date && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
                    Filed {p.distress.file_date}
                  </span>
                )}
                {raw?._free_clear && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(76,175,154,0.2)', color: '#4CAF9A' }}>
                    Free &amp; Clear
                  </span>
                )}
                {raw?._vacant && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ff6b6b' }}>
                    Vacant
                  </span>
                )}
              </div>

              {/* Quick stats */}
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
                {(p.market_value || p.assessed_value) && (
                  <span className="font-bold text-white">
                    {fmtK(p.market_value ?? p.assessed_value)}
                    <span className="text-xs font-normal ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>market</span>
                  </span>
                )}
                {p.beds != null && <span style={{ color: 'rgba(255,255,255,0.7)' }}>{p.beds}bd / {p.baths ?? '?'}ba</span>}
                {p.living_area && <span style={{ color: 'rgba(255,255,255,0.7)' }}>{p.living_area.toLocaleString()} sqft</span>}
                {p.year_built  && <span style={{ color: 'rgba(255,255,255,0.7)' }}>Built {p.year_built}</span>}
                {raw?._suggested_rent && <span style={{ color: '#6ABDE0' }}>~{fmtK(raw._suggested_rent)}/mo rent</span>}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {p.pa_url && (
                  <a href={p.pa_url} target="_blank" rel="noreferrer"
                    className="text-[11px] font-bold px-3 py-1.5 rounded-xl hover:opacity-80"
                    style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.15)' }}>
                    View on PA ↗
                  </a>
                )}
                {p.distress?.lead_id && (
                  <button onClick={() => router.push(`/leads/${p.distress!.lead_id}`)}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-xl hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ff6b6b', border: '1px solid rgba(239,68,68,0.25)' }}>
                    Open Full Lead Detail →
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Tabs */}
        {p && (
          <div className="flex overflow-x-auto px-4 md:px-6 gap-0" style={{ scrollbarWidth: 'none' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors"
                style={{
                  borderColor: tab === t.key ? '#C9A84C' : 'transparent',
                  color: tab === t.key ? '#C9A84C' : 'rgba(255,255,255,0.45)',
                }}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      {p && (
        <div className="flex-1 overflow-auto px-4 md:px-6 py-5 space-y-5">

          {/* ══ OVERVIEW ══ */}
          {tab === 'overview' && (
            <>
              <PropertyMedia address={p.property_address} city={p.city} zip={p.zip} />

              {/* Distress banner */}
              {p.distress && (
                <div className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
                  style={{ backgroundColor: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div>
                    <p className="text-sm font-bold" style={{ color: '#ef4444' }}>⚠ In your distress database</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs" style={{ color: 'var(--c-text-2)' }}>
                      {p.distress.case_type   && <span>{p.distress.case_type}</span>}
                      {p.distress.file_date   && <span>Filed {p.distress.file_date}</span>}
                      {p.distress.lien_amount && <span style={{ color: '#ef4444', fontWeight: 600 }}>{fmt$(p.distress.lien_amount)} lien</span>}
                      {p.distress.pipeline_stage && (
                        <span className="px-2 py-0.5 rounded-full font-bold"
                          style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                          {p.distress.pipeline_stage}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => router.push(`/leads/${p.distress!.lead_id}`)}
                    className="text-xs font-bold px-3 py-2 rounded-xl hover:opacity-80 shrink-0"
                    style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                    Open Full Lead →
                  </button>
                </div>
              )}

              {/* Property Details */}
              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Property Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Tile label="Beds"       value={p.beds ?? '—'} />
                  <Tile label="Baths"      value={p.baths ?? '—'} />
                  <Tile label="Sqft"       value={p.living_area ? p.living_area.toLocaleString() : '—'} sub="living area" />
                  <Tile label="Year Built" value={p.year_built ?? '—'} />
                  {p.lot_size    && <Tile label="Lot Size"   value={p.lot_size.toLocaleString()} sub="sqft" />}
                  {p.stories     && <Tile label="Stories"    value={p.stories} />}
                  {p.property_use && <Tile label="Type"      value={p.property_use} />}
                  <Tile label="Occupancy"
                    value={!p.absentee_owner ? 'Owner-Occupied' : raw?._vacant ? 'Vacant' : 'Absentee'}
                    color={!p.absentee_owner ? '#4CAF9A' : raw?._vacant ? '#E07B6A' : '#C9A84C'} />
                </div>
                <InfoRow label="Property Address" value={p.property_address} />
                <InfoRow label="City / State / ZIP" value={[p.city, p.state, p.zip].filter(Boolean).join(', ')} />
                <InfoRow label="County"      value={countyLabel} />
                <InfoRow label="Subdivision" value={p.subdivision} />
                <InfoRow label="Zoning"      value={p.zoning} />
                <InfoRow label="Folio / APN" value={<span className="font-mono text-xs">{p.folio}</span>} />
              </div>

              {/* Valuation */}
              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Valuation</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Tile label="Market Value"   value={fmtK(p.market_value)}   color="var(--c-primary)" />
                  <Tile label="Assessed Value" value={fmtK(p.assessed_value)} />
                  {raw?._estimated_equity != null && (
                    <Tile label="Est. Equity"
                      value={fmtK(raw._estimated_equity)}
                      sub={raw._equity_percent != null ? `${raw._equity_percent}% · ${equityTier ?? ''}` : undefined}
                      color={equityColor} />
                  )}
                  <Tile label="Land Value"     value={fmtK(p.land_value)} />
                  <Tile label="Building Value" value={fmtK(p.building_value)} />
                  {raw?._suggested_rent && <Tile label="Est. Rent" value={`${fmtK(raw._suggested_rent)}/mo`} color="#6ABDE0" />}
                </div>
              </div>
            </>
          )}

          {/* ══ OWNERSHIP ══ */}
          {tab === 'ownership' && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Ownership</h3>
              <InfoRow label="Owner Name"    value={p.owner_name} />
              <InfoRow label="Mailing"       value={p.mailing_address} />
              <InfoRow label="Owner City"    value={p.owner_city} />
              <InfoRow label="Owner State"   value={
                p.owner_state && p.owner_state !== 'FL'
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>Out-of-State · {p.owner_state}</span>
                  : p.owner_state
              } />
              <InfoRow label="Owner ZIP"     value={p.owner_zip} />
              <InfoRow label="Absentee"      value={p.absentee_owner ? '✓ Yes' : 'No — Owner Occupied'} />
              <InfoRow label="Folio / APN"   value={<span className="font-mono text-xs">{p.folio}</span>} />
              {p.folio && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--c-border)' }}>
                  {p.pa_url && (
                    <a href={p.pa_url} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold underline hover:opacity-70" style={{ color: '#7B8FD4' }}>
                      View official PA record → {p.folio}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ FINANCIALS ══ */}
          {tab === 'financials' && (
            <div className="space-y-5">
              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--c-text-2)' }}>Valuation</h3>
                <InfoRow label="Market Value"   value={fmt$(p.market_value)} />
                <InfoRow label="Assessed Value" value={fmt$(p.assessed_value)} />
                <InfoRow label="Land Value"     value={fmt$(p.land_value)} />
                <InfoRow label="Building Value" value={fmt$(p.building_value)} />
                <InfoRow label="Tax Year"       value={p.tax_year} />
                <InfoRow label="Annual Taxes"   value={p.annual_taxes ? fmt$(p.annual_taxes) : null} />
                {raw?._estimated_equity != null && (
                  <InfoRow label="Est. Equity"
                    value={`${fmt$(raw._estimated_equity)}${raw._equity_percent != null ? ` (${raw._equity_percent}%)` : ''}`} />
                )}
                {raw?._suggested_rent && (
                  <InfoRow label="Est. Monthly Rent" value={`${fmt$(raw._suggested_rent)}/mo`} />
                )}
              </div>
              {p.legal_desc && (
                <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid rgba(76,175,154,0.3)' }}>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#4CAF9A' }}>Legal Description</h3>
                  <p className="text-xs font-mono leading-relaxed" style={{ color: 'var(--c-text-2)' }}>{p.legal_desc}</p>
                </div>
              )}
            </div>
          )}

          {/* ══ SALE HISTORY ══ */}
          {tab === 'history' && (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
              <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--c-border)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>Sale History</h3>
              </div>
              {sales.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--c-text-3)' }}>No sale history on record</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card-alt)' }}>
                        {['Date', 'Price', 'Instrument', 'Grantor', 'Grantee', ...(sales.some(s => s.book) ? ['Book', 'Page'] : [])].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider"
                            style={{ color: 'var(--c-text-3)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sales.map((s, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--c-border)' }}>
                          <td className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--c-primary)' }}>{s.date}</td>
                          <td className="px-4 py-2.5 font-bold" style={{ color: s.price ? '#4CAF9A' : 'var(--c-text-3)' }}>
                            {s.price ? fmt$(s.price) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--c-text-2)' }}>{s.instrument}</td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--c-text-2)' }}>{s.grantor}</td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--c-text-2)' }}>{s.grantee}</td>
                          {sales.some(s => s.book) && (
                            <><td className="px-4 py-2.5 text-xs" style={{ color: 'var(--c-text-3)' }}>{s.book || '—'}</td>
                              <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--c-text-3)' }}>{s.page || '—'}</td></>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══ COMPS (coming soon) ══ */}
          {tab === 'comps' && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Comparable Sales</p>
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                Coming soon — Beaches MLS &amp; market data integration in progress
              </p>
            </div>
          )}

          {/* Source note */}
          <p className="text-[10px] pb-2" style={{ color: 'var(--c-text-3)' }}>
            Source: {p.source === 'miami-dade-pa' ? 'Miami-Dade Property Appraiser (official)' : p.source === 'reapi' ? 'RealEstateAPI.com' : p.source}
            {p.pa_url && <> · <a href={p.pa_url} target="_blank" rel="noreferrer" className="underline hover:opacity-70">Official PA record ↗</a></>}
          </p>
        </div>
      )}
    </div>
  )
}
