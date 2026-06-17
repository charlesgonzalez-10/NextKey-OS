'use client'

import { useMemo } from 'react'
import {
  resolveTemplate,
  findMissingVars,
  varLabel,
  TemplateContext,
} from '@/lib/email/template-variables'

interface Props {
  subject:   string
  body:      string
  context?:  TemplateContext
  onClose:   () => void
  onSend?:   () => void
  sending?:  boolean
}

export default function EmailPreviewModal({ subject, body, context = {}, onClose, onSend, sending }: Props) {
  const resolvedSubject = useMemo(() => resolveTemplate(subject, context), [subject, context])
  const resolvedBody    = useMemo(() => resolveTemplate(body,    context), [body,    context])

  const missingSubject = useMemo(() => findMissingVars(resolvedSubject), [resolvedSubject])
  const missingBody    = useMemo(() => findMissingVars(resolvedBody),    [resolvedBody])
  const allMissing     = [...new Set([...missingSubject, ...missingBody])]

  const highlightMissing = (html: string) =>
    html.replace(/\{\{([^}]+)\}\}/g, (match) =>
      `<mark style="background:#fef2f2;color:#ef4444;padding:1px 4px;border-radius:3px;border:1px solid #fecaca">${match}</mark>`
    )

  const previewBodyHtml = highlightMissing(resolvedBody)

  const srcDoc = `<!DOCTYPE html><html><head><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a;margin:0;padding:16px}
    *{max-width:100%;box-sizing:border-box}img{max-width:100%;height:auto}
    a{color:#1a73e8}
  </style></head><body>${previewBodyHtml || '<em style="color:#999">No body</em>'}</body></html>`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      backgroundColor: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 680,
        backgroundColor: 'var(--c-card)',
        borderRadius: 14,
        border: '1px solid var(--c-border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)' }}>Email Preview</span>
            {allMissing.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, backgroundColor: '#fef2f2', color: '#ef4444', padding: '2px 8px', borderRadius: 10, border: '1px solid #fecaca' }}>
                {allMissing.length} unfilled variable{allMissing.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Missing variables warning */}
        {allMissing.length > 0 && (
          <div style={{ margin: '12px 20px 0', padding: '10px 14px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>Missing variables — fill in before sending:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allMissing.map(k => (
                <span key={k} style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', backgroundColor: '#fee2e2', padding: '2px 8px', borderRadius: 6 }}>
                  {varLabel(k)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Subject */}
        <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subject</span>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-primary)', marginTop: 4 }}
            dangerouslySetInnerHTML={{ __html: highlightMissing(resolvedSubject) || '<em style="color:#999">No subject</em>' }}
          />
        </div>

        {/* Divider */}
        <div style={{ height: 1, backgroundColor: 'var(--c-border)', margin: '12px 20px 0', flexShrink: 0 }} />

        {/* Body preview */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginTop: 12, marginBottom: 6 }}>Body</span>
          <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' }}>
            <iframe
              srcDoc={srcDoc}
              sandbox="allow-same-origin"
              style={{ width: '100%', minHeight: 200, border: 'none', display: 'block' }}
              onLoad={e => {
                const f = e.currentTarget
                if (f.contentDocument?.body) {
                  const h = f.contentDocument.body.scrollHeight
                  if (h > 0) f.style.height = (h + 24) + 'px'
                }
              }}
              title="Email preview"
            />
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)', flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
          {onSend && (
            <button
              onClick={onSend}
              disabled={sending}
              style={{
                padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                backgroundColor: allMissing.length > 0 ? '#6b7280' : '#C9A84C',
                color: allMissing.length > 0 ? '#fff' : '#0A1F44',
                border: 'none', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? 'Sending…' : allMissing.length > 0 ? 'Send Anyway' : 'Send'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}
          >
            {onSend ? 'Edit' : 'Close'}
          </button>
          {allMissing.length > 0 && (
            <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 4 }}>
              ⚠ Highlighted variables will appear as-is in sent email
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
