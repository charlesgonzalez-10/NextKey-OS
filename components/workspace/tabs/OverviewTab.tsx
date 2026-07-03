'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { fmtDate, fmtDateTime, fmtMoneyFull, STAGE_META } from '@/lib/acquisitionEngine'

const PropertyMapCard = dynamic(() => import('@/components/PropertyMapCard'), { ssr: false })
const CallingPanel    = dynamic(() => import('@/components/workspace/tabs/CallingPanel'), { ssr: false })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtK(n: number | null | undefined): string {
  if (!n) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${Math.round(n / 1000)}k`
}

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '—'
  return `$${n.toLocaleString()}`
}

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

function stars(n: number): string {
  const full  = Math.min(5, Math.max(0, Math.round(n)))
  const empty = 5 - full
  return '★'.repeat(full) + '☆'.repeat(empty)
}

const EQUITY_COLORS: Record<string, string> = {
  'High':    '#4CAF9A',
  'Medium':  '#C9A84C',
  'Low':     '#E07B6A',
  'Negative':'#ef4444',
}

const COUNTY_LABELS: Record<string, string> = {
  'miami-dade': 'Miami-Dade County',
  'broward':    'Broward County',
  'palm-beach': 'Palm Beach County',
}

const SOURCE_LABELS: Record<string, string> = {
  'miami-dade-pa': 'Miami-Dade Property Appraiser',
  'broward-pa':    'Broward County Property Appraiser',
  'palm-beach-pa': 'Palm Beach County Property Appraiser',
  'reapi':         'RealEstateAPI.com',
}

const DOT_COLORS: Record<string, string> = {
  note:      '#C9A84C',
  call_log:  '#22c55e',
  sms_log:   '#60a5fa',
  email_log: '#a78bfa',
  task:      '#f59e0b',
}

const SCORE_LABELS: Record<string, string> = {
  'cash-purchase':     'Cash Purchase',
  'subject-to':        'Subject-To',
  'novation':          'Novation Agreement',
  'short-sale':        'Short Sale',
  'deed-in-lieu':      'Deed in Lieu',
  'wholesale':         'Wholesale',
  'creative-finance':  'Creative Finance',
  'list-and-sell':     'List & Sell',
  'hold':              'Hold / Rent',
}

// ─── Opportunity Score Calculator ─────────────────────────────────────────────

interface ScoreInputs {
  equity_tier?: string | null
  equity_percentage?: number | null
  mls_dom?: number | null
  mls_price_reductions?: number | null
  is_pre_foreclosure?: boolean | null
  is_foreclosure?: boolean | null
  is_probate?: boolean | null
  multiple_liens?: boolean | null
  vacant?: boolean | null
  owner_state?: string | null
  distress_score?: number | null
  lead_quality?: number | null
  rent_estimate?: number | null
  suggested_rent?: number | null
  market_value?: number | null
  estimated_value?: number | null
}

function computeOpportunityScore(d: ScoreInputs): number {
  let score = 0

  // Equity (25 pts)
  if (d.equity_tier === 'High')        score += 25
  else if (d.equity_tier === 'Medium') score += 15
  else if (d.equity_tier === 'Low')    score += 5
  else if ((d.equity_percentage ?? 0) > 0) score += 3

  // Days on market (15 pts)
  const dom = d.mls_dom ?? 0
  if (dom >= 180) score += 15
  else if (dom >= 90) score += 12
  else if (dom >= 60) score += 9
  else if (dom >= 30) score += 5
  else if (dom >= 14) score += 2

  // Distress signals (20 pts)
  if (d.is_foreclosure)       score += 12
  else if (d.is_pre_foreclosure) score += 10
  if (d.is_probate)           score += 8
  if (d.multiple_liens)       score += 6
  if (d.vacant)               score += 4
  if (d.owner_state && d.owner_state !== 'FL') score += 3

  // Price reductions (5 pts)
  const reductions = d.mls_price_reductions ?? 0
  if (reductions >= 3) score += 5
  else if (reductions >= 1) score += 3

  // AI signals (25 pts)
  if (d.lead_quality != null) score += Math.round((d.lead_quality / 10) * 15)
  if (d.distress_score != null) score += Math.round((d.distress_score / 10) * 10)

  // Rental yield (10 pts)
  const rent = d.rent_estimate ?? d.suggested_rent ?? 0
  const mv   = d.market_value ?? d.estimated_value ?? 0
  if (rent > 0 && mv > 0) {
    const yield_ = (rent * 12 / mv) * 100
    if (yield_ >= 8) score += 10
    else if (yield_ >= 6) score += 7
    else if (yield_ >= 4) score += 4
    else score += 2
  }

  return Math.min(100, Math.max(0, score))
}

function scoreToStarCount(score: number): number {
  if (score >= 80) return 5
  if (score >= 60) return 4
  if (score >= 40) return 3
  if (score >= 20) return 2
  return 1
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 60) return 'Strong'
  if (score >= 40) return 'Moderate'
  if (score >= 20) return 'Weak'
  return 'Low'
}

function scoreColor(score: number): string {
  if (score >= 80) return '#4CAF9A'
  if (score >= 60) return '#C9A84C'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

function scoreEmoji(score: number): string {
  if (score >= 80) return '🟢'
  if (score >= 60) return '🟡'
  if (score >= 40) return '🟠'
  return '🔴'
}

// ─── Shared primitives ────────────────────────────────────────────────────────

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

function KV({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '3px 0', gap: 8 }}>
      <span style={{ color: '#4a6a9a', fontSize: 11, flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: vColor ?? '#e2e8f0', textAlign: 'right' as const, wordBreak: 'break-word' }}>{v}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ borderTop: '1px solid #1a3050', margin: '8px 0' }} />
}

// ─── Property Snapshot ────────────────────────────────────────────────────────

interface SnapshotData {
  rent_estimate: number | null
  rent_range_low: number | null
  rent_range_high: number | null
  rent_fetched_at: string | null
}

function PropertySnapshot({ leadId }: { leadId: string }) {
  const { lead, aiSummary, acquisition, setActiveTab } = useWorkspace()
  const { offerStatus } = acquisition

  const [snapshot,       setSnapshot]       = useState<SnapshotData | null>(null)
  const [fetchingRent,   setFetchingRent]   = useState(false)
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)

  const mv         = lead.market_value ?? lead.estimated_value
  const listPrice  = lead.mls_listing_price
  const ourOffer   = offerStatus.amount ?? lead.offer_amount
  const loanBal    = lead.foreclosure_amount
  const estEquity  = lead.equity_dollar_amount ?? (mv && loanBal ? mv - loanBal : null)
  const dom        = lead.mls_dom
  const reductions = lead.mls_price_reductions ?? 0
  const mlsStatus  = lead.mls_status
  const rentEst    = snapshot?.rent_estimate ?? lead.rent_estimate ?? lead.suggested_rent
  const eClr       = EQUITY_COLORS[lead.equity_tier ?? ''] ?? '#9ca3af'

  const oppScore = computeOpportunityScore({
    equity_tier:      lead.equity_tier,
    equity_percentage: lead.equity_percentage,
    mls_dom:          dom,
    mls_price_reductions: reductions,
    is_pre_foreclosure: lead.is_pre_foreclosure,
    is_foreclosure:   lead.is_foreclosure,
    is_probate:       lead.probate_type != null,
    multiple_liens:   lead.multiple_liens,
    vacant:           lead.vacant,
    owner_state:      lead.owner_state,
    distress_score:   aiSummary?.distress_score,
    lead_quality:     aiSummary?.lead_quality,
    rent_estimate:    rentEst,
    market_value:     mv,
  })

  const starCount = scoreToStarCount(oppScore)
  const sLabel    = scoreLabel(oppScore)
  const sColor    = scoreColor(oppScore)
  const sEmoji    = scoreEmoji(oppScore)

  // Load snapshot (rental cache)
  useEffect(() => {
    if (snapshotLoaded) return
    fetch(`/api/leads/${leadId}/overview/snapshot`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSnapshot(d); setSnapshotLoaded(true) })
      .catch(() => setSnapshotLoaded(true))
  }, [leadId, snapshotLoaded])

  const fetchRent = useCallback(async () => {
    setFetchingRent(true)
    const res = await fetch(`/api/leads/${leadId}/overview/snapshot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_rent: true }),
    })
    if (res.ok) {
      const d = await res.json()
      if (d.rent_estimate) setSnapshot(d)
    }
    setFetchingRent(false)
  }, [leadId])

  const SNAPSHOT_ROWS: { label: string; value: React.ReactNode; color?: string; secondary?: string }[] = [
    {
      label: 'Market Value',
      value: mv ? fmtMoney(mv) : '—',
      color: mv ? '#C9A84C' : undefined,
      secondary: mv ? '(REAPI est.)' : undefined,
    },
    {
      label: 'Listing Price',
      value: listPrice ? fmtMoney(listPrice) : (mlsStatus ? `—  (${mlsStatus})` : '—'),
      color: listPrice ? '#e2e8f0' : undefined,
    },
    {
      label: 'Your Offer',
      value: ourOffer
        ? <span style={{ color: '#C9A84C', fontWeight: 700 }}>{fmtMoney(ourOffer)}{lead.offer_pct ? ` (${lead.offer_pct}%)` : ''}</span>
        : <span style={{ color: '#4a6a9a' }}>No offer yet</span>,
    },
  ]

  return (
    <div style={{ background: 'linear-gradient(135deg, #0a1729 0%, #0d1f35 100%)', border: '1px solid #1a3050', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#4a6a9a' }}>
          Property Snapshot
        </div>
        {mlsStatus && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: mlsStatus === 'Active' ? 'rgba(76,175,154,0.12)' : 'rgba(74,106,154,0.12)', color: mlsStatus === 'Active' ? '#4CAF9A' : '#4a6a9a', border: `1px solid ${mlsStatus === 'Active' ? 'rgba(76,175,154,0.35)' : '#1a3050'}` }}>
            {mlsStatus}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {/* Left: valuation rows */}
        <div style={{ paddingRight: 20, borderRight: '1px solid #1a3050' }}>
          {SNAPSHOT_ROWS.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(26,48,80,0.6)' }}>
              <span style={{ fontSize: 11, color: '#4a6a9a' }}>{r.label}</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: r.color ?? '#e2e8f0' }}>
                  {r.value}
                </div>
                {r.secondary && <div style={{ fontSize: 9, color: '#4a6a9a' }}>{r.secondary}</div>}
              </div>
            </div>
          ))}

          <Divider />

          {estEquity != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: 11, color: '#4a6a9a' }}>Estimated Equity</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: eClr }}>{fmtMoney(estEquity)}</span>
            </div>
          )}
          {dom != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: 11, color: '#4a6a9a' }}>Days on Market</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: dom > 120 ? '#ef4444' : dom > 60 ? '#C9A84C' : '#e2e8f0' }}>{dom}</span>
            </div>
          )}
          {reductions > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: 11, color: '#4a6a9a' }}>Price Reductions</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>{reductions}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: 11, color: '#4a6a9a' }}>Rental Estimate</span>
            {rentEst ? (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#4CAF9A' }}>{fmtMoney(rentEst)}/mo</div>
                {snapshot?.rent_range_low && snapshot?.rent_range_high && (
                  <div style={{ fontSize: 9, color: '#4a6a9a' }}>{fmtK(snapshot.rent_range_low)} – {fmtK(snapshot.rent_range_high)}</div>
                )}
              </div>
            ) : (
              <button onClick={fetchRent} disabled={fetchingRent} style={{ fontSize: 10, color: '#4CAF9A', background: 'rgba(76,175,154,0.1)', border: '1px solid rgba(76,175,154,0.3)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}>
                {fetchingRent ? '…' : 'Fetch'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ fontSize: 11, color: '#4a6a9a' }}>STR Estimate</span>
            <span style={{ fontSize: 11, color: '#4a6a9a', fontStyle: 'italic' }}>Coming Soon</span>
          </div>
        </div>

        {/* Right: AI opportunity score */}
        <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 8 }}>
            AI Opportunity Score
          </div>

          {/* Score ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: `conic-gradient(${sColor} 0% ${oppScore}%, rgba(26,48,80,0.4) ${oppScore}% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
              <div style={{ width: 54, height: 54, borderRadius: '50%', background: '#0a1729', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: sColor, lineHeight: 1 }}>{oppScore}</div>
                <div style={{ fontSize: 9, color: '#4a6a9a' }}>/ 100</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, marginBottom: 2 }}>{sEmoji}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: sColor }}>{sLabel}</div>
            </div>
          </div>

          {/* Stars */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#4a6a9a', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Overall Opportunity</div>
            <div style={{ fontSize: 20, lineHeight: 1, marginBottom: 3 }}>
              {[1,2,3,4,5].map(i => (
                <span key={i} style={{ color: i <= starCount ? sColor : '#1a3050' }}>★</span>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: sColor }}>{stars(starCount).includes('★★★★★') ? 'Excellent' : sLabel}</div>
          </div>

          {/* AI summary */}
          {aiSummary?.summary ? (
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, fontStyle: 'italic', borderLeft: `2px solid ${sColor}50`, paddingLeft: 8 }}>
              "{aiSummary.summary.length > 120 ? aiSummary.summary.slice(0, 120) + '…' : aiSummary.summary}"
            </div>
          ) : (
            <button onClick={() => setActiveTab('analyze')}
              style={{ fontSize: 10, color: '#4ade80', background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 5, padding: '5px 10px', cursor: 'pointer', textAlign: 'left' }}>
              ✦ Generate AI Analysis →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Investment Snapshot ──────────────────────────────────────────────────────

function InvestmentSnapshot() {
  const { lead, acquisition, setActiveTab } = useWorkspace()
  const { offerStatus } = acquisition

  const mv        = lead.market_value ?? lead.estimated_value
  const offer     = offerStatus.amount ?? lead.offer_amount
  const loanBal   = lead.foreclosure_amount
  const estEquity = lead.equity_dollar_amount ?? (mv && loanBal ? Math.max(0, mv - loanBal) : null)
  const rent      = lead.rent_estimate ?? lead.suggested_rent
  const offerPct  = offer && mv ? Math.round((offer / mv) * 100) : lead.offer_pct

  const spread    = offer && mv ? mv - offer : null
  const grossYield = rent && mv ? ((rent * 12) / mv * 100).toFixed(1) : null
  const capRate   = rent && mv ? (((rent * 12) * 0.6) / mv * 100).toFixed(1) : null // rough: NOI ≈ 60% of gross rent

  const ROW_COLOR = '#e2e8f0'

  // Suggested exit strategy
  let suggestedExit = 'Pass'
  let exitColor = '#4a6a9a'
  if (estEquity && mv) {
    const equityPct = estEquity / mv
    if (equityPct >= 0.35 && offer) { suggestedExit = 'Wholesale'; exitColor = '#C9A84C' }
    else if (equityPct >= 0.25) { suggestedExit = 'Fix & Flip'; exitColor = '#f59e0b' }
    else if (grossYield && parseFloat(grossYield) >= 6) { suggestedExit = 'Buy & Hold'; exitColor = '#4CAF9A' }
    else if (lead.is_pre_foreclosure || lead.is_foreclosure) { suggestedExit = 'Creative Finance'; exitColor = '#a78bfa' }
    else { suggestedExit = 'Subject-To'; exitColor = '#60a5fa' }
  }

  const POTENTIAL_ITEMS = [
    { label: 'Wholesale Potential', color: '#C9A84C', active: spread != null && spread > 20000 },
    { label: 'Fix & Flip Potential', color: '#f59e0b', active: (lead.equity_tier === 'High' || lead.equity_tier === 'Medium') },
    { label: 'Rental Potential', color: '#4CAF9A', active: grossYield != null && parseFloat(grossYield) >= 5 },
  ]

  return (
    <Card style={{ height: '100%' }}>
      <CardTitle action={
        <button onClick={() => setActiveTab('offer')}
          style={{ fontSize: 10, color: '#C9A84C', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}>
          Make Offer →
        </button>
      }>
        Investment Snapshot
      </CardTitle>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginBottom: 10 }}>
        {[
          { k: 'Current Offer', v: fmtMoney(offer), c: '#C9A84C' },
          { k: 'Offer %', v: offerPct ? `${offerPct}%` : '—', c: offerPct && offerPct < 70 ? '#4CAF9A' : '#C9A84C' },
          { k: 'Spread', v: spread != null ? fmtK(spread) : '—', c: spread && spread > 0 ? '#4CAF9A' : '#ef4444' },
          { k: 'Est. Profit', v: spread != null ? fmtK(spread * 0.7) : '—', c: '#e2e8f0' },
          { k: 'Est. Equity', v: fmtK(estEquity), c: EQUITY_COLORS[lead.equity_tier ?? ''] ?? '#4a6a9a' },
          { k: 'Monthly Rent', v: rent ? fmtMoney(rent) : '—', c: '#4CAF9A' },
          { k: 'Gross Yield', v: grossYield ? `${grossYield}%` : '—', c: grossYield && parseFloat(grossYield) >= 6 ? '#4CAF9A' : '#C9A84C' },
          { k: 'Cap Rate', v: capRate ? `${capRate}%` : '—', c: capRate && parseFloat(capRate) >= 5 ? '#4CAF9A' : '#e2e8f0' },
        ].map(r => (
          <div key={r.k} style={{ display: 'flex', flexDirection: 'column', padding: '4px 0', borderBottom: '1px solid rgba(26,48,80,0.4)' }}>
            <span style={{ fontSize: 9, color: '#4a6a9a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{r.k}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: r.c ?? ROW_COLOR }}>{r.v}</span>
          </div>
        ))}
      </div>

      <Divider />

      {/* Potential */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {POTENTIAL_ITEMS.map(p => (
          <span key={p.label} style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: p.active ? `${p.color}15` : 'transparent', color: p.active ? p.color : '#4a6a9a', border: `1px solid ${p.active ? `${p.color}40` : '#1a3050'}`, opacity: p.active ? 1 : 0.4 }}>
            {p.active ? '✓' : '○'} {p.label.replace(' Potential', '')}
          </span>
        ))}
      </div>

      {/* Suggested exit */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#4a6a9a' }}>Suggested Exit</span>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${exitColor}15`, color: exitColor, border: `1px solid ${exitColor}40` }}>
          {suggestedExit}
        </span>
      </div>
    </Card>
  )
}

// ─── Quick Actions bar ────────────────────────────────────────────────────────

function QuickActions() {
  const { lead, acquisition, setActiveTab } = useWorkspace()
  const phones = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5].filter(Boolean) as string[]

  // Pictometry URL
  const pictometryUrl = (() => {
    const c = lead.county?.toLowerCase()
    const f = lead.folio_number
    const a = lead.property_address
    if (!c) return null
    if (c === 'miami-dade' && f) return `https://gisweb.miamidade.gov/addressSearch/index.html?folioNum=${encodeURIComponent(f)}`
    if (c === 'miami-dade') return `https://gisweb.miamidade.gov/addressSearch/index.html?addr=${encodeURIComponent(a)}`
    if (c === 'broward' && f) return `https://bcpa.net/RecInfo.asp?URL_Folio=${encodeURIComponent(f)}`
    if (c === 'palm-beach' && f) return `https://pbcpao.gov/property-details/${encodeURIComponent(f)}`
    return null
  })()

  // Realtor.com link
  const realtorUrl = (() => {
    const parts = [lead.property_address, lead.city, lead.state ?? 'FL', lead.zip].filter(Boolean).join(' ')
    return `https://www.realtor.com/realestateandhomes-detail/${parts.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  })()

  const ACTIONS: { label: string; icon: string; color: string; onClick?: () => void; href?: string; disabled?: boolean }[] = [
    { label: 'Analyze Property', icon: '✦', color: '#C9A84C', onClick: () => setActiveTab('analyze') },
    { label: 'Make Offer',       icon: '💰', color: '#C9A84C', onClick: () => setActiveTab('offer') },
    { label: 'Generate Contract',icon: '📄', color: '#a78bfa', onClick: () => setActiveTab('documents') },
    { label: 'Contact Owner',    icon: '📞', color: '#4CAF9A', onClick: () => setActiveTab('comms'), href: phones[0] ? `tel:${phones[0]}` : undefined },
    { label: 'View Listing',     icon: '🏠', color: '#60a5fa', href: realtorUrl },
    { label: 'Open Pictometry',  icon: '🛰', color: '#4CAF9A', href: pictometryUrl ?? '#', disabled: !pictometryUrl },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 7 }}>
      {ACTIONS.map(a => {
        const style: React.CSSProperties = {
          padding: '8px 4px', borderRadius: 6, fontSize: 11, fontWeight: 600,
          textAlign: 'center', cursor: a.disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${a.color}35`, background: `${a.color}0d`,
          color: a.disabled ? '#4a6a9a' : a.color, opacity: a.disabled ? 0.4 : 1,
          textDecoration: 'none', display: 'block',
        }
        if (a.href) return (
          <a key={a.label} href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" style={style}>
            <div style={{ fontSize: 16, marginBottom: 3 }}>{a.icon}</div>
            <div style={{ fontSize: 10 }}>{a.label}</div>
          </a>
        )
        return (
          <button key={a.label} onClick={a.onClick} style={{ ...style, fontFamily: 'inherit' }}>
            <div style={{ fontSize: 16, marginBottom: 3 }}>{a.icon}</div>
            <div style={{ fontSize: 10 }}>{a.label}</div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Main OverviewTab ─────────────────────────────────────────────────────────

export default function OverviewTab() {
  const {
    lead, notes, acquisition, setActiveTab, aiSummary, addNote,
    onEnrich, onDeepEnrich, enriching, deepEnriching, enrichMsg, deepEnrichMsg,
  } = useWorkspace()
  const { offerStatus, communicationStatus } = acquisition

  const [noteText, setNoteText] = useState('')
  const [saving, setSaving]     = useState(false)

  const handleAddNote = async () => {
    const text = noteText.trim()
    if (!text) return
    setSaving(true)
    await addNote(text, 'note')
    setNoteText('')
    setSaving(false)
  }

  const stage    = lead.pipeline_stage ?? ''
  const stageMeta = STAGE_META[stage] ?? null
  const eClr     = EQUITY_COLORS[lead.equity_tier ?? ''] ?? '#9ca3af'
  const ds       = daysSince(lead.file_date)
  const mv       = lead.market_value ?? lead.estimated_value
  const loanBal  = lead.foreclosure_amount
  const ltv      = mv && loanBal ? Math.round((loanBal / mv) * 100) : null
  const phones   = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5].filter(Boolean) as string[]

  const isPaid = lead.enrichment_src === 'reapi'
  const sourceLabel = lead.enrichment_src ? (SOURCE_LABELS[lead.enrichment_src] ?? lead.enrichment_src) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ══════ PROPERTY SNAPSHOT + INVESTMENT SNAPSHOT ══════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, alignItems: 'start' }}>
        <PropertySnapshot leadId={lead.id} />
        <InvestmentSnapshot />
      </div>

      {/* ══════ QUICK ACTIONS ══════ */}
      <QuickActions />

      {/* ══════ MAIN 2-COL GRID ══════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Property Map */}
          <Suspense fallback={
            <div style={{ height: 200, background: '#071829', borderRadius: 7, border: '1px solid #1a3050', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#4a6a9a', fontSize: 11 }}>Loading map…</span>
            </div>
          }>
            <PropertyMapCard
              address={lead.property_address}
              city={lead.city}
              zip={lead.zip}
              county={lead.county}
              folio={lead.folio_number}
              latitude={lead.latitude}
              longitude={lead.longitude}
            />
          </Suspense>

          {/* Property Details */}
          <Card>
            <CardTitle>Property Details</CardTitle>
            {lead.property_type && <KV k="Type" v={lead.property_type} />}
            {lead.beds != null && <KV k="Beds / Baths" v={`${lead.beds} / ${lead.baths ?? '?'}`} />}
            {(lead.sqft ?? lead.living_area) && (
              <KV k="Living Area" v={`${Number(lead.sqft ?? lead.living_area).toLocaleString()} sqft`} />
            )}
            {lead.lot_size && <KV k="Lot Size" v={`${Number(lead.lot_size).toLocaleString()} sqft`} />}
            {lead.year_built && <KV k="Year Built" v={String(lead.year_built)} />}
            {(lead.subdivision ?? lead.subdivision_name) && (
              <KV k="Subdivision" v={lead.subdivision ?? lead.subdivision_name!} />
            )}
            {lead.occupancy && <KV k="Occupancy" v={lead.occupancy} />}
            {lead.county && <KV k="County" v={COUNTY_LABELS[lead.county] ?? lead.county} />}
            {lead.folio_number && (
              <KV k="Folio" v={
                <a
                  href={
                    lead.county === 'miami-dade'
                      ? `https://www.miamidade.gov/Apps/PA/propertysearch/#/?folio=${lead.folio_number}`
                      : lead.county === 'broward'
                        ? `https://www.bcpa.net/RecInfo.asp?URL_Folio=${lead.folio_number}`
                        : lead.county === 'palm-beach'
                          ? `https://www.pbcpao.gov/property-details/${lead.folio_number}`
                          : '#'
                  }
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: '#7B8FD4', textDecoration: 'none', fontFamily: 'monospace', fontSize: 10 }}
                >
                  {lead.folio_number} ↗
                </a>
              } />
            )}
          </Card>

          {/* Ownership */}
          <Card>
            <CardTitle>Ownership</CardTitle>
            <KV k="Owner" v={lead.owner_name ?? lead.mortgagor ?? '—'} />
            {lead.entity_type && <KV k="Entity Type" v={lead.entity_type} />}
            {lead.homestead != null && (
              <KV k="Homestead"
                v={lead.homestead ? '✓ Owner-Occupied' : 'No'}
                vColor={lead.homestead ? '#4CAF9A' : '#4a6a9a'}
              />
            )}
            {lead.vacant && <KV k="Vacant" v="✓ Yes" vColor="#f59e0b" />}
            {lead.multiple_liens && <KV k="Multiple Liens" v="⚠ Yes — Verify all positions" vColor="#ef4444" />}
            {lead.mailing_address && <KV k="Mailing Address" v={lead.mailing_address} />}
            {lead.owner_state && lead.owner_state !== 'FL' && (
              <KV k="Owner State" v={
                <span style={{ padding: '1px 7px', borderRadius: 20, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', fontSize: 10, fontWeight: 600 }}>
                  Out-of-State · {lead.owner_state}
                </span>
              } />
            )}
            {phones.length > 0 && (
              <>
                <Divider />
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 6 }}>Phone Numbers</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {phones.map((p, i) => (
                    <a key={i} href={`tel:${p}`}
                      style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(123,143,212,0.1)', color: '#7B8FD4', border: '1px solid rgba(123,143,212,0.2)', fontSize: 11, fontFamily: 'monospace', textDecoration: 'none', fontWeight: 500 }}>
                      {p}
                    </a>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* PA Enrichment Data */}
          {lead.enriched_at && (
            <Card style={{ border: '1px solid rgba(76,175,154,0.25)' }}>
              <CardTitle action={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 20, background: 'rgba(76,175,154,0.1)', color: '#4CAF9A' }}>
                    {new Date(lead.enriched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button onClick={() => onEnrich(true)} disabled={enriching}
                    style={{ fontSize: 10, color: '#4a6a9a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {enriching ? '…' : '↻ Refresh'}
                  </button>
                </div>
              }>
                PA Enrichment Data
              </CardTitle>
              {lead.legal_description && (
                <KV k="Legal Description" v={
                  <span style={{ fontSize: 10, fontFamily: 'monospace', lineHeight: 1.4 }}>{lead.legal_description}</span>
                } />
              )}
              {lead.zoning && <KV k="Zoning" v={lead.zoning} />}
              {(lead.subdivision_name ?? lead.subdivision) && (
                <KV k="Subdivision" v={lead.subdivision_name ?? lead.subdivision!} />
              )}
              {lead.tax_year && lead.tax_amount && (
                <KV k={`Tax (${lead.tax_year})`} v={`$${Number(lead.tax_amount).toLocaleString()}`} />
              )}
              {lead.last_sale_date && (
                <KV k="Last Sale" v={
                  <span>
                    {lead.sold_price ? `$${Number(lead.sold_price).toLocaleString()}` : '—'}
                    <span style={{ marginLeft: 4, fontSize: 10, color: '#4a6a9a' }}>
                      · {new Date(lead.last_sale_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                } />
              )}
              {lead.living_area && <KV k="Living Area (PA)" v={`${Number(lead.living_area).toLocaleString()} sqft`} />}
            </Card>
          )}

          {/* Enrichment source banner */}
          {(lead.enrichment_src || lead.enriched_at) && (
            <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {sourceLabel && <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{sourceLabel}</span>}
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: isPaid ? 'rgba(107,189,224,0.1)' : 'rgba(76,175,154,0.1)', color: isPaid ? '#6ABDE0' : '#4CAF9A', border: `1px solid ${isPaid ? 'rgba(107,189,224,0.25)' : 'rgba(76,175,154,0.25)'}` }}>
                  {isPaid ? 'Paid' : 'Public'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {enrichMsg && <span style={{ fontSize: 10, color: enrichMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>{enrichMsg}</span>}
                {!isPaid && (
                  <>
                    {deepEnrichMsg && <span style={{ fontSize: 10, color: deepEnrichMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>{deepEnrichMsg}</span>}
                    <button onClick={onDeepEnrich} disabled={deepEnriching}
                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)', cursor: 'pointer', opacity: deepEnriching ? 0.6 : 1 }}>
                      {deepEnriching ? '…' : 'Deep Enrich'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* No enrichment yet */}
          {!lead.enriched_at && lead.county && (
            <div style={{ background: '#0d1b2e', border: '1px dashed #1a3050', borderRadius: 7, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 3 }}>Property Appraiser Data</div>
                <div style={{ fontSize: 10, color: '#4a6a9a' }}>Enrich with {COUNTY_LABELS[lead.county] ?? lead.county} data — folio, legal description, tax, sale history</div>
              </div>
              <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                {enrichMsg && <span style={{ fontSize: 10, color: enrichMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>{enrichMsg}</span>}
                <button onClick={() => onEnrich(false)} disabled={enriching}
                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, background: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)', cursor: 'pointer', opacity: enriching ? 0.6 : 1 }}>
                  {enriching ? 'Enriching…' : '↻ Enrich'}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Lead Status */}
          <Card>
            <CardTitle>Lead Status</CardTitle>
            {stageMeta && (
              <KV k="Stage" v={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: stageMeta.bg, color: stageMeta.color, fontSize: 10, fontWeight: 500 }}>
                  ● {stageMeta.label}
                </span>
              } />
            )}
            {lead.lead_score != null && <KV k="Lead Score" v={`${lead.lead_score} / 100`} vColor="#C9A84C" />}
            {offerStatus.hasOffer && <KV k="Our Offer" v={fmtMoneyFull(offerStatus.amount!)} vColor="#C9A84C" />}
            {lead.lead_added_at && <KV k="Added" v={fmtDate(lead.lead_added_at)} vColor="#4a6a9a" />}
            <Divider />
            <KV k="Call"
              v={communicationStatus.hasTalked ? '✓ Talked' : communicationStatus.callStatus !== 'not_called' ? 'Called' : '—'}
              vColor={communicationStatus.hasTalked ? '#22c55e' : '#4a6a9a'}
            />
            <KV k="SMS"   v={communicationStatus.smsStatus  !== 'not_sent'   ? 'Sent' : '—'} vColor="#4a6a9a" />
            <KV k="Email" v={communicationStatus.emailStatus !== 'not_sent'  ? 'Sent' : '—'} vColor="#4a6a9a" />
          </Card>

          {/* Surplus Funds banner */}
          {lead.surplus_funds_amount && (
            <Card style={{ border: '1px solid rgba(76,175,154,0.4)', background: 'rgba(76,175,154,0.06)' }}>
              <CardTitle><span style={{ color: '#4CAF9A' }}>Surplus Funds</span></CardTitle>
              <KV k="Surplus Amount" v={`$${lead.surplus_funds_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} vColor="#4CAF9A" />
              <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginTop: 4 }}>
                Unclaimed funds held by the county — owed to the property owner.
              </div>
            </Card>
          )}

          {/* Calling workflow — shown for acquisition leads */}
          {lead.acquisition_pipeline && (
            <Card>
              <CallingPanel />
            </Card>
          )}

          {/* Valuation */}
          <Card>
            <CardTitle>Valuation</CardTitle>
            {mv && <KV k="Market Value" v={fmtK(mv)} vColor="#C9A84C" />}
            {lead.assessed_value && <KV k="Assessed Value" v={fmtK(lead.assessed_value)} vColor="#4a6a9a" />}
            {lead.equity_dollar_amount && (
              <KV k="Est. Equity"
                v={`${fmtK(lead.equity_dollar_amount)}${lead.equity_percentage ? ` (${Number(lead.equity_percentage).toFixed(0)}%)` : ''}`}
                vColor={eClr}
              />
            )}
            {loanBal && <KV k="Est. Loan Balance" v={fmtK(loanBal)} vColor="#E07B6A" />}
            {ltv !== null && <KV k="Est. LTV" v={`${ltv}%`} vColor={ltv > 90 ? '#ef4444' : ltv > 70 ? '#C9A84C' : '#4CAF9A'} />}
            {lead.equity_tier && (
              <KV k="Equity Tier" v={
                <span style={{ padding: '1px 7px', borderRadius: 20, background: `${eClr}18`, color: eClr, fontSize: 10, fontWeight: 600 }}>
                  {lead.equity_tier}
                </span>
              } />
            )}
            {mv && loanBal && (
              <>
                <Divider />
                <div style={{ fontSize: 10, color: '#4a6a9a', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Loan ({ltv}%)</span>
                  <span>Equity ({100 - (ltv ?? 0)}%)</span>
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ background: '#E07B6A', width: `${Math.min(100, ltv ?? 0)}%`, transition: 'width .5s' }} />
                  <div style={{ flex: 1, background: eClr, opacity: 0.6 }} />
                </div>
              </>
            )}
          </Card>

          {/* AI Insight */}
          {aiSummary && (
            <Card style={{ border: '1px solid rgba(74,222,128,0.15)' }}>
              <CardTitle action={
                <button onClick={() => setActiveTab('analyze')}
                  style={{ fontSize: 10, color: '#4ade80', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Full Analysis →
                </button>
              }>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ padding: '1px 6px', borderRadius: 4, background: '#0f1e0a', border: '1px solid #1a5c2a', color: '#4ade80', fontSize: 9 }}>✦ AI</span>
                  Analysis
                </span>
              </CardTitle>
              {aiSummary.summary && (
                <p style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.55, marginBottom: 8, marginTop: 0 }}>{aiSummary.summary}</p>
              )}
              {aiSummary.distress_score != null && (
                <KV k="Distress Score" v={`${aiSummary.distress_score} / 10`} vColor="#f59e0b" />
              )}
              {aiSummary.lead_quality != null && (
                <KV k="Lead Quality" v={`${aiSummary.lead_quality} / 10`} vColor="#C9A84C" />
              )}
              {aiSummary.motivation && (
                <KV k="Motivation" v={aiSummary.motivation} vColor="#4ade80" />
              )}
              {aiSummary.urgency && (
                <KV k="Urgency" v={aiSummary.urgency} vColor={aiSummary.urgency === 'high' ? '#ef4444' : '#C9A84C'} />
              )}
              {aiSummary.strategy && (
                <KV k="Strategy" v={SCORE_LABELS[aiSummary.strategy] ?? aiSummary.strategy} />
              )}
              {aiSummary.highlights && aiSummary.highlights.length > 0 && (
                <>
                  <Divider />
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 5 }}>Key Signals</div>
                  {aiSummary.highlights.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
                      <span style={{ color: '#C9A84C', fontSize: 10, flexShrink: 0, marginTop: 1 }}>▸</span>
                      <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{h}</span>
                    </div>
                  ))}
                </>
              )}
            </Card>
          )}

          {/* Activity Timeline */}
          <Card>
            <CardTitle action={
              notes.length > 6
                ? <button onClick={() => setActiveTab('comms')} style={{ fontSize: 10, color: '#4a6a9a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    All {notes.length} →
                  </button>
                : undefined
            }>
              Activity Timeline
            </CardTitle>
            {notes.length === 0 ? (
              <p style={{ fontSize: 11, color: '#4a6a9a', padding: '4px 0' }}>No activity logged yet.</p>
            ) : notes.slice(0, 6).map(n => {
              const dotColor = DOT_COLORS[n.note_type ?? 'note'] ?? '#374151'
              return (
                <div key={n.id} style={{ display: 'flex', gap: 9, padding: '6px 0', borderBottom: '1px solid #0d1b2e' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 10, color: '#4a6a9a' }}>{fmtDateTime(n.created_at)}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{n.body}</div>
                  </div>
                </div>
              )
            })}
          </Card>

          {/* Quick Note */}
          <Card>
            <CardTitle>Add Note</CardTitle>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Log a note about this lead…"
              rows={3}
              style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '7px 9px', color: '#e2e8f0', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
            <button
              onClick={handleAddNote}
              disabled={saving || !noteText.trim()}
              style={{ marginTop: 6, padding: '5px 12px', borderRadius: 5, background: '#1a3050', border: '1px solid rgba(201,168,76,0.25)', color: '#C9A84C', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: saving || !noteText.trim() ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </Card>

        </div>
      </div>
    </div>
  )
}
