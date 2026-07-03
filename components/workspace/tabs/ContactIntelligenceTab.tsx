'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import type { SkipTracePhone, SkipTraceEmail, SkipTraceStoredResult } from '@/lib/skiptrace/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(-10)
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

function confidencePct(n: number | null | undefined): string {
  if (n == null) return ''
  return `${Math.round(n * 100)}%`
}

function daysSinceLabel(n: number | null): string {
  if (n === null) return ''
  if (n === 0)   return 'Today'
  if (n === 1)   return '1 day ago'
  if (n < 30)    return `${n} days ago`
  if (n < 60)    return `${Math.round(n / 7)} wks ago`
  return `${Math.round(n / 30)} mo ago`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background:    '#0d1b2e',
  border:        '1px solid #1a3050',
  borderRadius:  10,
  marginBottom:  10,
  overflow:      'hidden',
}

const sectionTitle: React.CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  color:         '#4a6a9a',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  marginBottom:  10,
}

const pill = (color: string, bg: string): React.CSSProperties => ({
  display:       'inline-flex',
  alignItems:    'center',
  gap:           3,
  padding:       '2px 8px',
  borderRadius:  20,
  fontSize:      9,
  fontWeight:    700,
  background:    bg,
  color,
  border:        `1px solid ${color}35`,
  whiteSpace:    'nowrap',
})

const iconBtn = (color: string): React.CSSProperties => ({
  fontSize:        10,
  fontWeight:      700,
  padding:         '3px 9px',
  borderRadius:    5,
  border:          `1px solid ${color}40`,
  background:      `${color}12`,
  color,
  cursor:          'pointer',
  whiteSpace:      'nowrap',
})

// ─── Phone card ───────────────────────────────────────────────────────────────

function PhoneRow({ phone }: { phone: SkipTracePhone }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(fmtPhone(phone.phone_number))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const typeColor = phone.is_mobile ? '#4CAF9A' : phone.is_voip ? '#a78bfa' : '#C9A84C'
  const typeLbl   = phone.is_mobile ? 'Mobile' : phone.is_landline ? 'Landline' : phone.is_voip ? 'VoIP' : phone.phone_type ?? 'Unknown'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #0d1b2e' }}>
      {/* Type badge */}
      <span style={pill(typeColor, `${typeColor}15`)}>{typeLbl}</span>

      {/* Number */}
      <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', flex: 1, fontVariantNumeric: 'tabular-nums' }}>
        {fmtPhone(phone.phone_number)}
      </span>

      {/* DNC warning */}
      {phone.is_dnc && (
        <span style={pill('#ef4444', '#ef444420')}>DNC</span>
      )}

      {/* Confidence */}
      {phone.confidence != null && (
        <span style={{ fontSize: 10, color: '#4a6a9a' }}>{confidencePct(phone.confidence)}</span>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
        <a href={`tel:${phone.phone_number}`} style={{ ...iconBtn('#4CAF9A'), textDecoration: 'none' }}>
          📞 Call
        </a>
        <a href={`sms:${phone.phone_number}`} style={{ ...iconBtn('#60a5fa'), textDecoration: 'none' }}>
          💬 Text
        </a>
        <button onClick={copy} style={iconBtn('#C9A84C')}>
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// ─── Email card ───────────────────────────────────────────────────────────────

function EmailRow({ email }: { email: SkipTraceEmail }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(email.email)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #0d1b2e' }}>
      {email.is_primary && <span style={pill('#C9A84C', '#C9A84C15')}>Primary</span>}
      <span style={{ fontSize: 13, color: '#e2e8f0', flex: 1 }}>{email.email}</span>
      {email.confidence != null && (
        <span style={{ fontSize: 10, color: '#4a6a9a' }}>{confidencePct(email.confidence)}</span>
      )}
      <div style={{ display: 'flex', gap: 5 }}>
        <a href={`mailto:${email.email}`} style={{ ...iconBtn('#a78bfa'), textDecoration: 'none' }}>
          ✉ Email
        </a>
        <button onClick={copy} style={iconBtn('#C9A84C')}>
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: SkipTraceStoredResult['results'][0] }) {
  return (
    <div style={cardStyle}>
      <div style={{ padding: '12px 14px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
              {result.full_name ?? 'Unknown Owner'}
            </div>
            {result.age && (
              <div style={{ fontSize: 11, color: '#4a6a9a', marginTop: 2 }}>Age {result.age}</div>
            )}
          </div>
          {result.confidence_score != null && (
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 1 }}>Confidence</div>
              <div style={{
                fontSize:   14,
                fontWeight: 700,
                color: result.confidence_score >= 0.75 ? '#4CAF9A' : result.confidence_score >= 0.5 ? '#C9A84C' : '#E07B6A',
              }}>
                {confidencePct(result.confidence_score)}
              </div>
            </div>
          )}
        </div>

        {/* Phones */}
        {result.phones.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={sectionTitle}>Phone Numbers ({result.phones.length})</div>
            {result.phones.map((p, i) => <PhoneRow key={i} phone={p} />)}
          </div>
        )}

        {/* Emails */}
        {result.emails.length > 0 && (
          <div style={{ marginBottom: result.relatives?.length ? 12 : 0 }}>
            <div style={sectionTitle}>Email Addresses ({result.emails.length})</div>
            {result.emails.map((e, i) => <EmailRow key={i} email={e} />)}
          </div>
        )}

        {/* Relatives (collapsed list) */}
        {result.relatives && result.relatives.length > 0 && (
          <div>
            <div style={sectionTitle}>Known Relatives</div>
            <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.7 }}>
              {result.relatives.slice(0, 5).join(' · ')}
              {result.relatives.length > 5 && ` · +${result.relatives.length - 5} more`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── History panel ────────────────────────────────────────────────────────────

function HistoryPanel({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<Array<{
    id: string; provider: string; status: string; credits_used: number | null;
    requested_at: string; completed_at: string | null;
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/properties/${propertyId}/skiptrace/history`)
      .then(r => r.json())
      .then(d => { setRows(d.history ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [propertyId])

  if (loading) return <div style={{ fontSize: 11, color: '#4a6a9a', padding: '8px 0' }}>Loading history…</div>
  if (!rows.length) return <div style={{ fontSize: 11, color: '#4a6a9a', padding: '8px 0' }}>No previous requests.</div>

  return (
    <div>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #1a3050', fontSize: 11 }}>
          <span style={{
            ...pill(
              r.status === 'completed' ? '#4CAF9A' : r.status === 'failed' ? '#ef4444' : '#C9A84C',
              r.status === 'completed' ? '#4CAF9A15' : r.status === 'failed' ? '#ef444420' : '#C9A84C15',
            ),
          }}>{r.status}</span>
          <span style={{ color: '#4a6a9a', flex: 1 }}>{fmtDate(r.requested_at)}</span>
          <span style={{ color: '#e2e8f0' }}>{r.provider}</span>
          {r.credits_used != null && (
            <span style={{ color: '#4a6a9a' }}>{r.credits_used} credit{r.credits_used !== 1 ? 's' : ''}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function ContactIntelligenceTab() {
  const { lead } = useWorkspace()
  const propertyId = lead.id

  const [data,         setData]         = useState<SkipTraceStoredResult | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [running,      setRunning]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [noCredentials, setNoCredentials] = useState(false)
  const [showHistory,  setShowHistory]  = useState(false)

  const fetchResults = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/properties/${propertyId}/skiptrace`)
      const json = await res.json()
      setData(json.result ?? null)
    } catch {
      setError('Failed to load skip trace data')
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { fetchResults() }, [fetchResults])

  const runTrace = useCallback(async (force = false) => {
    setRunning(true); setError(null)
    try {
      const res  = await fetch(`/api/properties/${propertyId}/skiptrace${force ? '?force=true' : ''}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'NO_CREDENTIALS') { setNoCredentials(true); return }
        setError(json.error ?? json.message ?? 'Skip trace failed')
        return
      }
      setData(json.result ?? null)
    } catch {
      setError('Network error — please try again')
    } finally {
      setRunning(false)
    }
  }, [propertyId])

  // ── No credentials configured ──────────────────────────────────────────────
  if (noCredentials) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 20, textAlign: 'center' as const }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Skip Trace Not Configured</div>
          <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>
            Add a <code style={{ color: '#C9A84C' }}>REAPI_KEY</code> to your Vercel environment variables to enable skip tracing.
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2].map(i => (
          <div key={i} style={{ ...cardStyle, height: 80, background: '#0d1b2e' }}>
            <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ width: '40%', height: 12, borderRadius: 6, background: '#1a3050' }} />
              <div style={{ width: '70%', height: 10, borderRadius: 6, background: '#1a3050' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── No results yet ─────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 24, textAlign: 'center' as const }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>
            No verified contact information available.
          </div>
          <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 16 }}>
            Run a skip trace to find phone numbers and email addresses for{' '}
            <strong style={{ color: '#C9A84C' }}>{lead.owner_name ?? 'the owner'}</strong>.
          </div>
          {error && (
            <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 12 }}>{error}</div>
          )}
          <button
            onClick={() => runTrace(false)}
            disabled={running}
            style={{
              padding:       '8px 24px',
              borderRadius:  8,
              fontSize:      12,
              fontWeight:    700,
              background:    '#C9A84C',
              color:         '#0A1F44',
              border:        'none',
              cursor:        running ? 'not-allowed' : 'pointer',
              opacity:       running ? 0.7 : 1,
            }}>
            {running ? 'Running Skip Trace…' : '⚡ Skip Trace'}
          </button>
        </div>
      </div>
    )
  }

  // ── Has results ────────────────────────────────────────────────────────────
  const totalPhones = data.results.reduce((n, r) => n + r.phones.length, 0)
  const totalEmails = data.results.reduce((n, r) => n + r.emails.length, 0)

  return (
    <div>
      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: '#0d1b2e',
        border: '1px solid #1a3050', borderRadius: 10, marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={pill(data.is_fresh ? '#4CAF9A' : '#C9A84C', data.is_fresh ? '#4CAF9A15' : '#C9A84C15')}>
            {data.is_fresh ? '✓ Fresh' : '↻ Stale'}
          </span>
          <span style={{ fontSize: 11, color: '#4a6a9a' }}>
            {data.days_since !== null ? `Traced ${daysSinceLabel(data.days_since)}` : 'Traced'} via {data.request.provider}
          </span>
          <span style={{ fontSize: 11, color: '#4a6a9a' }}>
            · {totalPhones} phone{totalPhones !== 1 ? 's' : ''} · {totalEmails} email{totalEmails !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {!data.is_fresh && (
            <button onClick={() => runTrace(false)} disabled={running} style={iconBtn('#4CAF9A')}>
              {running ? '…' : '↻ Refresh'}
            </button>
          )}
          <button onClick={() => runTrace(true)} disabled={running} style={iconBtn('#4a6a9a')}>
            {running ? '…' : 'Refresh Anyway'}
          </button>
          <button onClick={() => setShowHistory(h => !h)} style={iconBtn('#4a6a9a')}>
            History
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8, padding: '6px 10px', background: '#ef444420', border: '1px solid #ef444440', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div style={{ ...cardStyle, marginBottom: 10, padding: '10px 14px' }}>
          <div style={{ ...sectionTitle, marginBottom: 8 }}>Request History</div>
          <HistoryPanel propertyId={propertyId} />
        </div>
      )}

      {/* Contact results */}
      {data.results.length === 0 ? (
        <div style={{ ...cardStyle, padding: '16px 14px', textAlign: 'center' as const }}>
          <div style={{ fontSize: 12, color: '#4a6a9a' }}>
            Skip trace completed but no contact information was found for this owner.
          </div>
        </div>
      ) : (
        data.results.map(r => <ResultCard key={r.id} result={r} />)
      )}
    </div>
  )
}
