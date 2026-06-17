'use client'

import { useEffect, useRef } from 'react'

interface DocumentViewerProps {
  url: string
  name: string
  fileType?: string | null
  onClose: () => void
}

export default function DocumentViewer({ url, name, fileType, onClose }: DocumentViewerProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isImage = fileType === 'jpg' || fileType === 'png' ||
    url.match(/\.(jpg|jpeg|png)(\?|$)/i)
  const isPdf   = fileType === 'pdf' || url.match(/\.pdf(\?|$)/i)
  const isDocx  = fileType === 'docx' || fileType === 'xlsx'

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.82)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Header */}
      <div style={{
        width: '100%', maxWidth: 1000,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', flexShrink: 0,
      }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <a
          href={url}
          download={name}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.2)', color: '#fff', textDecoration: 'none', fontWeight: 500 }}
        >
          Download
        </a>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, width: '100%', maxWidth: 1000, minHeight: 0, padding: '0 20px 20px', display: 'flex' }}>
        {isPdf && (
          <iframe
            src={url}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 10, minHeight: 600 }}
            title={name}
          />
        )}
        {isImage && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={name}
              style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 8, objectFit: 'contain' }}
            />
          </div>
        )}
        {isDocx && (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 10, minHeight: 600 }}
            title={name}
          />
        )}
        {!isPdf && !isImage && !isDocx && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 48 }}>📄</div>
            <p style={{ color: '#fff', fontSize: 14 }}>Preview not available for this file type.</p>
            <a href={url} download={name} style={{ fontSize: 13, padding: '8px 20px', borderRadius: 8, backgroundColor: '#C9A84C', color: '#0A1F44', fontWeight: 700, textDecoration: 'none' }}>
              Download File
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
