'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const CATEGORIES = ['Seller', 'Buyer', 'Investor', 'Wholesaler', 'Agent', 'Lender', 'Student', 'Other']
const STATUSES = ['Active', 'Inactive', 'Closed', 'Follow-up']

const categoryColors: Record<string, string> = {
  Seller: '#4CAF9A',
  Buyer: '#7B8FD4',
  Investor: '#C9A84C',
  Wholesaler: '#E07B6A',
  Agent: '#6ABDE0',
  Lender: '#B06AE0',
  Student: '#E0A86A',
  Other: '#888',
}

const activityIcons: Record<string, string> = {
  call: '📞',
  text: '💬',
  email: '✉️',
  meeting: '🤝',
  note: '📝',
  offer: '💰',
  follow_up: '🔔',
  other: '📌',
}

interface Contact {
  id: string
  name: string
  phone: string
  email: string
  address: string
  category: string
  tags: string[]
  notes: string
  status: string
  source: string
  follow_up_date: string | null
  created_at: string
}

interface Activity {
  id: string
  type: string
  notes: string
  created_at: string
}

interface Deal {
  id: string
  address: string
  status: string
  arv: number
  offer_price: number
  created_at: string
}

interface Msg {
  id: string
  direction: string
  body: string
  status: string
  created_at: string
}

type Tab = 'about' | 'messages'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ContactDetailClient({
  contact: initialContact,
  activities: initialActivities,
  deals,
  messages: initialMessages,
}: {
  contact: Contact
  activities: Activity[]
  deals: Deal[]
  messages: Msg[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [tab, setTab] = useState<Tab>('about')
  const [contact, setContact] = useState(initialContact)
  const [activities, setActivities] = useState(initialActivities)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: contact.name || '',
    phone: contact.phone || '',
    email: contact.email || '',
    address: contact.address || '',
    category: contact.category || 'Seller',
    status: contact.status || 'Active',
    tags: (contact.tags || []).join(', '),
    notes: contact.notes || '',
    source: contact.source || '',
    follow_up_date: contact.follow_up_date || '',
  })

  // ── Notes — standalone auto-saving box ──
  const [notes, setNotes]           = useState(contact.notes || '')
  const [notesSaved, setNotesSaved] = useState(false)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleNotesChange = (val: string) => {
    setNotes(val)
    setNotesSaved(false)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      await supabase.from('contacts').update({ notes: val }).eq('id', contact.id)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    }, 800)
  }

  // Activity log form
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [activityForm, setActivityForm]         = useState({ type: 'call', notes: '' })
  const [activitySaving, setActivitySaving]     = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const { data, error } = await supabase
      .from('contacts')
      .update({
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        category: form.category,
        status: form.status,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        notes: form.notes,
        source: form.source,
        follow_up_date: form.follow_up_date || null,
      })
      .eq('id', contact.id)
      .select()
      .single()

    if (error) { setError(error.message); setSaving(false) }
    else { setContact(data); setEditing(false); setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ${contact.name}? This cannot be undone.`)) return
    setDeleting(true)
    await supabase.from('contacts').delete().eq('id', contact.id)
    router.push('/contacts')
  }

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    setActivitySaving(true)
    const { data, error } = await supabase
      .from('activities')
      .insert([{ contact_id: contact.id, type: activityForm.type, notes: activityForm.notes }])
      .select()
      .single()

    if (!error && data) {
      setActivities(prev => [data, ...prev])
      setActivityForm({ type: 'call', notes: '' })
      setShowActivityForm(false)
    }
    setActivitySaving(false)
  }

  const catColor = categoryColors[contact.category] || '#888'

  const fuMeta = (() => {
    if (!contact.follow_up_date) return null
    const d = new Date(contact.follow_up_date + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
    if (diff < 0)  return { label: 'Overdue',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
    if (diff === 0) return { label: 'Today',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
    if (diff === 1) return { label: 'Tomorrow', color: '#C9A84C', bg: 'rgba(201,168,76,0.12)' }
    return {
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      color: '#6b7280', bg: 'rgba(107,114,128,0.08)',
    }
  })()

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'about',
      label: 'About',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      key: 'messages',
      label: 'Messages',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
        </svg>
      ),
    },
  ]

  return (
    <div style={{ color: 'var(--c-primary)', display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ── */}
      <div className="px-4 md:px-8 pt-4 md:pt-8 pb-0" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
        <div className="flex items-center gap-3 mb-4 md:mb-5">
          <a href="/contacts" className="transition-colors flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold truncate" style={{ color: 'var(--c-primary)' }}>{contact.name}</h1>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                style={{ backgroundColor: `${catColor}20`, color: catColor }}>
                {contact.category}
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                {contact.status}
              </span>
            </div>
            <p className="text-xs md:text-sm mt-0.5 truncate" style={{ color: 'var(--c-text-3)' }}>
              Added {new Date(contact.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {contact.source ? ` · ${contact.source}` : ''}
              {contact.phone ? ` · ${contact.phone}` : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {!editing ? (
              <>
                <button
                  onClick={() => setEditing(true)}
                  style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}
                  className="font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  style={{ border: '1px solid rgba(224,123,106,0.4)', color: '#E07B6A' }}
                >
                  {deleting ? '…' : 'Del'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
                  className="font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity text-sm disabled:opacity-60"
                >
                  {saving ? '…' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditing(false); setError('') }}
                  className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80"
                  style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* ── Tab bar ── */}
        <div className="flex gap-1 -mb-px">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2"
              style={{
                borderBottomColor: tab === t.key ? '#C9A84C' : 'transparent',
                color: tab === t.key ? '#C9A84C' : 'var(--c-text-2)',
                backgroundColor: 'transparent',
              }}
            >
              {t.icon}
              {t.label}
              {t.key === 'messages' && initialMessages.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                  {initialMessages.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto">

        {/* ABOUT TAB */}
        {tab === 'about' && (
          <div className="p-4 md:p-8 max-w-5xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {/* Left col — contact info + notes + activity */}
              <div className="md:col-span-2 space-y-4 md:space-y-5">

                {/* Info card */}
                <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <h2 className="font-bold text-base mb-4" style={{ color: 'var(--c-primary)' }}>Contact Info</h2>
                  {editing ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Full Name</label>
                        <input name="name" value={form.name} onChange={handleChange}
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Phone</label>
                        <input name="phone" value={form.phone} onChange={handleChange} type="tel"
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Email</label>
                        <input name="email" value={form.email} onChange={handleChange} type="email"
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Property Address</label>
                        <input name="address" value={form.address} onChange={handleChange}
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Category</label>
                        <select name="category" value={form.category} onChange={handleChange}
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Status</label>
                        <select name="status" value={form.status} onChange={handleChange}
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                          {STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Source</label>
                        <input name="source" value={form.source} onChange={handleChange}
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Tags (comma separated)</label>
                        <input name="tags" value={form.tags} onChange={handleChange}
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Follow-up Date</label>
                        <input name="follow_up_date" value={form.follow_up_date} onChange={handleChange} type="date"
                          className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                          style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <InfoRow label="Phone" value={contact.phone}
                        link={contact.phone ? `tel:${contact.phone}` : undefined} />
                      <InfoRow label="Email" value={contact.email}
                        link={contact.email ? `mailto:${contact.email}` : undefined} />
                      <InfoRow label="Property Address" value={contact.address} />
                      <InfoRow label="Source" value={contact.source} />
                      {contact.tags && contact.tags.length > 0 && (
                        <div className="flex gap-2 items-start">
                          <span className="text-xs w-32 pt-1 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>Tags</span>
                          <div className="flex flex-wrap gap-1.5">
                            {contact.tags.map(tag => (
                              <span key={tag} className="px-2 py-0.5 rounded-full text-xs"
                                style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {contact.follow_up_date && fuMeta && (
                        <div className="flex gap-2">
                          <span className="text-xs w-32 pt-0.5 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>Follow-up</span>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: fuMeta.bg, color: fuMeta.color }}>
                            {fuMeta.label}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-base" style={{ color: 'var(--c-primary)' }}>Notes</h2>
                    {notesSaved && <span className="text-xs font-medium" style={{ color: '#4CAF9A' }}>✓ Saved</span>}
                  </div>
                  <textarea
                    value={notes}
                    onChange={e => handleNotesChange(e.target.value)}
                    placeholder="Add notes about this contact — motivation, property condition, timeline, anything…"
                    rows={6}
                    className="w-full text-sm rounded-xl px-3 py-2.5 resize-y focus:outline-none"
                    style={{
                      backgroundColor: 'var(--c-input-bg)',
                      border: '1px solid var(--c-border)',
                      color: 'var(--c-primary)',
                      minHeight: '120px',
                    }}
                  />
                </div>

                {/* Activity log */}
                <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-base" style={{ color: 'var(--c-primary)' }}>Activity Log</h2>
                    <button
                      onClick={() => setShowActivityForm(!showActivityForm)}
                      className="text-xs font-bold px-4 py-1.5 rounded-lg transition-opacity hover:opacity-90"
                      style={showActivityForm
                        ? { border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }
                        : { backgroundColor: '#0A1F44', color: '#C9A84C' }}
                    >
                      {showActivityForm ? 'Cancel' : '+ Log Activity'}
                    </button>
                  </div>

                  {showActivityForm && (
                    <form onSubmit={handleAddActivity} className="rounded-xl p-4 mb-4 space-y-3"
                      style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
                      <select
                        value={activityForm.type}
                        onChange={e => setActivityForm(prev => ({ ...prev, type: e.target.value }))}
                        className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      >
                        {Object.entries(activityIcons).map(([key, icon]) => (
                          <option key={key} value={key}>{icon} {key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                        ))}
                      </select>
                      <textarea
                        value={activityForm.notes}
                        onChange={e => setActivityForm(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="What happened? Add details..."
                        rows={3}
                        className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none"
                        style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      />
                      <button
                        type="submit"
                        disabled={activitySaving || !activityForm.notes.trim()}
                        style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
                        className="font-bold px-5 py-2 rounded-xl text-sm hover:opacity-90 disabled:opacity-60"
                      >
                        {activitySaving ? 'Saving…' : 'Log It'}
                      </button>
                    </form>
                  )}

                  {activities.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: 'var(--c-text-3)' }}>No activity yet. Log your first interaction above.</p>
                  ) : (
                    <div className="space-y-3">
                      {activities.map(a => (
                        <div key={a.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                            style={{ backgroundColor: 'var(--c-card-alt)' }}>
                            {activityIcons[a.type] || '📌'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-semibold capitalize" style={{ color: 'var(--c-primary)' }}>
                                {a.type.replace('_', ' ')}
                              </span>
                              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                                {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </div>
                            {a.notes && <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>{a.notes}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right col — deals + quick actions */}
              <div className="space-y-5">
                <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-base" style={{ color: 'var(--c-primary)' }}>Deals</h2>
                    <a href={`/deals/new?contact_id=${contact.id}`}
                      className="text-xs font-bold hover:underline" style={{ color: '#C9A84C' }}>
                      + New Deal
                    </a>
                  </div>
                  {deals.length === 0 ? (
                    <p className="text-sm text-center py-4" style={{ color: 'var(--c-text-3)' }}>No deals yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {deals.map(deal => (
                        <a key={deal.id} href={`/deals/${deal.id}`}
                          className="block p-3 rounded-xl transition-colors hover:opacity-80"
                          style={{ border: '1px solid var(--c-border)' }}>
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>{deal.address}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>{deal.status}</span>
                            {deal.offer_price && (
                              <span className="text-xs font-bold" style={{ color: '#4CAF9A' }}>
                                ${deal.offer_price.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <h2 className="font-bold text-base mb-3" style={{ color: 'var(--c-primary)' }}>Quick Actions</h2>
                  <div className="space-y-2">
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`}
                        className="flex items-center gap-2 p-2.5 rounded-xl transition-opacity hover:opacity-80"
                        style={{ backgroundColor: 'var(--c-card-alt)' }}>
                        <span className="text-sm">📞</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--c-primary)' }}>Call {contact.phone}</span>
                      </a>
                    )}
                    {contact.phone && (
                      <button
                        onClick={() => setTab('messages')}
                        className="flex items-center gap-2 p-2.5 rounded-xl w-full text-left transition-opacity hover:opacity-80"
                        style={{ backgroundColor: 'var(--c-card-alt)' }}>
                        <span className="text-sm">💬</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--c-primary)' }}>Send Message</span>
                      </button>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`}
                        className="flex items-center gap-2 p-2.5 rounded-xl transition-opacity hover:opacity-80"
                        style={{ backgroundColor: 'var(--c-card-alt)' }}>
                        <span className="text-sm">✉️</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--c-primary)' }}>Email</span>
                      </a>
                    )}
                    {contact.address && (
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(contact.address)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 rounded-xl transition-opacity hover:opacity-80"
                        style={{ backgroundColor: 'var(--c-card-alt)' }}>
                        <span className="text-sm">📍</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--c-primary)' }}>Maps</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MESSAGES TAB */}
        {tab === 'messages' && (
          <MessagesTab contact={contact} initialMessages={initialMessages} />
        )}
      </div>
    </div>
  )
}

// ── Messages tab — full conversation view ──────────────────────────────────
function MessagesTab({ contact, initialMessages }: { contact: Contact; initialMessages: Msg[] }) {
  const supabase = createClient()
  const [thread, setThread] = useState<Msg[]>((initialMessages ?? []).filter(m => m != null))
  const [compose, setCompose]     = useState('')
  const [sending, setSending]     = useState(false)
  const [sendError, setSendError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`msgs_contact_${contact.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `contact_id=eq.${contact.id}`,
      }, (payload) => {
        const msg = payload.new as (Msg & { contact_id: string }) | null
        if (!msg?.id) return
        setThread(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [contact.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async () => {
    if (!compose.trim() || sending) return
    setSending(true)
    setSendError('')
    const body = compose.trim()
    setCompose('')

    const tempId = `temp_${Date.now()}`
    const tempMsg: Msg = { id: tempId, direction: 'outbound', body, status: 'sending', created_at: new Date().toISOString() }
    setThread(prev => [...prev, tempMsg])

    const res  = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id, body }),
    })
    const data = await res.json()

    if (!res.ok) {
      setSendError(data.error ?? 'Failed to send')
      setThread(prev => prev.filter(m => m.id !== tempId))
      setCompose(body)
    } else {
      if (data.message?.id) {
        setThread(prev => prev.map(m => m.id === tempId ? data.message : m))
      } else {
        setThread(prev => prev.filter(m => m.id !== tempId))
      }
      if (data.warning) setSendError(data.warning)
    }
    setSending(false)
  }

  const getSuggestedReply = async () => {
    if (aiLoading) return
    setAiLoading(true)
    const res  = await fetch('/api/sms/ai-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: contact.id }) })
    const data = await res.json()
    if (data.suggestion) { setCompose(data.suggestion); textareaRef.current?.focus() }
    setAiLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const safeThread  = thread.filter((m): m is Msg => m != null)
  const hasInbound  = safeThread.some(m => m.direction === 'inbound')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 145px)' }}>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-8 py-6" style={{ backgroundColor: 'var(--c-bg)' }}>
        {safeThread.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--c-card-alt)' }}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
              </svg>
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No messages yet</p>
            {contact.phone
              ? <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Send your first message below</p>
              : <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Add a phone number to this contact first</p>
            }
          </div>
        )}

        <div className="max-w-2xl mx-auto space-y-3">
          {safeThread.map((msg, i) => {
            const prev = safeThread[i - 1]
            const showDate = !prev || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString()
            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px" style={{ backgroundColor: 'var(--c-border)' }} />
                    <span className="text-xs font-medium px-3" style={{ color: 'var(--c-text-3)' }}>
                      {new Date(msg.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: 'var(--c-border)' }} />
                  </div>
                )}
                <div className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-sm px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                    style={msg.direction === 'outbound'
                      ? { backgroundColor: '#0A1F44', color: '#fff', borderBottomRightRadius: 4 }
                      : { backgroundColor: 'var(--c-card)', color: 'var(--c-primary)', border: '1px solid var(--c-border)', borderBottomLeftRadius: 4 }
                    }
                  >
                    <p>{msg.body}</p>
                    <p className="text-xs mt-1 opacity-50">
                      {msg.status === 'sending' ? 'Sending…'
                        : msg.status === 'failed' ? '⚠️ Not delivered — A2P pending'
                        : timeAgo(msg.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Compose */}
      <div className="px-8 py-4" style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
        {sendError && <p className="text-xs text-red-500 mb-2">{sendError}</p>}

        {hasInbound && (
          <div className="mb-2">
            <button
              onClick={getSuggestedReply}
              disabled={aiLoading}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}
            >
              {aiLoading
                ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Generating…</>
                : '✨ AI Suggest Reply'
              }
            </button>
          </div>
        )}

        <div className="flex gap-3 items-end max-w-2xl mx-auto">
          <textarea
            ref={textareaRef}
            value={compose}
            onChange={e => setCompose(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={contact.phone ? `Message ${contact.name}… (Enter to send, Shift+Enter for newline)` : 'No phone number on file'}
            disabled={!contact.phone}
            rows={2}
            className="flex-1 resize-none rounded-2xl px-4 py-3 text-sm focus:outline-none"
            style={{
              backgroundColor: 'var(--c-card-alt)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-primary)',
              maxHeight: 120,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!compose.trim() || sending || !contact.phone}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, link }: { label: string; value?: string; link?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-xs w-32 pt-0.5 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>{label}</span>
      {link ? (
        <a href={link} className="text-sm font-medium hover:underline" style={{ color: 'var(--c-primary)' }}>{value}</a>
      ) : (
        <span className="text-sm font-medium" style={{ color: 'var(--c-primary)' }}>{value}</span>
      )}
    </div>
  )
}
