'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface WalletData {
  wallet: {
    status: string
    available: number
    monthly_credits: number
    purchased_credits: number
    bonus_credits: number
    reserved_credits: number
    total_gross: number
    lifetime_consumed: number
    credit_pct: number
  }
  plan: {
    name: string
    status: string
    period_end: string | null
  }
  usage_this_month: {
    total_calls: number
    credits_used: number
    by_feature: Array<{ feature_key: string; calls: number; credits: number }>
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  property_search_criteria: 'Property Search',
  property_detail:          'Property Detail',
  rentcast_rental_estimate: 'Rental Estimate',
  ai_lead_analysis:         'AI Analysis',
  ocr_document:             'Document OCR',
  mls_listing:              'MLS Listings',
}

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Components ─────────────────────────────────────────────────────────────────

function CreditBar({ available, total, pct }: { available: number; total: number; pct: number }) {
  const color = pct > 50 ? '#4ACF9A' : pct > 20 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{
      backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
      borderRadius: 14, padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Credits Remaining</p>
          <p style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1 }}>
            {available.toLocaleString()}
          </p>
          {total > 0 && (
            <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 6 }}>
              of {total.toLocaleString()} total · {pct}% remaining
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 2 }}>1 credit = 1 search</p>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--c-border)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.min(100, pct)}%`,
          backgroundColor: color, borderRadius: 4,
          transition: 'width 0.4s ease',
        }} />
      </div>

      {pct <= 20 && (
        <p style={{
          fontSize: 12, marginTop: 10, padding: '8px 12px', borderRadius: 8,
          backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          color: '#ef4444',
        }}>
          Running low on credits. Buy more to keep searching.
        </p>
      )}
    </div>
  )
}

function CreditBreakdown({ wallet }: { wallet: WalletData['wallet'] }) {
  const rows = [
    { label: 'Monthly Credits',   value: wallet.monthly_credits,   desc: 'Included with your plan' },
    { label: 'Purchased Credits', value: wallet.purchased_credits,  desc: 'One-time purchases' },
    { label: 'Bonus Credits',     value: wallet.bonus_credits,      desc: 'Promotions & referrals' },
    { label: 'Reserved',          value: -wallet.reserved_credits,  desc: 'Held for pending searches', warn: true },
  ]

  return (
    <div style={{
      backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
      borderRadius: 14, padding: '20px 24px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Credit Breakdown</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(row => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-primary)' }}>{row.label}</p>
              <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{row.desc}</p>
            </div>
            <span style={{
              fontSize: 15, fontWeight: 700,
              color: row.warn ? '#f59e0b' : row.value > 0 ? 'var(--c-primary)' : 'var(--c-text-3)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {row.value < 0 ? `−${Math.abs(row.value).toLocaleString()}` : row.value.toLocaleString()}
            </span>
          </div>
        ))}
        <div style={{ height: 1, backgroundColor: 'var(--c-border)', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)' }}>Available Now</p>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#4ACF9A', fontVariantNumeric: 'tabular-nums' }}>
            {wallet.available.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}

function UsageCard({ usage }: { usage: WalletData['usage_this_month'] }) {
  return (
    <div style={{
      backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
      borderRadius: 14, padding: '20px 24px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Usage This Month</p>

      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--c-primary)', lineHeight: 1 }}>{usage.total_calls.toLocaleString()}</p>
          <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>Total searches</p>
        </div>
        <div>
          <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--c-primary)', lineHeight: 1 }}>{usage.credits_used.toLocaleString()}</p>
          <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>Credits used</p>
        </div>
      </div>

      {usage.by_feature.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {usage.by_feature.map(f => (
            <div key={f.feature_key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{featureLabel(f.feature_key)}</span>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--c-text-3)', fontVariantNumeric: 'tabular-nums' }}>{f.calls} calls</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-primary)', fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>{f.credits} cr</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {usage.total_calls === 0 && (
        <p style={{ fontSize: 12, color: 'var(--c-text-3)', fontStyle: 'italic' }}>No searches yet this month.</p>
      )}
    </div>
  )
}

function PlanCard({ plan }: { plan: WalletData['plan'] }) {
  return (
    <div style={{
      backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
      borderRadius: 14, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Current Plan</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-primary)' }}>{plan.name}</p>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            backgroundColor: plan.status === 'active' ? 'rgba(74,207,154,0.12)' : 'rgba(245,158,11,0.12)',
            color: plan.status === 'active' ? '#4ACF9A' : '#f59e0b',
            letterSpacing: '0.06em',
          }}>{plan.status.toUpperCase()}</span>
        </div>
        {plan.period_end && (
          <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>
            Renews {new Date(plan.period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          style={{
            flex: 1, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            backgroundColor: '#4ACF9A', color: '#000', border: 'none', cursor: 'pointer',
          }}
          onClick={() => alert('Upgrade plans coming soon.')}
        >
          Upgrade Plan
        </button>
        <button
          style={{
            flex: 1, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)',
            border: '1px solid var(--c-border)', cursor: 'pointer',
          }}
          onClick={() => alert('Credit purchases coming soon.')}
        >
          Buy Credits
        </button>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function BillingClient() {
  const [data, setData]       = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/billing/wallet')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ color: 'var(--c-primary)', padding: '24px 28px', maxWidth: 700 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Credits & Billing</h1>
        <p style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
          Your search credits and current plan.
        </p>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20,
          backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          color: '#ef4444', fontSize: 13,
        }}>
          {error}
          <button onClick={load} style={{ marginLeft: 12, fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[160, 200, 180, 160].map((h, i) => (
            <div key={i} style={{ height: h, borderRadius: 14, backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', opacity: 0.5 }} />
          ))}
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CreditBar
            available={data.wallet.available}
            total={data.wallet.total_gross}
            pct={data.wallet.credit_pct}
          />
          <CreditBreakdown wallet={data.wallet} />
          <UsageCard usage={data.usage_this_month} />
          <PlanCard plan={data.plan} />
        </div>
      )}
    </div>
  )
}
