'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdminStats {
  generated_at: string
  db: Record<string, number> & { error?: string }
  twilio: {
    sms_outbound_today?: { count: number; cost: number }
    sms_inbound_today?:  { count: number; cost: number }
    sms_outbound_month?: { count: number; cost: number }
    sms_inbound_month?:  { count: number; cost: number }
    total_cost_today?:   number
    total_cost_month?:   number
    error?: string
  } | null
  jobs: {
    last_enrichment?: string | null
    enriched_today?: number
    last_distress_ingest?: string | null
    distress_today?: number
    failed_sms_today?: number
    error?: string
  }
  gmail: { email?: string; expires_at?: string; updated_at?: string }[]
  sms: {
    outbound_30d?: number
    inbound_30d?:  number
    failed_30d?:   number
    ai_replies_30d?: number
    error?: string
  }
  env: Record<string, boolean>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmt$(n: number | undefined): string {
  if (n == null) return '—'
  return `$${n.toFixed(4)}`
}

function fmtNum(n: number | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--c-text-3)', marginBottom: 10,
      }}>{title}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function StatCard({
  label, value, sub, status = 'neutral',
}: {
  label: string
  value: string | number
  sub?: string
  status?: 'ok' | 'warn' | 'error' | 'neutral'
}) {
  const colors = {
    ok:      { bg: 'rgba(74,207,154,0.08)',  border: 'rgba(74,207,154,0.2)',  dot: '#4ACF9A' },
    warn:    { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  dot: '#f59e0b' },
    error:   { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   dot: '#ef4444' },
    neutral: { bg: 'var(--c-card)',           border: 'var(--c-border)',       dot: 'var(--c-text-3)' },
  }
  const c = colors[status]
  return (
    <div style={{
      backgroundColor: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: c.dot, flexShrink: 0 }} />
      </div>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-primary)', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>{sub}</p>}
    </div>
  )
}

function EnvRow({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '7px 12px', borderRadius: 8,
      backgroundColor: ok ? 'rgba(74,207,154,0.06)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${ok ? 'rgba(74,207,154,0.15)' : 'rgba(239,68,68,0.15)'}`,
    }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-primary)', fontFamily: 'monospace' }}>{name}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: ok ? '#4ACF9A' : '#ef4444' }}>
        {ok ? 'SET' : 'MISSING'}
      </span>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdminClient() {
  const [stats, setStats]     = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [age, setAge]         = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/stats')
      if (res.status === 403) { setError('Access denied.'); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStats(await res.json())
      setAge(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Tick age counter every second
  useEffect(() => {
    const t = setInterval(() => setAge(a => a + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  if (error) {
    return (
      <div style={{ padding: 32, color: '#ef4444', fontSize: 14 }}>{error}</div>
    )
  }

  return (
    <div style={{ color: 'var(--c-primary)', padding: '24px 28px', maxWidth: 1200 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>System Admin</h1>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
              backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.25)', letterSpacing: '0.08em',
            }}>OWNER ONLY</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 2 }}>
            {loading ? 'Loading…' : stats ? `Refreshed ${age}s ago · ${new Date(stats.generated_at).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)',
            border: '1px solid var(--c-border)', cursor: 'pointer', opacity: loading ? 0.5 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {loading && !stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{ height: 74, borderRadius: 10, backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', opacity: 0.5 }} />
          ))}
        </div>
      )}

      {stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* ── Database ── */}
          <Section title="Database">
            <StatCard label="Contacts"       value={fmtNum(stats.db.contacts)}        status="neutral" />
            <StatCard label="Deals"          value={fmtNum(stats.db.deals)}           status="neutral" />
            <StatCard label="Leads (DB)"     value={fmtNum(stats.db.leads)}           status="neutral" />
            <StatCard label="Properties"     value={fmtNum(stats.db.properties)}      status="neutral" />
            <StatCard label="Scraper Leads"  value={fmtNum(stats.db.scraper_leads)}   status="neutral" />
            <StatCard label="SMS Messages"   value={fmtNum(stats.db.messages)}        status="neutral" />
            <StatCard label="Communications" value={fmtNum(stats.db.communications)}  status="neutral" />
            <StatCard label="Distress Filings" value={fmtNum(stats.db.distress_filings)} status="neutral" />
            <StatCard label="Cache (valid)"  value={fmtNum(stats.db.cache_valid)}     status={stats.db.cache_valid > 0 ? 'ok' : 'neutral'} sub="active entries" />
            <StatCard label="Cache (expired)" value={fmtNum(stats.db.cache_expired)} status={stats.db.cache_expired > 50 ? 'warn' : 'neutral'} sub="to be pruned" />
            <StatCard label="OAuth Tokens"   value={fmtNum(stats.db.oauth_tokens)}    status={stats.db.oauth_tokens > 0 ? 'ok' : 'neutral'} sub="connected accounts" />
          </Section>

          {/* ── Platform Config ── */}
          <div>
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--c-text-3)', marginBottom: 10,
            }}>Platform Configuration</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { label: 'Lead Types',         href: '/admin/lead-types',  desc: 'Manage lead categories'     },
                { label: 'Business Verticals', href: '/admin/verticals',   desc: 'Manage business lines'      },
                { label: 'Pipelines',          href: '/admin/pipelines',   desc: 'Configure deal pipelines'   },
                { label: 'User Management',    href: '/admin/users',       desc: 'Invite & manage users'      },
              ].map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  style={{
                    padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
                    color: 'var(--c-primary)', textDecoration: 'none', minWidth: 180,
                    display: 'block',
                  }}
                >
                  {item.label}
                  <div style={{ fontSize: 11, color: 'var(--c-text-2)', fontWeight: 400, marginTop: 2 }}>{item.desc}</div>
                </a>
              ))}
            </div>
          </div>

          {/* ── Twilio / SMS ── */}
          <Section title="Twilio SMS">
            {stats.twilio?.error ? (
              <StatCard label="Twilio" value="Error" sub={stats.twilio.error} status="error" />
            ) : stats.twilio ? (
              <>
                <StatCard label="Outbound Today"  value={fmtNum(stats.twilio.sms_outbound_today?.count)} sub={fmt$(stats.twilio.sms_outbound_today?.cost)} status="neutral" />
                <StatCard label="Inbound Today"   value={fmtNum(stats.twilio.sms_inbound_today?.count)}  sub="received" status="neutral" />
                <StatCard label="Cost Today"      value={fmt$(stats.twilio.total_cost_today)}             status={stats.twilio.total_cost_today! > 1 ? 'warn' : 'ok'} />
                <StatCard label="Outbound Month"  value={fmtNum(stats.twilio.sms_outbound_month?.count)} sub={fmt$(stats.twilio.sms_outbound_month?.cost)} status="neutral" />
                <StatCard label="Inbound Month"   value={fmtNum(stats.twilio.sms_inbound_month?.count)}  sub="received" status="neutral" />
                <StatCard label="Cost This Month" value={fmt$(stats.twilio.total_cost_month)}             status={stats.twilio.total_cost_month! > 10 ? 'warn' : 'ok'} />
              </>
            ) : (
              <StatCard label="Twilio" value="Not configured" status="error" />
            )}
          </Section>

          {/* ── SMS Health (30 days) ── */}
          <Section title="SMS Health — 30 Days">
            <StatCard label="Sent"       value={fmtNum(stats.sms.outbound_30d)} status="neutral" />
            <StatCard label="Received"   value={fmtNum(stats.sms.inbound_30d)}  status="neutral" />
            <StatCard label="Failed"     value={fmtNum(stats.sms.failed_30d)}   status={stats.sms.failed_30d! > 5 ? 'error' : stats.sms.failed_30d! > 0 ? 'warn' : 'ok'} sub="delivery failures" />
            <StatCard label="AI Replies" value={fmtNum(stats.sms.ai_replies_30d)} status="neutral" sub="AI suggested" />
            <StatCard label="Failed Today" value={fmtNum(stats.jobs.failed_sms_today)} status={stats.jobs.failed_sms_today! > 0 ? 'warn' : 'ok'} />
          </Section>

          {/* ── Gmail ── */}
          <Section title="Gmail Integration">
            {stats.gmail.length === 0 ? (
              <StatCard label="Gmail" value="Not connected" status="warn" sub="Go to Settings to connect" />
            ) : (
              stats.gmail.map((g, i) => (
                <StatCard
                  key={i}
                  label={`Gmail Account ${i + 1}`}
                  value={g.email ?? 'Unknown'}
                  sub={`Updated ${timeAgo(g.updated_at)}`}
                  status={g.expires_at && new Date(g.expires_at) < new Date() ? 'warn' : 'ok'}
                />
              ))
            )}
          </Section>

          {/* ── Background Jobs ── */}
          <Section title="Background Jobs">
            <StatCard
              label="Last Enrichment"
              value={timeAgo(stats.jobs.last_enrichment)}
              sub={`${fmtNum(stats.jobs.enriched_today)} enriched today`}
              status={!stats.jobs.last_enrichment ? 'warn' : 'neutral'}
            />
            <StatCard
              label="Last Distress Ingest"
              value={timeAgo(stats.jobs.last_distress_ingest)}
              sub={`${fmtNum(stats.jobs.distress_today)} added today`}
              status={!stats.jobs.last_distress_ingest ? 'warn' : 'neutral'}
            />
          </Section>

          {/* ── API / External Services ── */}
          <Section title="API Usage Notes">
            <StatCard label="REAPI" value="See Console" sub="nextkeyps.reapi.com" status="neutral" />
            <StatCard label="Rentcast" value="See Console" sub="app.rentcast.io" status="neutral" />
            <StatCard label="Google Maps" value="See Console" sub="console.cloud.google.com" status="neutral" />
            <StatCard label="Anthropic AI" value="See Console" sub="console.anthropic.com" status="neutral" />
            <StatCard label="2Captcha" value="See Console" sub="2captcha.com/setting" status="neutral" />
          </Section>

          {/* ── Environment Variables ── */}
          <div>
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--c-text-3)', marginBottom: 10,
            }}>Environment Variables</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
              {Object.entries(stats.env).map(([key, ok]) => (
                <EnvRow key={key} name={key.toUpperCase()} ok={ok} />
              ))}
            </div>
          </div>

          {/* ── Quick Links ── */}
          <div>
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--c-text-3)', marginBottom: 10,
            }}>External Consoles</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { label: 'Supabase',         href: 'https://supabase.com/dashboard/project/osueksootkjhhgjdpqyy' },
                { label: 'Vercel',           href: 'https://vercel.com/charlesgonzalez-10s-projects/nextkeyos' },
                { label: 'Twilio Console',   href: 'https://console.twilio.com' },
                { label: 'Anthropic',        href: 'https://console.anthropic.com' },
                { label: 'Google Cloud',     href: 'https://console.cloud.google.com' },
                { label: 'REAPI',            href: 'https://nextkeyps.reapi.com' },
                { label: 'Rentcast',         href: 'https://app.rentcast.io' },
                { label: '2Captcha',         href: 'https://2captcha.com/setting' },
                { label: 'Airtable (Spesio)', href: 'https://airtable.com' },
              ].map(link => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
                    color: 'var(--c-text-2)', textDecoration: 'none',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {link.label}
                  <svg className="w-3 h-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
