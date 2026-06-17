'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ColumnPicker, { useColumnPrefs, ColumnDef } from '@/components/ColumnPicker'

// ─── Types ────────────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Seller', 'Buyer', 'Investor', 'Wholesaler', 'Agent', 'Lender', 'Other']
const STATUSES   = ['Active', 'Inactive', 'Closed', 'Follow-up']

// ─── Contact Views ────────────────────────────────────────────────────────────

interface ContactView {
  id: string
  name: string
  category: string
  status: string
  source: string
  tag: string
  due: '' | 'today' | 'week' | 'overdue'
  isPreset?: boolean
}

const PRESET_CONTACT_VIEWS: ContactView[] = [
  { id: 'preset-all',      name: 'All Contacts',         category: 'All',       status: '', source: '', tag: '', due: '',       isPreset: true },
  { id: 'preset-buyers',   name: 'Buyers',               category: 'Buyer',     status: '', source: '', tag: '', due: '',       isPreset: true },
  { id: 'preset-sellers',  name: 'Sellers',              category: 'Seller',    status: '', source: '', tag: '', due: '',       isPreset: true },
  { id: 'preset-investors',name: 'Investors',            category: 'Investor',  status: '', source: '', tag: '', due: '',       isPreset: true },
  { id: 'preset-due-today',name: 'Follow-Up Due Today',  category: 'All',       status: '', source: '', tag: '', due: 'today',  isPreset: true },
  { id: 'preset-overdue',  name: 'Overdue Follow-Ups',   category: 'All',       status: '', source: '', tag: '', due: 'overdue',isPreset: true },
  { id: 'preset-active',   name: 'Active Contacts',      category: 'All',       status: 'Active', source: '', tag: '', due: '', isPreset: true },
]

const LS_VIEWS_KEY   = 'nk_contact_views'
const LS_DEFAULT_KEY = 'nk_contact_default_view'

function loadContactViews(): ContactView[] {
  try { const s = localStorage.getItem(LS_VIEWS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}
function saveContactViews(views: ContactView[]) {
  try { localStorage.setItem(LS_VIEWS_KEY, JSON.stringify(views)) } catch { /* noop */ }
}
function loadDefaultViewId(): string | null {
  try { return localStorage.getItem(LS_DEFAULT_KEY) } catch { return null }
}
function getInitialViewState(): ContactView | null {
  try {
    const id = localStorage.getItem(LS_DEFAULT_KEY)
    if (!id) return null
    const saved: ContactView[] = JSON.parse(localStorage.getItem(LS_VIEWS_KEY) ?? '[]')
    return [...PRESET_CONTACT_VIEWS, ...saved].find(v => v.id === id) ?? null
  } catch { return null }
}

const categoryColors: Record<string, string> = {
  Seller: '#4CAF9A', Buyer: '#7B8FD4', Investor: '#C9A84C',
  Wholesaler: '#E07B6A', Agent: '#6ABDE0', Lender: '#B06AE0', Other: '#888',
}

type ColKey = 'name' | 'category' | 'phone' | 'email' | 'address' | 'source' | 'status' | 'tags' | 'notes' | 'follow_up' | 'added'

const COLUMNS: ColumnDef<ColKey>[] = [
  { key: 'name',     label: 'Name',      locked: true },
  { key: 'category', label: 'Category',  defaultVisible: true },
  { key: 'phone',    label: 'Phone',     defaultVisible: true },
  { key: 'email',    label: 'Email',     defaultVisible: false },
  { key: 'address',  label: 'Address',   defaultVisible: false },
  { key: 'source',   label: 'Source',    defaultVisible: true },
  { key: 'status',   label: 'Status',    defaultVisible: false },
  { key: 'tags',     label: 'Tags',      defaultVisible: false },
  { key: 'notes',    label: 'Notes',     defaultVisible: true },
  { key: 'follow_up',label: 'Follow Up', defaultVisible: true },
  { key: 'added',    label: 'Added',     defaultVisible: false },
]

interface Contact {
  id: string
  name: string
  phone: string
  email: string
  address: string
  city: string
  zip: string
  category: string
  tags: string[]
  notes: string
  status: string
  source: string
  follow_up_date: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFollowUpMeta(date: string | null) {
  if (!date) return null
  const d = new Date(date + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)  return { label: 'Overdue',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
  if (diff === 0) return { label: 'Today',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
  if (diff === 1) return { label: 'Tomorrow', color: '#C9A84C', bg: 'rgba(201,168,76,0.12)' }
  if (diff <= 7)  return { label: `In ${diff}d`, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }
  return {
    label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    color: '#6b7280', bg: 'rgba(107,114,128,0.08)',
  }
}

// ─── Column resize ────────────────────────────────────────────────────────────

type AnyCol = ColKey | 'name'

const DEFAULT_WIDTHS: Record<AnyCol, number> = {
  name: 180, category: 110, phone: 130, email: 180, address: 200,
  source: 120, status: 90, tags: 150, notes: 220, follow_up: 110, added: 100,
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ContactsClient({ contacts }: { contacts: Contact[] }) {
  const router = useRouter()
  const initView = typeof window !== 'undefined' ? getInitialViewState() : null

  const [localContacts, setLocalContacts] = useState(contacts)
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]           = useState(false)

  const [search, setSearch]             = useState('')
  const [activeCategory, setActiveCategory] = useState(initView?.category ?? 'All')
  const [filterStatus, setFilterStatus] = useState(initView?.status ?? '')
  const [filterSource, setFilterSource] = useState(initView?.source ?? '')
  const [filterTag, setFilterTag]       = useState(initView?.tag ?? '')
  const [filterDue, setFilterDue]       = useState<'' | 'today' | 'week' | 'overdue'>(initView?.due ?? '')
  const [showFilters, setShowFilters]   = useState(false)

  const [savedViews, setSavedViews]         = useState<ContactView[]>(() => typeof window !== 'undefined' ? loadContactViews() : [])
  const [defaultViewId, setDefaultViewId]   = useState<string | null>(() => typeof window !== 'undefined' ? loadDefaultViewId() : null)
  const [viewMenuOpen, setViewMenuOpen]     = useState(false)
  const [saveViewOpen, setSaveViewOpen]     = useState(false)

  const { visible, toggle, reset, isVisible } = useColumnPrefs('contacts', COLUMNS)

  // ── Column widths ──────────────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Partial<Record<AnyCol, number>>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem('contacts_col_widths')
      if (saved) return JSON.parse(saved)
    } catch {}
    return {}
  })
  const colWidthsRef = useRef(colWidths)
  useEffect(() => { colWidthsRef.current = colWidths }, [colWidths])

  const w = (key: AnyCol) => colWidths[key] ?? DEFAULT_WIDTHS[key]

  const startResize = (key: AnyCol, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX    = e.clientX
    const startW    = w(key)
    const onMove    = (ev: MouseEvent) => {
      const next = Math.max(60, startW + (ev.clientX - startX))
      setColWidths(prev => ({ ...prev, [key]: next }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem('contacts_col_widths', JSON.stringify(colWidthsRef.current))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── View handlers ──────────────────────────────────────────────────────────
  const applyView = (v: ContactView) => {
    setActiveCategory(v.category)
    setFilterStatus(v.status)
    setFilterSource(v.source)
    setFilterTag(v.tag)
    setFilterDue(v.due)
    setViewMenuOpen(false)
  }

  const saveView = (name: string) => {
    const view: ContactView = {
      id: crypto.randomUUID(), name,
      category: activeCategory, status: filterStatus,
      source: filterSource, tag: filterTag, due: filterDue,
    }
    const next = [...savedViews, view]
    setSavedViews(next)
    saveContactViews(next)
  }

  const deleteView = (id: string) => {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    saveContactViews(next)
    if (defaultViewId === id) {
      localStorage.removeItem(LS_DEFAULT_KEY)
      setDefaultViewId(null)
    }
  }

  const setDefaultView = (id: string) => {
    localStorage.setItem(LS_DEFAULT_KEY, id)
    setDefaultViewId(id)
    setViewMenuOpen(false)
  }

  const removeDefaultView = () => {
    localStorage.removeItem(LS_DEFAULT_KEY)
    setDefaultViewId(null)
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const clearSelect = () => setSelected(new Set())

  const bulkSetCategory = async (category: string) => {
    if (!selected.size) return
    setBulkUpdating(true)
    const results = await Promise.all(Array.from(selected).map(id =>
      fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      }).then(r => ({ id, ok: r.ok })).catch(() => ({ id, ok: false }))
    ))
    const succeededIds = new Set(results.filter(r => r.ok).map(r => r.id))
    if (succeededIds.size > 0) setLocalContacts(prev => prev.map(c => succeededIds.has(c.id) ? { ...c, category } : c))
    setSelected(new Set())
    setBulkUpdating(false)
  }

  const exportSelected = (rows: Contact[]) => {
    const targets = selected.size > 0 ? rows.filter(c => selected.has(c.id)) : rows
    const header = 'Name,Phone,Email,Address,Category,Status,Source,Tags,Follow Up,Added'
    const csv = [
      header,
      ...targets.map(c => [
        c.name, c.phone, c.email, c.address, c.category, c.status, c.source,
        (c.tags || []).join(';'), c.follow_up_date || '',
        new Date(c.created_at).toLocaleDateString(),
      ].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const deleteSelected = async () => {
    if (!selected.size) return
    setDeleting(true)
    const results = await Promise.all(Array.from(selected).map(id =>
      fetch(`/api/contacts/${id}`, { method: 'DELETE' }).then(r => ({ id, ok: r.ok })).catch(() => ({ id, ok: false }))
    ))
    const deletedIds = new Set(results.filter(r => r.ok).map(r => r.id))
    if (deletedIds.size > 0) setLocalContacts(prev => prev.filter(c => !deletedIds.has(c.id)))
    setSelected(new Set()); setDeleteConfirm(false); setDeleting(false)
  }

  // ── Derived: unique tags + sources from loaded contacts ────────────────────
  const allTags    = [...new Set(localContacts.flatMap(c => c.tags || []))].sort()
  const allSources = [...new Set(localContacts.map(c => c.source).filter(Boolean))].sort()

  const dueCount = localContacts.filter(c => {
    if (!c.follow_up_date) return false
    const d = new Date(c.follow_up_date + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return d <= today
  }).length

  const activeFilterCount = [filterStatus, filterSource, filterTag, filterDue].filter(Boolean).length

  const filtered = localContacts.filter(c => {
    if (activeCategory !== 'All' && c.category !== activeCategory) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !c.name?.toLowerCase().includes(q) &&
        !c.phone?.includes(q) &&
        !c.email?.toLowerCase().includes(q) &&
        !c.address?.toLowerCase().includes(q)
      ) return false
    }
    if (filterStatus && c.status !== filterStatus) return false
    if (filterSource && c.source !== filterSource) return false
    if (filterTag && !c.tags?.some(t => t.toLowerCase().includes(filterTag.toLowerCase()))) return false
    if (filterDue) {
      if (!c.follow_up_date) return false
      const d = new Date(c.follow_up_date + 'T00:00:00')
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
      if (filterDue === 'overdue' && diff >= 0) return false
      if (filterDue === 'today'   && diff !== 0) return false
      if (filterDue === 'week'    && (diff < 0 || diff > 7)) return false
    }
    return true
  })

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  const selectAll   = () => setSelected(new Set(filtered.map(c => c.id)))

  return (
    <div className="p-4 md:p-8" style={{ color: 'var(--c-primary)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--c-primary)' }}>Contacts</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--c-text-2)' }}>
            {localContacts.length.toLocaleString()} total
            {dueCount > 0 && (
              <button
                onClick={() => { setFilterDue('today'); setShowFilters(true) }}
                className="ml-3 font-semibold hover:underline"
                style={{ color: '#ef4444' }}
              >
                {dueCount} due
              </button>
            )}
          </p>
        </div>
        <a
          href="/contacts/new"
          className="flex items-center gap-2 font-bold px-4 py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Add Contact</span>
        </a>
      </div>

      {/* ── Search + Category bar ── */}
      <div
        className="rounded-2xl p-4 mb-4"
        style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}
      >
        {/* Search row */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--c-text-3)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search name, phone, email, address…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm pl-9 pr-3 py-2 rounded-xl focus:outline-none"
              style={{
                backgroundColor: 'var(--c-input-bg)',
                border: '1px solid var(--c-border)',
                color: 'var(--c-primary)',
              }}
            />
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors shrink-0"
            style={{
              backgroundColor: showFilters ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
              border: '1px solid var(--c-border)',
              color: showFilters ? '#C9A84C' : 'var(--c-text-2)',
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="text-[10px] px-1.5 rounded-full font-bold"
                style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
              style={
                activeCategory === cat
                  ? { backgroundColor: '#0A1F44', color: '#C9A84C' }
                  : { backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }
              }
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="mt-4 pt-4 grid grid-cols-2 md:grid-cols-4 gap-3"
            style={{ borderTop: '1px solid var(--c-border)' }}>
            {/* Status */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--c-text-3)' }}>Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-xl focus:outline-none"
                style={{
                  backgroundColor: 'var(--c-input-bg)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-primary)',
                }}
              >
                <option value="">Any</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Source */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--c-text-3)' }}>Source</label>
              <select
                value={filterSource}
                onChange={e => setFilterSource(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-xl focus:outline-none"
                style={{
                  backgroundColor: 'var(--c-input-bg)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-primary)',
                }}
              >
                <option value="">Any</option>
                {allSources.map(s => <option key={s} value={s!}>{s}</option>)}
              </select>
            </div>

            {/* Tag */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--c-text-3)' }}>Tag</label>
              <input
                type="text"
                placeholder="Filter by tag…"
                value={filterTag}
                onChange={e => setFilterTag(e.target.value)}
                list="tag-options"
                className="w-full text-sm px-3 py-2 rounded-xl focus:outline-none"
                style={{
                  backgroundColor: 'var(--c-input-bg)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-primary)',
                }}
              />
              <datalist id="tag-options">
                {allTags.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>

            {/* Follow-up */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--c-text-3)' }}>Follow-up Due</label>
              <select
                value={filterDue}
                onChange={e => setFilterDue(e.target.value as typeof filterDue)}
                className="w-full text-sm px-3 py-2 rounded-xl focus:outline-none"
                style={{
                  backgroundColor: 'var(--c-input-bg)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-primary)',
                }}
              >
                <option value="">Any</option>
                <option value="overdue">Overdue</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
              </select>
            </div>

            {/* Clear filters link */}
            {activeFilterCount > 0 && (
              <div className="col-span-2 md:col-span-4 flex justify-end">
                <button
                  onClick={() => {
                    setFilterStatus(''); setFilterSource(''); setFilterTag(''); setFilterDue('')
                  }}
                  className="text-xs hover:underline"
                  style={{ color: 'var(--c-text-2)' }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          {(search || activeCategory !== 'All' || filterStatus || filterSource || filterTag || filterDue) ? (
            <>
              <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>No contacts match your filters</p>
              <button onClick={() => { setSearch(''); setActiveCategory('All'); setFilterStatus(''); setFilterSource(''); setFilterTag(''); setFilterDue('') }}
                className="text-sm font-semibold mt-3 hover:underline" style={{ color: '#C9A84C' }}>
                Clear filters →
              </button>
            </>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>No contacts yet.</p>
              <a href="/contacts/new" className="text-sm font-semibold mt-2 inline-block hover:underline"
                style={{ color: '#C9A84C' }}>
                Add your first contact →
              </a>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-2xl"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>

          {/* Table toolbar — no overflow:hidden here so the dropdown can escape */}
          <div className="relative flex items-center gap-2 flex-wrap px-6 py-3"
            style={{ borderBottom: '1px solid var(--c-border)' }}>

            {/* Select all */}
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input type="checkbox" checked={allSelected}
                onChange={e => e.target.checked ? selectAll() : clearSelect()}
                style={{ accentColor: '#C9A84C' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>
                {selected.size > 0 ? `${selected.size} selected` : 'Select All'}
              </span>
            </label>

            {/* Bulk actions */}
            {selected.size > 0 && (
              <>
                {/* Category change */}
                <select
                  disabled={bulkUpdating}
                  onChange={e => { if (e.target.value) { bulkSetCategory(e.target.value); e.target.value = '' } }}
                  className="text-xs font-semibold px-2 py-1 rounded-lg cursor-pointer"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                  <option value="">{bulkUpdating ? 'Updating…' : 'Set Category'}</option>
                  {CATEGORIES.filter(c => c !== 'All').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {/* Export */}
                <button onClick={() => exportSelected(filtered)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                  Export {selected.size}
                </button>

                {/* Delete */}
                {deleteConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>Delete {selected.size}?</span>
                    <button onClick={deleteSelected} disabled={deleting}
                      className="text-xs font-bold px-2.5 py-1 rounded-lg hover:opacity-80"
                      style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}>
                      {deleting ? '…' : 'Confirm'}
                    </button>
                    <button onClick={() => setDeleteConfirm(false)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                      style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(true)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                    Delete {selected.size}
                  </button>
                )}

                <button onClick={clearSelect}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                  ✕ Clear
                </button>
              </>
            )}

            <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--c-text-2)' }}>
              {filtered.length.toLocaleString()} contact{filtered.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {/* Views dropdown */}
              <div className="relative">
                <button
                  onClick={() => setViewMenuOpen(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                  style={{
                    backgroundColor: defaultViewId ? 'rgba(201,168,76,0.12)' : 'var(--c-card)',
                    border: `1px solid ${defaultViewId ? '#C9A84C' : 'var(--c-border)'}`,
                    color: defaultViewId ? '#C9A84C' : 'var(--c-text-2)',
                  }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Views
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {viewMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setViewMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-xl shadow-2xl overflow-hidden"
                      style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>

                      {defaultViewId && (
                        <div className="flex items-center justify-between px-3 py-2"
                          style={{ backgroundColor: 'rgba(201,168,76,0.08)', borderBottom: '1px solid var(--c-border)' }}>
                          <span className="text-[10px] font-bold" style={{ color: '#C9A84C' }}>★ Default view active</span>
                          <button onClick={removeDefaultView} className="text-[10px] hover:underline" style={{ color: 'var(--c-text-3)' }}>Clear</button>
                        </div>
                      )}

                      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Presets</p>
                      </div>
                      {PRESET_CONTACT_VIEWS.map(v => {
                        const isDefault = defaultViewId === v.id
                        return (
                          <div key={v.id} className="flex items-center group" style={{ borderBottom: '1px solid var(--c-border)' }}>
                            <button onClick={() => applyView(v)} className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left hover:opacity-80">
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                                style={{ backgroundColor: 'rgba(107,189,224,0.15)', color: '#6ABDE0' }}>
                                {v.name[0]?.toUpperCase()}
                              </span>
                              <span className="text-[11px] font-semibold flex-1" style={{ color: 'var(--c-primary)' }}>{v.name}</span>
                              {isDefault && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                                  style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}>DEFAULT</span>
                              )}
                            </button>
                            <button
                              onClick={() => isDefault ? removeDefaultView() : setDefaultView(v.id)}
                              title={isDefault ? 'Remove default' : 'Set as default'}
                              className="pr-3 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-bold"
                              style={{ color: isDefault ? '#C9A84C' : 'var(--c-text-3)' }}>
                              {isDefault ? '★' : '☆'}
                            </button>
                          </div>
                        )
                      })}

                      {savedViews.length > 0 && (
                        <>
                          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Saved</p>
                          </div>
                          {savedViews.map(v => {
                            const isDefault = defaultViewId === v.id
                            return (
                              <div key={v.id} className="flex items-center group" style={{ borderBottom: '1px solid var(--c-border)' }}>
                                <button onClick={() => applyView(v)} className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left hover:opacity-80">
                                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                                    style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                                    {v.name[0]?.toUpperCase()}
                                  </span>
                                  <span className="text-[11px] font-semibold flex-1" style={{ color: 'var(--c-primary)' }}>{v.name}</span>
                                  {isDefault && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                                      style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}>DEFAULT</span>
                                  )}
                                </button>
                                <div className="flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => isDefault ? removeDefaultView() : setDefaultView(v.id)}
                                    title={isDefault ? 'Remove default' : 'Set as default'}
                                    className="text-[11px] font-bold"
                                    style={{ color: isDefault ? '#C9A84C' : 'var(--c-text-3)' }}>
                                    {isDefault ? '★' : '☆'}
                                  </button>
                                  <button onClick={() => deleteView(v.id)} className="text-sm" style={{ color: '#ef4444' }}>×</button>
                                </div>
                              </div>
                            )
                          })}
                        </>
                      )}

                      <button
                        onClick={() => { setViewMenuOpen(false); setSaveViewOpen(true) }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:opacity-80"
                        style={{ color: '#C9A84C' }}>
                        <span className="text-sm">+</span>
                        <span className="text-[11px] font-semibold">Save Current View</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <ColumnPicker columns={COLUMNS} visible={visible} onToggle={toggle} onReset={reset} />
            </div>
          </div>

          {/* overflow-x: auto = scrollable; overflow-y: clip keeps rounded corners */}
          <div style={{ overflowX: 'auto', overflowY: 'clip', borderRadius: '0 0 16px 16px' }}>
          <div>
            <table style={{ tableLayout: 'fixed', width: '100%', minWidth: 'max-content' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--c-card-alt)', borderBottom: '1px solid var(--c-border)' }}>
                  <th style={{ width: 40, padding: '12px 8px 12px 16px' }}>
                    <input type="checkbox" checked={allSelected}
                      onChange={e => e.target.checked ? selectAll() : clearSelect()}
                      style={{ accentColor: '#C9A84C' }} />
                  </th>
                  {([
                    { key: 'name'     as AnyCol, label: 'Name',      always: true },
                    { key: 'category' as AnyCol, label: 'Category',  always: false },
                    { key: 'phone'    as AnyCol, label: 'Phone',     always: false },
                    { key: 'email'    as AnyCol, label: 'Email',     always: false },
                    { key: 'address'  as AnyCol, label: 'Address',   always: false },
                    { key: 'source'   as AnyCol, label: 'Source',    always: false },
                    { key: 'status'   as AnyCol, label: 'Status',    always: false },
                    { key: 'tags'     as AnyCol, label: 'Tags',      always: false },
                    { key: 'notes'    as AnyCol, label: 'Notes',     always: false },
                    { key: 'follow_up'as AnyCol, label: 'Follow Up', always: false },
                    { key: 'added'    as AnyCol, label: 'Added',     always: false },
                  ] as { key: AnyCol; label: string; always: boolean }[])
                    .filter(col => col.always || isVisible(col.key as ColKey))
                    .map(col => (
                      <th
                        key={col.key}
                        className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider select-none relative"
                        style={{ color: 'var(--c-text-2)', width: w(col.key), overflow: 'hidden' }}
                      >
                        <span className="truncate block pr-2">{col.label}</span>
                        {/* Resize handle */}
                        <div
                          onMouseDown={e => startResize(col.key, e)}
                          className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center group"
                          style={{ cursor: 'col-resize' }}
                          title="Drag to resize"
                        >
                          <div className="w-px h-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ backgroundColor: '#C9A84C' }} />
                        </div>
                      </th>
                    ))
                  }
                </tr>
              </thead>
              <tbody>
                {filtered.filter(Boolean).map((contact) => {
                  const catColor = categoryColors[contact.category] || '#888'
                  const fu = getFollowUpMeta(contact.follow_up_date)
                  const isSelected = selected.has(contact.id)
                  return (
                    <tr
                      key={contact.id}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderTop: '1px solid var(--c-border)',
                        backgroundColor: isSelected ? 'rgba(201,168,76,0.06)' : undefined,
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--c-hover)' }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = '' }}
                      onClick={() => router.push(`/contacts/${contact.id}`)}
                    >
                      <td style={{ padding: '0 8px 0 16px', width: 40 }}
                        onClick={e => { e.stopPropagation(); toggleSelect(contact.id) }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(contact.id)}
                          style={{ accentColor: '#C9A84C' }} onClick={e => e.stopPropagation()} />
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-sm" style={{ color: 'var(--c-primary)' }}>{contact.name}</p>
                        {!isVisible('address') && contact.address && (
                          <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: 'var(--c-text-2)' }}>
                            {contact.address}
                          </p>
                        )}
                      </td>

                      {isVisible('category') && (
                        <td className="px-6 py-4">
                          <span
                            className="px-2.5 py-1 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: `${catColor}20`, color: catColor }}
                          >
                            {contact.category || '—'}
                          </span>
                        </td>
                      )}

                      {isVisible('phone') && (
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--c-text-2)' }}>
                          {contact.phone || '—'}
                        </td>
                      )}
                      {isVisible('email') && (
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--c-text-2)' }}>
                          {contact.email || '—'}
                        </td>
                      )}
                      {isVisible('address') && (
                        <td className="px-6 py-4 text-sm max-w-xs truncate" style={{ color: 'var(--c-text-2)' }}>
                          {contact.address || '—'}
                        </td>
                      )}
                      {isVisible('source') && (
                        <td className="px-6 py-4 text-xs" style={{ color: 'var(--c-text-2)' }}>
                          {contact.source || '—'}
                        </td>
                      )}
                      {isVisible('status') && (
                        <td className="px-6 py-4 text-xs" style={{ color: 'var(--c-text-2)' }}>
                          {contact.status || '—'}
                        </td>
                      )}

                      {isVisible('tags') && (
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {(contact.tags || []).slice(0, 3).map(tag => (
                              <span key={tag}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                                {tag}
                              </span>
                            ))}
                            {(contact.tags || []).length > 3 && (
                              <span className="px-1.5 py-0.5 rounded text-xs" style={{ color: 'var(--c-text-3)' }}>
                                +{contact.tags.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                      )}

                      {isVisible('notes') && (
                        <td className="px-6 py-4 max-w-xs">
                          {contact.notes ? (
                            <p className="text-xs line-clamp-2 whitespace-pre-wrap" style={{ color: 'var(--c-text-2)' }}
                              title={contact.notes}>
                              {contact.notes}
                            </p>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>—</span>
                          )}
                        </td>
                      )}

                      {isVisible('follow_up') && (
                        <td className="px-6 py-4">
                          {fu ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ backgroundColor: fu.bg, color: fu.color }}>
                              {fu.label}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--c-text-3)' }} className="text-xs">—</span>
                          )}
                        </td>
                      )}

                      {isVisible('added') && (
                        <td className="px-6 py-4 text-xs" style={{ color: 'var(--c-text-2)' }}>
                          {new Date(contact.created_at).toLocaleDateString()}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>{/* end overflow clip wrapper */}
        </div>
      )}

      {/* Save View Modal */}
      {saveViewOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setSaveViewOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <SaveViewModal
              onClose={() => setSaveViewOpen(false)}
              onSave={(name) => { saveView(name); setSaveViewOpen(false) }}
              category={activeCategory}
              status={filterStatus}
              source={filterSource}
              tag={filterTag}
              due={filterDue}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Save View Modal ──────────────────────────────────────────────────────────

function SaveViewModal({ onClose, onSave, category, status, source, tag, due }: {
  onClose: () => void
  onSave: (name: string) => void
  category: string; status: string; source: string; tag: string; due: string
}) {
  const [name, setName] = useState('')

  const filters: string[] = []
  if (category && category !== 'All') filters.push(category)
  if (status)  filters.push(`Status: ${status}`)
  if (source)  filters.push(`Source: ${source}`)
  if (tag)     filters.push(`Tag: ${tag}`)
  if (due)     filters.push(`Due: ${due}`)

  return (
    <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
      style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
      <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--c-primary)' }}>Save Contact View</h2>
      <div className="mb-3">
        <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>View Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())}
          placeholder="e.g. My Investors"
          autoFocus
          className="w-full text-sm px-3 py-2 rounded-lg focus:outline-none"
          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
        />
      </div>
      <p className="text-[10px] mb-5" style={{ color: 'var(--c-text-3)' }}>
        {filters.length > 0 ? `Saves: ${filters.join(' · ')}` : 'Saves current filter state (no filters applied)'}
      </p>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 text-xs font-semibold py-2 rounded-lg hover:opacity-80"
          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
          Cancel
        </button>
        <button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}
          className="flex-1 text-xs font-bold py-2 rounded-lg hover:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
          Save View
        </button>
      </div>
    </div>
  )
}
