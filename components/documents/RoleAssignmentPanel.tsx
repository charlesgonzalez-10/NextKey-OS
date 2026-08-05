'use client'

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResolvedRole {
  signer_role_id: string
  role_name:      string
  color:          string
  signing_order:  number
  suggestion: {
    name:       string
    email:      string
    phone:      string | null
    contact_id: string | null
  } | null
}

interface AssignedSigner {
  signer_role_id: string
  role_name:      string
  color:          string
  name:           string
  email:          string
  contact_id:     string | null
  signing_order:  number
}

interface SentSigner {
  id:          string
  name:        string
  email:       string
  role_name:   string
  signing_url: string
}

interface Props {
  documentId:   string
  propertyId?:  string | null
  contactId?:   string | null
  onClose:      () => void
  onSent:       (signers: SentSigner[], sessionId: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoleAssignmentPanel({ documentId, propertyId, contactId, onClose, onSent }: Props) {
  const [loading,   setLoading]   = useState(true)
  const [roles,     setRoles]     = useState<ResolvedRole[]>([])
  const [assigned,  setAssigned]  = useState<AssignedSigner[]>([])
  const [sending,   setSending]   = useState(false)
  const [error,     setError]     = useState('')
  const [result,    setResult]    = useState<{ sessionId: string; signers: SentSigner[] } | null>(null)
  const [copied,    setCopied]    = useState<string | null>(null)

  // Load role suggestions on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const res = await fetch(`/api/documents/${documentId}/resolve-roles`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ property_id: propertyId, contact_id: contactId }),
      })
      if (!res.ok) { setError('Failed to load roles'); setLoading(false); return }
      const d = await res.json()
      const resolved: ResolvedRole[] = d.roles ?? []
      setRoles(resolved)
      // Pre-populate assigned signers from suggestions
      setAssigned(resolved.map(r => ({
        signer_role_id: r.signer_role_id,
        role_name:      r.role_name,
        color:          r.color,
        signing_order:  r.signing_order,
        name:           r.suggestion?.name       ?? '',
        email:          r.suggestion?.email      ?? '',
        contact_id:     r.suggestion?.contact_id ?? null,
      })))
      setLoading(false)
    }
    load()
  }, [documentId, propertyId, contactId])

  const updateAssigned = (roleId: string, field: 'name' | 'email', value: string) => {
    setAssigned(prev => prev.map(a =>
      a.signer_role_id === roleId ? { ...a, [field]: value } : a
    ))
  }

  const isValid = assigned.length > 0 && assigned.every(a => a.name.trim() && a.email.trim())
  const missingRoles = assigned.filter(a => !a.email.trim()).map(a => a.role_name)

  const handleSend = async () => {
    if (!isValid) return
    setSending(true); setError('')
    try {
      const res = await fetch('/api/signing-sessions/from-document', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          document_id:      documentId,
          role_assignments: assigned.map(a => ({
            signer_role_id: a.signer_role_id,
            name:           a.name.trim(),
            email:          a.email.trim(),
            contact_id:     a.contact_id,
            signing_order:  a.signing_order,
          })),
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Failed to send'); setSending(false); return }
      setResult({ sessionId: d.session_id, signers: d.signers })
      onSent(d.signers, d.session_id)
    } catch {
      setError('Request failed')
    } finally {
      setSending(false)
    }
  }

  // ─── Overlay shell ──────────────────────────────────────────────────────────

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 200,
    backgroundColor: 'rgba(0,0,0,0.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  }
  const box: React.CSSProperties = {
    backgroundColor: 'var(--c-card)',
    border:          '1px solid var(--c-border)',
    borderRadius:    16,
    padding:         0,
    width:           '100%',
    maxWidth:        520,
    maxHeight:       '90vh',
    display:         'flex',
    flexDirection:   'column',
    overflow:        'hidden',
  }

  // ─── Success screen ─────────────────────────────────────────────────────────

  if (result) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={box} onClick={e => e.stopPropagation()}>
          <div style={{ padding: '28px 28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Signing requests sent!</h2>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
              Each signer received a unique link by email.
            </p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.signers.map(s => (
                <div key={s.id} style={{
                  padding: '12px 14px',
                  backgroundColor: 'var(--c-hover)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{s.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--c-text-2)', margin: '2px 0 0' }}>
                        {s.role_name} · {s.email}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(s.signing_url)
                        setCopied(s.id)
                        setTimeout(() => setCopied(null), 2000)
                      }}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                        backgroundColor: copied === s.id ? 'rgba(74,207,154,0.15)' : 'rgba(201,168,76,0.12)',
                        color:           copied === s.id ? '#4ACF9A' : '#C9A84C',
                        border:          `1px solid ${copied === s.id ? 'rgba(74,207,154,0.3)' : 'rgba(201,168,76,0.3)'}`,
                      }}
                    >
                      {copied === s.id ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '20px 20px 24px' }}>
            <button onClick={onClose} style={{
              width: '100%', padding: '11px 0', borderRadius: 10,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              backgroundColor: '#0A1F44', color: '#C9A84C', border: 'none',
            }}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Assignment screen ──────────────────────────────────────────────────────

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '22px 24px 18px',
          borderBottom: '1px solid var(--c-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Send for Signature</h2>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 3 }}>
              Assign people to each signing role. Suggestions are auto-filled from your contacts.
            </p>
          </div>
          <button onClick={onClose} style={{
            fontSize: 18, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--c-text-3)', lineHeight: 1, padding: '0 0 0 12px',
          }}>×</button>
        </div>

        {/* Role list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--c-text-2)', fontSize: 13 }}>
              Loading roles…
            </div>
          ) : roles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 6 }}>
                No signer roles found in this document.
              </p>
              <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                Publish a new version of the template with signer role fields to use this panel.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {assigned.map((a, idx) => {
                const role = roles[idx]
                const hasSuggestion = !!role?.suggestion
                return (
                  <div key={a.signer_role_id} style={{
                    border: '1px solid var(--c-border)',
                    borderRadius: 12, overflow: 'hidden',
                  }}>
                    {/* Role header */}
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: 'var(--c-hover)',
                      borderBottom: '1px solid var(--c-border)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{
                        display: 'inline-block', width: 10, height: 10,
                        borderRadius: '50%', backgroundColor: a.color, flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{a.role_name}</span>
                      {hasSuggestion && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, marginLeft: 'auto',
                          backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A',
                          border: '1px solid rgba(74,207,154,0.3)',
                        }}>
                          Auto-filled
                        </span>
                      )}
                    </div>

                    {/* Editable fields */}
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        placeholder="Full name"
                        value={a.name}
                        onChange={e => updateAssigned(a.signer_role_id, 'name', e.target.value)}
                        style={{
                          width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7,
                          backgroundColor: 'var(--c-input-bg)',
                          border: '1px solid var(--c-border)',
                          color: 'var(--c-primary)', outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                      <input
                        placeholder="Email address"
                        type="email"
                        value={a.email}
                        onChange={e => updateAssigned(a.signer_role_id, 'email', e.target.value)}
                        style={{
                          width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7,
                          backgroundColor: 'var(--c-input-bg)',
                          border: `1px solid ${!a.email.trim() ? '#ef4444' : 'var(--c-border)'}`,
                          color: 'var(--c-primary)', outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && roles.length > 0 && (
          <div style={{ padding: '16px 20px 22px', borderTop: '1px solid var(--c-border)' }}>
            {error && (
              <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', marginBottom: 10 }}>{error}</p>
            )}
            {missingRoles.length > 0 && (
              <p style={{ fontSize: 11, color: '#f59e0b', textAlign: 'center', marginBottom: 8 }}>
                Please fill in email for: {missingRoles.join(', ')}
              </p>
            )}
            <button
              onClick={handleSend}
              disabled={sending || !isValid}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                fontSize: 14, fontWeight: 700, cursor: isValid ? 'pointer' : 'not-allowed',
                backgroundColor: '#0A1F44', color: '#C9A84C', border: 'none',
                opacity: (!isValid || sending) ? 0.5 : 1,
              }}
            >
              {sending ? 'Sending…' : `✉️ Send for Signature (${assigned.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
