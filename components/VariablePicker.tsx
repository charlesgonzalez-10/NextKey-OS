'use client'

import { useState, useEffect, useRef } from 'react'
import { VARIABLE_LIBRARY, CATEGORY_META, VarCategory } from '@/lib/email/template-variables'

interface Props {
  onInsert: (key: string) => void
  onClose:  () => void
  initialSearch?: string
  style?: React.CSSProperties
}

const CATS = Object.keys(CATEGORY_META) as VarCategory[]

export default function VariablePicker({ onInsert, onClose, initialSearch = '', style }: Props) {
  const [search, setSearch]       = useState(initialSearch)
  const [activeCat, setActiveCat] = useState<VarCategory | 'all'>('all')
  const inputRef  = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [onClose])

  const filtered = VARIABLE_LIBRARY.filter(v => {
    const matchesCat = activeCat === 'all' || v.category === activeCat
    const q = search.toLowerCase()
    const matchesSearch = !q || v.label.toLowerCase().includes(q) || v.key.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)
    return matchesCat && matchesSearch
  })

  const grouped = CATS.reduce<Record<string, typeof VARIABLE_LIBRARY>>((acc, cat) => {
    const items = filtered.filter(v => v.category === cat)
    if (items.length) acc[cat] = items
    return acc
  }, {})

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        zIndex: 200,
        width: 360,
        maxHeight: 440,
        backgroundColor: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Header */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)' }}>Insert Variable</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search variables…"
          style={{
            width: '100%',
            padding: '7px 10px',
            borderRadius: 7,
            fontSize: 12,
            border: '1px solid var(--c-border)',
            backgroundColor: 'var(--c-input-bg)',
            color: 'var(--c-primary)',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', gap: 5, padding: '8px 12px', flexShrink: 0, overflowX: 'auto', borderBottom: '1px solid var(--c-border)' }}>
        <button
          onClick={() => setActiveCat('all')}
          style={{
            fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 12, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            backgroundColor: activeCat === 'all' ? '#C9A84C' : 'var(--c-hover)',
            color: activeCat === 'all' ? '#0A1F44' : 'var(--c-text-2)',
          }}
        >
          All
        </button>
        {CATS.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCat(cat)}
            style={{
              fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 12, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              backgroundColor: activeCat === cat ? CATEGORY_META[cat].color : `${CATEGORY_META[cat].color}20`,
              color: activeCat === cat ? '#0A1F44' : CATEGORY_META[cat].color,
            }}
          >
            {CATEGORY_META[cat].label}
          </button>
        ))}
      </div>

      {/* Variable list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {Object.keys(grouped).length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--c-text-3)', fontSize: 12, padding: '24px 0' }}>No variables match</div>
        )}
        {(activeCat === 'all' ? CATS : [activeCat]).map(cat => {
          const items = grouped[cat]
          if (!items?.length) return null
          return (
            <div key={cat} style={{ marginBottom: 6 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: CATEGORY_META[cat].color,
                textTransform: 'uppercase', letterSpacing: '0.07em',
                padding: '4px 8px 2px',
              }}>
                {CATEGORY_META[cat].label}
              </div>
              {items.map(v => (
                <button
                  key={v.key}
                  onClick={() => { onInsert(v.key); onClose() }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 7,
                    border: 'none', backgroundColor: 'transparent', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 1,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-primary)' }}>{v.label}</span>
                    <code style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      backgroundColor: `${CATEGORY_META[cat].color}18`,
                      color: CATEGORY_META[cat].color,
                      fontFamily: 'monospace',
                    }}>
                      {`{{${v.key}}}`}
                    </code>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{v.description} · e.g. <em>{v.example}</em></span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Utility: insert variable at textarea cursor ─────────────────────────────

export function insertVariableAtCursor(
  textarea: HTMLTextAreaElement,
  varKey: string,
  setter: (value: string) => void,
  replaceFrom?: number,
) {
  const start   = replaceFrom !== undefined ? replaceFrom : textarea.selectionStart
  const end     = textarea.selectionEnd
  const current = textarea.value
  const token   = `{{${varKey}}}`
  const next    = current.slice(0, start) + token + current.slice(end)
  setter(next)
  requestAnimationFrame(() => {
    textarea.focus()
    const pos = start + token.length
    textarea.setSelectionRange(pos, pos)
  })
}
