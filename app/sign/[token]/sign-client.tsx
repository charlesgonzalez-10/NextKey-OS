'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType = 'signature' | 'initials' | 'date' | 'text' | 'checkbox'

interface SigningField {
  id: string; type: FieldType; page: number
  x: number; y: number; w: number; h: number
  required: boolean; label?: string
}

interface SessionInfo {
  flow: 'session'
  session_id: string; title: string
  signer_name: string; signer_email: string
  signer_role: string | null; signer_color: string
  signer_ref_id: string; pdf_url: string | null
  fields: SigningField[]
}

interface LegacyInfo {
  flow: 'legacy'
  document_name: string; recipient_name: string | null
  recipient_email: string; message: string | null
  expires_at: string; pdf_url: string | null
}

// ── Shared: signature pad ─────────────────────────────────────────────────────

function SignaturePad({ onCapture, compact }: { onCapture: (data: string | null) => void; compact?: boolean }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const drawing     = useRef(false)
  const [isEmpty, setIsEmpty]     = useState(true)
  const [mode, setMode]           = useState<'draw' | 'type'>('draw')
  const [typedName, setTypedName] = useState('')

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width; const sy = canvas.height / rect.height
    if ('touches' in e) return { x: (e.touches[0].clientX - rect.left) * sx, y: (e.touches[0].clientY - rect.top) * sy }
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return
    e.preventDefault(); drawing.current = true
    const ctx = canvas.getContext('2d')!; const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }, [])

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    if (!drawing.current) return
    const canvas = canvasRef.current; if (!canvas) return
    e.preventDefault()
    const ctx = canvas.getContext('2d')!; const pos = getPos(e, canvas)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#0A1F44'
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
    setIsEmpty(false); onCapture(canvas.toDataURL('image/png'))
  }, [onCapture])

  const stopDraw = useCallback(() => { drawing.current = false }, [])

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || mode !== 'draw') return
    canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', draw)
    canvas.addEventListener('mouseup', stopDraw); canvas.addEventListener('mouseleave', stopDraw)
    canvas.addEventListener('touchstart', startDraw, { passive: false })
    canvas.addEventListener('touchmove', draw, { passive: false })
    canvas.addEventListener('touchend', stopDraw)
    return () => {
      canvas.removeEventListener('mousedown', startDraw); canvas.removeEventListener('mousemove', draw)
      canvas.removeEventListener('mouseup', stopDraw); canvas.removeEventListener('mouseleave', stopDraw)
      canvas.removeEventListener('touchstart', startDraw); canvas.removeEventListener('touchmove', draw)
      canvas.removeEventListener('touchend', stopDraw)
    }
  }, [startDraw, draw, stopDraw, mode])

  const clear = () => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true); onCapture(null)
  }

  useEffect(() => {
    if (mode !== 'type') return
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (typedName.trim()) {
      ctx.font = `italic ${compact ? '28' : '36'}px Georgia, serif`
      ctx.fillStyle = '#0A1F44'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(typedName, canvas.width / 2, canvas.height / 2)
      setIsEmpty(false); onCapture(canvas.toDataURL('image/png'))
    } else { setIsEmpty(true); onCapture(null) }
  }, [typedName, mode, compact, onCapture])

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {(['draw', 'type'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); clear() }}
              className={`px-3 py-1.5 font-medium capitalize transition-colors ${mode === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              {m}
            </button>
          ))}
        </div>
        {!isEmpty && <button onClick={clear} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Clear</button>}
      </div>
      {mode === 'type' && (
        <input value={typedName} onChange={e => setTypedName(e.target.value)}
          placeholder="Type your name" className="w-full mb-2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
      )}
      <div className="relative border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 overflow-hidden" style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} width={500} height={compact ? 90 : 140} className={`w-full ${compact ? 'h-20' : 'h-32'} cursor-crosshair block`} />
        {isEmpty && mode === 'draw' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-300">Draw here</p>
          </div>
        )}
        <div className="absolute bottom-4 left-8 right-8 border-b border-gray-300" />
      </div>
    </div>
  )
}

// ── Session signing flow ──────────────────────────────────────────────────────

interface FieldModalProps {
  field: SigningField
  color: string
  currentValue: string | null
  onSave: (value: string) => void
  onClose: () => void
}

function FieldModal({ field, color, currentValue, onSave, onClose }: FieldModalProps) {
  const [sigData, setSigData] = useState<string | null>(currentValue)
  const [textVal, setTextVal] = useState(currentValue ?? '')
  const [dateVal, setDateVal] = useState(currentValue ?? new Date().toLocaleDateString('en-US'))
  const [checked, setChecked] = useState(currentValue === 'checked')

  const save = () => {
    if (field.type === 'signature' || field.type === 'initials') { if (sigData) onSave(sigData) }
    else if (field.type === 'date') onSave(dateVal)
    else if (field.type === 'text') { if (textVal.trim()) onSave(textVal.trim()) }
    else if (field.type === 'checkbox') onSave(checked ? 'checked' : '')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <h3 className="font-bold text-gray-900">{field.label || field.type}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {(field.type === 'signature' || field.type === 'initials') && (
          <SignaturePad onCapture={setSigData} compact={field.type === 'initials'} />
        )}
        {field.type === 'date' && (
          <input type="date"
            value={(() => {
              if (!dateVal) return new Date().toISOString().split('T')[0]
              if (dateVal.includes('/')) {
                const [m, d, y] = dateVal.split('/')
                return y && m && d ? `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` : new Date().toISOString().split('T')[0]
              }
              return dateVal
            })()}
            onChange={e => setDateVal(e.target.value ? new Date(e.target.value + 'T00:00:00').toLocaleDateString('en-US') : '')}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
          />
        )}
        {field.type === 'text' && (
          <input value={textVal} onChange={e => setTextVal(e.target.value)}
            placeholder={field.label || 'Enter text…'}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" />
        )}
        {field.type === 'checkbox' && (
          <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-gray-200 hover:bg-gray-50">
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
              className="w-5 h-5" />
            <span className="text-sm text-gray-700">{field.label || 'Check to agree'}</span>
          </label>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={save}
            disabled={
              (field.type === 'signature' || field.type === 'initials') ? !sigData :
              field.type === 'text' ? !textVal.trim() : false
            }
            className="flex-1 py-2.5 text-sm font-bold rounded-xl text-white disabled:opacity-40"
            style={{ backgroundColor: color }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

function SessionSigningPage({ token, info }: { token: string; info: SessionInfo }) {
  const [filledData, setFilledData] = useState<Record<string, string>>({})
  const [activeField, setActiveField] = useState<SigningField | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<'signed' | 'declined' | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [autoSig, setAutoSig] = useState<string | null>(null)
  const [autoInitials, setAutoInitials] = useState<string | null>(null)

  const color = info.signer_color ?? '#4CAF9A'

  // Generate signature/initials — canvas cropped tight to text so it fills the field
  useEffect(() => {
    const name = info.signer_name
    const render = (text: string) => {
      const fontSize = 58
      const pad = 10
      // Measure text dimensions first
      const tmp = document.createElement('canvas')
      tmp.width = 1400; tmp.height = 200
      const tctx = tmp.getContext('2d')!
      tctx.font = `italic ${fontSize}px Georgia, serif`
      const m = tctx.measureText(text)
      const tw = Math.ceil(m.width)
      const th = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)
      // Render to exactly-sized canvas
      const canvas = document.createElement('canvas')
      canvas.width = tw + pad * 2; canvas.height = th + pad * 2
      const ctx = canvas.getContext('2d')!
      ctx.font = `italic ${fontSize}px Georgia, serif`
      ctx.fillStyle = '#0A1F44'
      ctx.textBaseline = 'top'
      ctx.fillText(text, pad, pad)
      return canvas.toDataURL('image/png')
    }
    const initials = name.split(/\s+/).map((w: string) => w[0]?.toUpperCase() ?? '').filter(Boolean).join('')
    setAutoSig(render(name))
    setAutoInitials(render(initials))
  }, [info.signer_name])

  const handleFieldClick = (field: SigningField) => {
    if (field.type === 'signature' && autoSig) {
      setFilledData(prev => ({ ...prev, [field.id]: autoSig }))
    } else if (field.type === 'initials' && autoInitials) {
      setFilledData(prev => ({ ...prev, [field.id]: autoInitials }))
    } else if (field.type === 'date') {
      setFilledData(prev => ({ ...prev, [field.id]: new Date().toLocaleDateString('en-US') }))
    } else if (field.type === 'checkbox') {
      setFilledData(prev => ({ ...prev, [field.id]: prev[field.id] === 'checked' ? '' : 'checked' }))
    } else {
      setActiveField(field)
    }
  }

  useEffect(() => {
    if (!info.pdf_url) return
    let cancelled = false
    const load = async () => {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const doc = await pdfjsLib.getDocument({ url: info.pdf_url! }).promise
      if (!cancelled) { setPdfDoc(doc); setNumPages(doc.numPages); setPdfLoading(false) }
    }
    load().catch(() => setPdfLoading(false))
    return () => { cancelled = true }
  }, [info.pdf_url])

  const requiredFields = info.fields.filter(f => f.required)
  const allRequiredFilled = requiredFields.every(f => filledData[f.id])
  const totalFields = info.fields.length
  const filledCount = info.fields.filter(f => filledData[f.id]).length

  const handleSubmit = async () => {
    setSubmitting(true); setSubmitError('')
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', fields_data: filledData }),
      })
      const d = await res.json()
      if (d.ok) setDone('signed')
      else setSubmitError(d.error ?? 'Signing failed.')
    } finally { setSubmitting(false) }
  }

  const handleDecline = async () => {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', decline_reason: declineReason }),
      })
      const d = await res.json()
      if (d.ok) setDone('declined')
      else setSubmitError(d.error ?? 'Failed to decline. Please try again.')
    } catch {
      setSubmitError('Network error — please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done === 'signed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Signing Complete</h1>
          <p className="text-sm text-gray-500">
            All your fields have been signed. You'll receive the fully executed contract and a Certificate of Completion by email.
          </p>
        </div>
      </div>
    )
  }

  if (done === 'declined') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Request Declined</h1>
          <p className="text-sm text-gray-500">The sender has been notified.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold tracking-tight" style={{ color: '#0A1F44' }}>NextKey</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>OS</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {filledCount}/{totalFields} field{totalFields !== 1 ? 's' : ''} filled
          </span>
          <div className="w-24 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${totalFields > 0 ? (filledCount / totalFields) * 100 : 0}%`, backgroundColor: color }} />
          </div>
        </div>
      </header>

      {/* Info bar */}
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0"
              style={{ backgroundColor: color }}>
              {info.signer_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{info.signer_name}</p>
              <p className="text-xs text-gray-500">{info.signer_role ? `${info.signer_role} · ` : ''}{info.signer_email}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="font-bold text-gray-900 text-sm">{info.title}</p>
              <p className="text-xs text-gray-400">Click each highlighted field to apply your signature</p>
            </div>
          </div>
        </div>

        {/* PDF pages with field overlays */}
        <div className="mb-4">
          {pdfLoading && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-400">Loading document…</p>
            </div>
          )}
          {!pdfLoading && pdfDoc && (
            <div className="flex flex-col items-center gap-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                <SigningPageCanvas
                  key={pageNum} pdfDoc={pdfDoc} pageNum={pageNum}
                  fields={info.fields.filter(f => f.page === pageNum)}
                  filledData={filledData} color={color}
                  onFieldClick={handleFieldClick}
                />
              ))}
            </div>
          )}
        </div>

        {/* Agreement + Submit */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
          <label className="flex items-start gap-3 cursor-pointer mb-5">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
            <span className="text-xs text-gray-500 leading-relaxed">
              By submitting, I confirm that my electronic signatures are the legal equivalent of my handwritten signatures, and I have reviewed and agree to the terms of this document.
            </span>
          </label>

          <button onClick={handleSubmit}
            disabled={!allRequiredFilled || !agreed || submitting}
            className="w-full py-3.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
            {submitting ? 'Submitting…' : `Complete Signing (${filledCount}/${totalFields} fields)`}
          </button>

          {submitError && <p className="text-xs text-center mt-2 text-red-500">{submitError}</p>}

          {!showDecline ? (
            <button onClick={() => setShowDecline(true)} className="w-full text-xs text-gray-400 hover:text-gray-600 mt-3 py-1">
              Decline to sign
            </button>
          ) : (
            <div className="mt-4 bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-700 mb-2">Reason for declining (optional)</p>
              <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={2}
                className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:outline-none bg-white resize-none" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setShowDecline(false)} className="flex-1 py-2 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">Cancel</button>
                <button onClick={handleDecline} disabled={submitting}
                  className="flex-1 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50">
                  Confirm Decline
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mb-8">
          Secured by NextKey OS · This link is private and unique to you.
        </p>
      </div>

      {/* Field modal */}
      {activeField && (
        <FieldModal
          field={activeField} color={color}
          currentValue={filledData[activeField.id] ?? null}
          onSave={value => { setFilledData(prev => ({ ...prev, [activeField.id]: value })); setActiveField(null) }}
          onClose={() => setActiveField(null)}
        />
      )}
    </div>
  )
}

function SigningPageCanvas({ pdfDoc, pageNum, fields, filledData, color, onFieldClick }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any; pageNum: number
  fields: SigningField[]; filledData: Record<string, string>
  color: string; onFieldClick: (f: SigningField) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    const render = async () => {
      const page = await pdfDoc.getPage(pageNum)
      const scale = Math.min(760 / page.getViewport({ scale: 1 }).width, 1.5)
      const vp = page.getViewport({ scale })
      if (cancelled) return
      const canvas = canvasRef.current; if (!canvas) return
      canvas.width = vp.width; canvas.height = vp.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      if (!cancelled) setDims({ w: vp.width, h: vp.height })
    }
    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageNum])

  return (
    <div className="relative bg-white shadow-md" style={{ display: 'inline-block' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {dims.w > 0 && fields.map(field => {
        const filled = !!filledData[field.id]
        const px = field.x * dims.w; const py = field.y * dims.h
        const pw = field.w * dims.w; const ph = field.h * dims.h

        return (
          <button key={field.id} onClick={() => onFieldClick(field)}
            title={`${field.label || field.type} — click to ${filled ? 're-sign' : 'sign'}`}
            style={{
              position: 'absolute', left: px, top: py, width: pw, height: ph,
              backgroundColor: filled ? `${color}20` : `${color}35`,
              border: `2px solid ${filled ? color + 'a0' : color}`,
              borderRadius: 3, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
            {filled ? (
              field.type === 'signature' || field.type === 'initials' ? (
                <img src={filledData[field.id]} alt="signature"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }} />
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, color, padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {field.type === 'checkbox' ? '✓' : filledData[field.id]}
                </span>
              )
            ) : (
              <span style={{ fontSize: 10, fontWeight: 600, color: color + 'cc', whiteSpace: 'nowrap' }}>
                {field.required ? '* ' : ''}{field.label || field.type}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Legacy signing flow ───────────────────────────────────────────────────────

function LegacySigningPage({ token, info }: { token: string; info: LegacyInfo }) {
  const [sigData, setSigData]         = useState<string | null>(null)
  const [signerName, setSignerName]   = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [done, setDone]               = useState<'signed' | 'declined' | null>(null)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [showPdf, setShowPdf]         = useState(false)
  const [agreed, setAgreed]           = useState(false)
  const [error, setError]             = useState('')

  const handleSign = async () => {
    if (!sigData || !agreed) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_data: sigData, signer_name: signerName, action: 'sign' }),
      })
      const d = await res.json()
      if (d.ok) setDone('signed')
      else setError(d.error ?? 'Signing failed.')
    } finally { setSubmitting(false) }
  }

  const handleDecline = async () => {
    setSubmitting(true)
    await fetch(`/api/sign/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decline', decline_reason: declineReason }),
    })
    setDone('declined'); setSubmitting(false)
  }

  if (done === 'signed') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Document Signed</h1>
        <p className="text-sm text-gray-500">A fully executed copy has been emailed to you and the sender.</p>
      </div>
    </div>
  )

  if (done === 'declined') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
        <div className="text-6xl mb-4">🚫</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Request Declined</h1>
        <p className="text-sm text-gray-500">The sender has been notified.</p>
      </div>
    </div>
  )

  const expiry = new Date(info.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold tracking-tight" style={{ color: '#0A1F44' }}>NextKey</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>OS</span>
        </div>
        <span className="text-xs text-gray-400">Secure Document Signing</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
          <div className="flex items-start gap-4">
            <div className="text-3xl">📄</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{info.document_name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">For {info.recipient_name ?? info.recipient_email}</p>
              {info.message && <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">{info.message}</p>}
              <p className="text-xs text-gray-400 mt-2">Expires {expiry}</p>
            </div>
          </div>
          {info.pdf_url && (
            <button onClick={() => setShowPdf(v => !v)}
              className="mt-4 w-full text-sm font-medium py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2">
              {showPdf ? 'Hide Document' : 'Review Document'}
            </button>
          )}
        </div>

        {showPdf && info.pdf_url && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
            <iframe src={info.pdf_url} className="w-full" style={{ height: '60vh' }} title="Document preview" />
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Sign Below</h2>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Full Name *</label>
            <input value={signerName} onChange={e => setSignerName(e.target.value)}
              placeholder={info.recipient_name ?? 'Your full legal name'}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" />
          </div>
          <SignaturePad onCapture={setSigData} />
          <label className="flex items-start gap-3 mt-5 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
            <span className="text-xs text-gray-500 leading-relaxed">
              By signing, I agree that my electronic signature is legally binding. I have reviewed the document and agree to its terms.
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <button onClick={handleSign} disabled={!sigData || !signerName.trim() || !agreed || submitting}
            className="w-full py-3.5 rounded-xl text-sm font-bold disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
            {submitting ? 'Submitting…' : '✍️  Sign Document'}
          </button>
          {error && <p className="text-center text-sm text-red-500">{error}</p>}
          {!showDecline ? (
            <button onClick={() => setShowDecline(true)} className="text-xs text-gray-400 hover:text-gray-600 py-1 text-center">
              Decline to sign
            </button>
          ) : (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-700 mb-2">Reason for declining (optional)</p>
              <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={2}
                className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:outline-none bg-white resize-none" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setShowDecline(false)} className="flex-1 py-2 text-xs border border-gray-200 rounded-lg text-gray-500">Cancel</button>
                <button onClick={handleDecline} disabled={submitting}
                  className="flex-1 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg disabled:opacity-50">
                  Confirm Decline
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-gray-300 mt-6">Secured by NextKey OS</p>
      </div>
    </div>
  )
}

// ── Root: detect flow and route ───────────────────────────────────────────────

export default function SignClient({ token }: { token: string }) {
  const [data, setData]         = useState<SessionInfo | LegacyInfo | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch(`/api/sign/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setErrorStatus(d.errorStatus ?? null) }
        else setData(d)
      })
      .catch(() => setError('Failed to load signing request.'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Loading document…</p>
      </div>
    </div>
  )

  if (error) {
    const icon = errorStatus === 'signed' ? '✅' : errorStatus === 'declined' ? '🚫' : errorStatus === 'expired' ? '⏰' : '⚠️'
    const label = errorStatus === 'signed' ? 'Already Signed' : errorStatus === 'declined' ? 'Request Declined' : errorStatus === 'expired' ? 'Link Expired' : 'Link Not Found'
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">{icon}</div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">{label}</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  if (data.flow === 'session') return <SessionSigningPage token={token} info={data} />
  return <LegacySigningPage token={token} info={data} />
}
