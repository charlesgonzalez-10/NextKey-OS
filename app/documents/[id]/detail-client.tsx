'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const DocumentViewer = dynamic(() => import('@/components/DocumentViewer'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

interface Doc {
  id: string
  name: string
  category: string
  status: string
  file_type: string | null
  file_path: string | null
  pdf_path: string | null
  signed_pdf_path: string | null
  offer_amount: number | null
  recipient_name: string | null
  recipient_email: string | null
  sent_at: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
  lead_id: string | null
  deal_id: string | null
  property_id: string | null
  contact_id: string | null
}

interface SigningRequest {
  id: string
  recipient_email: string
  recipient_name: string | null
  status: string
  created_at: string
  viewed_at: string | null
  signed_at: string | null
  expires_at: string
  token: string
}

interface Version {
  id: string
  version: number
  file_path: string | null
  notes: string | null
  created_at: string
}

interface Activity {
  id: string
  action: string
  notes: string | null
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKFLOW: { status: string; label: string; color: string }[] = [
  { status: 'draft',        label: 'Draft',        color: '#6b7280' },
  { status: 'generated',   label: 'Generated',    color: '#818cf8' },
  { status: 'signed_by_me',label: 'Signed by Me', color: '#C9A84C' },
  { status: 'sent',         label: 'Sent',         color: '#38bdf8' },
  { status: 'viewed',       label: 'Viewed',       color: '#a78bfa' },
  { status: 'fully_signed', label: 'Fully Signed', color: '#4ACF9A' },
]

const WORKFLOW_NEXT: Record<string, { status: string; label: string }> = {
  draft:        { status: 'generated',    label: 'Mark Generated' },
  generated:    { status: 'signed_by_me', label: 'Mark Signed by Me' },
  signed_by_me: { status: 'sent',         label: 'Mark Sent' },
  sent:         { status: 'viewed',       label: 'Mark Viewed' },
  viewed:       { status: 'fully_signed', label: 'Mark Fully Signed' },
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:        { bg: 'rgba(107,114,128,0.15)', text: '#9ca3af' },
  generated:    { bg: 'rgba(99,102,241,0.15)',  text: '#818cf8' },
  signed_by_me: { bg: 'rgba(201,168,76,0.15)',  text: '#C9A84C' },
  sent:         { bg: 'rgba(56,189,248,0.15)',   text: '#38bdf8' },
  viewed:       { bg: 'rgba(167,139,250,0.15)', text: '#a78bfa' },
  accepted:     { bg: 'rgba(74,207,154,0.15)',   text: '#4ACF9A' },
  fully_signed: { bg: 'rgba(74,207,154,0.15)',   text: '#4ACF9A' },
  rejected:     { bg: 'rgba(239,68,68,0.12)',    text: '#ef4444' },
  expired:      { bg: 'rgba(239,68,68,0.1)',     text: '#ef4444' },
}

const ACTION_ICONS: Record<string, string> = {
  created: '✦', generated: '📄', signed: '✍️', sent: '📤',
  viewed: '👁', accepted: '✅', rejected: '❌', version_saved: '🔖',
  status_changed: '🔄',
}

const CATEGORY_LABEL: Record<string, string> = {
  offer: 'Offer', loi: 'LOI', assignment: 'Assignment', contract: 'Contract',
  disclosure: 'Disclosure', letter: 'Letter', photo: 'Photo',
  closing: 'Closing', probate: 'Probate', foreclosure: 'Foreclosure',
  title: 'Title', seller: 'Seller', buyer: 'Buyer', marketing: 'Marketing', other: 'Other',
}

// ─── Request Signature Modal ──────────────────────────────────────────────────

function RequestSignatureModal({
  doc,
  onClose,
  onCreated,
}: {
  doc: Doc
  onClose: () => void
  onCreated: (req: SigningRequest, url: string) => void
}) {
  const [email,   setEmail]   = useState(doc.recipient_email ?? '')
  const [name,    setName]    = useState(doc.recipient_name  ?? '')
  const [message, setMessage] = useState('')
  const [expires, setExpires] = useState('7')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [result,  setResult]  = useState<{ url: string; gmailError: string | null } | null>(null)

  const submit = async () => {
    if (!email) { setError('Recipient email required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/documents/${doc.id}/sign-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_email: email, recipient_name: name, message, expires_days: Number(expires) }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || 'Failed'); return }
      setResult({ url: d.signing_url, gmailError: d.gmail_error })
      onCreated(d.request, d.signing_url)
    } catch { setError('Request failed') }
    finally { setSaving(false) }
  }

  const S: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 200,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  }
  const box: React.CSSProperties = {
    backgroundColor: 'var(--c-card)', borderRadius: 16, padding: 28,
    width: '100%', maxWidth: 480, border: '1px solid var(--c-border)',
  }

  if (result) {
    return (
      <div style={S}>
        <div style={box}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Signing Request Created</p>
            {result.gmailError
              ? <p style={{ fontSize: 12, color: '#f59e0b' }}>⚠️ {result.gmailError}</p>
              : <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>Email sent to {email}</p>}
          </div>
          <div style={{ backgroundColor: 'var(--c-hover)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: 'var(--c-text-2)', marginBottom: 4 }}>Signing link:</p>
            <p style={{ fontSize: 11, wordBreak: 'break-all', color: '#C9A84C' }}>{result.url}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { navigator.clipboard.writeText(result.url) }}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}
            >
              Copy Link
            </button>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>✍️ Request Signature</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--c-text-2)' }}>×</button>
        </div>

        {[
          { label: 'Recipient Email', value: email, set: setEmail, type: 'email', required: true },
          { label: 'Recipient Name',  value: name,  set: setName,  type: 'text',  required: false },
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' as const }}>
              {f.label}{f.required && ' *'}
            </label>
            <input
              value={f.value} onChange={e => f.set(e.target.value)} type={f.type}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' as const }}>
            Personal Message (optional)
          </label>
          <textarea
            value={message} onChange={e => setMessage(e.target.value)} rows={2}
            placeholder="e.g. Hi Maria, please review and sign the purchase agreement at your earliest convenience."
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const, resize: 'vertical' as const }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' as const }}>Link Expires In</label>
          <select
            value={expires} onChange={e => setExpires(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }}
          >
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
        </div>

        {error && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            style={{ padding: '8px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Sending…' : '✍️ Send Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Send Modal ───────────────────────────────────────────────────────────────

function SendModal({ doc, onClose, onSent }: { doc: Doc; onClose: () => void; onSent: () => void }) {
  const [to, setTo]         = useState(doc.recipient_email ?? '')
  const [subject, setSubject] = useState(`${doc.name} — Please Review`)
  const [body, setBody]     = useState(
    `<p>Hi${doc.recipient_name ? ` ${doc.recipient_name}` : ''},</p><p>Please find the attached document for your review.</p><p>Let me know if you have any questions.</p><p>Best regards</p>`
  )
  const [sending, setSending] = useState(false)
  const [error, setError]   = useState('')

  const send = async () => {
    if (!to) { setError('Recipient email required'); return }
    setSending(true); setError('')
    try {
      const res = await fetch(`/api/documents/${doc.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || 'Send failed'); return }
      onSent()
      onClose()
    } catch { setError('Send failed') }
    finally { setSending(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ backgroundColor: 'var(--c-card)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, border: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Send via Gmail</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--c-text-2)' }}>×</button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 20 }}>
          📎 {doc.name}.pdf will be attached
        </p>

        {[
          { label: 'To', value: to, set: setTo, type: 'email' },
          { label: 'Subject', value: subject, set: setSubject, type: 'text' },
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>{f.label}</label>
            <input value={f.value} onChange={e => f.set(e.target.value)} type={f.type}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }} />
          </div>
        ))}

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Message</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const, resize: 'vertical' as const }} />
        </div>

        {error && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={send} disabled={sending}
            style={{ padding: '8px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending…' : '📤 Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DocDetailClient({ docId }: { docId: string }) {
  const router = useRouter()
  const [doc, setDoc]               = useState<Doc | null>(null)
  const [versions, setVersions]     = useState<Version[]>([])
  const [activity, setActivity]     = useState<Activity[]>([])
  const [loading, setLoading]       = useState(true)
  const [viewer, setViewer]         = useState<{ url: string; fileType: string | null } | null>(null)
  const [showSend,       setShowSend]       = useState(false)
  const [showSignReq,    setShowSignReq]    = useState(false)
  const [signingRequests, setSigningRequests] = useState<SigningRequest[]>([])
  const [advancing,      setAdvancing]      = useState(false)
  const [activeTab,      setActiveTab]      = useState<'versions' | 'activity' | 'signatures'>('activity')

  const load = useCallback(async () => {
    const [docRes, verRes, actRes, sigRes] = await Promise.allSettled([
      fetch(`/api/documents/${docId}`).then(r => r.json()),
      fetch(`/api/documents/${docId}/versions`).then(r => r.json()),
      fetch(`/api/documents/${docId}/activity`).then(r => r.json()),
      fetch(`/api/documents/${docId}/sign-request`).then(r => r.json()),
    ])
    if (docRes.status === 'fulfilled') setDoc(docRes.value)
    if (verRes.status === 'fulfilled') setVersions(verRes.value.versions ?? [])
    if (actRes.status === 'fulfilled') setActivity(actRes.value.activity ?? [])
    if (sigRes.status === 'fulfilled') setSigningRequests(sigRes.value.requests ?? [])
    setLoading(false)
  }, [docId])

  useEffect(() => { load() }, [load])

  const openViewer = async () => {
    const res = await fetch(`/api/documents/${docId}/url`)
    const d   = await res.json()
    if (d.url) setViewer({ url: d.url, fileType: doc?.file_type ?? null })
  }

  const openVersion = async (v: Version) => {
    if (!v.file_path) return
    const { data: urlData } = await fetch(`/api/documents/${docId}/url`).then(r => r.json())
    // For versions, generate URL directly via a version-specific signed URL request
    const res = await fetch(`/api/documents/${docId}/versions/${v.id}/url`).catch(() => null)
    if (res?.ok) {
      const d = await res.json()
      if (d.url) setViewer({ url: d.url, fileType: 'pdf' })
    }
  }

  const advanceStatus = async () => {
    if (!doc) return
    const next = WORKFLOW_NEXT[doc.status]
    if (!next) return
    setAdvancing(true)
    await fetch(`/api/documents/${docId}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status_changed', notes: `Status → ${next.label}`, new_status: next.status }),
    })
    setDoc(prev => prev ? { ...prev, status: next.status } : prev)
    setActivity(prev => [{ id: crypto.randomUUID(), action: 'status_changed', notes: `Status → ${next.status}`, created_at: new Date().toISOString() }, ...prev])
    setAdvancing(false)
  }

  const saveVersion = async () => {
    const res = await fetch(`/api/documents/${docId}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d   = await res.json()
    if (d.version) {
      setVersions(prev => [d.version, ...prev])
      setActivity(prev => [{ id: crypto.randomUUID(), action: 'version_saved', notes: `Version ${d.version.version} saved`, created_at: new Date().toISOString() }, ...prev])
    }
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--c-text-2)' }}>Loading…</div>
  if (!doc) return <div style={{ padding: 60, textAlign: 'center', color: '#ef4444' }}>Document not found. <a href="/documents" style={{ color: '#C9A84C' }}>← Back</a></div>

  const sc = STATUS_COLORS[doc.status] ?? STATUS_COLORS.draft
  const currentStepIdx = WORKFLOW.findIndex(s => s.status === doc.status)
  const nextStep = WORKFLOW_NEXT[doc.status]
  const hasFile = !!(doc.signed_pdf_path || doc.pdf_path || doc.file_path)
  const isPdf = doc.file_type === 'pdf' || !!(doc.pdf_path || doc.signed_pdf_path)

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 28 }}>
        <a href="/documents" style={{ color: 'var(--c-text-2)', textDecoration: 'none', fontSize: 20, lineHeight: 1, paddingTop: 3 }}>←</a>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{doc.name}</h1>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text }}>
              {doc.status.replace(/_/g, ' ')}
            </span>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
              {CATEGORY_LABEL[doc.category] ?? doc.category}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--c-text-2)', flexWrap: 'wrap' }}>
            {doc.recipient_name  && <span>→ {doc.recipient_name}</span>}
            {doc.recipient_email && <span>{doc.recipient_email}</span>}
            {doc.offer_amount    && <span>${Number(doc.offer_amount).toLocaleString()}</span>}
            {doc.sent_at         && <span>Sent {new Date(doc.sent_at).toLocaleDateString()}</span>}
            <span>Created {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {hasFile && (
            <button onClick={openViewer}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid rgba(201,168,76,0.35)', backgroundColor: 'rgba(201,168,76,0.08)', color: '#C9A84C', cursor: 'pointer' }}>
              View
            </button>
          )}
          {isPdf && hasFile && (
            <button onClick={() => router.push(`/documents/${docId}/fill`)}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
              Fill & Sign
            </button>
          )}
          {isPdf && hasFile && (
            <button onClick={() => setShowSignReq(true)}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, backgroundColor: '#0A1F44', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)', cursor: 'pointer' }}>
              ✍️ Request Signature
            </button>
          )}
          <button onClick={() => setShowSend(true)}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            📤 Send
          </button>
          <button onClick={saveVersion}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            🔖 Save Version
          </button>
        </div>
      </div>

      {/* Workflow pipeline */}
      <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-2)' }}>
            Document Workflow
          </span>
          {nextStep && (
            <button onClick={advanceStatus} disabled={advancing}
              style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 6, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', opacity: advancing ? 0.6 : 1 }}>
              {advancing ? '…' : `↑ ${nextStep.label}`}
            </button>
          )}
        </div>

        {/* Steps row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
          {WORKFLOW.map((step, i) => {
            const isActive  = i === currentStepIdx
            const isPast    = i < currentStepIdx
            const isFuture  = i > currentStepIdx
            return (
              <div key={step.status} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', margin: '0 auto 6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isActive ? step.color : isPast ? `${step.color}40` : 'var(--c-hover)',
                    border: `2px solid ${isActive || isPast ? step.color : 'var(--c-border)'}`,
                    fontSize: isActive ? 14 : 12, fontWeight: 700,
                    color: isActive ? '#fff' : isPast ? step.color : 'var(--c-text-3)',
                    transition: 'all 0.2s',
                    flexShrink: 0,
                  }}>
                    {isPast ? '✓' : i + 1}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: isActive ? 700 : 500,
                    color: isActive ? step.color : isPast ? 'var(--c-text-2)' : 'var(--c-text-3)',
                    display: 'block', whiteSpace: 'nowrap',
                  }}>
                    {step.label}
                  </span>
                </div>
                {i < WORKFLOW.length - 1 && (
                  <div style={{ height: 2, flex: '0 0 20px', backgroundColor: i < currentStepIdx ? WORKFLOW[i].color : 'var(--c-border)', marginBottom: 18 }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Two-col layout: history sidebar + doc meta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

        {/* Left — document info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Document preview card */}
          <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>
              {doc.file_type === 'jpg' || doc.file_type === 'png' ? '🖼️' : '📄'}
            </div>
            <p style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{doc.name}</p>
            {doc.file_type && <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', marginBottom: 16 }}>{doc.file_type}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {hasFile && (
                <button onClick={openViewer}
                  style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid rgba(201,168,76,0.35)', backgroundColor: 'rgba(201,168,76,0.08)', color: '#C9A84C', cursor: 'pointer' }}>
                  Open Preview
                </button>
              )}
              {isPdf && hasFile && (
                <button onClick={() => router.push(`/documents/${docId}/fill`)}
                  style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
                  Fill & Sign
                </button>
              )}
            </div>
          </div>

          {/* Linked records */}
          {(doc.lead_id || doc.deal_id || doc.property_id || doc.contact_id) && (
            <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '16px 20px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-2)', marginBottom: 12 }}>Linked To</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {doc.lead_id     && <a href={`/leads/${doc.lead_id}`}     style={{ fontSize: 12, color: '#C9A84C', textDecoration: 'none' }}>→ Lead</a>}
                {doc.deal_id     && <a href={`/deals/${doc.deal_id}`}     style={{ fontSize: 12, color: '#C9A84C', textDecoration: 'none' }}>→ Deal</a>}
                {doc.contact_id  && <a href={`/contacts/${doc.contact_id}` } style={{ fontSize: 12, color: '#C9A84C', textDecoration: 'none' }}>→ Contact</a>}
              </div>
            </div>
          )}
        </div>

        {/* Right — versions + activity */}
        <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--c-border)' }}>
            {(['activity', 'signatures', 'versions'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{
                  flex: 1, padding: '12px 0', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  backgroundColor: 'transparent',
                  color: activeTab === t ? '#C9A84C' : 'var(--c-text-2)',
                  borderBottom: activeTab === t ? '2px solid #C9A84C' : '2px solid transparent',
                  textTransform: 'capitalize',
                }}>
                {t === 'versions'   ? `Versions (${versions.length})` :
                 t === 'signatures' ? `Signatures (${signingRequests.length})` :
                 'Activity'}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {activeTab === 'signatures' ? (
              signingRequests.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 10 }}>No signing requests yet</p>
                  <button onClick={() => setShowSignReq(true)}
                    style={{ fontSize: 11, padding: '5px 14px', borderRadius: 6, backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)', cursor: 'pointer' }}>
                    ✍️ Request Signature
                  </button>
                </div>
              ) : (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {signingRequests.map(sr => {
                    const statusColors: Record<string, string> = {
                      pending:  '#6b7280', viewed: '#a78bfa', signed: '#4ACF9A', declined: '#ef4444', expired: '#f59e0b',
                    }
                    const statusColor = statusColors[sr.status] ?? '#6b7280'
                    return (
                      <div key={sr.id} style={{ padding: '10px 12px', backgroundColor: 'var(--c-hover)', borderRadius: 8, border: '1px solid var(--c-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{sr.recipient_name ?? sr.recipient_email}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, backgroundColor: `${statusColor}20`, color: statusColor, textTransform: 'capitalize' }}>
                            {sr.status}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--c-text-2)', margin: '2px 0' }}>{sr.recipient_email}</p>
                        <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginTop: 4 }}>
                          {sr.signed_at   && <span>✅ Signed {new Date(sr.signed_at).toLocaleDateString()}</span>}
                          {sr.viewed_at && !sr.signed_at && <span>👁 Viewed {new Date(sr.viewed_at).toLocaleDateString()}</span>}
                          {!sr.viewed_at && <span>Sent {new Date(sr.created_at).toLocaleDateString()} · Expires {new Date(sr.expires_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    )
                  })}
                  <button onClick={() => setShowSignReq(true)}
                    style={{ fontSize: 11, padding: '6px 0', borderRadius: 6, border: '1px dashed var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer', marginTop: 4 }}>
                    + New Request
                  </button>
                </div>
              )
            ) : activeTab === 'activity' ? (
              activity.length === 0 ? (
                <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--c-text-3)' }}>No activity yet</p>
              ) : (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activity.map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{ACTION_ICONS[a.action] ?? '•'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{a.action.replace(/_/g, ' ')}</p>
                        {a.notes && <p style={{ fontSize: 11, color: 'var(--c-text-2)', margin: '2px 0 0' }}>{a.notes}</p>}
                        <p style={{ fontSize: 10, color: 'var(--c-text-3)', margin: '2px 0 0' }}>
                          {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              versions.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 10 }}>No saved versions</p>
                  <button onClick={saveVersion}
                    style={{ fontSize: 11, padding: '5px 14px', borderRadius: 6, backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)', cursor: 'pointer' }}>
                    Save Current Version
                  </button>
                </div>
              ) : (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {versions.map(v => (
                    <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', backgroundColor: 'var(--c-hover)', borderRadius: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', flexShrink: 0 }}>v{v.version}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 11, color: 'var(--c-text-2)', margin: 0 }}>
                          {new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {v.notes && <p style={{ fontSize: 10, color: 'var(--c-text-3)', margin: '2px 0 0' }}>{v.notes}</p>}
                      </div>
                      <button onClick={() => openVersion(v)}
                        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                        View
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {viewer && doc && (
        <DocumentViewer url={viewer.url} name={doc.name} fileType={viewer.fileType} onClose={() => setViewer(null)} />
      )}

      {showSend && doc && (
        <SendModal doc={doc} onClose={() => setShowSend(false)} onSent={() => {
          setDoc(prev => prev ? { ...prev, status: 'sent', sent_at: new Date().toISOString() } : prev)
          setActivity(prev => [{ id: crypto.randomUUID(), action: 'sent', notes: `Sent to ${doc.recipient_email}`, created_at: new Date().toISOString() }, ...prev])
        }} />
      )}

      {showSignReq && doc && (
        <RequestSignatureModal
          doc={doc}
          onClose={() => setShowSignReq(false)}
          onCreated={(req) => {
            setSigningRequests(prev => [req, ...prev])
            setActiveTab('signatures')
            setDoc(prev => prev ? { ...prev, status: 'sent', sent_at: new Date().toISOString() } : prev)
          }}
        />
      )}
    </div>
  )
}
