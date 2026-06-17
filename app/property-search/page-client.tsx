'use client'

/**
 * Property Search
 *
 * One page, two ways to work:
 *   1. Type an address/folio/owner → "Look Up" button appears →
 *      instantly shows that property's full detail card inline
 *   2. Build acquisition criteria → "Run Search" → bulk distress list
 *
 * Both live on the same screen. No tabs, no separate pages.
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import type { PropertySearchResult } from '@/lib/enrichment/types'
import type { CompsResult } from '@/lib/mls/beaches-mls'
import { useRouter } from 'next/navigation'
import PropertySearchPanel, {
  CriteriaState,
  criteriaToParams,
  activeCriteriaCount,
} from '@/components/PropertySearchPanel'
import type { DrawnZone } from '@/components/AcquisitionMap'

// ─── Enrichment data shape (from /api/property-search/enrich) ─────────────────

interface EnrichmentData {
  equity_percent:   number | null
  estimated_equity: number | null
  open_mortgage:    number | null
  estimated_value:  number | null
  suggested_rent:   number | null
  free_clear:       boolean
  high_equity:      boolean
  absentee_owner:   boolean
  vacant:           boolean
  pre_foreclosure:  boolean
  foreclosure:      boolean
  auction:          boolean
  tax_lien:         boolean
  mls_active:       boolean
}

// Lazy-load the map so it doesn't block initial paint
const AcquisitionMap = lazy(() => import('@/components/AcquisitionMap'))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${n.toLocaleString()}`
}

function fmtSqft(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n.toLocaleString()} sf`
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return s }
}

// ─── InlineComps ─────────────────────────────────────────────────────────────

function InlineComps({ comps }: { comps: CompsResult }) {
  const { sold, active, pending, median_sold_price, avg_price_per_sqft } = comps
  const total = sold.length + active.length + pending.length

  if (total === 0) {
    return (
      <div className="px-4 py-3 text-center">
        <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>No comps found within ½ mile</p>
      </div>
    )
  }

  return (
    <div>
      {/* Stats row */}
      {(median_sold_price || avg_price_per_sqft) && (
        <div className="grid grid-cols-3 divide-x" style={{ borderBottom: '1px solid var(--c-border)', '--tw-divide-opacity': '1' } as React.CSSProperties}>
          {[
            { label: 'Median Sold',  value: median_sold_price   ? fmt$(median_sold_price)              : '—' },
            { label: 'Avg $/sqft',   value: avg_price_per_sqft  ? `$${avg_price_per_sqft}/sf`          : '—' },
            { label: 'Comps Found',  value: `${sold.length}s / ${active.length}a` },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center py-2.5 px-1"
              style={{ borderRight: '1px solid var(--c-border)' }}>
              <span className="text-[8px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>{label}</span>
              <span className="text-[11px] font-bold" style={{ color: value === '—' ? 'var(--c-text-3)' : '#4CAF9A' }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top 3 sold comps */}
      {sold.length > 0 && (
        <div className="px-3 py-2" style={{ borderBottom: active.length > 0 ? '1px solid var(--c-border)' : undefined }}>
          <p className="text-[8px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#4CAF9A' }}>
            Sold ({sold.length})
          </p>
          <div className="space-y-1.5">
            {sold.slice(0, 3).map((c, i) => (
              <div key={c.mls_number ?? i} className="flex items-center justify-between">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-[10px] font-semibold truncate" style={{ color: 'var(--c-primary)' }}>{c.address}</p>
                  <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>
                    {[c.beds && `${c.beds}bd`, c.baths && `${c.baths}ba`, c.living_area && `${c.living_area.toLocaleString()}sf`].filter(Boolean).join(' · ')}
                    {c.sold_date ? ` · ${new Date(c.sold_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
                    {c.distance_miles ? ` · ${c.distance_miles}mi` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-bold" style={{ color: '#4CAF9A' }}>{fmt$(c.sold_price)}</p>
                  {c.price_per_sqft && <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>${c.price_per_sqft}/sf</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top 3 active listings */}
      {active.length > 0 && (
        <div className="px-3 py-2">
          <p className="text-[8px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#C9A84C' }}>
            Active ({active.length})
          </p>
          <div className="space-y-1.5">
            {active.slice(0, 3).map((c, i) => (
              <div key={c.mls_number ?? i} className="flex items-center justify-between">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-[10px] font-semibold truncate" style={{ color: 'var(--c-primary)' }}>{c.address}</p>
                  <p className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>
                    {[c.beds && `${c.beds}bd`, c.baths && `${c.baths}ba`, c.living_area && `${c.living_area.toLocaleString()}sf`].filter(Boolean).join(' · ')}
                    {c.days_on_market ? ` · ${c.days_on_market}d on market` : ''}
                    {c.distance_miles ? ` · ${c.distance_miles}mi` : ''}
                  </p>
                </div>
                <p className="text-[11px] font-bold shrink-0" style={{ color: '#C9A84C' }}>{fmt$(c.list_price)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── LookupResultCard ─────────────────────────────────────────────────────────

function LookupResultCard({
  result,
  saved,
  onSave,
  onClear,
  enrichData,
  enrichLoading,
  onEnrich,
}: {
  result:        PropertySearchResult
  saved:         boolean
  onSave:        () => void
  onClear:       () => void
  enrichData:    EnrichmentData | null
  enrichLoading: boolean
  onEnrich:      () => void
}) {
  const d = result.distress

  // Verified foreclosure = has case number (actual lis pendens / OR record)
  // Unverified = flag exists in DB but no case number (may be REAPI estimate)
  const flags: Array<{ label: string; verified: boolean }> = []
  if (d?.foreclosure_type === 'P') flags.push({ label: 'Pre-Foreclosure', verified: !!d.case_number })
  if (d?.foreclosure_type === 'F') flags.push({ label: 'Foreclosure',     verified: !!d.case_number })
  if (d?.foreclosure_type === 'A') flags.push({ label: 'Auction',         verified: !!d.case_number })

  // Consistent source name regardless of which adapter returned the result
  const sourceLabel =
    result.source_display ??
    (result.source === 'reapi'          ? 'REAPI'            :
     result.source === 'miami-dade-pa'  ? 'Miami-Dade PA'    :
     result.source === 'broward-pa'     ? 'BCPA'             :
     result.source === 'palm-beach-pa'  ? 'Palm Beach PA'    :
     result.source?.includes('pa')      ? 'County PA'        : 'REAPI')

  // For REAPI results the enrichment data is already embedded in raw
  const rawR = result.source === 'reapi' ? (result.raw as Record<string, unknown>) : null
  const equityPct  = enrichData?.equity_percent  ?? (rawR?._equity_percent  as number | null)  ?? null
  const rentEst    = enrichData?.suggested_rent  ?? (rawR?._suggested_rent  as number | null)  ?? null
  const freeClear  = enrichData?.free_clear      ?? (rawR?._free_clear      as boolean)        ?? false
  const highEquity = enrichData?.high_equity     ?? (rawR?._high_equity     as boolean)        ?? false
  const vacantFlag = enrichData?.vacant          ?? (rawR?._vacant          as boolean)        ?? false
  const reapiPreFC = enrichData?.pre_foreclosure ?? (rawR?._pre_foreclosure as boolean)        ?? false
  const reapiFC    = enrichData?.foreclosure     ?? (rawR?._foreclosure     as boolean)        ?? false

  // REAPI signals — only show if NOT already covered by a verified DB record
  const dbVerifiedPreFC = d?.foreclosure_type === 'P' && d?.case_number
  const dbVerifiedFC    = d?.foreclosure_type === 'F' && d?.case_number
  const reapiSignals: string[] = []
  if (reapiPreFC && !dbVerifiedPreFC) reapiSignals.push('Pre-FC flag')
  if (reapiFC    && !dbVerifiedFC)    reapiSignals.push('Foreclosure flag')
  if (freeClear)                      reapiSignals.push('Free & Clear')
  if (highEquity)                     reapiSignals.push('High Equity')
  if (vacantFlag)                     reapiSignals.push('Vacant')

  const showEnrichSection = enrichData !== null || result.source === 'reapi'
  // Show Deep Enrich button only for PA-sourced properties not yet enriched
  const showEnrichBtn = result.source !== 'reapi' && !enrichData

  // Google Maps link
  const gmaps = `https://www.google.com/maps/search/${encodeURIComponent(
    [result.property_address, result.city, result.state, result.zip].filter(Boolean).join(', ')
  )}`

  return (
    <div>
      {/* Card header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div className="flex-1 min-w-0 pr-2">
          <p className="text-[13px] font-bold leading-tight" style={{ color: 'var(--c-primary)' }}>
            {result.property_address}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            {[result.city, result.state, result.zip].filter(Boolean).join(', ')}
          </p>
        </div>
        <button onClick={onClear} className="shrink-0 mt-0.5 hover:opacity-60 text-xs px-1.5 py-0.5 rounded-lg"
          style={{ color: 'var(--c-text-3)', backgroundColor: 'var(--c-hover)' }}>✕</button>
      </div>

      {/* Source badge + distress flags */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
        {/* Data source */}
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(107,159,212,0.12)', color: '#6B9FD4', border: '1px solid rgba(107,159,212,0.3)' }}>
          {sourceLabel}
        </span>

        {result.absentee_owner && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
            Absentee Owner
          </span>
        )}

        {/* Foreclosure badges — red when verified by case number, amber when unverified */}
        {flags.map(f => (
          <span key={f.label} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: f.verified ? 'rgba(231,76,60,0.12)'  : 'rgba(251,146,60,0.10)',
              color:            f.verified ? '#E74C3C'               : '#FB923C',
              border:           `1px solid ${f.verified ? 'rgba(231,76,60,0.35)' : 'rgba(251,146,60,0.35)'}`,
            }}>
            {f.label}{!f.verified ? ' (unverified)' : ''}
          </span>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--c-border)' }} />

      {/* Owner block */}
      {result.owner_name && (
        <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>Owner</p>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--c-primary)' }}>{result.owner_name}</p>
          {result.mailing_address && result.mailing_address !== result.property_address && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
              {result.mailing_address}{result.owner_city ? `, ${result.owner_city}` : ''}{result.owner_state ? `, ${result.owner_state}` : ''}
            </p>
          )}
        </div>
      )}

      {/* Property stats grid */}
      <div className="grid grid-cols-4 gap-0" style={{ borderBottom: '1px solid var(--c-border)' }}>
        {[
          { label: 'Beds',    value: result.beds      ?? '—' },
          { label: 'Baths',   value: result.baths     ?? '—' },
          { label: 'Living',  value: fmtSqft(result.living_area) },
          { label: 'Built',   value: result.year_built ?? '—' },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center py-2.5 px-1"
            style={{ borderRight: '1px solid var(--c-border)' }}>
            <span className="text-[8px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>{label}</span>
            <span className="text-[12px] font-bold" style={{ color: 'var(--c-primary)' }}>{String(value)}</span>
          </div>
        ))}
      </div>

      {/* Valuations — source tagged as PA */}
      <div className="grid grid-cols-3 gap-0" style={{ borderBottom: '1px solid var(--c-border)' }}>
        {[
          { label: 'Market',   value: fmt$(result.market_value)   },
          { label: 'Assessed', value: fmt$(result.assessed_value) },
          { label: 'Land',     value: fmt$(result.land_value)     },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center py-2.5 px-1"
            style={{ borderRight: '1px solid var(--c-border)' }}>
            <span className="text-[8px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>{label}</span>
            <span className="text-[11px] font-bold" style={{ color: value === '—' ? 'var(--c-text-3)' : '#C9A84C' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Enrichment section — equity + REAPI signals */}
      {showEnrichSection && (
        <div style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(76,175,154,0.03)' }}>
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#4CAF9A' }}>
              REAPI Enrichment
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: 'rgba(107,159,212,0.12)', color: '#6B9FD4', border: '1px solid rgba(107,159,212,0.25)' }}>
              REAPI
            </span>
          </div>
          <div className="grid grid-cols-3 gap-0 px-0" style={{ borderTop: '1px solid var(--c-border)' }}>
            <div className="flex flex-col items-center py-2.5 px-1" style={{ borderRight: '1px solid var(--c-border)' }}>
              <span className="text-[8px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>Equity %</span>
              <span className="text-[11px] font-bold" style={{ color: equityPct != null ? '#4CAF9A' : 'var(--c-text-3)' }}>
                {equityPct != null ? `${equityPct}%` : '—'}
              </span>
            </div>
            <div className="flex flex-col items-center py-2.5 px-1" style={{ borderRight: '1px solid var(--c-border)' }}>
              <span className="text-[8px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>Est. Equity</span>
              <span className="text-[11px] font-bold" style={{ color: enrichData?.estimated_equity != null || rawR?._estimated_equity != null ? '#4CAF9A' : 'var(--c-text-3)' }}>
                {fmt$(enrichData?.estimated_equity ?? (rawR?._estimated_equity as number | null))}
              </span>
            </div>
            <div className="flex flex-col items-center py-2.5 px-1">
              <span className="text-[8px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--c-text-3)' }}>Est. Rent</span>
              <span className="text-[11px] font-bold" style={{ color: rentEst != null ? '#C9A84C' : 'var(--c-text-3)' }}>
                {rentEst != null ? `$${rentEst.toLocaleString()}` : '—'}
              </span>
            </div>
          </div>
          {reapiSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2.5 pt-1">
              {reapiSignals.map(s => (
                <span key={s} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(251,146,60,0.10)', color: '#FB923C', border: '1px solid rgba(251,146,60,0.3)' }}>
                  REAPI: {s}
                </span>
              ))}
              <span className="text-[9px] px-2 py-0.5" style={{ color: 'var(--c-text-3)', fontStyle: 'italic' }}>
                Verify before labeling
              </span>
            </div>
          )}
        </div>
      )}

      {/* Last sale */}
      {(result.last_sale_date || result.last_sale_amount) && (
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Last Sale</span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--c-primary)' }}>
            {fmtDate(result.last_sale_date)}{result.last_sale_amount ? ` · ${fmt$(result.last_sale_amount)}` : ''}
          </span>
        </div>
      )}

      {/* Verified distress detail */}
      {d && (d.case_number || d.file_date || d.plaintiff || d.lender_name) && (
        <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(231,76,60,0.04)' }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#E74C3C' }}>
            Verified Distress Record
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {d.case_number && (
              <div>
                <p className="text-[8px] uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Case #</p>
                <p className="text-[10px] font-mono font-semibold" style={{ color: 'var(--c-primary)' }}>{d.case_number}</p>
              </div>
            )}
            {d.file_date && (
              <div>
                <p className="text-[8px] uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Filed</p>
                <p className="text-[10px] font-semibold" style={{ color: 'var(--c-primary)' }}>{fmtDate(d.file_date)}</p>
              </div>
            )}
            {(d.plaintiff || d.lender_name) && (
              <div className="col-span-2">
                <p className="text-[8px] uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Plaintiff / Lender</p>
                <p className="text-[10px] font-semibold" style={{ color: 'var(--c-primary)' }}>{d.plaintiff ?? d.lender_name}</p>
              </div>
            )}
            {d.lien_amount && (
              <div>
                <p className="text-[8px] uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Lien Amount</p>
                <p className="text-[10px] font-bold" style={{ color: '#E74C3C' }}>{fmt$(d.lien_amount)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Folio */}
      {result.folio && (
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Folio / APN</span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--c-text-2)' }}>{result.folio}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 px-4 py-3">
        <button
          onClick={onSave}
          disabled={saved}
          className="flex-1 py-2 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
          style={{
            backgroundColor: saved ? 'rgba(76,175,154,0.12)' : 'var(--c-primary)',
            color:            saved ? '#4CAF9A'               : '#C9A84C',
            border:           saved ? '1px solid rgba(76,175,154,0.3)' : 'none',
            opacity:          saved ? 1 : undefined,
          }}>
          {saved ? '✓ Saved to Leads' : '＋ Save to Leads'}
        </button>

        {/* Deep Enrich — PA-sourced only; REAPI results already have this data */}
        {showEnrichBtn && (
          <button onClick={onEnrich} disabled={enrichLoading}
            className="py-2 px-3 text-[11px] font-bold rounded-xl flex items-center gap-1 hover:opacity-80 transition-all"
            style={{ backgroundColor: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.35)' }}>
            {enrichLoading
              ? <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#4CAF9A', borderTopColor: 'transparent' }} />
              : '⚡ Enrich'}
          </button>
        )}

        {result.pa_url && (
          <a href={result.pa_url} target="_blank" rel="noopener noreferrer"
            className="py-2 px-3 text-[11px] font-bold rounded-xl flex items-center gap-1 hover:opacity-80 transition-all"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            PA
          </a>
        )}
        <a href={gmaps} target="_blank" rel="noopener noreferrer"
          className="py-2 px-3 text-[11px] font-bold rounded-xl flex items-center gap-1 hover:opacity-80 transition-all"
          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Map
        </a>
      </div>
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedSearch {
  id:        string
  name:      string
  emoji:     string
  filters:   CriteriaState
  owner:     string
  is_shared: boolean
  created_at: string
}

type SearchMode = 'search' | 'draw'

const EMPTY: CriteriaState = {}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEARCH_EXAMPLES = [
  { label: 'Address',     example: '1234 SW 5th Ave, Miami' },
  { label: 'Owner',       example: 'John Smith' },
  { label: 'LLC / Entity', example: 'Sunshine Properties LLC' },
  { label: 'Folio / APN', example: '30-4108-003-1840' },
  { label: 'Case #',      example: 'CACE-25-012345' },
  { label: 'Phone',       example: '(954) 555-1234' },
  { label: 'ZIP',         example: '33331' },
  { label: 'Subdivision', example: 'Weston Hills' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function PropertySearchClient() {
  const router = useRouter()

  // Mode
  const [mode, setMode]               = useState<SearchMode>('search')
  const [showCriteria, setShowCriteria] = useState(true)

  // Search state
  const [searchInput, setSearchInput] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Criteria
  const [criteria, setCriteria] = useState<CriteriaState>(EMPTY)
  const activeCount = activeCriteriaCount(criteria)

  // Draw zone
  const [drawnZone, setDrawnZone] = useState<DrawnZone | null>(null)

  // Quick Lookup state (uses the existing searchInput as the query)
  const [lookupResult,  setLookupResult]  = useState<PropertySearchResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError,   setLookupError]   = useState<string | null>(null)
  const [lookupSaved,   setLookupSaved]   = useState(false)

  // MLS comps auto-fetched after a successful lookup
  const [lookupComps,        setLookupComps]        = useState<CompsResult | null>(null)
  const [lookupCompsLoading, setLookupCompsLoading] = useState(false)
  const [lookupCompsError,   setLookupCompsError]   = useState<string | null>(null)

  // Deep Enrich — explicit REAPI pull for PAO-sourced properties
  const [enrichData,    setEnrichData]    = useState<EnrichmentData | null>(null)
  const [enrichLoading, setEnrichLoading] = useState(false)

  // Saved searches
  const [savedSearches, setSavedSearches]   = useState<SavedSearch[]>([])
  const [activeSaved, setActiveSaved]       = useState<string | null>(null)
  const [showSaveModal, setShowSaveModal]   = useState(false)
  const [saveName, setSaveName]             = useState('')
  const [saveEmoji, setSaveEmoji]           = useState('')

  // Load saved searches on mount
  useEffect(() => {
    fetch('/api/leads/saved-searches')
      .then(r => r.json())
      .then(d => Array.isArray(d) && setSavedSearches(d))
      .catch(() => {})
  }, [])

  // Escape clears search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearchInput('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────

  const runSearch = useCallback(() => {
    const c: CriteriaState = { ...criteria }
    if (searchInput.trim()) c.search = searchInput.trim()

    const params = criteriaToParams(c)

    // Encode draw zone if present
    if (drawnZone) {
      params.set('zone', JSON.stringify(drawnZone))
    }

    router.push(`/property-search/results?${params.toString()}`)
  }, [criteria, searchInput, drawnZone, router])

  const clearAll = () => {
    setCriteria(EMPTY)
    setSearchInput('')
    setDrawnZone(null)
    setActiveSaved(null)
  }

  const loadSaved = (s: SavedSearch) => {
    if (activeSaved === s.id) {
      setActiveSaved(null)
      setCriteria(EMPTY)
      setSearchInput('')
    } else {
      setActiveSaved(s.id)
      setCriteria(s.filters)
      setSearchInput(s.filters.search ?? '')
    }
  }

  const deleteSaved = async (id: string) => {
    await fetch(`/api/leads/saved-searches/${id}`, { method: 'DELETE' })
    setSavedSearches(prev => prev.filter(s => s.id !== id))
    if (activeSaved === id) { setActiveSaved(null); setCriteria(EMPTY) }
  }

  const saveSearch = async () => {
    if (!saveName.trim()) return
    const res = await fetch('/api/leads/saved-searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: saveName.trim(), emoji: saveEmoji, filters: criteria }),
    })
    if (res.ok) {
      const data = await res.json()
      setSavedSearches(prev => [...prev, data])
      setShowSaveModal(false)
      setSaveName('')
    }
  }

  // ── Quick Lookup ──────────────────────────────────────────────────────────

  const runLookup = useCallback(async () => {
    const q = searchInput.trim()
    if (!q) return
    setLookupLoading(true)
    setLookupError(null)
    setLookupResult(null)
    setLookupSaved(false)
    setLookupComps(null)
    setLookupCompsError(null)
    setEnrichData(null)
    try {
      const res  = await fetch(`/api/property-search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok) {
        setLookupError(data.error ?? 'Property not found')
      } else {
        const result: PropertySearchResult = data.result
        setLookupResult(result)
        // Auto-fetch comps in background (don't await — non-blocking)
        const addrFull = [result.property_address, result.city, result.state, result.zip].filter(Boolean).join(', ')
        setLookupCompsLoading(true)
        fetch(
          `/api/mls/comps?address=${encodeURIComponent(addrFull)}` +
          (result.beds  ? `&beds=${result.beds}`        : '') +
          (result.living_area ? `&sqft=${result.living_area}` : '')
        )
          .then(r => r.json())
          .then(d => {
            if (d.error) setLookupCompsError(d.code === 'NO_CREDENTIALS' ? null : d.error)
            else setLookupComps(d as CompsResult)
          })
          .catch(() => {})
          .finally(() => setLookupCompsLoading(false))
      }
    } catch {
      setLookupError('Network error — please try again')
    } finally {
      setLookupLoading(false)
    }
  }, [searchInput])

  const saveLookupToLeads = useCallback(async () => {
    if (!lookupResult) return
    // Map PropertySearchResult → the shape /api/properties/save expects.
    // Lead type (is_pre_foreclosure etc.) is intentionally NOT set here —
    // the user assigns lead type manually after reviewing the property.
    // Distress details are saved only if a verified case number is present.
    const hasVerifiedDistress = !!(lookupResult.distress?.case_number)
    const property = {
      county:           lookupResult.county,
      property_address: lookupResult.property_address,
      city:             lookupResult.city,
      state:            lookupResult.state,
      zip:              lookupResult.zip,
      folio_number:     lookupResult.folio,
      owner_name:       lookupResult.owner_name,
      mailing_address:  lookupResult.mailing_address,
      owner_city:       lookupResult.owner_city,
      owner_state:      lookupResult.owner_state,
      owner_zip:        lookupResult.owner_zip,
      absentee_owner:   lookupResult.absentee_owner,
      beds:             lookupResult.beds,
      baths:            lookupResult.baths,
      living_area:      lookupResult.living_area,
      year_built:       lookupResult.year_built,
      market_value:     lookupResult.market_value,
      assessed_value:   lookupResult.assessed_value,
      land_value:       lookupResult.land_value,
      data_source:      lookupResult.source_display ?? lookupResult.source,
      source:           lookupResult.source_type === 'public' ? 'county_pa' : 'reapi',
      // Distress fields only if verified (case number present)
      case_number:      hasVerifiedDistress ? lookupResult.distress!.case_number : null,
      file_date:        hasVerifiedDistress ? lookupResult.distress!.file_date   : null,
      plaintiff:        hasVerifiedDistress ? lookupResult.distress!.plaintiff   : null,
      lender_name:      hasVerifiedDistress ? lookupResult.distress!.lender_name : null,
      // Lead type NOT auto-assigned from lookup — user assigns manually
      is_pre_foreclosure: false,
      is_foreclosure:     false,
      is_auction:         false,
      equity_percentage:  enrichData?.equity_percent  ?? null,
      equity_tier:        enrichData?.high_equity ? 'High' : enrichData?.equity_percent != null ? (enrichData.equity_percent >= 50 ? 'Medium' : 'Low') : null,
      folio_number_raw:   lookupResult.folio,
    }
    const res = await fetch('/api/properties/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property }),
    })
    if (res.ok) setLookupSaved(true)
  }, [lookupResult, enrichData])

  const runEnrich = useCallback(async () => {
    if (!lookupResult) return
    setEnrichLoading(true)
    try {
      const res = await fetch('/api/property-search/enrich', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          address: [lookupResult.property_address, lookupResult.city, lookupResult.state, lookupResult.zip].filter(Boolean).join(', '),
          folio:   lookupResult.folio,
          county:  lookupResult.county,
        }),
      })
      const data = await res.json()
      if (data.enrichment) setEnrichData(data.enrichment as EnrichmentData)
    } catch { /* silently ignore network errors */ }
    finally { setEnrichLoading(false) }
  }, [lookupResult])

  const hasAnyCriteria = activeCount > 0 || searchInput.trim().length > 0 || drawnZone !== null

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden" style={{ color: 'var(--c-primary)' }}>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* LEFT PANEL — Criteria Builder                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col h-full overflow-hidden"
        style={{ width: 400, minWidth: 340, maxWidth: 440, borderRight: '1px solid var(--c-border)', backgroundColor: 'var(--c-bg)' }}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Property Search</h1>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Define your acquisition criteria or draw a zone on the map</p>

          {/* Mode toggle */}
          <div className="flex gap-1 mt-3 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)' }}>
            {(['search', 'draw'] as SearchMode[]).map(m => (
              <button key={m}
                onClick={() => setMode(m)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                style={{
                  backgroundColor: mode === m ? 'var(--c-primary)' : 'transparent',
                  color: mode === m ? '#C9A84C' : 'var(--c-text-3)',
                }}>
                {m === 'search' ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                  </svg>
                )}
                {m === 'search' ? 'Search Mode' : 'Draw Zone'}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Universal search bar */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex items-center rounded-xl overflow-hidden"
              style={{ border: '2px solid var(--c-primary)', backgroundColor: 'var(--c-card)' }}>
              <div className="pl-3 pr-2 shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  style={{ color: 'var(--c-primary)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
                </svg>
              </div>
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') runSearch()
                  if (e.key === 'Escape') setSearchInput('')
                }}
                placeholder="Address, owner, LLC, folio, case #, phone, ZIP…"
                className="flex-1 py-2.5 text-sm bg-transparent focus:outline-none"
                style={{ color: 'var(--c-primary)' }}
              />
              {searchInput && (
                <button onClick={() => setSearchInput('')}
                  className="px-2 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>✕</button>
              )}
            </div>

            {/* Search type hint chips */}
            {!searchInput && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {SEARCH_EXAMPLES.map(({ label }) => (
                  <span key={label}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
                    {label}
                  </span>
                ))}
              </div>
            )}

            {/* Draw zone active notice */}
            {drawnZone && (
              <div className="flex items-center justify-between mt-2.5 px-3 py-2 rounded-xl"
                style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)' }}>
                <span className="text-[11px] font-semibold" style={{ color: '#C9A84C' }}>
                  ✓ {drawnZone.type === 'circle'
                    ? `Circle · ${((drawnZone.radius ?? 0) / 1609).toFixed(1)} mi`
                    : `${drawnZone.type} zone selected`}
                </span>
                <button onClick={() => setDrawnZone(null)}
                  className="text-[10px] hover:opacity-60" style={{ color: '#C9A84C' }}>
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Acquisition criteria accordion */}
          <div style={{ borderBottom: '1px solid var(--c-border)' }}>
            <button
              onClick={() => setShowCriteria(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3"
              style={{ backgroundColor: 'var(--c-card-alt)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-primary)' }}>
                  Acquisition Criteria
                </span>
                {activeCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
                    {activeCount}
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

          {/* ── Quick Lookup result card ──────────────────────────────── */}
          {(lookupResult || lookupError) && (
            <div className="mx-4 my-3 rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>

              {lookupError ? (
                <div className="p-4 text-center">
                  <p className="text-2xl mb-2">🏚️</p>
                  <p className="text-sm font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Not Found</p>
                  <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{lookupError}</p>
                  <p className="text-[10px] mt-2" style={{ color: 'var(--c-text-3)' }}>
                    Try adding city or ZIP • Check spelling • Use folio # for exact match
                  </p>
                </div>
              ) : lookupResult ? (
                <LookupResultCard
                  result={lookupResult}
                  saved={lookupSaved}
                  onSave={saveLookupToLeads}
                  onClear={() => {
                    setLookupResult(null); setLookupError(null); setLookupSaved(false)
                    setLookupComps(null); setLookupCompsError(null)
                    setEnrichData(null)
                  }}
                  enrichData={enrichData}
                  enrichLoading={enrichLoading}
                  onEnrich={runEnrich}
                />
              ) : null}
            </div>
          )}

          {/* MLS Comps — shown below the lookup card */}
          {lookupResult && (lookupCompsLoading || lookupComps || lookupCompsError) && (
            <div className="mx-4 mb-3 rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
              <div className="flex items-center justify-between px-4 py-2.5"
                style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card-alt)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
                    Comps · ½ mi radius
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{ backgroundColor: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
                    {lookupComps?.source === 'rentcast' ? 'Rentcast' : 'Beaches MLS'}
                  </span>
                </div>
                {lookupCompsLoading && (
                  <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
                )}
              </div>

              {lookupCompsLoading && !lookupComps ? (
                <div className="px-4 py-3 text-center">
                  <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Pulling comps…</p>
                </div>
              ) : lookupCompsError ? (
                <div className="px-4 py-3">
                  <p className="text-[11px]" style={{ color: '#E74C3C' }}>{lookupCompsError}</p>
                </div>
              ) : lookupComps ? (
                <InlineComps comps={lookupComps} />
              ) : null}
            </div>
          )}

          {/* Saved specs */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
                Saved Specs
              </span>
              <button onClick={() => setShowSaveModal(true)}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                + Save Current
              </button>
            </div>

            {savedSearches.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                No saved specs yet. Build a criteria set and save it for quick re-runs.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {savedSearches.map(s => (
                  <div key={s.id} className="flex items-center gap-0.5">
                    <button onClick={() => loadSaved(s)}
                      className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                      style={{
                        backgroundColor: activeSaved === s.id ? 'var(--c-primary)' : 'var(--c-hover)',
                        color: activeSaved === s.id ? '#C9A84C' : 'var(--c-text-2)',
                        border: `1px solid ${activeSaved === s.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
                      }}>
                      {s.name}
                    </button>
                    <button onClick={() => deleteSaved(s.id)}
                      className="text-[10px] px-1 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom padding */}
          <div className="h-32" />
        </div>

        {/* Sticky footer — Look Up + Run Search */}
        <div className="p-4 flex flex-col gap-2"
          style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>

          {/* Look Up This Property — appears when there's text in the search box */}
          {searchInput.trim() && (
            <button onClick={runLookup} disabled={lookupLoading}
              className="w-full py-2.5 text-sm font-bold rounded-xl transition-all hover:opacity-90 flex items-center justify-center gap-2"
              style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' }}>
              {lookupLoading
                ? <><div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} /> Looking up…</>
                : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>Look Up This Property</>
              }
            </button>
          )}

          {hasAnyCriteria && (
            <button onClick={clearAll}
              className="w-full py-2 text-xs font-semibold rounded-xl transition-all hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Clear All Criteria
            </button>
          )}
          <button onClick={runSearch}
            className="w-full py-3 text-sm font-bold rounded-xl transition-all hover:opacity-90 flex items-center justify-center gap-2"
            style={{ backgroundColor: hasAnyCriteria ? 'var(--c-primary)' : '#1e3a5c', color: hasAnyCriteria ? '#C9A84C' : 'rgba(255,255,255,0.3)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            {hasAnyCriteria ? `Run Bulk Search${activeCount > 0 ? ` · ${activeCount} criteria` : ''}` : 'Run Bulk Search'}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* RIGHT PANEL — Interactive Map                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: '#071829' }}>

        {/* Map header */}
        <div className="px-5 py-3 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0A1F44' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {mode === 'draw' ? 'Draw Zone' : 'South Florida'}
            </span>
            {mode === 'draw' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                Draw a polygon, rectangle, or circle to define your search area
              </span>
            )}
          </div>
          {drawnZone && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(76,175,154,0.2)', color: '#4CAF9A' }}>
              ✓ Zone selected — run search to see properties inside
            </span>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 min-h-0 p-3">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center rounded-2xl" style={{ backgroundColor: '#071829' }}>
              <div className="text-center">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2"
                  style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading map…</p>
              </div>
            </div>
          }>
            <AcquisitionMap
              className="w-full h-full"
              onZoneDrawn={zone => {
                setDrawnZone(zone)
                if (zone) setMode('draw')
              }}
            />
          </Suspense>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SAVE MODAL                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {showSaveModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-2xl p-6 w-80 shadow-2xl"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <h3 className="text-base font-bold mb-4" style={{ color: 'var(--c-primary)' }}>Save Search Spec</h3>
            <input
              autoFocus
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveSearch(); if (e.key === 'Escape') setShowSaveModal(false) }}
              placeholder='e.g. "Weston Estates Pre-FC"'
              className="w-full px-3 py-2.5 rounded-xl text-sm mb-4 focus:outline-none"
              style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2 text-sm rounded-xl" style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                Cancel
              </button>
              <button onClick={saveSearch}
                className="flex-1 py-2 text-sm font-bold rounded-xl" style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                Save Spec
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
