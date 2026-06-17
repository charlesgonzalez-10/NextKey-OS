'use client'

import { useState, useEffect, useRef } from 'react'

interface Template {
  id: string
  name: string
  subject: string
  body: string
  category: string | null
}

interface Attachment {
  filename: string
  mimeType: string
  data: string // base64
}

interface Props {
  defaultTo?: string
  defaultSubject?: string
  defaultBody?: string
  contactId?: string
  leadId?: string
  dealId?: string
  propertyId?: string
  propertyAddress?: string
  contactName?: string
  onClose: () => void
  onSent?: (messageId: string) => void
}

const OFFER_STATUSES = ['sent', 'countered', 'accepted', 'rejected', 'expired', 'dead'] as const
type OfferStatus = typeof OFFER_STATUSES[number]

const TEMPLATE_VARS: Record<string, string> = {
  contact_name:     'Contact Name',
  property_address: 'Property Address',
  offer_amount:     'Offer Amount',
  closing_date:     'Closing Date',
  my_name:          'My Name',
  company_name:     'Company Name',
}

function applyVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v || `{{${k}}}`),
    text
  )
}

export default function EmailComposer({
  defaultTo = '',
  defaultSubject = '',
  defaultBody = '',
  contactId,
  leadId,
  dealId,
  propertyId,
  propertyAddress = '',
  contactName = '',
  onClose,
  onSent,
}: Props) {
  const [to, setTo]             = useState(defaultTo)
  const [subject, setSubject]   = useState(defaultSubject)
  const [body, setBody]         = useState(defaultBody)
  const [cc, setCc]             = useState('')
  const [showCc, setShowCc]     = useState(false)
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')
  const [offerStatus, setOfferStatus] = useState<OfferStatus | ''>('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [templates, setTemplates]     = useState<Template[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({
    contact_name:     contactName,
    property_address: propertyAddress,
    offer_amount:     '',
    closing_date:     '',
    my_name:          'Charles Gonzalez',
    company_name:     'NextKey Property Solutions',
  })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/auth/gmail/status').then(r => r.json()).then(d => setGmailConnected(d.connected)).catch(() => setGmailConnected(false))
    fetch('/api/email-templates').then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {})
  }, [])

  const applyTemplate = (tpl: Template) => {
    setSubject(applyVars(tpl.subject, varValues))
    setBody(applyVars(tpl.body, varValues))
    setShowTemplates(false)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const newAtts = await Promise.all(files.map(file => new Promise<Attachment>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const data = (reader.result as string).split(',')[1] // strip data:...;base64,
        resolve({ filename: file.name, mimeType: file.type || 'application/octet-stream', data })
      }
      reader.readAsDataURL(file)
    })))
    setAttachments(prev => [...prev, ...newAtts])
    e.target.value = ''
  }

  const send = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setError('To, subject, and body are required.')
      return
    }
    setSending(true)
    setError('')
    // Convert plain-text newlines to <br> if body isn't already HTML
    const htmlBody = body.includes('<') ? body : body.replace(/\n/g, '<br>')

    const res = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: to.trim(),
        subject: subject.trim(),
        html_body: htmlBody,
        cc: cc.trim() || undefined,
        contact_id:  contactId,
        lead_id:     leadId,
        deal_id:     dealId,
        property_id: propertyId,
        attachments: attachments.length > 0 ? attachments : undefined,
        offer_status: offerStatus || undefined,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to send email.')
      setSending(false)
      return
    }
    onSent?.(data.messageId)
    onClose()
  }

  const resolvedBody = applyVars(body, varValues)
  const resolvedSubject = applyVars(subject, varValues)

  const hasVars = Object.keys(TEMPLATE_VARS).some(k => body.includes(`{{${k}}}`) || subject.includes(`{{${k}}}`))

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000, padding: '16px',
    }}>
      <div style={{
        backgroundColor: 'var(--c-bg)',
        border: '1px solid var(--c-border)',
        borderRadius: 16,
        width: '100%', maxWidth: 640,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--c-border)', flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Compose Email</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowTemplates(v => !v)}
              style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                backgroundColor: showTemplates ? 'var(--c-gold)' : 'var(--c-hover)',
                color: showTemplates ? '#0A1F44' : 'var(--c-primary)', border: 'none', cursor: 'pointer',
              }}
            >
              Templates
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--c-text-2)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Gmail not connected warning */}
        {gmailConnected === false && (
          <div style={{
            margin: '12px 20px 0', padding: '10px 14px', borderRadius: 8, fontSize: 13,
            backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.25)',
          }}>
            Gmail is not connected.{' '}
            <a href="/settings" style={{ color: '#ef4444', textDecoration: 'underline' }}>Connect it in Settings</a>{' '}
            before sending.
          </div>
        )}

        {/* Templates panel */}
        {showTemplates && (
          <div style={{
            margin: '12px 20px 0', borderRadius: 10, border: '1px solid var(--c-border)',
            backgroundColor: 'var(--c-card)', overflow: 'hidden',
          }}>
            {templates.length === 0 ? (
              <p style={{ padding: '12px 16px', fontSize: 13, color: 'var(--c-text-2)' }}>No templates yet.</p>
            ) : (
              templates.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)} style={{
                  width: '100%', textAlign: 'left', padding: '10px 16px',
                  backgroundColor: 'transparent', border: 'none', borderBottom: '1px solid var(--c-border)',
                  cursor: 'pointer', color: 'var(--c-primary)',
                }}>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 1 }}>{t.subject.slice(0, 60)}</p>
                </button>
              ))
            )}
          </div>
        )}

        {/* Variable fill-in (only shown if template has vars) */}
        {hasVars && (
          <div style={{ margin: '12px 20px 0', padding: '12px 16px', borderRadius: 10, backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--c-text-2)', marginBottom: 10 }}>Fill Template Variables</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {Object.entries(TEMPLATE_VARS).filter(([k]) => body.includes(`{{${k}}}`) || subject.includes(`{{${k}}}`)).map(([k, label]) => (
                <div key={k}>
                  <label style={{ fontSize: 11, color: 'var(--c-text-2)', display: 'block', marginBottom: 3 }}>{label}</label>
                  <input
                    value={varValues[k] ?? ''}
                    onChange={e => setVarValues(v => ({ ...v, [k]: e.target.value }))}
                    placeholder={label}
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12,
                      backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)',
                      color: 'var(--c-primary)', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {/* To */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', width: 48, flexShrink: 0 }}>To</label>
              <input
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="recipient@email.com"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              />
              {!showCc && (
                <button onClick={() => setShowCc(true)} style={{ fontSize: 12, color: 'var(--c-text-2)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Cc</button>
              )}
            </div>
          </div>

          {showCc && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', width: 48, flexShrink: 0 }}>Cc</label>
              <input
                value={cc}
                onChange={e => setCc(e.target.value)}
                placeholder="cc@email.com"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              />
            </div>
          )}

          {/* Subject */}
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-2)', width: 48, flexShrink: 0 }}>Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            />
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your email here…"
            rows={10}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, fontSize: 13,
              backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)',
              color: 'var(--c-primary)', resize: 'vertical', fontFamily: 'inherit',
              boxSizing: 'border-box', lineHeight: 1.6,
            }}
          />

          {/* Offer status */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-2)', whiteSpace: 'nowrap' }}>Track as offer/contract:</label>
            <select
              value={offerStatus}
              onChange={e => setOfferStatus(e.target.value as OfferStatus | '')}
              style={{
                padding: '6px 10px', borderRadius: 7, fontSize: 12,
                backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)',
                color: 'var(--c-primary)', cursor: 'pointer',
              }}
            >
              <option value="">None</option>
              {OFFER_STATUSES.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Attachments */}
          <div style={{ marginTop: 12 }}>
            {attachments.map((att, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 7, backgroundColor: 'var(--c-hover)', marginBottom: 6, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-primary)' }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {att.filename}
                </span>
                <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--c-text-2)', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)',
                color: 'var(--c-text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              Attach PDF
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" multiple onChange={handleFile} style={{ display: 'none' }} />
          </div>

          {error && (
            <p style={{ marginTop: 12, fontSize: 13, color: '#ef4444' }}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          {hasVars ? (
            <p style={{ fontSize: 11, color: 'var(--c-text-2)', maxWidth: 320 }}>
              Preview: <em style={{ color: 'var(--c-primary)' }}>{resolvedSubject.slice(0, 50)}{resolvedSubject.length > 50 ? '…' : ''}</em>
            </p>
          ) : <div />}
          <button
            onClick={send}
            disabled={sending || gmailConnected === false}
            style={{
              padding: '10px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600,
              backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer',
              opacity: (sending || gmailConnected === false) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {sending ? 'Sending…' : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
