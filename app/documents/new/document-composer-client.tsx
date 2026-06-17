'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { variableLabel, buildAutoFill } from '@/lib/documents/template-utils'

const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false })

interface Template {
  id: string
  name: string
  category: string
  description: string | null
  variables: string[]
  is_builtin: boolean
}

const CATEGORY_LABEL: Record<string, string> = {
  offer: 'Offer', loi: 'LOI', assignment: 'Assignment', contract: 'Contract',
  disclosure: 'Disclosure', letter: 'Letter', other: 'Other',
}
const CATEGORY_COLORS: Record<string, string> = {
  offer: '#C9A84C', loi: '#818cf8', assignment: '#38bdf8',
  contract: '#4ACF9A', letter: '#fb923c', other: 'rgba(255,255,255,0.5)',
}

type Step = 'template' | 'fields' | 'signature' | 'generate'

export default function DocumentComposerClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const leadId        = searchParams.get('lead_id')
  const dealId        = searchParams.get('deal_id')
  const propertyId    = searchParams.get('property_id')
  const contactId     = searchParams.get('contact_id')
  const templateIdParam = searchParams.get('template_id')

  const [step, setStep]               = useState<Step>('template')
  const [templates, setTemplates]     = useState<Template[]>([])
  const autoPickedRef = useRef(false)
  const [selected, setSelected]       = useState<Template | null>(null)
  const [fields, setFields]           = useState<Record<string, string>>({})
  const [docName, setDocName]         = useState('')
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [savedSig, setSavedSig]       = useState<string | null>(null)
  const [includeSignature, setIncludeSignature] = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [offerAmount, setOfferAmount] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [expiresAt, setExpiresAt]     = useState('')

  // Load templates + auto-fill data
  useEffect(() => {
    fetch('/api/document-templates')
      .then(r => r.json())
      .then(setTemplates)
      .catch(() => {})

    // Fetch signature
    fetch('/api/user/signature')
      .then(r => r.json())
      .then(d => { if (d.signature_data) setSavedSig(d.signature_data) })
      .catch(() => {})
  }, [])

  const loadAutoFill = useCallback(async (tmpl: Template) => {
    const [profRes, leadRes, dealRes, propRes, contactRes] = await Promise.allSettled([
      fetch('/api/user/signature').then(r => r.json()),
      leadId     ? fetch(`/api/leads/${leadId}`).then(r => r.json())         : Promise.resolve(null),
      dealId     ? fetch(`/api/deals/${dealId}`).then(r => r.json())         : Promise.resolve(null),
      propertyId ? fetch(`/api/properties/${propertyId}`).then(r => r.json()): Promise.resolve(null),
      contactId  ? fetch(`/api/contacts/${contactId}`).then(r => r.json())   : Promise.resolve(null),
    ])

    const prof    = profRes.status    === 'fulfilled' ? profRes.value    : {}
    const lead    = leadRes.status    === 'fulfilled' ? leadRes.value    : null
    const deal    = dealRes.status    === 'fulfilled' ? dealRes.value    : null
    const prop    = propRes.status    === 'fulfilled' ? propRes.value    : null
    const contact = contactRes.status === 'fulfilled' ? contactRes.value : null

    const auto = buildAutoFill({
      user:     { ...prof },
      property: prop,
      lead,
      contact,
      deal,
    })

    // Only fill variables this template uses
    const filled: Record<string, string> = {}
    for (const v of tmpl.variables) {
      filled[v] = auto[v] ?? ''
    }
    setFields(filled)

    if (deal?.offer_price) setOfferAmount(String(deal.offer_price))
    if (contact?.name)     setRecipientName(contact.name)
    if (contact?.email)    setRecipientEmail(contact.email)
  }, [leadId, dealId, propertyId, contactId])

  // Auto-pick a template when ?template_id= is in the URL (must come after loadAutoFill)
  useEffect(() => {
    if (!templateIdParam || templates.length === 0 || autoPickedRef.current) return
    const match = templates.find(t => t.id === templateIdParam)
    if (!match) return
    autoPickedRef.current = true
    setSelected(match)
    setDocName(match.name)
    loadAutoFill(match).then(() => setStep('fields'))
  }, [templates, templateIdParam, loadAutoFill])

  const pickTemplate = async (tmpl: Template) => {
    setSelected(tmpl)
    setDocName(tmpl.name)
    await loadAutoFill(tmpl)
    setStep('fields')
  }

  const generate = async () => {
    if (!selected) return
    setGenerating(true)
    setError(null)

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id:      selected.id,
          name:             docName,
          filled_data:      fields,
          property_id:      propertyId || null,
          lead_id:          leadId     || null,
          contact_id:       contactId  || null,
          deal_id:          dealId     || null,
          offer_amount:     offerAmount ? parseFloat(offerAmount) : null,
          recipient_name:   recipientName || null,
          recipient_email:  recipientEmail || null,
          expires_at:       expiresAt || null,
          include_signature: includeSignature,
        }),
      })

      const doc = await res.json()
      if (!res.ok) throw new Error(doc.error ?? 'Generation failed')

      // Log activity + save initial version
      await Promise.allSettled([
        fetch(`/api/documents/${doc.id}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generated', notes: `Generated from template: ${selected?.name}` }),
        }),
        fetch(`/api/documents/${doc.id}/versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      ])

      router.push(`/documents/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate document')
    } finally {
      setGenerating(false)
    }
  }

  const saveSignature = async (dataUrl: string) => {
    setSignatureDataUrl(dataUrl)
    setSavedSig(dataUrl)
    await fetch('/api/user/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature_data: dataUrl }),
    })
  }

  // ── Step: Template picker ──────────────────────────────────────────────────
  if (step === 'template') {
    const byCategory: Record<string, Template[]> = {}
    for (const t of templates) {
      const cat = t.category
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(t)
    }

    return (
      <div style={{ color: 'var(--c-primary)', maxWidth: 840, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <a href="/documents" style={{ color: 'var(--c-text-2)', textDecoration: 'none', fontSize: 13 }}>← Documents</a>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>New Document</h1>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 28 }}>Choose a template to get started</p>

        {Object.entries(byCategory).map(([cat, tmpls]) => (
          <div key={cat} style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-2)', marginBottom: 12 }}>
              {CATEGORY_LABEL[cat] ?? cat}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {tmpls.map(t => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t)}
                  style={{
                    padding: '18px 20px', borderRadius: 14, textAlign: 'left',
                    backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#C9A84C')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                      backgroundColor: `${CATEGORY_COLORS[cat]}22`,
                      color: CATEGORY_COLORS[cat] ?? 'rgba(255,255,255,0.5)',
                    }}>
                      {CATEGORY_LABEL[cat] ?? cat}
                    </span>
                    {t.is_builtin && (
                      <span style={{ fontSize: 10, color: 'var(--c-text-2)' }}>Built-in</span>
                    )}
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--c-primary)' }}>{t.name}</p>
                  {t.description && (
                    <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{t.description}</p>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--c-text-2)', marginTop: 8 }}>
                    {t.variables.length} variable{t.variables.length !== 1 ? 's' : ''}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--c-border)' }}>
          <a href="/documents/templates" style={{ fontSize: 13, color: '#C9A84C' }}>
            + Create a custom template
          </a>
        </div>
      </div>
    )
  }

  // ── Step: Fill Fields ──────────────────────────────────────────────────────
  if (step === 'fields') {
    const inputStyle: React.CSSProperties = {
      width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
      border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
      color: 'var(--c-primary)', boxSizing: 'border-box',
    }
    return (
      <div style={{ color: 'var(--c-primary)', maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button onClick={() => setStep('template')} style={{ background: 'none', border: 'none', color: 'var(--c-text-2)', fontSize: 13, cursor: 'pointer' }}>← Back</button>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Fill Document Fields</h1>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 28 }}>
          Fields are auto-filled from linked records. Edit any values before generating.
        </p>

        {/* Document name */}
        <div style={{ marginBottom: 24, padding: '20px 24px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-2)', display: 'block', marginBottom: 6 }}>Document Name</label>
          <input value={docName} onChange={e => setDocName(e.target.value)} style={inputStyle} />
        </div>

        {/* Offer tracking fields */}
        <div style={{ marginBottom: 24, padding: '20px 24px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-2)', marginBottom: 16 }}>Tracking</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Offer Amount ($)</label>
              <input type="number" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} placeholder="0" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Expires</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Recipient Name</label>
              <input value={recipientName} onChange={e => setRecipientName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Recipient Email</label>
              <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        {/* Template variables */}
        <div style={{ padding: '20px 24px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, marginBottom: 24 }}>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-2)', marginBottom: 16 }}>Document Variables</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {selected?.variables.map(v => (
              <div key={v}>
                <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>
                  {variableLabel(v)}
                  <span style={{ fontSize: 10, color: 'var(--c-text-2)', opacity: 0.6, marginLeft: 4 }}>{'{{' + v + '}}'}</span>
                </label>
                <input
                  value={fields[v] ?? ''}
                  onChange={e => setFields(p => ({ ...p, [v]: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setStep('signature')}
            style={{
              padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer',
            }}
          >
            Next: Signature →
          </button>
        </div>
      </div>
    )
  }

  // ── Step: Signature ────────────────────────────────────────────────────────
  if (step === 'signature') {
    return (
      <div style={{ color: 'var(--c-primary)', maxWidth: 640, margin: '0 auto', padding: '32px 24px' }}>
        <button onClick={() => setStep('fields')} style={{ background: 'none', border: 'none', color: 'var(--c-text-2)', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Add Signature</h1>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 28 }}>
          Your signature is saved securely and reused for future documents.
        </p>

        <div style={{ padding: '24px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, marginBottom: 24 }}>
          {savedSig ? (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#4ACF9A', marginBottom: 10 }}>Saved signature on file:</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={savedSig} alt="Saved signature" style={{ maxWidth: 300, maxHeight: 100, border: '1px solid var(--c-border)', borderRadius: 8, backgroundColor: '#fff', padding: 8 }} />
            </div>
          ) : null}

          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {savedSig ? 'Draw a new signature to replace:' : 'Draw your signature:'}
          </p>
          <SignaturePad
            onSave={saveSignature}
            existingDataUrl={null}
            width={480}
            height={160}
          />
        </div>

        {/* Toggle include signature */}
        <div style={{
          padding: '16px 20px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Include Signature in PDF</p>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
              {savedSig ? 'Your saved signature will be added to the document' : 'Save a signature above to enable this'}
            </p>
          </div>
          <button
            disabled={!savedSig}
            onClick={() => setIncludeSignature(v => !v)}
            style={{
              position: 'relative', width: 48, height: 26, borderRadius: 13,
              backgroundColor: includeSignature && savedSig ? '#C9A84C' : 'var(--c-hover)',
              border: '1px solid var(--c-border)', cursor: savedSig ? 'pointer' : 'not-allowed',
              opacity: savedSig ? 1 : 0.4, flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 3,
              left: includeSignature && savedSig ? 24 : 3,
              width: 18, height: 18, borderRadius: '50%',
              backgroundColor: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => setStep('generate')}
            style={{
              padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)',
              border: '1px solid var(--c-border)', cursor: 'pointer',
            }}
          >
            Skip →
          </button>
          <button
            onClick={() => setStep('generate')}
            style={{
              padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer',
            }}
          >
            Next: Generate →
          </button>
        </div>
      </div>
    )
  }

  // ── Step: Generate ─────────────────────────────────────────────────────────
  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 640, margin: '0 auto', padding: '32px 24px' }}>
      <button onClick={() => setStep('signature')} style={{ background: 'none', border: 'none', color: 'var(--c-text-2)', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← Back</button>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Review & Generate</h1>
      <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 28 }}>Review the details below, then generate your PDF.</p>

      <div style={{ padding: '20px 24px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            ['Document', docName],
            ['Template', selected?.name],
            ['Category', CATEGORY_LABEL[selected?.category ?? ''] ?? selected?.category],
            ...(offerAmount ? [['Offer Amount', `$${Number(offerAmount).toLocaleString()}`]] : []),
            ...(recipientName ? [['Recipient', recipientName]] : []),
            ['Signature', includeSignature && savedSig ? 'Included ✓' : 'Not included'],
            ...(leadId     ? [['Linked Lead', leadId.slice(0, 8) + '…']]         : []),
            ...(dealId     ? [['Linked Deal', dealId.slice(0, 8) + '…']]         : []),
            ...(propertyId ? [['Linked Property', propertyId.slice(0, 8) + '…']] : []),
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-2)' }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16,
          backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444',
          border: '1px solid rgba(239,68,68,0.25)', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <button
        onClick={generate}
        disabled={generating || !docName}
        style={{
          width: '100%', padding: '14px', borderRadius: 10, fontSize: 15, fontWeight: 700,
          backgroundColor: generating ? 'var(--c-hover)' : '#C9A84C',
          color: generating ? 'var(--c-text-2)' : '#0A1F44',
          border: 'none', cursor: generating ? 'not-allowed' : 'pointer',
        }}
      >
        {generating ? 'Generating PDF…' : 'Generate & Download PDF'}
      </button>

      <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 12, textAlign: 'center' }}>
        The PDF will download automatically and be saved to your Documents.
      </p>
    </div>
  )
}
