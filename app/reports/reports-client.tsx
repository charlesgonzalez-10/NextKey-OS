'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface BreakdownItem {
  id: string
  name: string
  color: string
  count: number
  count_range: number
}

interface SourceItem {
  source: string
  count: number
  count_range: number
}

interface PipelineStageItem {
  id: string
  name: string
  count: number
}

interface PipelineItem {
  id: string
  name: string
  color: string
  count: number
  value: number
  stages: PipelineStageItem[]
}

interface ReportsData {
  summary: {
    total_contacts: number
    new_contacts: number
    total_deals: number
    active_deals: number
    pipeline_value: number
    closed_deals: number
    closed_value: number
  }
  by_lead_type:  BreakdownItem[]
  by_vertical:   BreakdownItem[]
  by_source:     SourceItem[]
  by_pipeline:   PipelineItem[]
  unassigned_deals: { count: number; by_status: Record<string, number> }
  monthly_trend: Array<{ month: string; contacts: number; deals: number }>
  date_range: { from: string; to: string }
}

// ── Date range presets ─────────────────────────────────────────────────────────

const today = new Date()
const fmt = (d: Date) => d.toISOString().slice(0, 10)

const PRESETS = [
  {
    label: 'This Month',
    from:  fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
    to:    fmt(today),
  },
  {
    label: 'Last Month',
    from:  fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    to:    fmt(new Date(today.getFullYear(), today.getMonth(), 0)),
  },
  {
    label: 'This Quarter',
    from:  fmt(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)),
    to:    fmt(today),
  },
  {
    label: 'Last 30 Days',
    from:  fmt(new Date(Date.now() - 30 * 864e5)),
    to:    fmt(today),
  },
  {
    label: 'Last 90 Days',
    from:  fmt(new Date(Date.now() - 90 * 864e5)),
    to:    fmt(today),
  },
  {
    label: 'YTD',
    from:  fmt(new Date(today.getFullYear(), 0, 1)),
    to:    fmt(today),
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function currency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function pct(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function StackedBar({ items, getCount }: {
  items: Array<{ id?: string; source?: string; name?: string; color?: string; count: number }>
  getCount: (item: typeof items[number]) => number
}) {
  const total = items.reduce((s, i) => s + getCount(i), 0)
  if (total === 0) return <div className="h-3 bg-gray-100 rounded-full" />
  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-px">
      {items.map((item, idx) => {
        const w = (getCount(item) / total) * 100
        const color = item.color ?? `hsl(${(idx * 47) % 360}, 65%, 55%)`
        return (
          <div
            key={item.id ?? item.source ?? idx}
            title={`${item.name ?? item.source}: ${getCount(item)}`}
            style={{ width: `${w}%`, backgroundColor: color, minWidth: w > 0 ? '4px' : 0 }}
          />
        )
      })}
    </div>
  )
}

function BreakdownTable({
  title,
  items,
  showRange,
  rangeLabel,
  colorDot = true,
}: {
  title: string
  items: Array<{ id?: string; source?: string; name?: string; color?: string; count: number; count_range?: number }>
  showRange: boolean
  rangeLabel: string
  colorDot?: boolean
}) {
  const total = items.reduce((s, i) => s + i.count, 0)
  const totalRange = items.reduce((s, i) => s + (i.count_range ?? 0), 0)

  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
        <p className="text-sm text-gray-400 text-center py-6">No data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      <StackedBar items={items} getCount={i => i.count} />
      <div className="mt-4 space-y-2.5">
        {items.map((item, idx) => {
          const color = item.color ?? `hsl(${(idx * 47) % 360}, 65%, 55%)`
          const label = item.name ?? item.source ?? '—'
          return (
            <div key={item.id ?? item.source ?? idx} className="flex items-center gap-3">
              {colorDot && (
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              )}
              <span className="flex-1 text-sm text-gray-700 truncate">{label}</span>
              {showRange && (
                <span className="text-xs text-gray-400 w-16 text-right">
                  {item.count_range ?? 0} {rangeLabel}
                </span>
              )}
              <span className="text-sm font-bold text-gray-900 w-8 text-right">{item.count}</span>
              <span className="text-xs text-gray-400 w-10 text-right">{pct(item.count, total)}%</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-400">
        <span>{total} total all time</span>
        {showRange && <span>{totalRange} in selected range</span>}
      </div>
    </div>
  )
}

function MonthlyTrend({ months }: { months: ReportsData['monthly_trend'] }) {
  const maxC = Math.max(...months.map(m => m.contacts), 1)
  const maxD = Math.max(...months.map(m => m.deals), 1)
  const max  = Math.max(maxC, maxD, 1)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Monthly Trend (12 months)</h3>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-blue-500 inline-block rounded" />Contacts
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-500 inline-block rounded" />Deals
          </span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-32">
        {months.map(m => (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
            <div className="w-full flex items-end gap-px h-28">
              <div
                className="flex-1 bg-blue-500 rounded-t-sm transition-all"
                style={{ height: `${(m.contacts / max) * 100}%`, minHeight: m.contacts > 0 ? 2 : 0 }}
                title={`${m.month}: ${m.contacts} contacts`}
              />
              <div
                className="flex-1 bg-amber-500 rounded-t-sm transition-all"
                style={{ height: `${(m.deals / max) * 100}%`, minHeight: m.deals > 0 ? 2 : 0 }}
                title={`${m.month}: ${m.deals} deals`}
              />
            </div>
            <span className="text-[9px] text-gray-400 truncate w-full text-center">
              {m.month.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineBreakdown({ pipelines, unassigned }: {
  pipelines: PipelineItem[]
  unassigned: ReportsData['unassigned_deals']
}) {
  if (pipelines.length === 0 && unassigned.count === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Pipeline Breakdown</h3>
        <p className="text-sm text-gray-400 text-center py-6">
          No deals yet. <Link href="/deals/new" className="text-blue-600 underline">Create a deal</Link> or{' '}
          <Link href="/admin/pipelines" className="text-blue-600 underline">set up pipelines</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Pipeline Breakdown</h3>
      <div className="space-y-5">
        {pipelines.map(p => (
          <div key={p.id}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color || '#6366f1' }} />
                <span className="text-sm font-semibold text-gray-800">{p.name}</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-gray-900">{p.count} deals</span>
                {p.value > 0 && (
                  <span className="text-xs text-gray-400 ml-2">{currency(p.value)}</span>
                )}
              </div>
            </div>
            {p.stages.length > 0 && (
              <div className="ml-4 space-y-1.5">
                {p.stages.filter(s => s.count > 0).map(s => (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                    <span className="flex-1 text-xs text-gray-600 truncate">{s.name}</span>
                    <span className="text-xs font-semibold text-gray-700">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {unassigned.count > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                <span className="text-sm font-semibold text-gray-600">Unassigned</span>
              </div>
              <span className="text-sm font-bold text-gray-700">{unassigned.count} deals</span>
            </div>
            <div className="ml-4 space-y-1.5">
              {Object.entries(unassigned.by_status).map(([status, count]) => (
                <div key={status} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-200 shrink-0" />
                  <span className="flex-1 text-xs text-gray-500 truncate">{status}</span>
                  <span className="text-xs font-semibold text-gray-600">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ReportsClient() {
  const [data,    setData]    = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset,  setPreset]  = useState(PRESETS[0].label)
  const [from,    setFrom]    = useState(PRESETS[0].from)
  const [to,      setTo]      = useState(PRESETS[0].to)
  const [custom,  setCustom]  = useState(false)

  const fetchData = useCallback((f: string, t: string) => {
    setLoading(true)
    fetch(`/api/reports?from=${f}&to=${t}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectPreset = (p: typeof PRESETS[number]) => {
    setPreset(p.label)
    setFrom(p.from)
    setTo(p.to)
    setCustom(false)
    fetchData(p.from, p.to)
  }

  const applyCustom = () => {
    setPreset('Custom')
    fetchData(from, to)
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Date range picker ── */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => selectPreset(p)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              preset === p.label && !custom
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); setCustom(true); setPreset('Custom') }}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
          />
          <span className="text-gray-400 text-sm">–</span>
          <input
            type="date"
            value={to}
            onChange={e => { setTo(e.target.value); setCustom(true); setPreset('Custom') }}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
          />
          {custom && (
            <button
              onClick={applyCustom}
              className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Apply
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
            <StatCard
              label="Total Contacts"
              value={data.summary.total_contacts.toLocaleString()}
              sub={`+${data.summary.new_contacts} in range`}
            />
            <StatCard
              label="New Contacts"
              value={data.summary.new_contacts.toLocaleString()}
              sub="In selected period"
            />
            <StatCard
              label="Total Deals"
              value={data.summary.total_deals.toLocaleString()}
            />
            <StatCard
              label="Active Deals"
              value={data.summary.active_deals.toLocaleString()}
            />
            <StatCard
              label="Pipeline Value"
              value={currency(data.summary.pipeline_value)}
              sub="Active deals"
            />
            <StatCard
              label="Deals Closed"
              value={data.summary.closed_deals.toLocaleString()}
            />
            <StatCard
              label="Closed Value"
              value={currency(data.summary.closed_value)}
            />
          </div>

          {/* ── Monthly trend ── */}
          <MonthlyTrend months={data.monthly_trend} />

          {/* ── Breakdown grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <BreakdownTable
              title="By Lead Type"
              items={data.by_lead_type}
              showRange
              rangeLabel="new"
            />
            <BreakdownTable
              title="By Vertical"
              items={data.by_vertical}
              showRange
              rangeLabel="new"
            />
            <BreakdownTable
              title="By Lead Source"
              items={data.by_source.map(s => ({ source: s.source, count: s.count, count_range: s.count_range }))}
              showRange
              rangeLabel="new"
              colorDot={false}
            />
            <PipelineBreakdown
              pipelines={data.by_pipeline}
              unassigned={data.unassigned_deals}
            />
          </div>
        </>
      )}

      {!loading && !data && (
        <div className="text-center py-20 text-gray-400">
          <p>Failed to load report data.</p>
          <button
            onClick={() => fetchData(from, to)}
            className="mt-3 text-sm text-blue-600 underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
