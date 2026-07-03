'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallLogEntry {
  id: string
  outcome: string
  notes: string | null
  phone_used: string | null
  duration_secs: number | null
  follow_up_at: string | null
  created_at: string
}

const OUTCOME_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'answered',           label: 'Answered',           color: '#22c55e' },
  { value: 'no_answer',          label: 'No Answer',          color: '#f59e0b' },
  { value: 'voicemail',          label: 'Voicemail',          color: '#60a5fa' },
  { value: 'wrong_number',       label: 'Wrong Number',       color: '#ef4444' },
  { value: 'disconnected',       label: 'Disconnected',       color: '#9ca3af' },
  { value: 'callback_scheduled', label: 'Callback Scheduled', color: '#a78bfa' },
]

const SURPLUS_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new',           label: 'New' },
  { value: 'researching',   label: 'Researching' },
  { value: 'owner_found',   label: 'Owner Found' },
  { value: 'contacted',     label: 'Contacted' },
  { value: 'claim_filed',   label: 'Claim Filed' },
  { value: 'paid',          label: 'Paid' },
  { value: 'archived',      label: 'Archived' },
]

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── CallingPanel ──────────────────────────────────────────────────────────────

export default function CallingPanel() {
  const { lead, updateLeadField } = useWorkspace()

  const [calls, setCalls]               = useState<CallLogEntry[]>([])
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [showForm, setShowForm]         = useState(false)
  const [outcome, setOutcome]           = useState('no_answer')
  const [notes, setNotes]               = useState('')
  const [phoneUsed, setPhoneUsed]       = useState(lead.phone_1 ?? '')
  const [followUp, setFollowUp]         = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [surplusStatus, setSurplusStatus] = useState(lead.surplus_status ?? '')

  const phones = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5]
    .filter(Boolean) as string[]

  const loadCalls = useCallback(async () => {
    setLoadingCalls(true)
    try {
      const res = await fetch(`/api/acquisition/call-log?lead_id=${lead.id}`)
      if (res.ok) {
        const d = await res.json()
        setCalls(d.calls ?? [])
      }
    } finally { setLoadingCalls(false) }
  }, [lead.id])

  useEffect(() => { loadCalls() }, [loadCalls])

  const handleLogCall = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { lead_id: lead.id, outcome, phone_used: phoneUsed }
      if (notes.trim()) body.notes = notes.trim()
      if (followUp) body.follow_up_at = new Date(followUp).toISOString()

      const res = await fetch('/api/acquisition/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const d = await res.json()
        setCalls(prev => [d.call, ...prev])
        setNotes('')
        setFollowUp('')
        setShowForm(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
        // Update surplus_status if changed
        if (surplusStatus && surplusStatus !== lead.surplus_status) {
          await updateLeadField({ surplus_status: surplusStatus })
        }
      }
    } finally { setSaving(false) }
  }

  const handleSurplusStatusChange = async (v: string) => {
    setSurplusStatus(v)
    await updateLeadField({ surplus_status: v })
  }

  const outcomeForEntry = (o: string) => OUTCOME_OPTIONS.find(x => x.value === o) ?? { label: o, color: '#4a6a9a' }

  return (
    <div style={{ marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a' }}>
          Calling Workflow
        </div>
        {saved && <span style={{ fontSize: 10, color: '#22c55e' }}>✓ Logged</span>}
      </div>

      {/* Phone numbers */}
      {phones.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 12 }}>
          {phones.map((ph, i) => (
            <a key={i} href={`tel:${ph}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 6,
                padding: '5px 10px', textDecoration: 'none', color: '#4CAF9A', fontSize: 11, fontWeight: 600,
              }}
              onClick={() => { setPhoneUsed(ph); setShowForm(true) }}>
              <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>
              </svg>
              {ph}
            </a>
          ))}
        </div>
      )}

      {phones.length === 0 && (
        <div style={{ fontSize: 11, color: '#4a6a9a', padding: '8px 0', marginBottom: 8 }}>No phone numbers on file.</div>
      )}

      {/* Log call button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            background: 'rgba(76,175,154,0.1)', border: '1px solid rgba(76,175,154,0.3)',
            borderRadius: 6, color: '#4CAF9A', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            marginBottom: 12,
          }}>
          + Log Call
        </button>
      )}

      {/* Call log form */}
      {showForm && (
        <div style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 7, padding: 12, marginBottom: 12 }}>
          {/* Outcome */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 4 }}>Outcome</div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
              {OUTCOME_OPTIONS.map(opt => (
                <button key={opt.value}
                  onClick={() => setOutcome(opt.value)}
                  style={{
                    padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', border: `1px solid ${opt.color}44`,
                    background: outcome === opt.value ? `${opt.color}22` : 'transparent',
                    color: outcome === opt.value ? opt.color : '#4a6a9a',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Phone used */}
          {phones.length > 1 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 4 }}>Phone Used</div>
              <select value={phoneUsed} onChange={e => setPhoneUsed(e.target.value)}
                style={{ width: '100%', background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, padding: '4px 8px', color: '#e2e8f0', fontSize: 11 }}>
                {phones.map(ph => <option key={ph} value={ph}>{ph}</option>)}
              </select>
            </div>
          )}

          {/* Notes */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 4 }}>Notes</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} placeholder="What happened on the call…"
              style={{ width: '100%', background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, padding: '6px 8px', color: '#e2e8f0', fontSize: 11, resize: 'none', fontFamily: 'inherit' }} />
          </div>

          {/* Follow up */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 4 }}>Schedule Follow-Up</div>
            <input type="datetime-local" value={followUp} onChange={e => setFollowUp(e.target.value)}
              style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, padding: '4px 8px', color: '#e2e8f0', fontSize: 11 }} />
          </div>

          {/* Status */}
          {lead.acquisition_pipeline === 'surplus-funds' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 4 }}>Surplus Status</div>
              <select value={surplusStatus} onChange={e => setSurplusStatus(e.target.value)}
                style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, padding: '4px 8px', color: '#e2e8f0', fontSize: 11 }}>
                {SURPLUS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleLogCall} disabled={saving}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 5, background: '#4CAF9A', border: 'none',
                color: '#fff', fontSize: 11, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>
              {saving ? 'Saving…' : 'Log Call'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '6px 12px', borderRadius: 5, background: 'transparent', border: '1px solid #1a3050', color: '#4a6a9a', fontSize: 11, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Call history */}
      {loadingCalls && <div style={{ fontSize: 11, color: '#4a6a9a' }}>Loading…</div>}
      {!loadingCalls && calls.length > 0 && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 6 }}>Call History</div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5 }}>
            {calls.map(c => {
              const meta = outcomeForEntry(c.outcome)
              return (
                <div key={c.id} style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: c.notes ? 4 : 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                    <span style={{ fontSize: 9, color: '#4a6a9a' }}>{fmtDate(c.created_at)}</span>
                  </div>
                  {c.phone_used && <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: c.notes ? 2 : 0 }}>{c.phone_used}</div>}
                  {c.notes && <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>{c.notes}</div>}
                  {c.follow_up_at && (
                    <div style={{ fontSize: 9, color: '#a78bfa', marginTop: 3 }}>
                      Follow-up: {new Date(c.follow_up_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
