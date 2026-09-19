'use client'

import { useState, useEffect, useCallback } from 'react'
import type { EconomicsDashboard } from '@/lib/billing/economicsService'
import type { ProviderWalletState } from '@/lib/billing/providerHealth'

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return '—'
  return `${pct}%`
}

function walletStateBadge(state: ProviderWalletState) {
  const cfg: Record<ProviderWalletState, { label: string; cls: string }> = {
    unknown:  { label: 'Unknown',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
    healthy:  { label: 'Healthy',  cls: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
    low:      { label: 'Low',      cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
    critical: { label: 'Critical', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
    depleted: { label: 'Depleted', cls: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  }
  const { label, cls } = cfg[state] ?? cfg.unknown
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

function callStatusBadge(status: string) {
  const depleted = status === 'depleted'
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
      depleted
        ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
        : status === 'healthy'
          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    }`}>{status}</span>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children, className = '', colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2 text-sm text-gray-700 dark:text-gray-300 ${className}`}>
      {children}
    </td>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminEconomicsClient() {
  const [data,   setData]   = useState<EconomicsDashboard | null>(null)
  const [period, setPeriod] = useState('current_month')
  const [loading, setLoading] = useState(true)
  const [error,  setError]  = useState<string | null>(null)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/economics?period=${p}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load economics data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(period) }, [load, period])

  const header = (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Economics Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Read-only. No mutations, no reservations, no credits consumed by this view.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          <option value="current_month">Current Month</option>
          <option value="last_30_days">Last 30 Days</option>
          <option value="last_60_days">Last 60 Days</option>
        </select>
        <button
          onClick={() => load(period)}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
    </div>
  )

  if (loading && !data) {
    return <div className="p-6">{header}<p className="text-gray-500 dark:text-gray-400">Loading…</p></div>
  }

  if (error) {
    return (
      <div className="p-6">
        {header}
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4">
          <p className="text-sm text-red-700 dark:text-red-300">Error: {error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-6 space-y-10 max-w-7xl">
      {header}

      {/* ── SECTION 1: PLATFORM ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Platform"
          subtitle={`${data.platform.period_start.slice(0, 10)} — ${data.platform.period_end.slice(0, 10)}`}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[
            { label: 'Active Accounts', value: data.platform.total_accounts.toLocaleString() },
            { label: 'Credits Available', value: data.platform.total_credits_available.toLocaleString() },
            { label: 'Credits Consumed (lifetime)', value: data.platform.total_credits_consumed.toLocaleString() },
            { label: 'Credits Purchased (period)', value: data.platform.total_credits_purchased.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr><Th>Plan</Th><Th>Active Accounts</Th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.platform.accounts_by_plan.map(p => (
                <tr key={p.plan_key}>
                  <Td><code className="text-xs">{p.plan_key}</code> — {p.display_name}</Td>
                  <Td>{p.count}</Td>
                </tr>
              ))}
              {data.platform.accounts_by_plan.length === 0 && (
                <tr><Td className="text-gray-400" colSpan={2 }>No active subscriptions</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SECTION 2: VENDOR SPEND ─────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Vendor Spend" subtitle="Pool utilization and per-provider/feature cost breakdown" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          {/* Pool utilization */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Pool Utilization</h3>
            <div className="space-y-2">
              {data.vendor_spend.pool_utilization.map(p => (
                <div key={p.pool_key} className="flex items-center gap-3">
                  <span className="text-xs w-40 text-gray-600 dark:text-gray-400 shrink-0">{p.display_name}</span>
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        p.utilization_pct >= 90 ? 'bg-red-500'
                        : p.utilization_pct >= 70 ? 'bg-yellow-500'
                        : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, p.utilization_pct)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right shrink-0">
                    {fmtCents(p.spent_cents)} / {fmtCents(p.limit_cents)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* By provider */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Provider</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr><Th>Provider</Th><Th>Cost</Th><Th>Calls</Th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.vendor_spend.by_provider.map(p => (
                    <tr key={p.provider_key}>
                      <Td><code className="text-xs">{p.provider_key}</code></Td>
                      <Td>{fmtCents(p.cost_cents)}</Td>
                      <Td>{p.call_count.toLocaleString()}</Td>
                    </tr>
                  ))}
                  {data.vendor_spend.by_provider.length === 0 && (
                    <tr><Td className="text-gray-400" colSpan={3 }>No vendor spend this period</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Total vendor cost this period: <strong>{fmtCents(data.vendor_spend.total_cost_cents)}</strong>
        </p>
      </section>

      {/* ── SECTION 3: FEATURE ECONOMICS ────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Feature Economics"
          subtitle="Per-feature call counts, cost, and cache performance. Recommended credit cost is advisory and may be null."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th>Feature</Th>
                <Th>Calls</Th>
                <Th>Cache Hit%</Th>
                <Th>Provider Calls</Th>
                <Th>Failed</Th>
                <Th>Total Vendor Cost</Th>
                <Th>Avg Cost/Call</Th>
                <Th>Expected Cost</Th>
                <Th>Credit Cost</Th>
                <Th>Recommended Credits</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.feature_economics.map(f => (
                <tr key={f.feature_key}>
                  <Td><code className="text-xs">{f.feature_key}</code></Td>
                  <Td>{f.total_calls.toLocaleString()}</Td>
                  <Td>{fmtPct(f.cache_hit_rate_pct)}</Td>
                  <Td>{f.provider_calls.toLocaleString()}</Td>
                  <Td>{f.failed_calls > 0
                    ? <span className="text-red-600 dark:text-red-400">{f.failed_calls}</span>
                    : '0'
                  }</Td>
                  <Td>{fmtCents(f.total_vendor_cost_cents)}</Td>
                  <Td>{fmtCents(f.avg_vendor_cost_cents)}</Td>
                  <Td>{fmtCents(f.expected_vendor_cost_cents)}</Td>
                  <Td>{f.customer_credit_cost ?? '—'}</Td>
                  <Td className="text-gray-400 dark:text-gray-500 italic">
                    {f.recommended_credit_cost ?? 'N/A — collecting data'}
                  </Td>
                </tr>
              ))}
              {data.feature_economics.length === 0 && (
                <tr><Td className="text-gray-400" colSpan={10 }>No feature usage this period</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SECTION 4: CUSTOMER ECONOMICS ───────────────────────────────────── */}
      <section>
        <SectionHeader title="Customer Economics" subtitle="Per-account vendor spend and credit consumption" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th>Account ID</Th>
                <Th>Plan</Th>
                <Th>Vendor Cost</Th>
                <Th>Cap</Th>
                <Th>Cap Used%</Th>
                <Th>Credits Consumed</Th>
                <Th>Calls</Th>
                <Th>Cache Hit%</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.customer_economics.slice(0, 50).map(c => (
                <tr key={c.account_id}>
                  <Td>
                    <code className="text-xs text-gray-500 dark:text-gray-400">
                      {c.account_id.slice(0, 8)}…
                    </code>
                  </Td>
                  <Td>{c.plan_key ?? '—'}</Td>
                  <Td>{fmtCents(c.vendor_cost_cents)}</Td>
                  <Td>{fmtCents(c.vendor_cap_cents)}</Td>
                  <Td>{c.cap_utilization_pct != null
                    ? <span className={c.cap_utilization_pct >= 80 ? 'text-orange-600 dark:text-orange-400 font-medium' : ''}>
                        {fmtPct(c.cap_utilization_pct)}
                      </span>
                    : '—'
                  }</Td>
                  <Td>{c.credits_consumed.toLocaleString()}</Td>
                  <Td>{c.call_count.toLocaleString()}</Td>
                  <Td>{fmtPct(c.cache_hit_rate_pct)}</Td>
                </tr>
              ))}
              {data.customer_economics.length === 0 && (
                <tr><Td className="text-gray-400" colSpan={8 }>No customer activity this period</Td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data.customer_economics.length > 50 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Showing top 50 of {data.customer_economics.length} accounts by vendor cost.
          </p>
        )}
      </section>

      {/* ── SECTION 5: PROVIDER HEALTH ───────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Provider Health"
          subtitle="Call-outcome status (from API responses) and wallet state (from manually entered balance). Independent signals."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th>Provider</Th>
                <Th>Call Status</Th>
                <Th>Wallet State</Th>
                <Th>Known Balance</Th>
                <Th>Owner Reserve</Th>
                <Th>Customer Usable</Th>
                <Th>Low Threshold</Th>
                <Th>Critical Threshold</Th>
                <Th>Balance Entered</Th>
                <Th>Last 402</Th>
                <Th>Last Refill Verified</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.provider_health.wallets.map(w => {
                const callStatus = data.provider_health.statuses.find(
                  s => s.provider_key === w.provider_key
                )
                return (
                  <tr key={w.provider_key}>
                    <Td><code className="text-xs">{w.provider_key}</code></Td>
                    <Td>{callStatus ? callStatusBadge(callStatus.current_status) : <span className="text-gray-400">—</span>}</Td>
                    <Td>{walletStateBadge(w.wallet_state)}</Td>
                    <Td>{fmtCents(w.known_balance_cents)}</Td>
                    <Td>{fmtCents(w.owner_reserve_cents)}</Td>
                    <Td>{fmtCents(w.customer_usable_cents)}</Td>
                    <Td>{fmtCents(w.low_balance_threshold_cents)}</Td>
                    <Td>{fmtCents(w.critical_balance_threshold_cents)}</Td>
                    <Td className="text-gray-400 dark:text-gray-500 text-xs">
                      {w.balance_entered_at ? new Date(w.balance_entered_at).toLocaleDateString() : '—'}
                    </Td>
                    <Td className="text-gray-400 dark:text-gray-500 text-xs">
                      {w.last_wallet_depleted_at
                        ? <span className="text-red-500">{new Date(w.last_wallet_depleted_at).toLocaleDateString()}</span>
                        : '—'
                      }
                    </Td>
                    <Td className="text-gray-400 dark:text-gray-500 text-xs">
                      {w.last_refill_verified_at ? new Date(w.last_refill_verified_at).toLocaleDateString() : '—'}
                    </Td>
                  </tr>
                )
              })}
              {data.provider_health.wallets.length === 0 && (
                <tr><Td className="text-gray-400" colSpan={11 }>No providers found</Td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          Wallet state is advisory — manually entered balances may be stale.
          Only HTTP 402 evidence sets Depleted status authoritatively.
          Use [Update Balance] and [Mark Refilled] buttons in the provider settings to manage.
        </p>
      </section>

      {/* ── SECTION 6: REVENUE ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Revenue" />
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">N/A — Stripe live mode not enabled</p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{data.revenue_note}</p>
        </div>
      </section>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Generated at {new Date(data.generated_at).toLocaleString()}
      </p>
    </div>
  )
}
