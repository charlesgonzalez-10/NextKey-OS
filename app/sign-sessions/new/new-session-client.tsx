'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType = 'signature' | 'initials' | 'date' | 'text' | 'checkbox'

interface SigningField {
  id: string; type: FieldType; page: number
  x: number; y: number; w: number; h: number
  signer_id: string; required: boolean; label?: string
}

interface Signer {
  id: string; name: string; email: string; role: string; color: string
}

interface Template {
  id: string; name: string; category: string; page_count: number | null; created_at: string
}

const SIGNER_COLORS = ['#4CAF9A', '#7B8FD4', '#E07B6A', '#C9A84C', '#6ABDE0', '#B06AE0']

const FIELD_DEFAULTS: Record<FieldType, { w: number; h: number; label: string }> = {
  signature: { w: 0.22, h: 0.055, label: 'Signature' },
  initials:  { w: 0.10, h: 0.045, label: 'Initials' },
  date:      { w: 0.14, h: 0.038, label: 'Date' },
  text:      { w: 0.20, h: 0.038, label: 'Text' },
  checkbox:  { w: 0.026, h: 0.026, label: '' },
}

const FIELD_ICONS: Record<FieldType, string> = {
  signature: '✍', initials: 'IN', date: '📅', text: 'T', checkbox: '☑',
}

// ── Per-page canvas + field overlay component ─────────────────────────────────

interface PageWithFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any
  pageNum: number
  scale: number
  fields: SigningField[]
  signers: Signer[]
  activeSignerId: string
  activeTool: FieldType | null
  selectedFieldId: string | null
  onPlaceField: (page: number, x: number, y: number) => void
  onSelectField: (id: string) => void
  onDeleteField: (id: string) => void
  onDragField: (e: React.MouseEvent, fieldId: string, pw: number, ph: number) => void
  onDimsReady: (page: number, w: number, h: number) => void
}

function PageWithFields({
  pdfDoc, pageNum, scale, fields, signers, activeTool, activeSignerId,
  selectedFieldId, onPlaceField, onSelectField, onDeleteField, onDragField, onDimsReady,
}: PageWithFieldsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    const render = async () => {
      const page = await pdfDoc.getPage(pageNum)
      const vp = page.getViewport({ scale })
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = vp.width; canvas.height = vp.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      if (!cancelled) { setDims({ w: vp.width, h: vp.height }); onDimsReady(pageNum, vp.width, vp.height) }
    }
    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageNum, scale, onDimsReady])

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeTool || !activeSignerId || !dims.w) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / dims.w
    const y = (e.clientY - rect.top) / dims.h
    onPlaceField(pageNum, x, y)
  }

  const pageFields = fields.filter(f => f.page === pageNum)

  return (
    <div style={{ position: 'relative', marginBottom: 16, display: 'inline-block', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {/* Overlay for click-to-place */}
      <div
        onClick={handleOverlayClick}
        style={{
          position: 'absolute', inset: 0,
          cursor: activeTool ? 'crosshair' : 'default',
        }}
      />
      {/* Field markers */}
      {dims.w > 0 && pageFields.map(field => {
        const signer = signers.find(s => s.id === field.signer_id)
        const color = signer?.color ?? '#C9A84C'
        const isSelected = field.id === selectedFieldId
        return (
          <div
            key={field.id}
            onMouseDown={e => { e.stopPropagation(); onDragField(e, field.id, dims.w, dims.h) }}
            onClick={e => { e.stopPropagation(); onSelectField(field.id) }}
            style={{
              position: 'absolute',
              left: `${field.x * dims.w}px`,
              top: `${field.y * dims.h}px`,
              width: `${field.w * dims.w}px`,
              height: `${field.h * dims.h}px`,
              backgroundColor: `${color}28`,
              border: `2px solid ${isSelected ? color : color + '90'}`,
              borderRadius: 3,
              cursor: 'move',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: field.type === 'checkbox' ? 14 : 10,
              fontWeight: 700, color,
              userSelect: 'none', zIndex: 10,
              boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 3px ${color}` : undefined,
              overflow: 'hidden',
            }}
          >
            <span style={{ pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: field.type === 'checkbox' ? 16 : 9 }}>
              {FIELD_ICONS[field.type]}{field.type !== 'checkbox' && field.label ? ` ${field.label}` : ''}
            </span>
            {isSelected && (
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onDeleteField(field.id) }}
                style={{
                  position: 'absolute', top: -9, right: -9,
                  width: 18, height: 18, borderRadius: '50%',
                  backgroundColor: '#ef4444', color: '#fff',
                  fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, zIndex: 11,
                }}
              >×</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function NewSessionClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const contractTemplateIdParam = searchParams.get('contract_template_id')
  const documentIdParam         = searchParams.get('document_id')
  const [step, setStep] = useState<'setup' | 'editor' | 'sending'>('setup')

  // Setup
  const [title, setTitle] = useState('')
  const [sourcePdf, setSourcePdf] = useState<{ path: string; name: string } | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [signers, setSigners] = useState<Signer[]>([
    { id: crypto.randomUUID(), name: '', email: '', role: 'Buyer', color: SIGNER_COLORS[0] },
  ])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [setupError, setSetupError] = useState('')

  // Editor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [numPages, setNumPages] = useState(0)
  const [fields, setFields] = useState<SigningField[]>([])
  const [activeTool, setActiveTool] = useState<FieldType | null>(null)
  const [activeSignerId, setActiveSignerId] = useState('')
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({})
  const [pdfLoading, setPdfLoading] = useState(false)

  // Sending
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ signers: { name: string; email: string; signing_url: string }[] } | null>(null)
  const [sendError, setSendError] = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  useEffect(() => {
    setLoadingTemplates(true)
    fetch('/api/contract-templates')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : []
        setTemplates(list)
        setLoadingTemplates(false)
        if (contractTemplateIdParam) {
          const match = list.find((t: Template) => t.id === contractTemplateIdParam)
          if (match) selectTemplate(match)
        }
      })
      .catch(() => setLoadingTemplates(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-load a pre-generated document when coming from Generate Contract flow
  useEffect(() => {
    if (!documentIdParam) return
    fetch(`/api/documents/${documentIdParam}/url`)
      .then(r => r.json())
      .then(d => {
        if (d.url) setPdfUrl(d.url)
        if (d.name) { setTitle(d.name); setSourcePdf({ path: d.pdf_path ?? '', name: d.name }) }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentIdParam])

  useEffect(() => {
    if (signers.length > 0 && !activeSignerId) setActiveSignerId(signers[0].id)
  }, [signers, activeSignerId])

  // Load PDF with pdfjs when entering editor
  useEffect(() => {
    if (step !== 'editor' || !pdfUrl) return
    let cancelled = false
    const load = async () => {
      setPdfLoading(true)
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise
      if (!cancelled) { setPdfDoc(doc); setNumPages(doc.numPages); setPdfLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [step, pdfUrl])

  // ── Setup handlers ──────────────────────────────────────────────────────────

  const handleFileUpload = async (file: File) => {
    if (file.type !== 'application/pdf') { setSetupError('Please select a PDF file.'); return }
    setUploading(true); setSetupError('')
    const fd = new FormData()
    fd.append('file', file); fd.append('name', file.name.replace(/\.pdf$/i, ''))
    const res = await fetch('/api/contract-templates/upload', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setSetupError(data.error ?? 'Upload failed'); return }
    setTemplates(prev => [data, ...prev])
    setSourcePdf({ path: data.file_path, name: data.name })
    if (!title) setTitle(data.name)
    const urlRes = await fetch(`/api/contract-templates/${data.id}`)
    const urlData = await urlRes.json()
    if (urlData.url) setPdfUrl(urlData.url)
  }

  const selectTemplate = async (t: Template) => {
    const res = await fetch(`/api/contract-templates/${t.id}`)
    const data = await res.json()
    if (data.file_path) setSourcePdf({ path: data.file_path, name: data.name })
    if (!title) setTitle(data.name)
    if (data.url) setPdfUrl(data.url)
  }

  const addSigner = () => {
    const color = SIGNER_COLORS[signers.length % SIGNER_COLORS.length]
    setSigners(prev => [...prev, { id: crypto.randomUUID(), name: '', email: '', role: '', color }])
  }
  const updateSigner = (id: string, patch: Partial<Signer>) =>
    setSigners(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  const removeSigner = (id: string) => {
    setSigners(prev => prev.filter(s => s.id !== id))
    setFields(prev => prev.filter(f => f.signer_id !== id))
  }

  const canProceed = title.trim() && sourcePdf && signers.length > 0 && signers.every(s => s.name.trim() && s.email.trim())

  // ── Editor handlers ─────────────────────────────────────────────────────────

  const handleDimsReady = useCallback((page: number, w: number, h: number) => {
    setPageDims(prev => ({ ...prev, [page]: { w, h } }))
  }, [])

  const handlePlaceField = useCallback((page: number, xFrac: number, yFrac: number) => {
    if (!activeTool || !activeSignerId) return
    const defaults = FIELD_DEFAULTS[activeTool]
    const newField: SigningField = {
      id: crypto.randomUUID(), type: activeTool, page,
      x: Math.max(0, Math.min(xFrac - defaults.w / 2, 1 - defaults.w)),
      y: Math.max(0, Math.min(yFrac - defaults.h / 2, 1 - defaults.h)),
      w: defaults.w, h: defaults.h,
      signer_id: activeSignerId, required: true, label: defaults.label,
    }
    setFields(prev => [...prev, newField])
    setSelectedFieldId(newField.id)
  }, [activeTool, activeSignerId])

  const handleDragField = useCallback((e: React.MouseEvent, fieldId: string, pw: number, ph: number) => {
    e.stopPropagation()
    const field = fields.find(f => f.id === fieldId)
    if (!field) return
    const startX = e.clientX; const startY = e.clientY
    const origX = field.x; const origY = field.y

    const onMove = (ev: MouseEvent) => {
      setFields(prev => prev.map(f => f.id === fieldId ? {
        ...f,
        x: Math.max(0, Math.min(origX + (ev.clientX - startX) / pw, 1 - f.w)),
        y: Math.max(0, Math.min(origY + (ev.clientY - startY) / ph, 1 - f.h)),
      } : f))
    }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    setSelectedFieldId(fieldId)
  }, [fields])

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
    if (selectedFieldId === id) setSelectedFieldId(null)
  }

  const selectedField = fields.find(f => f.id === selectedFieldId)

  // ── Send ─────────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!sourcePdf) return
    setSending(true); setSendError(''); setStep('sending')

    const createRes = await fetch('/api/signing-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, pdf_path: sourcePdf.path, fields, signers }),
    })
    const session = await createRes.json()
    if (!createRes.ok) { setSendError(session.error ?? 'Failed to create session'); setSending(false); return }

    const sendRes = await fetch(`/api/signing-sessions/${session.id}/send`, { method: 'POST' })
    const sendData = await sendRes.json()
    setSending(false)
    if (!sendRes.ok) { setSendError(sendData.error ?? 'Failed to send'); return }
    setSendResult(sendData)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Sending / done screen
  if (step === 'sending') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: 'var(--c-bg)' }}>
        <div className="w-full max-w-lg rounded-2xl p-8 text-center"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          {sending && !sendResult ? (
            <>
              <div className="text-3xl mb-4 animate-pulse">✉️</div>
              <p className="font-semibold" style={{ color: 'var(--c-primary)' }}>Sending to signers…</p>
            </>
          ) : sendResult ? (
            <>
              <div className="text-4xl mb-4">✅</div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Signing requests sent!</h2>
              <p className="text-sm mb-6" style={{ color: 'var(--c-text-2)' }}>
                Each signer received a unique link by email.
              </p>
              <div className="space-y-2 mb-6 text-left">
                {sendResult.signers.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl"
                    style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)' }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>{s.name}</p>
                      <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>{s.email}</p>
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(s.signing_url); setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 2000) }}
                      className="text-xs font-bold px-2.5 py-1 rounded-lg hover:opacity-80 shrink-0"
                      style={{ backgroundColor: copiedIdx === i ? 'rgba(34,197,94,0.15)' : 'rgba(201,168,76,0.15)', color: copiedIdx === i ? '#22c55e' : '#C9A84C', border: `1px solid ${copiedIdx === i ? '#22c55e40' : '#C9A84C40'}` }}>
                      {copiedIdx === i ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => router.push('/sign-sessions')}
                className="w-full py-3 rounded-xl font-bold text-sm hover:opacity-90"
                style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
                View All Sessions →
              </button>
            </>
          ) : (
            <>
              <div className="text-3xl mb-4">❌</div>
              <p className="font-semibold mb-2" style={{ color: '#ef4444' }}>{sendError || 'Something went wrong'}</p>
              <button onClick={() => { setStep('editor'); setSending(false) }}
                className="px-4 py-2 rounded-xl text-sm font-bold hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', border: '1px solid var(--c-border)' }}>
                ← Back to Editor
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // Editor
  if (step === 'editor') {
    return (
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-bg)' }}>

        {/* Left panel */}
        <div className="w-56 shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }}>
          <div className="p-4 shrink-0 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <button onClick={() => setStep('setup')}
              className="text-xs font-semibold hover:underline mb-3 block" style={{ color: 'var(--c-text-2)' }}>
              ← Back to Setup
            </button>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--c-primary)' }}>{title}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-2)' }}>{fields.length} fields</p>
          </div>

          {/* Field type tools */}
          <div className="p-3 shrink-0 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Add Field</p>
            <div className="space-y-1">
              {(Object.keys(FIELD_DEFAULTS) as FieldType[]).map(type => (
                <button key={type}
                  onClick={() => setActiveTool(prev => prev === type ? null : type)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-semibold"
                  style={{
                    backgroundColor: activeTool === type ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                    color: activeTool === type ? '#C9A84C' : 'var(--c-text-2)',
                    border: `1px solid ${activeTool === type ? '#C9A84C' : 'var(--c-border)'}`,
                  }}>
                  <span className="w-5 text-center text-sm">{FIELD_ICONS[type]}</span>
                  <span className="capitalize">{type}</span>
                </button>
              ))}
            </div>
            {activeTool ? (
              <p className="text-[10px] mt-2 text-center font-semibold" style={{ color: '#C9A84C' }}>
                Click PDF to place ↓
              </p>
            ) : (
              <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--c-text-3)' }}>
                Select a type above
              </p>
            )}
          </div>

          {/* Assign to signer */}
          <div className="p-3 shrink-0 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Assign To</p>
            {signers.map(s => (
              <button key={s.id} onClick={() => setActiveSignerId(s.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold text-left mb-1"
                style={{
                  backgroundColor: activeSignerId === s.id ? `${s.color}20` : 'var(--c-hover)',
                  border: `1px solid ${activeSignerId === s.id ? s.color : 'var(--c-border)'}`,
                  color: activeSignerId === s.id ? s.color : 'var(--c-text-2)',
                }}>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.name || 'Signer'}</span>
                {s.role && <span className="ml-auto text-[9px] shrink-0" style={{ color: 'var(--c-text-3)' }}>{s.role}</span>}
              </button>
            ))}
          </div>

          {/* Summary */}
          <div className="p-3 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>Summary</p>
            {signers.map(s => (
              <div key={s.id} className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-[11px] truncate max-w-[90px]" style={{ color: 'var(--c-text-2)' }}>{s.name || 'Signer'}</span>
                </div>
                <span className="text-[11px] font-bold" style={{ color: 'var(--c-primary)' }}>
                  {fields.filter(f => f.signer_id === s.id).length}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* PDF area */}
        <div
          className="flex-1 overflow-auto p-8"
          style={{ backgroundColor: '#d1d5db' }}
          onClick={() => { if (!activeTool) setSelectedFieldId(null) }}
        >
          {pdfLoading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm font-semibold" style={{ color: '#6b7280' }}>Loading PDF…</p>
            </div>
          )}
          {!pdfLoading && pdfDoc && (
            <div className="flex flex-col items-center">
              {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                <PageWithFields
                  key={pageNum}
                  pdfDoc={pdfDoc}
                  pageNum={pageNum}
                  scale={Math.min(800 / 612, 1.6)}
                  fields={fields}
                  signers={signers}
                  activeTool={activeTool}
                  activeSignerId={activeSignerId}
                  selectedFieldId={selectedFieldId}
                  onPlaceField={handlePlaceField}
                  onSelectField={setSelectedFieldId}
                  onDeleteField={removeField}
                  onDragField={handleDragField}
                  onDimsReady={handleDimsReady}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-52 shrink-0 flex flex-col border-l"
          style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }}>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedField ? (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-3)' }}>Field Properties</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Label</label>
                    <input
                      value={selectedField.label ?? ''}
                      onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, label: e.target.value } : f))}
                      className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Type</label>
                    <select
                      value={selectedField.type}
                      onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, type: e.target.value as FieldType } : f))}
                      className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                      {(Object.keys(FIELD_DEFAULTS) as FieldType[]).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Assign To</label>
                    <select
                      value={selectedField.signer_id}
                      onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, signer_id: e.target.value } : f))}
                      className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                      {signers.map(s => <option key={s.id} value={s.id}>{s.name || 'Signer'}{s.role ? ` (${s.role})` : ''}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedField.required}
                      onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, required: e.target.checked } : f))}
                      style={{ accentColor: '#C9A84C' }} />
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>Required</span>
                  </label>
                  <button onClick={() => removeField(selectedField.id)}
                    className="w-full text-xs font-semibold py-1.5 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                    Delete Field
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center pt-8">
                <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                  {activeTool ? `Click on the PDF to place a ${activeTool} field` : 'Select a field or pick a type to add'}
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t shrink-0" style={{ borderColor: 'var(--c-border)' }}>
            <button
              onClick={handleSend}
              disabled={fields.length === 0}
              className="w-full py-3 rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
              Send for Signatures
            </button>
            {fields.length === 0 && (
              <p className="text-[10px] text-center mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                Place at least one field
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Setup step ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--c-bg)' }}>
      <div className="max-w-2xl mx-auto p-6 md:p-10">

        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => router.push('/sign-sessions')}
            className="text-sm font-semibold hover:underline" style={{ color: 'var(--c-text-2)' }}>
            ← Back
          </button>
          <h1 className="text-xl font-bold" style={{ color: 'var(--c-primary)' }}>New Signing Session</h1>
        </div>

        {/* Title */}
        <section className="mb-6">
          <label className="block text-sm font-bold mb-2" style={{ color: 'var(--c-primary)' }}>Session Title</label>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Purchase Agreement – 123 Main St"
            className="w-full text-sm px-4 py-3 rounded-xl focus:outline-none"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
          />
        </section>

        {/* Contract Source */}
        <section className="mb-6">
          <label className="block text-sm font-bold mb-2" style={{ color: 'var(--c-primary)' }}>Contract PDF</label>
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            {/* Upload */}
            <label className="flex items-center gap-3 p-4 cursor-pointer hover:opacity-80"
              style={{ borderBottom: '1px solid var(--c-border)' }}>
              <input type="file" accept="application/pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'rgba(201,168,76,0.15)' }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>
                  {uploading ? 'Uploading…' : 'Upload a new blank contract'}
                </p>
                <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>PDF — saved to your template library</p>
              </div>
            </label>

            {/* Template picker */}
            {loadingTemplates ? (
              <div className="p-4 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>Loading library…</div>
            ) : templates.length > 0 ? (
              <div>
                <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                  Library
                </p>
                {templates.map(t => {
                  const isSelected = sourcePdf?.name === t.name
                  return (
                    <button key={t.id} onClick={() => selectTemplate(t)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80"
                      style={{ borderTop: '1px solid var(--c-border)', backgroundColor: isSelected ? 'rgba(201,168,76,0.08)' : undefined }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm"
                        style={{ backgroundColor: 'var(--c-hover)' }}>📄</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--c-primary)' }}>{t.name}</p>
                        <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
                          {t.category}{t.page_count ? ` · ${t.page_count}p` : ''}
                        </p>
                      </div>
                      {isSelected && <span className="text-xs font-bold shrink-0" style={{ color: '#C9A84C' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>No templates yet — upload one above</div>
            )}
          </div>
          {sourcePdf && (
            <p className="text-xs mt-2 font-semibold" style={{ color: '#22c55e' }}>✓ {sourcePdf.name}</p>
          )}
        </section>

        {/* Signers */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>Signers</label>
            <button onClick={addSigner}
              className="text-xs font-bold px-3 py-1 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
              + Add Signer
            </button>
          </div>
          <div className="space-y-3">
            {signers.map((s, idx) => (
              <div key={s.id} className="rounded-xl p-4"
                style={{ backgroundColor: 'var(--c-card)', border: `1px solid ${s.color}40` }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-xs font-bold" style={{ color: s.color }}>Signer {idx + 1}</span>
                  {signers.length > 1 && (
                    <button onClick={() => removeSigner(s.id)} className="ml-auto text-xs hover:opacity-80" style={{ color: '#ef4444' }}>Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Full Name" value={s.name} onChange={e => updateSigner(s.id, { name: e.target.value })}
                    className="text-xs px-3 py-2 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  <input placeholder="Email" type="email" value={s.email} onChange={e => updateSigner(s.id, { email: e.target.value })}
                    className="text-xs px-3 py-2 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  <input placeholder="Role (e.g. Buyer, Seller)" value={s.role} onChange={e => updateSigner(s.id, { role: e.target.value })}
                    className="col-span-2 text-xs px-3 py-2 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {setupError && <p className="text-sm mb-4 font-semibold" style={{ color: '#ef4444' }}>{setupError}</p>}

        <button onClick={() => { if (canProceed) setStep('editor') }} disabled={!canProceed}
          className="w-full py-4 rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
          Place Signature Fields →
        </button>
        <p className="text-xs text-center mt-2" style={{ color: 'var(--c-text-3)' }}>
          Next: click and drag fields onto your contract
        </p>
      </div>
    </div>
  )
}
