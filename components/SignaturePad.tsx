'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

interface SignaturePadProps {
  onSave: (dataUrl: string) => void
  onClear?: () => void
  existingDataUrl?: string | null
  width?: number
  height?: number
}

export default function SignaturePad({
  onSave,
  onClear,
  existingDataUrl,
  width = 480,
  height = 180,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const [isEmpty, setIsEmpty] = useState(true)
  const [saved, setSaved]     = useState(false)

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null

  const clear = useCallback(() => {
    const ctx = getCtx()
    if (!ctx || !canvasRef.current) return
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    setIsEmpty(true)
    setSaved(false)
    onClear?.()
  }, [onClear])

  // Draw existing signature on mount
  useEffect(() => {
    if (!existingDataUrl || !canvasRef.current) return
    const img = new Image()
    img.onload = () => {
      const ctx = getCtx()
      if (!ctx || !canvasRef.current) return
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height)
      setIsEmpty(false)
    }
    img.src = existingDataUrl
  }, [existingDataUrl])

  const getPos = (e: MouseEvent | Touch, rect: DOMRect) => ({
    x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
    y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
  })

  const startDraw = (x: number, y: number) => {
    const ctx = getCtx()
    if (!ctx) return
    drawing.current = true
    ctx.beginPath()
    ctx.moveTo(x, y)
    setSaved(false)
    setIsEmpty(false)
  }

  const continueDraw = (x: number, y: number) => {
    if (!drawing.current) return
    const ctx = getCtx()
    if (!ctx) return
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0A1F44'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const endDraw = () => { drawing.current = false }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onMouseDown = (e: MouseEvent) => {
      const p = getPos(e, canvas.getBoundingClientRect())
      startDraw(p.x, p.y)
    }
    const onMouseMove = (e: MouseEvent) => {
      const p = getPos(e, canvas.getBoundingClientRect())
      continueDraw(p.x, p.y)
    }
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const p = getPos(e.touches[0], canvas.getBoundingClientRect())
      startDraw(p.x, p.y)
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const p = getPos(e.touches[0], canvas.getBoundingClientRect())
      continueDraw(p.x, p.y)
    }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup', endDraw)
    canvas.addEventListener('mouseleave', endDraw)
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', endDraw)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', endDraw)
      canvas.removeEventListener('mouseleave', endDraw)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', endDraw)
    }
  }, [])

  const save = () => {
    if (!canvasRef.current || isEmpty) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onSave(dataUrl)
    setSaved(true)
  }

  return (
    <div>
      <div style={{
        border: '1.5px solid var(--c-border)',
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#fff',
        cursor: 'crosshair',
        display: 'inline-block',
        position: 'relative',
        maxWidth: '100%',
      }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ display: 'block', maxWidth: '100%', touchAction: 'none' }}
        />
        {isEmpty && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 13, color: 'rgba(10,31,68,0.25)' }}>Sign here</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={save}
          disabled={isEmpty}
          style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            backgroundColor: saved ? '#4ACF9A' : '#C9A84C',
            color: '#0A1F44', border: 'none', cursor: isEmpty ? 'not-allowed' : 'pointer',
            opacity: isEmpty ? 0.5 : 1, transition: 'background-color 0.2s',
          }}
        >
          {saved ? 'Saved ✓' : 'Save Signature'}
        </button>
        <button
          type="button"
          onClick={clear}
          style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13,
            backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
            border: '1px solid var(--c-border)', cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
