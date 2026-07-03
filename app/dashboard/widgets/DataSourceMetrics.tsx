'use client'

import { useState, useEffect } from 'react'

interface DSMetrics {
  total_requests:           number
  tier1_hits:               number
  tier2_hits:               number
  tier3_hits:               number
  cache_hit_rate:           number
  estimated_savings_cents:  number
  avg_response_time_ms:     number | null
  total_field_sources:      number
}

function fmtMoney(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`
  return `$${dollars.toFixed(0)}`
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function StatTile({
  label, value, sub, color,
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: '#f8f7f4',
      border: '1px solid #EDE9E0',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#0A1F44', marginBottom: 2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{sub}</div>}
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
    </div>
  )
}

function TierBar({ tier1, tier2, tier3 }: { tier1: number; tier2: number; tier3: number }) {
  const total = tier1 + tier2 + tier3
  if (!total) return null

  const pct1 = (tier1 / total) * 100
  const pct2 = (tier2 / total) * 100
  const pct3 = (tier3 / total) * 100

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>Source Distribution</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{total.toLocaleString()} total</span>
      </div>
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', height: 8, marginBottom: 8 }}>
        {pct1 > 0 && <div style={{ width: `${pct1}%`, background: '#7B8FD4' }} />}
        {pct2 > 0 && <div style={{ width: `${pct2}%`, background: '#4CAF9A' }} />}
        {pct3 > 0 && <div style={{ width: `${pct3}%`, background: '#C9A84C' }} />}
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {[
          { label: 'Cache', count: tier1, color: '#7B8FD4' },
          { label: 'Public Records', count: tier2, color: '#4CAF9A' },
          { label: 'Premium API', count: tier3, color: '#C9A84C' },
        ].filter(t => t.count > 0).map(t => (
          <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#6b7280' }}>
              {t.label} <span style={{ fontWeight: 600, color: '#0A1F44' }}>{t.count.toLocaleString()}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DataSourceMetrics() {
  const [metrics, setMetrics] = useState<DSMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dsoe/metrics')
      .then(r => r.json())
      .then(setMetrics)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #EDE9E0', padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: '#0A1F44', fontWeight: 700, fontSize: 16, margin: 0, marginBottom: 2 }}>
            Data Source Intelligence
          </h2>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
            DSOE efficiency — cache hits, public records, and premium API usage
          </p>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const,
          padding: '3px 8px', borderRadius: 4,
          background: '#4CAF9A22', color: '#4CAF9A', border: '1px solid #4CAF9A44',
        }}>
          Phase 6.2
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ height: 72, background: '#f8f7f4', borderRadius: 10, border: '1px solid #EDE9E0' }} />
          ))}
        </div>
      ) : !metrics ? (
        <div style={{ textAlign: 'center' as const, padding: 32, color: '#9ca3af', fontSize: 13 }}>
          No data available yet. DSOE will begin collecting metrics as properties are enriched.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            <StatTile
              label="Cache Hit Rate"
              value={fmtPct(metrics.cache_hit_rate)}
              sub={`${metrics.tier1_hits.toLocaleString()} of ${metrics.total_requests.toLocaleString()}`}
              color="#7B8FD4"
            />
            <StatTile
              label="Est. Savings"
              value={fmtMoney(metrics.estimated_savings_cents)}
              sub="vs. all-premium"
              color="#4CAF9A"
            />
            <StatTile
              label="Field Sources"
              value={metrics.total_field_sources.toLocaleString()}
              sub="properties tracked"
            />
            <StatTile
              label="Avg Response"
              value={metrics.avg_response_time_ms !== null ? `${metrics.avg_response_time_ms}ms` : '—'}
              sub="per resolution"
              color="#C9A84C"
            />
          </div>

          <TierBar
            tier1={metrics.tier1_hits}
            tier2={metrics.tier2_hits}
            tier3={metrics.tier3_hits}
          />
        </>
      )}
    </div>
  )
}
