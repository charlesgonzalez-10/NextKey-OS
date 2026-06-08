'use client'

import { useState, useRef, useEffect } from 'react'

export interface ColumnDef<K extends string = string> {
  key: K
  label: string
  locked?: boolean         // always visible, greyed-out checkbox
  defaultVisible?: boolean // default = true
}

interface Props<K extends string> {
  columns: ColumnDef<K>[]
  visible: Set<K>
  onToggle: (key: K) => void
  onReset: () => void
}

export default function ColumnPicker<K extends string>({
  columns,
  visible,
  onToggle,
  onReset,
}: Props<K>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleable = columns.filter(c => !c.locked)
  const visibleCount = toggleable.filter(c => visible.has(c.key)).length

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
        title="Customize visible columns"
      >
        {/* columns / sliders icon */}
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        Columns
        <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs" style={{ backgroundColor: '#0A1F4415', color: '#0A1F44' }}>
          {visibleCount}/{toggleable.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: '1px solid var(--c-border)' }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>Columns</span>
            <button onClick={onReset} className="text-xs font-semibold transition-colors"
              style={{ color: '#C9A84C' }}>
              Reset
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {columns.map(col => (
              <label
                key={col.key}
                className={`flex items-center gap-2.5 px-3 py-1.5 select-none transition-colors ${
                  col.locked ? 'cursor-default opacity-40' : 'cursor-pointer'
                }`}
                style={{ ':hover': { backgroundColor: 'var(--c-hover)' } } as React.CSSProperties}
                onMouseEnter={e => !col.locked && (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
              >
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  disabled={col.locked}
                  onChange={() => !col.locked && onToggle(col.key)}
                  className="w-3.5 h-3.5 rounded accent-yellow-500 flex-shrink-0"
                />
                <span className="text-sm truncate" style={{ color: 'var(--c-primary)' }}>{col.label}</span>
                {col.locked && (
                  <span className="ml-auto text-xs flex-shrink-0" style={{ color: 'var(--c-text-3)' }}>fixed</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useColumnPrefs<K extends string>(
  tableKey: string,
  columns: ColumnDef<K>[]
) {
  const storageKey = `nk_cols_${tableKey}`

  const getDefaults = (): Set<K> =>
    new Set(
      columns
        .filter(c => c.locked || c.defaultVisible !== false)
        .map(c => c.key)
    )

  const [visible, setVisible] = useState<Set<K>>(() => {
    if (typeof window === 'undefined') return getDefaults()
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as K[]
        const lockedKeys = columns.filter(c => c.locked).map(c => c.key)
        return new Set([...lockedKeys, ...parsed])
      }
    } catch { /* ignore */ }
    return getDefaults()
  })

  const toggle = (key: K) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // persist only toggleable keys
      const save = [...next].filter(k => !columns.find(c => c.key === k)?.locked)
      localStorage.setItem(storageKey, JSON.stringify(save))
      return next
    })
  }

  const reset = () => {
    setVisible(getDefaults())
    localStorage.removeItem(storageKey)
  }

  return { visible, toggle, reset, isVisible: (k: K) => visible.has(k) }
}
