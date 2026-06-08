'use client'

import { useState, useRef, useEffect } from 'react'
import ColumnPicker, { useColumnPrefs, ColumnDef } from '@/components/ColumnPicker'

// ─── Types ────────────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Seller', 'Buyer', 'Investor', 'Wholesaler', 'Agent', 'Lender', 'Other']
const STATUSES   = ['Active', 'Inactive', 'Closed', 'Follow-up']

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
  const [search, setSearch]             = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterTag, setFilterTag]       = useState('')
  const [filterDue, setFilterDue]       = useState<'' | 'today' | 'week' | 'overdue'>('')
  const [showFilters, setShowFilters]   = useState(false)
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

  // Derived: unique tags + sources from loaded contacts
  const allTags    = [...new Set(contacts.flatMap(c => c.tags || []))].sort()
  const allSources = [...new Set(contacts.map(c => c.source).filter(Boolean))].sort()

  const dueCount = contacts.filter(c => {
    if (!c.follow_up_date) return false
    const d = new Date(c.follow_up_date + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return d <= today
  }).length

  const activeFilterCount = [filterStatus, filterSource, filterTag, filterDue].filter(Boolean).length

  const filtered = contacts.filter(c => {
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

  return (
    <div className="p-4 md:p-8" style={{ color: 'var(--c-primary)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--c-primary)' }}>Contacts</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--c-text-2)' }}>
            {contacts.length.toLocaleString()} total
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
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>No contacts found.</p>
          <a href="/contacts/new" className="text-sm font-semibold mt-2 inline-block hover:underline"
            style={{ color: '#C9A84C' }}>
            Add your first contact →
          </a>
        </div>
      ) : (
        <div className="rounded-2xl"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>

          {/* Table toolbar — no overflow:hidden here so the dropdown can escape */}
          <div className="relative flex items-center justify-between px-6 py-3"
            style={{ borderBottom: '1px solid var(--c-border)' }}>
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>
              {filtered.length.toLocaleString()} contact{filtered.length !== 1 ? 's' : ''}
            </span>
            <ColumnPicker columns={COLUMNS} visible={visible} onToggle={toggle} onReset={reset} />
          </div>

          {/* overflow-x: auto = scrollable; overflow-y: clip keeps rounded corners */}
          <div style={{ overflowX: 'auto', overflowY: 'clip', borderRadius: '0 0 16px 16px' }}>
          <div>
            <table style={{ tableLayout: 'fixed', width: '100%', minWidth: 'max-content' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--c-card-alt)', borderBottom: '1px solid var(--c-border)' }}>
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
                  return (
                    <tr
                      key={contact.id}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: '1px solid var(--c-border)' }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                      onClick={() => window.location.href = `/contacts/${contact.id}`}
                    >
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
    </div>
  )
}
