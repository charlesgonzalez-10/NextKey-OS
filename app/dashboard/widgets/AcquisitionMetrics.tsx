'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface AcquisitionMetricsData {
  leads_by_pipeline:        Record<string, number>
  surplus_status_breakdown: Record<string, number>
  calls_today:              number
  follow_ups_due:           number
  total_surplus_value:      number
}

const PIPELINE_COLORS: Record<string, string> = {
  'wholesale':        '#7B8FD4',
  'retail':           '#C9A84C',
  'pre-foreclosure':  '#E07B6A',
  'surplus-funds':    '#4CAF9A',
  'probate':          '#a78bfa',
}

const SURPLUS_STATUS_LABELS: Record<string, string> = {
  new:           'New',
  researching:   'Researching',
  owner_found:   'Owner Found',
  contacted:     'Contacted',
  claim_filed:   'Claim Filed',
  paid:          'Paid',
  archived:      'Archived',
}

const SURPLUS_STATUS_COLORS: Record<string, string> = {
  new:           '#6b7280',
  researching:   '#60a5fa',
  owner_found:   '#f59e0b',
  contacted:     '#4CAF9A',
  claim_filed:   '#a78bfa',
  paid:          '#22c55e',
  archived:      '#374151',
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1000)}K`
  return `$${n.toLocaleString()}`
}

export default function AcquisitionMetrics() {
  const [data, setData]     = useState<AcquisitionMetricsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/acquisition/metrics')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="animate-pulse h-32 rounded-lg bg-gray-100" />
  }

  if (!data) {
    return <div className="text-sm text-gray-400 py-4 text-center">Unable to load metrics.</div>
  }

  const pipelines = Object.entries(data.leads_by_pipeline).sort((a, b) => b[1] - a[1])
  const statuses  = Object.entries(data.surplus_status_breakdown).sort((a, b) => b[1] - a[1])
  const totalSurplusLeads = statuses.reduce((s, [, c]) => s + c, 0)

  return (
    <div className="space-y-4">

      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Calls Today',     value: data.calls_today,    color: '#4CAF9A' },
          { label: 'Follow-Ups Due',  value: data.follow_ups_due, color: '#f59e0b', href: '/leads?wt=all' },
          { label: 'Surplus Leads',   value: totalSurplusLeads,   color: '#4CAF9A' },
          { label: 'Surplus Value',   value: fmtMoney(data.total_surplus_value), color: '#C9A84C', isText: true },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-lg border border-gray-100 p-3 flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{kpi.label}</span>
            <span className="text-2xl font-bold" style={{ color: kpi.color }}>
              {kpi.isText ? kpi.value : String(kpi.value)}
            </span>
          </div>
        ))}
      </div>

      {/* Pipeline breakdown */}
      {pipelines.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">By Pipeline</div>
          <div className="space-y-1.5">
            {pipelines.map(([slug, count]) => {
              const color  = PIPELINE_COLORS[slug] ?? '#6b7280'
              const label  = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              const total  = pipelines.reduce((s, [, c]) => s + c, 0)
              const pct    = total > 0 ? Math.round((count / total) * 100) : 0
              return (
                <Link key={slug} href={`/leads?acquisition_pipeline=${slug}`}
                  className="flex items-center gap-2 group">
                  <span className="text-[11px] font-medium text-gray-600 w-32 truncate group-hover:text-gray-900 transition-colors">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <span className="text-[11px] font-bold w-8 text-right" style={{ color }}>{count}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Surplus status breakdown */}
      {statuses.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Surplus Status</div>
          <div className="flex flex-wrap gap-2">
            {statuses.map(([status, count]) => {
              const color = SURPLUS_STATUS_COLORS[status] ?? '#6b7280'
              const label = SURPLUS_STATUS_LABELS[status] ?? status
              return (
                <span key={status} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}>
                  {label}
                  <span className="font-bold">{count}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
