'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Pool {
  pool_key: string
  pool_name?: string | null
  monthly_limit_cents: number
  spent_this_period_cents: number
  remaining_cents: number
  utilization_pct: number
  is_protected: boolean
  is_active: boolean
}

interface ProviderStat {
  provider_key: string
  events: number
  cost_cents: number
  failures: number
}

interface UsageEvent {
  request_id: string
  account_id: string
  provider_key: string
  feature_key: string
  actual_cost_cents: number
  estimated_cost_cents: number
  duration_ms: number
  success: boolean
  error_code?: string
  cache_hit?: boolean
  created_at: string
}

interface Reservation {
  request_id: string
  account_id: string
  pool_key: string
  provider_key: string
  feature_key: string
  status: string
  estimated_cost_cents: number
  actual_cost_cents?: number
  expires_at?: string
  finalized_at?: string
  created_at: string
}

interface CustomerAccount {
  account_id: string
  status: string
  available_credits: number
  monthly_credits: number
  purchased_credits: number
  bonus_credits: number
  reserved_credits: number
  lifetime_consumed: number
  cap: {
    effective_cap_cents: number
    spent_this_period_cents: number
    plan_default_cap_cents: number
    override_cap_cents?: number | null
  } | null
}

interface ReservationState {
  budget:                Record<string, number>
  credit:                Record<string, number>
  stale_budget:          number
  stale_credit:          number
  drift_accounts:        number
  drift_credits:         number
  needs_reconciliation:  boolean
}

interface ProviderHealth {
  provider_key:   string
  current_status: 'healthy' | 'low_balance' | 'depleted' | 'rate_limited' | 'auth_failed' | 'server_error' | 'unknown'
  error_category?: string
  http_status?:   number
  detail?:        string
  last_event_at?: string
}

interface BillingData {
  generated_at: string
  pools: Pool[]
  provider_usage: {
    total_events: number
    total_cost_cents: number
    by_provider: ProviderStat[]
    error?: string
  }
  recent_events: UsageEvent[]
  recent_reservations: Reservation[]
  active_reservations: { count: number; total_reserved_cents: number }
  customer_accounts: CustomerAccount[]
  credit_overview: {
    total_wallets: number
    total_available: number
    total_reserved: number
    error?: string
  }
  reservation_state: ReservationState | null
  provider_health: ProviderHealth[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function c$(cents?: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function num(n?: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

function shortId(id?: string): string {
  return id ? id.slice(0, 8) + '…' : '—'
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── Small components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: 'var(--c-text-3)', marginBottom: 12,
    }}>{children}</p>
  )
}

function Card({
  label, value, sub, status = 'neutral',
}: { label: string; value: string | number; sub?: string; status?: 'ok' | 'warn' | 'error' | 'neutral' }) {
  const colors = {
    ok:      { bg: 'rgba(74,207,154,0.08)',  border: 'rgba(74,207,154,0.2)',  dot: '#4ACF9A' },
    warn:    { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  dot: '#f59e0b' },
    error:   { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   dot: '#ef4444' },
    neutral: { bg: 'var(--c-card)',           border: 'var(--c-border)',       dot: 'var(--c-text-3)' },
  }
  const c = colors[status]
  return (
    <div style={{ backgroundColor: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: c.dot, flexShrink: 0, marginTop: 2 }} />
      </div>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-primary)', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>{sub}</p>}
    </div>
  )
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
      {children}
    </div>
  )
}

function ProgressBar({ pct, status }: { pct: number; status: 'ok' | 'warn' | 'error' }) {
  const colors = { ok: '#4ACF9A', warn: '#f59e0b', error: '#ef4444' }
  return (
    <div style={{ height: 4, borderRadius: 2, backgroundColor: 'var(--c-border)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{
        height: '100%', width: `${Math.min(100, pct)}%`,
        backgroundColor: colors[status], borderRadius: 2, transition: 'width 0.3s ease',
      }} />
    </div>
  )
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        {children}
      </table>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      textAlign: right ? 'right' : 'left', padding: '6px 10px',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-3)',
      borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td style={{
      textAlign: right ? 'right' : 'left', padding: '7px 10px',
      color: 'var(--c-primary)', borderBottom: '1px solid var(--c-border)',
      fontVariantNumeric: 'tabular-nums', fontFamily: mono ? 'monospace' : undefined,
      fontSize: mono ? 11 : 12, whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}

function StatusBadge({ ok, text }: { ok: boolean; text?: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      backgroundColor: ok ? 'rgba(74,207,154,0.12)' : 'rgba(239,68,68,0.12)',
      color: ok ? '#4ACF9A' : '#ef4444',
    }}>{text ?? (ok ? 'OK' : 'FAIL')}</span>
  )
}

// ── Provider Health Section ────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<string, {
  label: string
  style: 'ok' | 'warn' | 'error' | 'neutral'
  bg: string; border: string; dot: string
}> = {
  healthy:      { label: 'Healthy',      style: 'ok',      bg: 'rgba(74,207,154,0.08)',  border: 'rgba(74,207,154,0.2)',  dot: '#4ACF9A' },
  low_balance:  { label: 'Low Balance',  style: 'warn',    bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  dot: '#f59e0b' },
  depleted:     { label: 'Depleted',     style: 'error',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',  dot: '#ef4444' },
  rate_limited: { label: 'Rate Limited', style: 'warn',    bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  dot: '#f59e0b' },
  auth_failed:  { label: 'Auth Failed',  style: 'error',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',  dot: '#ef4444' },
  server_error: { label: 'Server Error', style: 'error',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',  dot: '#ef4444' },
  unknown:      { label: 'Unknown',      style: 'neutral', bg: 'var(--c-card)',           border: 'var(--c-border)',       dot: 'var(--c-text-3)' },
}

function ProviderHealthSection({ items }: { items: ProviderHealth[] }) {
  if (items.length === 0) return null

  return (
    <div>
      <SectionTitle>Provider Wallet Health</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {items.map(item => {
          const cfg = HEALTH_CONFIG[item.current_status] ?? HEALTH_CONFIG.unknown
          return (
            <div key={item.provider_key} style={{
              padding: '14px 16px', borderRadius: 10,
              backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)', fontFamily: 'monospace' }}>
                    {item.provider_key}
                  </span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  backgroundColor: cfg.bg, color: cfg.dot, border: `1px solid ${cfg.border}`,
                }}>{cfg.label}</span>
              </div>
              {item.http_status && (
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 2 }}>
                  HTTP {item.http_status}
                  {item.error_category && <span style={{ marginLeft: 6, fontFamily: 'monospace' }}>{item.error_category}</span>}
                </div>
              )}
              {item.detail && (
                <div style={{
                  fontSize: 11, color: cfg.style === 'error' ? '#ef4444' : 'var(--c-text-3)',
                  marginTop: 4, lineHeight: 1.4, maxWidth: 280,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={item.detail}>{item.detail}</div>
              )}
              {item.last_event_at && (
                <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginTop: 8 }}>
                  Last event: {relTime(item.last_event_at)}
                </div>
              )}
              {item.current_status === 'depleted' && (
                <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6, backgroundColor: 'rgba(239,68,68,0.1)', fontSize: 11, color: '#ef4444', lineHeight: 1.4 }}>
                  Fund vendor wallet to restore service
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Pool Section ───────────────────────────────────────────────────────────────

function PoolsSection({ pools }: { pools: Pool[] }) {
  return (
    <div>
      <SectionTitle>API Budget Pools — This Month</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pools.map(pool => {
          const status: 'ok' | 'warn' | 'error' =
            !pool.is_active ? 'error'
            : pool.utilization_pct >= 90 ? 'error'
            : pool.utilization_pct >= 70 ? 'warn'
            : 'ok'
          return (
            <div key={pool.pool_key} style={{
              padding: '14px 16px', borderRadius: 10,
              backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-primary)' }}>
                      {pool.pool_name ?? pool.pool_key}
                    </span>
                    {pool.is_protected && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                        backgroundColor: 'rgba(245,158,11,0.15)', color: '#f59e0b', letterSpacing: '0.06em',
                      }}>PROTECTED</span>
                    )}
                    {!pool.is_active && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                        backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', letterSpacing: '0.06em',
                      }}>INACTIVE</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--c-text-3)', fontFamily: 'monospace' }}>{pool.pool_key}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-primary)' }}>{c$(pool.spent_this_period_cents)}</span>
                  <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}> / {c$(pool.monthly_limit_cents)}</span>
                </div>
              </div>
              <ProgressBar pct={pool.utilization_pct} status={status} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{pool.utilization_pct}% used</span>
                <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{c$(pool.remaining_cents)} remaining</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Provider Usage ─────────────────────────────────────────────────────────────

function ProviderSection({ usage, reservations }: {
  usage: BillingData['provider_usage']
  reservations: BillingData['active_reservations']
}) {
  if (usage.error) return (
    <div><SectionTitle>Provider Usage</SectionTitle>
      <p style={{ color: '#ef4444', fontSize: 12 }}>{usage.error}</p></div>
  )
  return (
    <div>
      <SectionTitle>Provider Usage — This Month</SectionTitle>
      <CardGrid>
        <Card label="Total Spend"     value={c$(usage.total_cost_cents)}     sub={`${num(usage.total_events)} events`} status={usage.total_cost_cents > 0 ? 'ok' : 'neutral'} />
        <Card label="Active Holds"    value={num(reservations.count)}         sub={`${c$(reservations.total_reserved_cents)} reserved`} status="neutral" />
        {usage.by_provider.map(p => (
          <Card
            key={p.provider_key}
            label={p.provider_key.toUpperCase()}
            value={c$(p.cost_cents)}
            sub={`${num(p.events)} calls · ${num(p.failures)} failed`}
            status={p.failures > 0 ? 'warn' : 'ok'}
          />
        ))}
      </CardGrid>
    </div>
  )
}

// ── Recent Usage Events ─────────────────────────────────────────────────────────

function EventsTable({ events }: { events: UsageEvent[] }) {
  return (
    <div>
      <SectionTitle>Recent Usage Events</SectionTitle>
      {events.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>No events this period.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Account</Th>
              <Th>Provider</Th>
              <Th>Feature</Th>
              <Th right>Cost</Th>
              <Th right>Duration</Th>
              <Th>Status</Th>
              <Th>Cache</Th>
              <Th>Time</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <Td mono>{shortId(e.request_id)}</Td>
                <Td mono>{shortId(e.account_id)}</Td>
                <Td>{e.provider_key}</Td>
                <Td>{e.feature_key}</Td>
                <Td right>{c$(e.actual_cost_cents)}</Td>
                <Td right>{e.duration_ms ? `${e.duration_ms}ms` : '—'}</Td>
                <Td><StatusBadge ok={e.success} text={e.success ? 'OK' : (e.error_code ?? 'ERR')} /></Td>
                <Td><StatusBadge ok={!!e.cache_hit} text={e.cache_hit ? 'HIT' : 'MISS'} /></Td>
                <Td>{relTime(e.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

// ── Reservations ───────────────────────────────────────────────────────────────

function ReservationsTable({ reservations }: { reservations: Reservation[] }) {
  return (
    <div>
      <SectionTitle>Recent Reservations</SectionTitle>
      {reservations.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>No recent reservations.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Account</Th>
              <Th>Pool</Th>
              <Th>Provider</Th>
              <Th>Status</Th>
              <Th right>Estimated</Th>
              <Th right>Actual</Th>
              <Th>Time</Th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r, i) => {
              const statusColor =
                r.status === 'reserved' ? '#f59e0b'
                : r.status === 'finalized' ? '#4ACF9A'
                : '#ef4444'
              return (
                <tr key={i}>
                  <Td mono>{shortId(r.request_id)}</Td>
                  <Td mono>{shortId(r.account_id)}</Td>
                  <Td mono>{r.pool_key}</Td>
                  <Td>{r.provider_key}</Td>
                  <Td>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      backgroundColor: `${statusColor}1a`, color: statusColor, letterSpacing: '0.05em',
                    }}>{r.status.toUpperCase()}</span>
                  </Td>
                  <Td right>{c$(r.estimated_cost_cents)}</Td>
                  <Td right>{r.actual_cost_cents != null ? c$(r.actual_cost_cents) : '—'}</Td>
                  <Td>{relTime(r.created_at)}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

// ── Customer Accounts ──────────────────────────────────────────────────────────

function CustomerAccountsTable({ accounts }: { accounts: CustomerAccount[] }) {
  return (
    <div>
      <SectionTitle>Customer Accounts ({num(accounts.length)})</SectionTitle>
      {accounts.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>No customer accounts found.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Account ID</Th>
              <Th>Status</Th>
              <Th right>Available Credits</Th>
              <Th right>Monthly</Th>
              <Th right>Purchased</Th>
              <Th right>Bonus</Th>
              <Th right>Reserved</Th>
              <Th right>Lifetime Used</Th>
              <Th right>Vendor Cap</Th>
              <Th right>Vendor Spent</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => {
              const vendorPct = a.cap && a.cap.effective_cap_cents > 0
                ? Math.round((a.cap.spent_this_period_cents / a.cap.effective_cap_cents) * 100) : 0
              return (
                <tr key={i}>
                  <Td mono>{shortId(a.account_id)}</Td>
                  <Td><StatusBadge ok={a.status === 'active'} text={a.status.toUpperCase()} /></Td>
                  <Td right>{num(a.available_credits)}</Td>
                  <Td right>{num(a.monthly_credits)}</Td>
                  <Td right>{num(a.purchased_credits)}</Td>
                  <Td right>{num(a.bonus_credits)}</Td>
                  <Td right>{num(a.reserved_credits)}</Td>
                  <Td right>{num(a.lifetime_consumed)}</Td>
                  <Td right>{a.cap ? c$(a.cap.effective_cap_cents) : '—'}</Td>
                  <Td right>
                    {a.cap ? (
                      <span style={{ color: vendorPct >= 90 ? '#ef4444' : vendorPct >= 70 ? '#f59e0b' : undefined }}>
                        {c$(a.cap.spent_this_period_cents)} ({vendorPct}%)
                      </span>
                    ) : '—'}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

// ── Reconciliation Panel ───────────────────────────────────────────────────────

interface ClassifiedRes {
  request_id:           string
  category:             'A' | 'B' | 'C'
  category_reason:      string
  proposed_action:      string
  estimated_cost_cents: number
  reserved_credits:     number
  expires_at:           string
}

interface ReconcilePreview {
  previewed_at:                string
  total_stale_budget:          number
  total_stale_credit:          number
  category_A:                  number
  category_B:                  number
  category_C:                  number
  credits_to_release:          number
  credits_to_consume:          number
  current_reserved_credits:    number
  current_pool_spend_cents:    Record<string, number>
  current_account_spend_cents: Record<string, number>
  expected_reserved_credits:   number
  expected_pool_spend_cents:   Record<string, number>
  expected_account_spend_cents:Record<string, number>
  classified:                  ClassifiedRes[]
  is_safe:                     boolean
  safety_notes:                string[]
  error?: string
}

interface ReconcileVerification {
  verified_at:                               string
  reserved_credits_match_active:             boolean
  no_stale_in_flight:                        boolean
  no_successful_call_accidentally_released:  boolean
  remaining_needs_review:                    number
  remaining_drift:                           number
  issues:                                    string[]
}

interface ReconcileRunResult {
  run_at:                  string
  category_A_processed:    number
  category_B_processed:    number
  category_C_needs_review: number
  drift_corrected:         number
  errors:                  string[]
}

function ReconcileSection({ state }: { state: ReservationState | null }) {
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview]       = useState<ReconcilePreview | null>(null)
  const [running, setRunning]       = useState(false)
  const [runResult, setRunResult]   = useState<{ result: ReconcileRunResult; verification: ReconcileVerification } | null>(null)
  const [runError, setRunError]     = useState('')

  const loadPreview = async () => {
    setPreviewing(true); setPreview(null); setRunResult(null); setRunError('')
    try {
      const res = await fetch('/api/admin/reconcile')
      const json = await res.json()
      setPreview(json)
    } catch (e) {
      setPreview({ previewed_at: '', total_stale_budget: 0, total_stale_credit: 0, category_A: 0, category_B: 0, category_C: 0, credits_to_release: 0, credits_to_consume: 0, current_reserved_credits: 0, current_pool_spend_cents: {}, current_account_spend_cents: {}, expected_reserved_credits: 0, expected_pool_spend_cents: {}, expected_account_spend_cents: {}, classified: [], is_safe: false, safety_notes: [], error: String(e) })
    } finally {
      setPreviewing(false)
    }
  }

  const run = async () => {
    setRunning(true); setRunResult(null); setRunError('')
    try {
      const res = await fetch('/api/admin/reconcile', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) { setRunError(json.error ?? 'Unknown error'); return }
      setRunResult(json)
    } catch (e) {
      setRunError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const needsAction = state?.needs_reconciliation ?? false
  const staleB      = state?.stale_budget ?? 0
  const staleC      = state?.stale_credit ?? 0
  const drift       = state?.drift_credits ?? 0

  const canRun = preview?.is_safe === true && !running

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle>Reservation Health &amp; Reconciliation</SectionTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={loadPreview} disabled={previewing || running}
            style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)',
              border: '1px solid var(--c-border)',
              cursor: (previewing || running) ? 'wait' : 'pointer',
              opacity: (previewing || running) ? 0.6 : 1,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
            {previewing ? 'Loading…' : 'Preview'}
          </button>
          <button
            onClick={run} disabled={!canRun}
            title={!preview ? 'Run Preview first' : !preview.is_safe ? 'Preview is unsafe — check safety notes' : ''}
            style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              backgroundColor: canRun ? (needsAction ? 'rgba(245,158,11,0.15)' : 'rgba(74,207,154,0.1)') : 'var(--c-hover)',
              color: canRun ? (needsAction ? '#f59e0b' : '#4ACF9A') : 'var(--c-text-3)',
              border: `1px solid ${canRun ? (needsAction ? 'rgba(245,158,11,0.3)' : 'rgba(74,207,154,0.25)') : 'var(--c-border)'}`,
              cursor: canRun ? 'pointer' : 'not-allowed', opacity: running ? 0.6 : 1,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
            {running ? 'Running…' : 'Run Reconciliation'}
          </button>
        </div>
      </div>

      {/* Current health snapshot */}
      {state && (
        <CardGrid>
          <Card
            label="Stale Budget Res."
            value={num(staleB)}
            sub="reserved + expired"
            status={staleB === 0 ? 'ok' : 'error'}
          />
          <Card
            label="Stale Credit Res."
            value={num(staleC)}
            sub="reserved + expired"
            status={staleC === 0 ? 'ok' : 'error'}
          />
          <Card
            label="Credit Drift"
            value={drift > 0 ? `+${drift}` : String(drift)}
            sub={`across ${state.drift_accounts} account${state.drift_accounts !== 1 ? 's' : ''}`}
            status={drift === 0 ? 'ok' : 'warn'}
          />
          <Card
            label="Budget by Status"
            value={num((state.budget.reserved ?? 0) + (state.budget.finalized ?? 0) + (state.budget.released ?? 0) + (state.budget.expired ?? 0))}
            sub={`${state.budget.reserved ?? 0} in-flight · ${state.budget.finalized ?? 0} final`}
            status="neutral"
          />
        </CardGrid>
      )}

      {/* Preview panel */}
      {preview && (
        <div style={{ marginTop: 16 }}>
          {preview.error ? (
            <div style={{ padding: '10px 14px', borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: '#ef4444' }}>
              Preview error: {preview.error}
            </div>
          ) : (
            <div style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--c-card)', border: `1px solid ${preview.is_safe ? 'var(--c-border)' : 'rgba(239,68,68,0.3)'}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-3)', marginBottom: 10 }}>
                Reconciliation Preview — {preview.total_stale_budget} stale reservation{preview.total_stale_budget !== 1 ? 's' : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
                <Card label="Category A (release)" value={num(preview.category_A)} sub="no usage event" status={preview.category_A > 0 ? 'warn' : 'ok'} />
                <Card label="Category B (finalize)" value={num(preview.category_B)} sub="successful call" status={preview.category_B > 0 ? 'warn' : 'ok'} />
                <Card label="Category C (review)" value={num(preview.category_C)} sub="ambiguous outcome" status={preview.category_C > 0 ? 'error' : 'ok'} />
                <Card label="Credits to Release" value={num(preview.credits_to_release)} sub="from Category A" status={preview.credits_to_release > 0 ? 'warn' : 'ok'} />
                <Card label="Credits to Consume" value={num(preview.credits_to_consume)} sub="from Category B" status={preview.credits_to_consume > 0 ? 'warn' : 'ok'} />
                <Card label="Expected Reserved" value={num(preview.expected_reserved_credits)} sub={`from ${num(preview.current_reserved_credits)} now`} status="neutral" />
              </div>
              {/* Pool spend changes */}
              {Object.keys(preview.expected_pool_spend_cents).length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 8 }}>
                  {Object.entries(preview.expected_pool_spend_cents).map(([k, v]) => {
                    const curr = preview.current_pool_spend_cents[k] ?? 0
                    const delta = v - curr
                    return (
                      <span key={k} style={{ marginRight: 16 }}>
                        Pool <code style={{ fontFamily: 'monospace' }}>{k}</code>: {c$(curr)} → {c$(v)}{' '}
                        <span style={{ color: delta < 0 ? '#4ACF9A' : delta > 0 ? '#f59e0b' : 'inherit' }}>
                          ({delta >= 0 ? '+' : ''}{c$(delta)})
                        </span>
                      </span>
                    )
                  })}
                </div>
              )}
              {/* Safety notes */}
              {preview.safety_notes.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {preview.safety_notes.map((note, i) => (
                    <div key={i} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, marginBottom: 4,
                      backgroundColor: note.startsWith('UNSAFE') ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                      color: note.startsWith('UNSAFE') ? '#ef4444' : '#f59e0b',
                    }}>
                      {note.startsWith('UNSAFE') ? '⛔ ' : '⚠️ '}{note}
                    </div>
                  ))}
                </div>
              )}
              {/* Classified list */}
              {preview.classified.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: 'var(--c-text-3)', cursor: 'pointer', userSelect: 'none' }}>
                    Show {preview.classified.length} classified reservation{preview.classified.length !== 1 ? 's' : ''}
                  </summary>
                  <div style={{ marginTop: 8, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          {['Request', 'Cat', 'Est. Cost', 'Credits', 'Action'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-3)', borderBottom: '1px solid var(--c-border)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.classified.map((r, i) => {
                          const catColor = r.category === 'A' ? '#f59e0b' : r.category === 'B' ? '#4ACF9A' : '#ef4444'
                          return (
                            <tr key={i}>
                              <td style={{ padding: '5px 8px', fontFamily: 'monospace', borderBottom: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>{r.request_id.slice(0, 12)}…</td>
                              <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--c-border)' }}>
                                <span style={{ fontWeight: 700, color: catColor }}>{r.category}</span>
                              </td>
                              <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-primary)', fontVariantNumeric: 'tabular-nums' }}>{c$(r.estimated_cost_cents)}</td>
                              <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-primary)', fontVariantNumeric: 'tabular-nums' }}>{num(r.reserved_credits)}</td>
                              <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-text-3)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.proposed_action}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {preview.total_stale_budget === 0 && (
                <p style={{ fontSize: 12, color: '#4ACF9A', marginTop: 4 }}>No stale reservations — nothing to reconcile.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Run result + verification */}
      {runError && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: '#ef4444' }}>
          Reconciliation error: {runError}
        </div>
      )}
      {runResult && (
        <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-3)', marginBottom: 10 }}>
            Reconciliation Complete — {new Date(runResult.result.run_at).toLocaleTimeString()}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 12, color: 'var(--c-primary)', marginBottom: 12 }}>
            <span style={{ color: runResult.result.category_A_processed > 0 ? '#f59e0b' : '#4ACF9A' }}>
              A processed (released): {runResult.result.category_A_processed}
            </span>
            <span style={{ color: runResult.result.category_B_processed > 0 ? '#f59e0b' : '#4ACF9A' }}>
              B processed (finalized): {runResult.result.category_B_processed}
            </span>
            <span style={{ color: runResult.result.category_C_needs_review > 0 ? '#ef4444' : '#4ACF9A' }}>
              C needs review: {runResult.result.category_C_needs_review}
            </span>
            <span style={{ color: runResult.result.drift_corrected > 0 ? '#f59e0b' : '#4ACF9A' }}>
              Drift corrected: {runResult.result.drift_corrected}
            </span>
            {runResult.result.errors.length > 0 && (
              <span style={{ color: '#ef4444' }}>Errors: {runResult.result.errors.length}</span>
            )}
          </div>
          {/* Verification */}
          <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-3)', marginBottom: 6 }}>
              Verification
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11 }}>
              {[
                { label: 'Credits match active', ok: runResult.verification.reserved_credits_match_active },
                { label: 'No stale in-flight', ok: runResult.verification.no_stale_in_flight },
                { label: 'No accidental refunds', ok: runResult.verification.no_successful_call_accidentally_released },
                { label: `Needs review: ${runResult.verification.remaining_needs_review}`, ok: runResult.verification.remaining_needs_review === 0 },
                { label: `Drift: ${runResult.verification.remaining_drift}`, ok: runResult.verification.remaining_drift === 0 },
              ].map(({ label, ok }) => (
                <span key={label} style={{ color: ok ? '#4ACF9A' : '#ef4444' }}>
                  {ok ? '✓' : '✗'} {label}
                </span>
              ))}
            </div>
            {runResult.verification.issues.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {runResult.verification.issues.map((issue, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#ef4444', padding: '2px 0' }}>⚠ {issue}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdminBillingClient() {
  const [data, setData]     = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [age, setAge]       = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/billing')
      if (res.status === 403) { setError('Access denied.'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setAge(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => setAge(a => a + 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div style={{ color: 'var(--c-primary)', padding: '24px 28px', maxWidth: 1280 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a href="/admin" style={{ color: 'var(--c-text-3)', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>Admin</a>
            <span style={{ color: 'var(--c-text-3)' }}>/</span>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Billing Dashboard</h1>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
              backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.25)', letterSpacing: '0.08em',
            }}>OWNER ONLY</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 2 }}>
            {loading ? 'Loading…' : data ? `Refreshed ${age}s ago · ${new Date(data.generated_at).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          onClick={load} disabled={loading}
          style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)',
            border: '1px solid var(--c-border)', cursor: 'pointer', opacity: loading ? 0.5 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
          <svg style={{ width: 14, height: 14, animation: loading ? 'spin 1s linear infinite' : undefined }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {error && <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 20 }}>{error}</div>}

      {loading && !data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: 74, borderRadius: 10, backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', opacity: 0.5 }} />
          ))}
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

          {/* Credit Summary */}
          <div>
            <SectionTitle>Platform Credits</SectionTitle>
            <CardGrid>
              <Card
                label="Available Credits"
                value={num(data.credit_overview.total_available)}
                sub={`across ${num(data.credit_overview.total_wallets)} wallets`}
                status={data.credit_overview.total_available === 0 ? 'error' : 'ok'}
              />
              <Card
                label="Reserved Credits"
                value={num(data.credit_overview.total_reserved)}
                sub={data.reservation_state?.drift_credits ? `drift: +${data.reservation_state.drift_credits}` : 'in-flight'}
                status={data.reservation_state?.drift_credits ? 'warn' : data.credit_overview.total_reserved > 50 ? 'warn' : 'neutral'}
              />
              <Card
                label="Active Reservations"
                value={num(data.active_reservations.count)}
                sub={`${c$(data.active_reservations.total_reserved_cents)} held`}
                status="neutral"
              />
              <Card
                label="Customer Accounts"
                value={num(data.customer_accounts.length)}
                status="neutral"
              />
            </CardGrid>
          </div>

          {/* Provider Wallet Health */}
          {data.provider_health?.length > 0 && <ProviderHealthSection items={data.provider_health} />}

          {/* Budget Pools */}
          {data.pools.length > 0 && <PoolsSection pools={data.pools} />}

          {/* Provider Usage */}
          <ProviderSection usage={data.provider_usage} reservations={data.active_reservations} />

          {/* Customer Accounts Table */}
          <CustomerAccountsTable accounts={data.customer_accounts} />

          {/* Reconciliation Health */}
          <ReconcileSection state={data.reservation_state} />

          {/* Recent Events */}
          <EventsTable events={data.recent_events} />

          {/* Recent Reservations */}
          <ReservationsTable reservations={data.recent_reservations} />

        </div>
      )}
    </div>
  )
}
