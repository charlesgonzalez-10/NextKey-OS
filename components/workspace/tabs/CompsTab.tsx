'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import type { ComparableIntelligence, MarketContext, PropertyComparable, CompStatus } from '@/lib/graph/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toLocaleString()}`
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLOR: Record<CompStatus, string> = {
  active:  '#4CAF9A',
  pending: '#C9A84C',
  sold:    '#7B8FD4',
  rental:  '#a78bfa',
  expired: '#4a6a9a',
}

const STATUS_BG: Record<CompStatus, string> = {
  active:  'rgba(76,175,154,0.12)',
  pending: 'rgba(201,168,76,0.12)',
  sold:    'rgba(123,143,212,0.12)',
  rental:  'rgba(167,139,250,0.12)',
  expired: 'rgba(74,106,154,0.12)',
}

const CONFIDENCE_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high:   '#4CAF9A',
  medium: '#C9A84C',
  low:    '#E07B6A',
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '12px 14px', ...style }}>
      {children}
    </div>
  )
}

function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a' }}>
        {children}
      </div>
      {action}
    </div>
  )
}

function KV({ k, v, vColor, tooltip }: { k: string; v: React.ReactNode; vColor?: string; tooltip?: string }) {
  return (
    <div
      title={tooltip}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '3px 0', gap: 8, cursor: tooltip ? 'help' : undefined }}
    >
      <span style={{ color: '#4a6a9a', fontSize: 11, flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: vColor ?? '#e2e8f0', textAlign: 'right' as const }}>{v}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ borderTop: '1px solid #1a3050', margin: '8px 0' }} />
}

function StatusBadge({ status }: { status: CompStatus | null }) {
  if (!status) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      color: STATUS_COLOR[status],
      background: STATUS_BG[status],
      border: `1px solid ${STATUS_COLOR[status]}40`,
      textTransform: 'uppercase' as const, letterSpacing: '.06em',
    }}>
      {status}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const color = CONFIDENCE_COLOR[confidence]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      color, background: `${color}18`, border: `1px solid ${color}40`,
      textTransform: 'uppercase' as const, letterSpacing: '.06em',
    }}>
      {confidence} confidence
    </span>
  )
}

// ─── Comp Card ────────────────────────────────────────────────────────────────

function CompCard({ comp }: { comp: PropertyComparable }) {
  const price  = comp.closePrice ?? comp.listPrice
  const addr   = [comp.compAddress.street, comp.compAddress.city].filter(Boolean).join(', ') || '—'
  const score  = comp.similarityScore

  return (
    <div style={{
      background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7,
      padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {/* Address + status row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3 }}>{addr}</div>
          {comp.compMlsNumber && (
            <div style={{ fontSize: 10, color: '#4a6a9a', fontFamily: 'monospace', marginTop: 2 }}>
              MLS# {comp.compMlsNumber}
            </div>
          )}
        </div>
        <StatusBadge status={comp.compStatus} />
      </div>

      <Divider />

      {/* Price + key stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px' }}>
        <KV k="Price" v={fmtMoney(price)} vColor="#C9A84C" />
        <KV k="$/sqft" v={comp.pricePerSqft != null ? `$${fmtNum(comp.pricePerSqft, 0)}` : '—'} />
        <KV k="Beds/Baths" v={`${comp.beds ?? '?'} / ${comp.baths ?? '?'}`} />
        <KV k="Sqft" v={comp.sqft != null ? comp.sqft.toLocaleString() : '—'} />
        <KV k="DOM" v={comp.daysOnMarket != null ? String(comp.daysOnMarket) : '—'} vColor={comp.daysOnMarket != null && comp.daysOnMarket > 120 ? '#E07B6A' : undefined} />
        <KV k="Distance" v={comp.distanceMiles != null ? `${fmtNum(comp.distanceMiles, 2)} mi` : '—'} />
        {comp.closeDate && <KV k="Closed" v={fmtDate(comp.closeDate)} />}
        {comp.subdivision && <KV k="Subdivision" v={comp.subdivision} />}
      </div>

      {/* Similarity score */}
      {score != null && (
        <div style={{
          marginTop: 2, display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <div style={{ flex: 1, height: 3, background: '#1a3050', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${score}%`, height: '100%', background: score >= 70 ? '#4CAF9A' : score >= 45 ? '#C9A84C' : '#4a6a9a', borderRadius: 2 }} />
          </div>
          <span
            title="Similarity score: weighted composite of distance, sqft, beds/baths, year built, and sale recency. Higher = more similar to subject."
            style={{ fontSize: 10, color: score >= 70 ? '#4CAF9A' : score >= 45 ? '#C9A84C' : '#4a6a9a', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'help' }}
          >
            {score.toFixed(0)}% match
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Market Summary Card ──────────────────────────────────────────────────────

function MarketSummaryCard({ market }: { market: MarketContext }) {
  const s = market.statistics
  const pos = market.positionSummary

  return (
    <Card>
      <CardTitle>
        Market Context · {market.marketKey.replace('zip:', 'ZIP ').replace('city:', '')}
        {s?.confidence && (
          <span style={{ marginLeft: 8 }}>
            <ConfidenceBadge confidence={s.confidence} />
          </span>
        )}
      </CardTitle>

      {(!s || (s.sampleSize ?? 0) < 5) && (
        <div style={{ fontSize: 11, color: '#E07B6A', background: 'rgba(224,123,106,0.08)', border: '1px solid rgba(224,123,106,0.2)', borderRadius: 5, padding: '5px 10px', marginBottom: 8 }}>
          ⚠ Thin market sample ({s?.sampleSize ?? 0} listings). Stats may not be reliable.
        </div>
      )}

      {s ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 20px' }}>
          <KV k="Median Active Price" v={fmtMoney(s.medianListPrice)} />
          <KV k="Median Sold Price"   v={fmtMoney(s.medianClosePrice)} />
          <KV k="Median $/sqft"       v={s.medianPriceSqft != null ? `$${fmtNum(s.medianPriceSqft, 0)}` : '—'} />
          <KV k="Avg DOM"             v={s.medianDom != null ? String(Math.round(s.medianDom)) : '—'} />
          <KV k="Active Listings"     v={s.activeListings != null ? String(s.activeListings) : '—'} />
          <KV k="Pending"             v={s.pendingCount != null ? String(s.pendingCount) : '—'} />
          <KV k="Sold (period)"       v={s.soldCount != null ? String(s.soldCount) : '—'} />
          <KV
            k="Price Reduction Rate"
            v={s.priceReductionRate != null ? `${(s.priceReductionRate * 100).toFixed(1)}%` : '—'}
            tooltip="Percentage of listings with at least one price reduction"
          />
          {s.monthsOfSupply != null && (
            <KV
              k="Months of Supply"
              v={fmtNum(s.monthsOfSupply, 1)}
              vColor={s.monthsOfSupply < 3 ? '#E07B6A' : s.monthsOfSupply > 6 ? '#4CAF9A' : '#C9A84C'}
              tooltip="Active inventory ÷ monthly sales rate. <3 = seller's market, >6 = buyer's market"
            />
          )}
          <KV k="Sample Size" v={s.sampleSize != null ? String(s.sampleSize) : '—'} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#4a6a9a', textAlign: 'center', padding: '12px 0' }}>
          No market stats available for this area yet.
        </div>
      )}

      {pos && (
        <>
          <Divider />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pos.pricingPosition && (
              <span
                title={
                  pos.pricingPosition === 'below_market' ? 'Subject list price is more than 5% below median active' :
                  pos.pricingPosition === 'above_market' ? 'Subject list price is more than 5% above median active' :
                  'Subject list price is within 5% of median active'
                }
                style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, cursor: 'help',
                  color:      pos.pricingPosition === 'below_market' ? '#4CAF9A' : pos.pricingPosition === 'above_market' ? '#E07B6A' : '#C9A84C',
                  background: pos.pricingPosition === 'below_market' ? 'rgba(76,175,154,0.1)' : pos.pricingPosition === 'above_market' ? 'rgba(224,123,106,0.1)' : 'rgba(201,168,76,0.1)',
                  border:     pos.pricingPosition === 'below_market' ? '1px solid rgba(76,175,154,0.3)' : pos.pricingPosition === 'above_market' ? '1px solid rgba(224,123,106,0.3)' : '1px solid rgba(201,168,76,0.3)',
                }}>
                {pos.pricingPosition === 'below_market' ? 'Priced Below Market' : pos.pricingPosition === 'above_market' ? 'Priced Above Market' : 'At Market Price'}
              </span>
            )}
            {pos.domPosition && (
              <span
                title={
                  pos.domPosition === 'fast' ? 'DOM is 30%+ below market median — selling faster than average' :
                  pos.domPosition === 'slow' ? 'DOM is 30%+ above market median — sitting longer than average' :
                  'DOM is within 30% of market median'
                }
                style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, cursor: 'help',
                  color:      pos.domPosition === 'fast' ? '#4CAF9A' : pos.domPosition === 'slow' ? '#E07B6A' : '#94a3b8',
                  background: 'rgba(74,106,154,0.12)',
                  border:     '1px solid rgba(74,106,154,0.25)',
                }}>
                {pos.domPosition === 'fast' ? 'Fast Mover' : pos.domPosition === 'slow' ? 'Slow Mover' : 'Normal Pace'}
              </span>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: '#4a6a9a', textAlign: 'right' }}>
        {market.fromCache ? 'Cached' : 'Live'} · {fmtDate(market.fetchedAt)}
      </div>
    </Card>
  )
}

// ─── Score Explainer ──────────────────────────────────────────────────────────

function ScoreExplainerCard() {
  return (
    <Card style={{ border: '1px solid rgba(201,168,76,0.18)' }}>
      <CardTitle>Score Guide</CardTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', marginBottom: 3 }}>
            Market Position Score
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
            Composite of list-price vs. median, days-on-market, HOA burden, price-reduction history, and back-on-market frequency.
            <span style={{ color: '#4CAF9A' }}> Higher = stronger seller&apos;s position.</span>
          </div>
        </div>
        <Divider />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7B8FD4', marginBottom: 3 }}>
            MLS Acquisition Opportunity Score
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
            Weighted signals: price reductions, cumulative DOM, back-on-market, and listing cycle.
            <span style={{ color: '#4CAF9A' }}> Higher = more attractive to investor.</span>
            <span style={{ display: 'block', marginTop: 4, color: '#C9A84C', fontStyle: 'italic' }}>
              Scope: MLS signals only — county PA and off-market data not yet included.
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Filter Tab Bar ──────────────────────────────────────────────────────────

type FilterTab = 'all' | 'active' | 'pending' | 'sold'

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',     label: 'All' },
  { id: 'active',  label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'sold',    label: 'Sold' },
]

// ─── Main CompsTab ─────────────────────────────────────────────────────────────

export default function CompsTab() {
  const { lead } = useWorkspace()
  const pid = lead.property_id ?? lead.id

  const [comps,       setComps]       = useState<ComparableIntelligence | null>(null)
  const [market,      setMarket]      = useState<MarketContext | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [refreshing,  setRefreshing]  = useState(false)
  const [refreshMsg,  setRefreshMsg]  = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

  const loadData = useCallback(async () => {
    if (!pid) return
    setLoading(true)
    setError(null)
    try {
      const [compsRes, marketRes] = await Promise.all([
        fetch(`/api/properties/${pid}/comparables`),
        fetch(`/api/properties/${pid}/market`),
      ])
      if (!compsRes.ok && compsRes.status !== 404) throw new Error(`Comps HTTP ${compsRes.status}`)
      if (!marketRes.ok && marketRes.status !== 404) throw new Error(`Market HTTP ${marketRes.status}`)
      const [compsData, marketData] = await Promise.all([
        compsRes.ok ? compsRes.json() : null,
        marketRes.ok ? marketRes.json() : null,
      ])
      setComps(compsData)
      setMarket(marketData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comparable intelligence')
    }
    setLoading(false)
  }, [pid])

  useEffect(() => { loadData() }, [loadData])

  const handleRefresh = useCallback(async () => {
    if (!pid) return
    setRefreshing(true)
    setRefreshMsg('')
    try {
      const res = await fetch(`/api/properties/${pid}/comparables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      if (res.ok) {
        setRefreshMsg('✓ Comps refreshed')
        await loadData()
      } else {
        setRefreshMsg('Refresh failed')
      }
    } catch {
      setRefreshMsg('Request failed')
    }
    setRefreshing(false)
    setTimeout(() => setRefreshMsg(''), 5000)
  }, [pid, loadData])

  if (!pid) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#4a6a9a', fontSize: 13 }}>
      No property ID available.
    </div>
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#4a6a9a', fontSize: 13 }}>
      Loading comparable intelligence…
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
      <div style={{ color: '#E07B6A', fontSize: 13 }}>Failed to load comps: {error}</div>
      <button onClick={loadData} style={{ color: '#4CAF9A', background: 'rgba(76,175,154,0.1)', border: '1px solid rgba(76,175,154,0.3)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>
        Retry
      </button>
    </div>
  )

  const allComps: PropertyComparable[] = [
    ...(comps?.active  ?? []),
    ...(comps?.pending ?? []),
    ...(comps?.sold    ?? []),
  ]

  const filteredComps = activeFilter === 'all'
    ? allComps
    : activeFilter === 'active'  ? (comps?.active  ?? [])
    : activeFilter === 'pending' ? (comps?.pending ?? [])
    :                               (comps?.sold    ?? [])

  const summary = comps?.summary
  const lowSample = !summary || summary.sampleSize < 5 || summary.confidence === 'low'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {summary && (
            <>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {allComps.length} comp{allComps.length !== 1 ? 's' : ''}
              </span>
              <ConfidenceBadge confidence={summary.confidence} />
              {lowSample && (
                <span style={{ fontSize: 11, color: '#E07B6A' }}>
                  ⚠ Small sample
                </span>
              )}
            </>
          )}
          {!comps && !loading && (
            <span style={{ fontSize: 12, color: '#4a6a9a' }}>No comparable data — click Refresh to fetch</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {refreshMsg && <span style={{ fontSize: 11, color: refreshMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>{refreshMsg}</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)', cursor: refreshing ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: refreshing ? 0.6 : 1 }}
          >
            {refreshing ? '…' : '↻ Refresh Comps'}
          </button>
        </div>
      </div>

      {/* ── Market summary ── */}
      {market && <MarketSummaryCard market={market} />}

      {/* ── Suggested value range ── */}
      {summary?.suggestedValueRange && (
        <Card style={{ border: '1px solid rgba(201,168,76,0.25)' }}>
          <CardTitle>
            Suggested Value Range
            <span style={{ fontSize: 10, color: '#4a6a9a', fontWeight: 400, textTransform: 'none' as const }}>from {summary.soldCount} sold comp{summary.soldCount !== 1 ? 's' : ''}</span>
          </CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#C9A84C' }}>
              {fmtMoney(summary.suggestedValueRange.low)} – {fmtMoney(summary.suggestedValueRange.high)}
            </div>
            {summary.medianSoldPrice && (
              <div style={{ fontSize: 12, color: '#4a6a9a' }}>
                Median sold: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fmtMoney(summary.medianSoldPrice)}</span>
              </div>
            )}
          </div>
          {lowSample && (
            <div style={{ fontSize: 10, color: '#E07B6A', marginTop: 6 }}>
              Low confidence — fewer than 5 comps. Treat range as directional only.
            </div>
          )}
        </Card>
      )}

      {/* ── Filter tabs ── */}
      {allComps.length > 0 && (
        <div style={{ display: 'flex', gap: 0, border: '1px solid #1a3050', borderRadius: 7, overflow: 'hidden', alignSelf: 'flex-start' }}>
          {FILTER_TABS.map(tab => {
            const count = tab.id === 'all' ? allComps.length
              : tab.id === 'active'  ? (comps?.active?.length  ?? 0)
              : tab.id === 'pending' ? (comps?.pending?.length ?? 0)
              :                         (comps?.sold?.length    ?? 0)
            const active = activeFilter === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '5px 14px',
                  background: active ? 'rgba(201,168,76,0.12)' : 'transparent',
                  color: active ? '#C9A84C' : '#4a6a9a',
                  border: 'none', borderRight: '1px solid #1a3050', cursor: 'pointer',
                  transition: 'color .15s, background .15s',
                }}
              >
                {tab.label} {count > 0 ? `(${count})` : ''}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Comp cards ── */}
      {filteredComps.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {filteredComps.map(comp => <CompCard key={comp.id} comp={comp} />)}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#4a6a9a', fontSize: 12, padding: '24px 0' }}>
          {allComps.length === 0
            ? 'No comparables found. Click Refresh Comps to fetch from REAPI.'
            : `No ${activeFilter} comps in the current set.`}
        </div>
      )}

      {/* ── Score guide ── */}
      <ScoreExplainerCard />

      {/* ── Cache / freshness footer ── */}
      {comps && (
        <div style={{ fontSize: 10, color: '#4a6a9a', textAlign: 'center', padding: '4px 0' }}>
          Comps {comps.fromCache ? 'from cache' : 'freshly fetched'} · {fmtDate(comps.fetchedAt)}
        </div>
      )}
    </div>
  )
}
