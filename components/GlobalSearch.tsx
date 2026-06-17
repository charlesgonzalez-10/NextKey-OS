'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchResults {
  contacts:   { id: string; name: string; phone?: string; email?: string; category?: string }[]
  leads:      { id: string; property_address: string; owner_name?: string; status?: string; lead_score?: string }[]
  deals:      { id: string; address: string; status?: string; offer_price?: number }[]
  properties: { id: string; property_address: string; owner_name?: string; city?: string; zip?: string }[]
  documents:  { id: string; name: string; category?: string; status?: string; recipient_name?: string }[]
}

interface ResultItem {
  id:       string
  label:    string
  sub:      string
  href:     string
  category: string
  color:    string
  badge?:   string
}

const CATEGORY_META: Record<string, { color: string; icon: string }> = {
  Contacts:   { color: '#4ACF9A', icon: '👤' },
  Leads:      { color: '#C9A84C', icon: '📋' },
  Deals:      { color: '#818cf8', icon: '🤝' },
  Properties: { color: '#38bdf8', icon: '🏠' },
  Documents:  { color: '#fb923c', icon: '📄' },
}

const RECENT_KEY = 'nk_recent_searches'
const MAX_RECENT = 8

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

function saveRecent(q: string) {
  const prev = loadRecent().filter(s => s !== q)
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)))
}

function fmt$(n?: number | null) {
  return n ? '$' + Number(n).toLocaleString() : ''
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export default function GlobalSearch({ onClose }: Props) {
  const router = useRouter()
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [cursor,  setCursor]  = useState(-1)
  const [recent,  setRecent]  = useState<string[]>([])
  const inputRef    = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setRecent(loadRecent())
    inputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults(null); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        if (res.ok) setResults(await res.json())
      } finally { setLoading(false) }
    }, 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Flatten results into a navigable list
  const flatItems: ResultItem[] = results ? [
    ...results.contacts.map(c => ({
      id: c.id, category: 'Contacts', color: CATEGORY_META.Contacts.color,
      label: c.name || '(no name)', sub: c.email || c.phone || '',
      href: `/contacts/${c.id}`, badge: c.category ?? undefined,
    })),
    ...results.leads.map(l => ({
      id: l.id, category: 'Leads', color: CATEGORY_META.Leads.color,
      label: l.property_address || '(no address)', sub: l.owner_name || '',
      href: `/leads/${l.id}`, badge: l.lead_score ?? l.status ?? undefined,
    })),
    ...results.deals.map(d => ({
      id: d.id, category: 'Deals', color: CATEGORY_META.Deals.color,
      label: d.address || '(no address)', sub: [d.status, fmt$(d.offer_price)].filter(Boolean).join(' · '),
      href: `/deals/${d.id}`, badge: d.status ?? undefined,
    })),
    ...results.properties.map(p => ({
      id: p.id, category: 'Properties', color: CATEGORY_META.Properties.color,
      label: p.property_address || '(no address)', sub: [p.owner_name, p.city, p.zip].filter(Boolean).join(', '),
      href: `/leads/property?id=${p.id}`,
    })),
    ...results.documents.map(d => ({
      id: d.id, category: 'Documents', color: CATEGORY_META.Documents.color,
      label: d.name || '(untitled)', sub: [d.recipient_name, d.category].filter(Boolean).join(' · '),
      href: `/documents/${d.id}`, badge: d.status ?? undefined,
    })),
  ] : []

  const totalResults = flatItems.length
  const hasResults   = totalResults > 0
  const showRecent   = query.length < 2 && recent.length > 0

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, totalResults - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, -1))
    } else if (e.key === 'Enter') {
      if (cursor >= 0 && flatItems[cursor]) {
        navigate(flatItems[cursor].href, query)
      } else if (query.trim().length >= 2) {
        // no-op: wait for results
      }
    }
  }, [cursor, flatItems, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = (href: string, q = '') => {
    if (q.trim()) saveRecent(q.trim())
    onClose()
    router.push(href)
  }

  // Group flatItems by category for display
  const grouped: Record<string, ResultItem[]> = {}
  for (const item of flatItems) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  let itemIndex = 0

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '12%', left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, width: '100%', maxWidth: 620,
        display: 'flex', flexDirection: 'column',
        backgroundColor: '#0d2550',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        maxHeight: '72vh',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}>
          {loading ? (
            <svg style={{ width: 18, height: 18, flexShrink: 0, color: '#C9A84C', animation: 'spin 0.8s linear infinite' }} fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 60" />
            </svg>
          ) : (
            <svg style={{ width: 18, height: 18, flexShrink: 0, color: 'rgba(255,255,255,0.3)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(-1) }}
            onKeyDown={handleKeyDown}
            placeholder="Search contacts, leads, deals, properties, documents…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 15, color: '#fff',
              caretColor: '#C9A84C',
            }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 18, lineHeight: 1, padding: 0 }}>
              ×
            </button>
          )}
          <kbd style={{
            fontSize: 10, color: 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4, padding: '2px 6px', fontFamily: 'inherit', flexShrink: 0,
          }}>ESC</kbd>
        </div>

        {/* Results area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

          {/* Recent searches */}
          {showRecent && (
            <div style={{ padding: '4px 0 8px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 18px', marginBottom: 4 }}>
                Recent
              </div>
              {recent.map(r => (
                <button key={r} onClick={() => setQuery(r)}
                  style={{
                    width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.5)', fontSize: 13,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <svg style={{ width: 14, height: 14, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {r}
                </button>
              ))}
            </div>
          )}

          {/* No results */}
          {!loading && query.length >= 2 && !hasResults && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {/* Grouped results */}
          {hasResults && Object.entries(grouped).map(([cat, items]) => {
            const meta = CATEGORY_META[cat]
            return (
              <div key={cat} style={{ marginBottom: 4 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: meta.color, padding: '6px 18px 3px', opacity: 0.8,
                }}>
                  {meta.icon} {cat}
                </div>
                {items.map(item => {
                  const idx     = itemIndex++
                  const active  = idx === cursor
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.href, query)}
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                        padding: '9px 18px', background: active ? 'rgba(201,168,76,0.12)' : 'none',
                        border: 'none', cursor: 'pointer', borderLeft: active ? `2px solid #C9A84C` : '2px solid transparent',
                      }}
                      onMouseEnter={e => { setCursor(idx); (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = active ? 'rgba(201,168,76,0.12)' : 'transparent' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#C9A84C' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.label}
                        </div>
                        {item.sub && (
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.sub}
                          </div>
                        )}
                      </div>
                      {item.badge && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8, flexShrink: 0,
                          backgroundColor: `${meta.color}20`, color: meta.color,
                        }}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '8px 18px',
          borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
        }}>
          {[
            { keys: '↑↓', label: 'navigate' },
            { keys: '↵', label: 'open' },
            { keys: 'Esc', label: 'close' },
          ].map(h => (
            <span key={h.keys} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <kbd style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit' }}>{h.keys}</kbd>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>{h.label}</span>
            </span>
          ))}
          {hasResults && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
              {totalResults} result{totalResults !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </>
  )
}
