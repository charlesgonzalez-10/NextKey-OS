'use client'

/**
 * Property Search
 *
 * Two search modes, both navigate to /property-search/results:
 *   A. Single-property: type an address → Enter → results page (mode=single)
 *   B. Bulk criteria:   build criteria  → Run Bulk Search → results page
 *
 * No inline detail is displayed here. All property information lives on
 * the results page and the full Property Workspace.
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import PropertySearchPanel, {
  CriteriaState,
  criteriaToParams,
  activeCriteriaCount,
} from '@/components/PropertySearchPanel'
import type { DrawnZone } from '@/components/AcquisitionMap'

const AcquisitionMap = lazy(() => import('@/components/AcquisitionMap'))

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedSearch {
  id:         string
  name:       string
  emoji:      string
  filters:    CriteriaState
  owner:      string
  is_shared:  boolean
  created_at: string
}

type SearchMode = 'search' | 'draw'

const EMPTY: CriteriaState = {}

const SEARCH_EXAMPLES = [
  { label: 'Address'      },
  { label: 'Owner'        },
  { label: 'LLC / Entity' },
  { label: 'Folio / APN'  },
  { label: 'Case #'       },
  { label: 'Phone'        },
  { label: 'ZIP'          },
  { label: 'Subdivision'  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function PropertySearchClient() {
  const router = useRouter()

  const [mode, setMode]               = useState<SearchMode>('search')
  const [showCriteria, setShowCriteria] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [criteria, setCriteria]       = useState<CriteriaState>(EMPTY)
  const activeCount = activeCriteriaCount(criteria)
  const [drawnZone, setDrawnZone]     = useState<DrawnZone | null>(null)
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [activeSaved, setActiveSaved] = useState<string | null>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveName, setSaveName]       = useState('')
  const [saveEmoji, setSaveEmoji]     = useState('')

  useEffect(() => {
    fetch('/api/leads/saved-searches')
      .then(r => r.json())
      .then(d => Array.isArray(d) && setSavedSearches(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement === searchRef.current) setSearchInput('')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────

  const runBulkSearch = useCallback(() => {
    const c: CriteriaState = { ...criteria }
    if (searchInput.trim()) c.search = searchInput.trim()
    const params = criteriaToParams(c)
    if (drawnZone) params.set('zone', JSON.stringify(drawnZone))
    router.push(`/property-search/results?${params.toString()}`)
  }, [criteria, searchInput, drawnZone, router])

  const runAddressLookup = useCallback(() => {
    const q = searchInput.trim()
    if (!q) return
    router.push(`/property-search/results?q=${encodeURIComponent(q)}&mode=single`)
  }, [searchInput, router])

  const clearAll = () => {
    setCriteria(EMPTY); setSearchInput(''); setDrawnZone(null); setActiveSaved(null)
  }

  const loadSaved = (s: SavedSearch) => {
    if (activeSaved === s.id) { setActiveSaved(null); setCriteria(EMPTY); setSearchInput('') }
    else { setActiveSaved(s.id); setCriteria(s.filters); setSearchInput(s.filters.search ?? '') }
  }

  const deleteSaved = async (id: string) => {
    await fetch(`/api/leads/saved-searches/${id}`, { method: 'DELETE' })
    setSavedSearches(prev => prev.filter(s => s.id !== id))
    if (activeSaved === id) { setActiveSaved(null); setCriteria(EMPTY) }
  }

  const saveSearch = async () => {
    if (!saveName.trim()) return
    const res = await fetch('/api/leads/saved-searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: saveName.trim(), emoji: saveEmoji, filters: criteria }),
    })
    if (res.ok) {
      const data = await res.json()
      setSavedSearches(prev => [...prev, data])
      setShowSaveModal(false); setSaveName('')
    }
  }

  const hasAnyCriteria = activeCount > 0 || searchInput.trim().length > 0 || drawnZone !== null

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden" style={{ color: 'var(--c-primary)' }}>

      {/* ── LEFT PANEL ─────────────────────────────────────────────────── */}
      <div className="flex flex-col h-full overflow-hidden"
        style={{ width: 400, minWidth: 340, maxWidth: 440, borderRight: '1px solid var(--c-border)', backgroundColor: 'var(--c-bg)' }}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--c-primary)' }}>Property Search</h1>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Find one property or search by acquisition criteria</p>
          <div className="flex gap-1 mt-3 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)' }}>
            {(['search', 'draw'] as SearchMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                style={{
                  backgroundColor: mode === m ? 'var(--c-primary)' : 'transparent',
                  color: mode === m ? '#C9A84C' : 'var(--c-text-3)',
                }}>
                {m === 'search' ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                  </svg>
                )}
                {m === 'search' ? 'Search Mode' : 'Draw Zone'}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Section A: Find One Property */}
          <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-2.5" style={{ color: 'var(--c-text-3)' }}>
              Find One Property
            </p>
            <div className="flex items-center rounded-xl overflow-hidden"
              style={{ border: '2px solid var(--c-primary)', backgroundColor: 'var(--c-card)' }}>
              <div className="pl-3 pr-2 shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  style={{ color: 'var(--c-primary)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
                </svg>
              </div>
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') searchInput.trim() ? runAddressLookup() : runBulkSearch()
                  if (e.key === 'Escape') setSearchInput('')
                }}
                placeholder="Address, owner, folio, case #, phone, ZIP…"
                className="flex-1 py-2.5 text-sm bg-transparent focus:outline-none"
                style={{ color: 'var(--c-primary)' }}
              />
              {searchInput && (
                <button onClick={() => setSearchInput('')}
                  className="px-2 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>✕</button>
              )}
            </div>

            {!searchInput && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {SEARCH_EXAMPLES.map(({ label }) => (
                  <span key={label} className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
                    {label}
                  </span>
                ))}
              </div>
            )}

            {drawnZone && (
              <div className="flex items-center justify-between mt-2.5 px-3 py-2 rounded-xl"
                style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)' }}>
                <span className="text-[11px] font-semibold" style={{ color: '#C9A84C' }}>
                  ✓ {drawnZone.type === 'circle'
                    ? `Circle · ${((drawnZone.radius ?? 0) / 1609).toFixed(1)} mi`
                    : `${drawnZone.type} zone selected`}
                </span>
                <button onClick={() => setDrawnZone(null)}
                  className="text-[10px] hover:opacity-60" style={{ color: '#C9A84C' }}>Remove</button>
              </div>
            )}

            {searchInput.trim() && (
              <p className="text-[10px] mt-2 px-1" style={{ color: 'var(--c-text-3)' }}>
                Press <kbd className="px-1 py-0.5 rounded text-[9px]"
                  style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)' }}>Enter</kbd> to look up
              </p>
            )}
          </div>

          {/* OR separator */}
          <div className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--c-border)' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: 'var(--c-text-3)' }}>or</span>
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--c-border)' }} />
          </div>

          {/* Section B: Search Multiple Properties */}
          <div style={{ borderBottom: '1px solid var(--c-border)' }}>
            <button onClick={() => setShowCriteria(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3"
              style={{ backgroundColor: 'var(--c-card-alt)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-primary)' }}>
                  Search Multiple Properties
                </span>
                {activeCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
                    {activeCount}
                  </span>
                )}
              </div>
              <svg className={`w-4 h-4 transition-transform ${showCriteria ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showCriteria && (
              <PropertySearchPanel criteria={criteria} onChange={setCriteria} onRun={runBulkSearch} onClear={clearAll} />
            )}
          </div>

          {/* Saved specs */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Saved Specs</span>
              <button onClick={() => setShowSaveModal(true)}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                + Save Current
              </button>
            </div>
            {savedSearches.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                No saved specs yet. Build a criteria set and save it for quick re-runs.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {savedSearches.map(s => (
                  <div key={s.id} className="flex items-center gap-0.5">
                    <button onClick={() => loadSaved(s)}
                      className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                      style={{
                        backgroundColor: activeSaved === s.id ? 'var(--c-primary)' : 'var(--c-hover)',
                        color: activeSaved === s.id ? '#C9A84C' : 'var(--c-text-2)',
                        border: `1px solid ${activeSaved === s.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
                      }}>
                      {s.name}
                    </button>
                    <button onClick={() => deleteSaved(s.id)}
                      className="text-[10px] px-1 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="h-32" />
        </div>

        {/* Sticky footer */}
        <div className="p-4 flex flex-col gap-2"
          style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
          {hasAnyCriteria && (
            <button onClick={clearAll}
              className="w-full py-2 text-xs font-semibold rounded-xl transition-all hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Clear All Criteria
            </button>
          )}
          <button onClick={runBulkSearch}
            className="w-full py-3 text-sm font-bold rounded-xl transition-all hover:opacity-90 flex items-center justify-center gap-2"
            style={{ backgroundColor: hasAnyCriteria ? 'var(--c-primary)' : '#1e3a5c', color: hasAnyCriteria ? '#C9A84C' : 'rgba(255,255,255,0.3)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            {hasAnyCriteria ? `Run Bulk Search${activeCount > 0 ? ` · ${activeCount} criteria` : ''}` : 'Run Bulk Search'}
          </button>
        </div>
      </div>

      {/* ── RIGHT PANEL — Map ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: '#071829' }}>
        <div className="px-5 py-3 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0A1F44' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {mode === 'draw' ? 'Draw Zone' : 'South Florida'}
            </span>
            {mode === 'draw' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                Draw a polygon, rectangle, or circle to define your search area
              </span>
            )}
          </div>
          {drawnZone && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(76,175,154,0.2)', color: '#4CAF9A' }}>
              ✓ Zone selected — run search to see properties inside
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 p-3">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center rounded-2xl" style={{ backgroundColor: '#071829' }}>
              <div className="text-center">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2"
                  style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading map…</p>
              </div>
            </div>
          }>
            <AcquisitionMap className="w-full h-full"
              onZoneDrawn={zone => { setDrawnZone(zone); if (zone) setMode('draw') }} />
          </Suspense>
        </div>
      </div>

      {/* ── Save Modal ──────────────────────────────────────────────────── */}
      {showSaveModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-2xl p-6 w-80 shadow-2xl"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <h3 className="text-base font-bold mb-4" style={{ color: 'var(--c-primary)' }}>Save Search Spec</h3>
            <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveSearch(); if (e.key === 'Escape') setShowSaveModal(false) }}
              placeholder='e.g. "Weston Estates Pre-FC"'
              className="w-full px-3 py-2.5 rounded-xl text-sm mb-4 focus:outline-none"
              style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
            <div className="flex gap-2">
              <button onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2 text-sm rounded-xl" style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                Cancel
              </button>
              <button onClick={saveSearch}
                className="flex-1 py-2 text-sm font-bold rounded-xl" style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                Save Spec
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
