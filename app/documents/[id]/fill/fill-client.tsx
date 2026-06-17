'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'

const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false })

type AnnotationType = 'text' | 'date' | 'signature' | 'initials' | 'checkmark'
type Tool = 'select' | AnnotationType

interface Annotation {
  id: string
  type: AnnotationType
  page: number
  x: number   // fraction of rendered page width
  y: number   // fraction of rendered page height (0=top)
  value: string
  fontSize: number
  width: number   // px
  height: number  // px
}

interface PageDim { width: number; height: number; top: number; left: number }

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Select', text: 'Text', date: 'Date',
  signature: 'Signature', initials: 'Initials', checkmark: '✓ Check',
}

const ANN_DEFAULTS: Record<AnnotationType, { width: number; height: number; value: string }> = {
  text:      { width: 140, height: 28, value: '' },
  date:      { width: 120, height: 28, value: new Date().toLocaleDateString('en-US') },
  signature: { width: 180, height: 60, value: '' },
  initials:  { width: 70,  height: 35, value: '' },
  checkmark: { width: 24,  height: 24, value: '✓' },
}

export default function FillClient({ docId }: { docId: string }) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const canvasRefs    = useRef<(HTMLCanvasElement | null)[]>([])
  const [docName, setDocName]           = useState('')
  const [fileType, setFileType]         = useState<string>('')
  const [pdfUrl, setPdfUrl]             = useState<string>('')
  const [numPages, setNumPages]         = useState(0)
  const [pageDims, setPageDims]         = useState<PageDim[]>([])
  const [annotations, setAnnotations]   = useState<Annotation[]>([])
  const [activeTool, setActiveTool]     = useState<Tool>('select')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [savedSig, setSavedSig]         = useState<string | null>(null)
  const [showSigPad, setShowSigPad]     = useState(false)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [saving, setSaving]             = useState(false)
  const [saveMsg, setSaveMsg]           = useState('')
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const dragging = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)

  // Load doc + PDF
  useEffect(() => {
    Promise.all([
      fetch(`/api/documents/${docId}`).then(r => r.json()),
      fetch(`/api/documents/${docId}/url`).then(r => r.json()),
    ]).then(([doc, urlData]) => {
      setDocName(doc.name || 'Document')
      setFileType(doc.file_type || 'pdf')
      if (urlData.url) setPdfUrl(urlData.url)
      else setError('Could not load PDF URL')
    }).catch(() => setError('Failed to load document'))

    fetch('/api/user/signature').then(r => r.json()).then(d => {
      if (d.signature_data) setSavedSig(d.signature_data)
    }).catch(() => {})
  }, [docId])

  // Render PDF pages with PDF.js
  useEffect(() => {
    if (!pdfUrl) return

    let cancelled = false
    ;(async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise
        if (cancelled) return
        setNumPages(pdf.numPages)
        canvasRefs.current = Array(pdf.numPages).fill(null)

        const dims: PageDim[] = []
        let cumulTop = 0

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          if (cancelled) return
          const vp = page.getViewport({ scale: 1.5 })
          const canvas = canvasRefs.current[i - 1]
          if (!canvas) continue
          canvas.width  = vp.width
          canvas.height = vp.height
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.render({ canvasContext: ctx as any, viewport: vp } as any).promise
          dims.push({ width: vp.width, height: vp.height, top: cumulTop, left: 0 })
          cumulTop += vp.height + 16
        }

        if (!cancelled) {
          setPageDims(dims)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          setError('Failed to render PDF. File may not be a valid PDF.')
          setLoading(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [pdfUrl])

  const placeAnnotation = useCallback((page: number, xFrac: number, yFrac: number) => {
    if (activeTool === 'select') return
    const defaults = ANN_DEFAULTS[activeTool as AnnotationType]

    let value = defaults.value
    if ((activeTool === 'signature' || activeTool === 'initials') && savedSig) {
      value = savedSig
    } else if (activeTool === 'signature' || activeTool === 'initials') {
      setShowSigPad(true)
      return
    }

    const id = crypto.randomUUID()
    setAnnotations(prev => [...prev, {
      id, type: activeTool as AnnotationType,
      page, x: xFrac, y: yFrac,
      value, fontSize: 11,
      width: defaults.width, height: defaults.height,
    }])
    setSelectedId(id)
    setActiveTool('select')
  }, [activeTool, savedSig])

  const onPageClick = (pageIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'select') { setSelectedId(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const xFrac = (e.clientX - rect.left) / rect.width
    const yFrac = (e.clientY - rect.top)  / rect.height
    placeAnnotation(pageIdx, xFrac, yFrac)
  }

  const onAnnMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (activeTool !== 'select') return
    setSelectedId(id)
    dragging.current = { id, startX: e.clientX, startY: e.clientY, origX: 0, origY: 0 }
    const ann = annotations.find(a => a.id === id)
    if (ann) { dragging.current.origX = ann.x; dragging.current.origY = ann.y }
  }

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    const d = dragging.current
    const ann = annotations.find(a => a.id === d.id)
    if (!ann) return
    const pageDim = pageDims[ann.page]
    if (!pageDim) return
    const dx = (e.clientX - d.startX) / pageDim.width
    const dy = (e.clientY - d.startY) / pageDim.height
    setAnnotations(prev => prev.map(a =>
      a.id === d.id ? { ...a, x: Math.max(0, Math.min(1, d.origX + dx)), y: Math.max(0, Math.min(1, d.origY + dy)) } : a
    ))
  }, [annotations, pageDims])

  const onMouseUp = useCallback(() => { dragging.current = null }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  const deleteSelected = () => {
    if (!selectedId) return
    setAnnotations(prev => prev.filter(a => a.id !== selectedId))
    setSelectedId(null)
  }

  const savePdf = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const res = await fetch(`/api/documents/${docId}/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: annotations.map(a => ({
          id: a.id, type: a.type, page: a.page,
          x: a.x, y: a.y, value: a.value, fontSize: a.fontSize,
        })) }),
      })
      if (res.ok) {
        setSaveMsg('Saved!')
        setTimeout(() => setSaveMsg(''), 3000)
      } else {
        const d = await res.json()
        setSaveMsg(d.error || 'Save failed')
      }
    } catch {
      setSaveMsg('Save failed')
    }
    setSaving(false)
  }

  if (error) return (
    <div style={{ padding: 60, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14 }}>
      <p style={{ marginBottom: 12 }}>{error}</p>
      <a href="/documents" style={{ color: '#C9A84C', textDecoration: 'none' }}>← Back to Documents</a>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--c-bg)', color: 'var(--c-primary)' }}>

      {/* Top bar */}
      <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)', flexShrink: 0, zIndex: 10 }}>
        <a href="/documents" style={{ color: 'var(--c-text-2)', textDecoration: 'none', fontSize: 18, lineHeight: 1 }}>←</a>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docName}</span>

        {/* Tool palette */}
        <div style={{ display: 'flex', gap: 4, padding: '4px', backgroundColor: 'var(--c-hover)', borderRadius: 8 }}>
          {(Object.keys(TOOL_LABELS) as Tool[]).map(t => (
            <button key={t} onClick={() => setActiveTool(t)}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                backgroundColor: activeTool === t ? '#C9A84C' : 'transparent',
                color: activeTool === t ? '#0A1F44' : 'var(--c-text-2)',
              }}>
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>

        {selectedId && (
          <button onClick={deleteSelected} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer' }}>
            Delete
          </button>
        )}

        {saveMsg && <span style={{ fontSize: 12, color: saveMsg === 'Saved!' ? '#4ACF9A' : '#ef4444' }}>{saveMsg}</span>}

        <button onClick={savePdf} disabled={saving || annotations.length === 0}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', backgroundColor: '#C9A84C', color: '#0A1F44', opacity: saving || annotations.length === 0 ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save PDF'}
        </button>
      </div>

      {/* Hint bar */}
      {activeTool !== 'select' && (
        <div style={{ padding: '6px 20px', backgroundColor: 'rgba(201,168,76,0.08)', borderBottom: '1px solid rgba(201,168,76,0.15)', fontSize: 11, color: '#C9A84C', flexShrink: 0 }}>
          Click anywhere on the document to place a <strong>{TOOL_LABELS[activeTool]}</strong> annotation. Press Esc to cancel.
        </div>
      )}

      {/* Main area */}
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 24, gap: 0 }}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {loading && (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--c-text-2)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>Rendering PDF…</div>
            </div>
          )}

          {Array.from({ length: numPages }).map((_, pageIdx) => (
            <div key={pageIdx} style={{ position: 'relative', boxShadow: '0 2px 20px rgba(0,0,0,0.3)', borderRadius: 4, overflow: 'hidden' }}>
              <canvas
                ref={el => { canvasRefs.current[pageIdx] = el }}
                style={{ display: 'block' }}
              />
              {/* Annotation overlay — captures clicks */}
              <div
                style={{
                  position: 'absolute', inset: 0,
                  cursor: activeTool === 'select' ? 'default' : 'crosshair',
                }}
                onClick={e => onPageClick(pageIdx, e)}
              >
                {/* Annotations on this page */}
                {annotations.filter(a => a.page === pageIdx).map(ann => {
                  const pageDim = pageDims[pageIdx]
                  if (!pageDim) return null
                  const left = ann.x * pageDim.width
                  const top  = ann.y * pageDim.height
                  const isSelected = selectedId === ann.id
                  return (
                    <div
                      key={ann.id}
                      onMouseDown={e => onAnnMouseDown(e, ann.id)}
                      onDoubleClick={() => { if (ann.type === 'text' || ann.type === 'date') setEditingId(ann.id) }}
                      style={{
                        position: 'absolute',
                        left, top,
                        width: ann.width, height: ann.height,
                        border: isSelected ? '1.5px solid #C9A84C' : '1px dashed rgba(201,168,76,0.5)',
                        borderRadius: 3,
                        backgroundColor: isSelected ? 'rgba(201,168,76,0.05)' : 'rgba(255,255,255,0.02)',
                        cursor: activeTool === 'select' ? 'grab' : 'crosshair',
                        userSelect: 'none',
                        display: 'flex', alignItems: 'center',
                        padding: '0 4px',
                        boxSizing: 'border-box',
                      }}
                    >
                      {(ann.type === 'signature' || ann.type === 'initials') && ann.value?.startsWith('data:image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ann.value} alt="signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      ) : ann.type === 'text' || ann.type === 'date' ? (
                        editingId === ann.id ? (
                          <input
                            autoFocus
                            value={ann.value}
                            onChange={e => setAnnotations(prev => prev.map(a => a.id === ann.id ? { ...a, value: e.target.value } : a))}
                            onBlur={() => setEditingId(null)}
                            onKeyDown={e => { if (e.key === 'Enter') setEditingId(null) }}
                            style={{ width: '100%', border: 'none', background: 'transparent', fontSize: ann.fontSize, color: '#000', outline: 'none', padding: 0 }}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span style={{ fontSize: ann.fontSize, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ann.value || <span style={{ color: '#999', fontStyle: 'italic' }}>Click to type</span>}
                          </span>
                        )
                      ) : (
                        <span style={{ fontSize: 16, color: '#111' }}>{ann.value}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Signature pad modal */}
      {showSigPad && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: 'var(--c-card)', borderRadius: 16, padding: 28, width: 560, border: '1px solid var(--c-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Draw Signature</span>
              <button onClick={() => setShowSigPad(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--c-text-2)' }}>×</button>
            </div>
            <SignaturePad
              width={500} height={160}
              onSave={dataUrl => {
                setSavedSig(dataUrl)
                // Persist to profile
                fetch('/api/user/signature', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature_data: dataUrl }) }).catch(() => {})
                // Place the annotation now
                setShowSigPad(false)
                // Re-trigger placement with the new sig by temporarily storing intent — user clicks again
              }}
            />
            <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 8 }}>After saving, select Signature tool and click the document to place it.</p>
          </div>
        </div>
      )}
    </div>
  )
}
