'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const EmailComposer = dynamic(() => import('@/components/EmailComposer'), { ssr: false })

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTACT_TYPES = ['Seller', 'Buyer', 'Investor', 'Attorney', 'Agent', 'Heir', 'Tenant', 'Vendor', 'Wholesaler', 'Lender', 'Other']
const STATUSES = ['Active', 'Nurture', 'Dead', 'Closed']
const LEAD_SCORES = ['Hot', 'Warm', 'Cold'] as const
const ACTIVITY_TYPES = ['call','text','email','meeting','note','offer','follow_up','other'] as const

const typeColors: Record<string, string> = {
  Seller: '#4CAF9A', Buyer: '#7B8FD4', Investor: '#C9A84C', Attorney: '#E07B6A',
  Agent: '#6ABDE0', Heir: '#a78bfa', Tenant: '#E0A86A', Vendor: '#888888',
  Wholesaler: '#E07B6A', Lender: '#B06AE0', Student: '#E0A86A', Other: '#888888',
}

const scoreColors: Record<string, string> = {
  Hot: '#ef4444', Warm: '#f59e0b', Cold: '#6ABDE0',
}

const activityColors: Record<string, string> = {
  call: '#4CAF9A', text: '#7B8FD4', email: '#6ABDE0', meeting: '#C9A84C',
  note: '#9CA3AF', offer: '#E07B6A', follow_up: '#B06AE0', other: '#9CA3AF',
}

const priorityColors: Record<string, string> = {
  low: '#9ca3af', normal: '#6ABDE0', high: '#f59e0b', urgent: '#ef4444',
}

const DOC_STATUS_COLORS: Record<string, string> = {
  draft: '#9ca3af', generated: '#7B8FD4', signed_by_me: '#C9A84C',
  sent: '#6ABDE0', fully_signed: '#4CAF9A', expired: '#ef4444', cancelled: '#9ca3af',
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = 'overview' | 'properties' | 'communications' | 'activity' | 'deals' | 'documents' | 'tasks' | 'automations'

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
  lead_source: string | null
  follow_up_date: string | null
  last_contact_date: string | null
  lead_score: string | null
  motivation: string | null
  timeline: string | null
  asking_price: number | null
  lead_type_id: string | null
  vertical_id: string | null
  created_at: string
}

interface Activity { id: string; type: string; notes: string; created_at: string }

interface Deal {
  id: string; address: string; status: string
  arv: number | null; offer_price: number | null
  closing_date: string | null; created_at: string
}

interface Msg { id: string; direction: string; body: string; status: string; created_at: string }

interface Task {
  id: string; title: string; description: string | null
  due_date: string | null; priority: string; status: string
  assigned_to: string | null; completed_at: string | null; created_at: string
}

interface GmailThread {
  id: string; subject: string; from: string; to: string
  snippet: string; date: string; unread: boolean; messageCount: number
}

interface GmailMsg { id: string; from: string; to: string; cc: string; subject: string; date: string; body: string }

// ─── Utils ────────────────────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return '—'
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', opts ?? { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtVal(v: number | null | undefined) {
  if (v == null) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

function activityInitial(type: string) {
  return type === 'follow_up' ? 'F' : (type?.[0]?.toUpperCase() ?? '?')
}

function futureMeta(dateStr: string | null) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)  return { label: 'Overdue',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
  if (diff === 0) return { label: 'Today',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
  if (diff === 1) return { label: 'Tomorrow', color: '#C9A84C', bg: 'rgba(201,168,76,0.12)' }
  return {
    label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    color: '#6b7280', bg: 'rgba(107,114,128,0.08)',
  }
}

const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }

// ─── Main component ───────────────────────────────────────────────────────────
export default function ContactDetailClient({
  contact: initialContact,
  activities: initialActivities,
  deals: initialDeals,
  messages: initialMessages,
}: {
  contact: Contact
  activities: Activity[]
  deals: Deal[]
  messages: Msg[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [tab, setTab]               = useState<Tab>('overview')
  const [contact, setContact]       = useState(initialContact)
  const [editing, setEditing]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [error, setError]           = useState('')
  const [showEmailComposer, setShowEmailComposer] = useState(false)

  const [leadTypes,  setLeadTypes]  = useState<{ id: string; name: string; color: string }[]>([])
  const [verticals,  setVerticals]  = useState<{ id: string; name: string; color: string }[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/lead-types').then(r => r.ok ? r.json() : []),
      fetch('/api/business-verticals').then(r => r.ok ? r.json() : []),
    ]).then(([types, verts]) => {
      setLeadTypes((types as { id: string; name: string; color: string; is_active: boolean }[]).filter(t => t.is_active))
      setVerticals((verts as { id: string; name: string; color: string; is_active: boolean }[]).filter(v => v.is_active))
    })
  }, [])

  const [form, setForm] = useState({
    name: initialContact.name || '',
    phone: initialContact.phone || '',
    email: initialContact.email || '',
    address: initialContact.address || '',
    category: initialContact.category || 'Seller',
    status: initialContact.status || 'Active',
    tags: (initialContact.tags || []).join(', '),
    notes: initialContact.notes || '',
    source: initialContact.source || '',
    lead_source: initialContact.lead_source || '',
    follow_up_date: initialContact.follow_up_date || '',
    last_contact_date: initialContact.last_contact_date || '',
    lead_score: initialContact.lead_score || '',
    motivation: initialContact.motivation || '',
    timeline: initialContact.timeline || '',
    asking_price: initialContact.asking_price?.toString() || '',
    lead_type_id: initialContact.lead_type_id || '',
    vertical_id: initialContact.vertical_id || '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSave = async () => {
    setSaving(true); setError('')
    const { data, error } = await supabase
      .from('contacts')
      .update({
        name: form.name, phone: form.phone, email: form.email, address: form.address,
        category: form.category, status: form.status, source: form.source,
        lead_source: form.lead_source || null,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        notes: form.notes,
        follow_up_date: form.follow_up_date || null,
        last_contact_date: form.last_contact_date || null,
        lead_score: form.lead_score || null,
        motivation: form.motivation || null,
        timeline: form.timeline || null,
        asking_price: form.asking_price ? Number(form.asking_price) : null,
        lead_type_id: form.lead_type_id || null,
        vertical_id: form.vertical_id || null,
      })
      .eq('id', contact.id)
      .select()
      .single()
    if (error) { setError(error.message); setSaving(false) }
    else { setContact(data); setEditing(false); setSaving(false) }
  }

  const handleDelete = async () => {
    setDeleting(true)
    const { error: delErr } = await supabase.from('contacts').delete().eq('id', contact.id)
    if (delErr) { setError('Failed to delete contact. Please try again.'); setDeleting(false); setDeleteConfirm(false) }
    else router.push('/contacts')
  }

  const catColor = typeColors[contact.category] ?? '#888'
  const fuMeta   = futureMeta(contact.follow_up_date)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview',       label: 'Overview' },
    { key: 'properties',     label: 'Properties' },
    { key: 'communications', label: 'Comms' },
    { key: 'activity',       label: 'Activity' },
    { key: 'deals',          label: 'Deals' },
    { key: 'documents',      label: 'Documents' },
    { key: 'tasks',          label: 'Tasks' },
    { key: 'automations',    label: 'Automations' },
  ]

  return (
    <div style={{ color: 'var(--c-primary)', display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ── */}
      <div className="px-4 md:px-8 pt-4 md:pt-6 pb-0"
        style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>

        <div className="flex items-start gap-3 mb-3">
          <a href="/contacts" style={{ color: 'var(--c-text-2)', marginTop: 4 }} className="flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </a>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--c-primary)' }}>{contact.name}</h1>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                    style={{ backgroundColor: `${catColor}20`, color: catColor }}>
                    {contact.category}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                    style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                    {contact.status}
                  </span>
                  {contact.lead_score && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold shrink-0"
                      style={{ backgroundColor: `${scoreColors[contact.lead_score] ?? '#888'}20`, color: scoreColors[contact.lead_score] ?? '#888' }}>
                      {contact.lead_score}
                    </span>
                  )}
                  {fuMeta && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                      style={{ backgroundColor: fuMeta.bg, color: fuMeta.color }}>
                      Follow-up: {fuMeta.label}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                  Added {fmtDate(contact.created_at)}
                  {contact.source ? ` · ${contact.source}` : ''}
                  {contact.last_contact_date ? ` · Last contact: ${fmtDate(contact.last_contact_date, { month: 'short', day: 'numeric' })}` : ''}
                </p>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {!editing ? (
                  <>
                    <button onClick={() => setEditing(true)}
                      style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}
                      className="font-bold px-4 py-2 rounded-xl hover:opacity-90 text-sm">
                      Edit
                    </button>
                    {deleteConfirm ? (
                      <span className="flex items-center gap-1.5">
                        <button onClick={handleDelete} disabled={deleting}
                          className="px-3 py-2 rounded-xl text-sm font-semibold"
                          style={{ backgroundColor: '#E07B6A', color: '#fff' }}>
                          {deleting ? '…' : 'Confirm'}
                        </button>
                        <button onClick={() => setDeleteConfirm(false)}
                          className="px-3 py-2 rounded-xl text-sm"
                          style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setDeleteConfirm(true)}
                        className="px-4 py-2 rounded-xl text-sm font-medium"
                        style={{ border: '1px solid rgba(224,123,106,0.4)', color: '#E07B6A' }}>
                        Delete
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={handleSave} disabled={saving}
                      style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
                      className="font-bold px-4 py-2 rounded-xl text-sm disabled:opacity-60">
                      {saving ? '…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditing(false); setError('') }}
                      className="px-4 py-2 rounded-xl text-sm font-medium"
                      style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>✕</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-red-500 text-xs mb-2">{error}</p>}

        {/* Quick action bar */}
        {!editing && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {contact.phone && (
              <a href={`tel:${contact.phone}`}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.3)' }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>
                </svg>
                Call
              </a>
            )}
            {contact.phone && (
              <button onClick={() => setTab('communications')}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'rgba(123,143,212,0.12)', color: '#7B8FD4', border: '1px solid rgba(123,143,212,0.3)' }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                </svg>
                Text
              </button>
            )}
            {contact.email && (
              <button onClick={() => setShowEmailComposer(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'rgba(106,189,224,0.12)', color: '#6ABDE0', border: '1px solid rgba(106,189,224,0.3)' }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
                Email
              </button>
            )}
            <a href={`/deals/new?contact_id=${contact.id}`}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
              + Deal
            </a>
            <button onClick={() => setTab('tasks')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'rgba(201,168,76,0.08)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.2)' }}>
              + Task
            </button>
            <a href={`/documents/new?contact_id=${contact.id}`}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Contract
            </a>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-shrink-0 px-3 md:px-4 py-2.5 text-xs md:text-sm font-semibold transition-colors border-b-2 whitespace-nowrap"
              style={{
                borderBottomColor: tab === t.key ? '#C9A84C' : 'transparent',
                color: tab === t.key ? '#C9A84C' : 'var(--c-text-2)',
                backgroundColor: 'transparent',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto">
        {tab === 'overview'       && <OverviewTab contact={contact} editing={editing} form={form} handleChange={handleChange} deals={initialDeals} onTabChange={setTab} leadTypes={leadTypes} verticals={verticals} />}
        {tab === 'properties'     && <LinkedPropertiesTab contactId={contact.id} />}
        {tab === 'communications' && <CommunicationsTab contact={contact} initialMessages={initialMessages} />}
        {tab === 'activity'       && <ActivityTab contactId={contact.id} initialActivities={initialActivities} />}
        {tab === 'deals'          && <DealsTab contactId={contact.id} initialDeals={initialDeals} />}
        {tab === 'documents'      && <DocumentsTab contactId={contact.id} />}
        {tab === 'tasks'          && <TasksTab contactId={contact.id} />}
        {tab === 'automations'    && <AutomationsTab />}
      </div>

      {showEmailComposer && (
        <EmailComposer
          defaultTo={contact.email ?? ''}
          contactId={contact.id}
          contactName={contact.name}
          onClose={() => setShowEmailComposer(false)}
        />
      )}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({
  contact, editing, form, handleChange, deals, onTabChange, leadTypes, verticals,
}: {
  contact: Contact
  editing: boolean
  form: Record<string, string>
  handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
  deals: Deal[]
  onTabChange: (t: Tab) => void
  leadTypes: { id: string; name: string; color: string }[]
  verticals: { id: string; name: string; color: string }[]
}) {
  const supabase = createClient()
  const [notes, setNotes]           = useState(contact.notes || '')
  const [notesSaved, setNotesSaved] = useState(false)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleNotesChange = (val: string) => {
    setNotes(val); setNotesSaved(false)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      await supabase.from('contacts').update({ notes: val }).eq('id', contact.id)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    }, 800)
  }

  const activeDeals = deals.filter(d => !['Dead','Cancelled','Closed'].includes(d.status))

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">

        {/* Contact Info */}
        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <h2 className="font-bold text-base mb-4" style={{ color: 'var(--c-primary)' }}>Contact Info</h2>
          {editing ? (
            <div className="space-y-3">
              {[
                { label: 'Full Name', name: 'name', type: 'text' },
                { label: 'Phone', name: 'phone', type: 'tel' },
                { label: 'Email', name: 'email', type: 'email' },
                { label: 'Property Address', name: 'address', type: 'text' },
                { label: 'Lead Source', name: 'lead_source', type: 'text' },
                { label: 'Tags (comma separated)', name: 'tags', type: 'text' },
                { label: 'Follow-up Date', name: 'follow_up_date', type: 'date' },
                { label: 'Last Contact Date', name: 'last_contact_date', type: 'date' },
              ].map(f => (
                <div key={f.name}>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>{f.label}</label>
                  <input name={f.name} value={form[f.name] ?? ''} onChange={handleChange} type={f.type}
                    className={inputCls} style={inputStyle} />
                </div>
              ))}
              {leadTypes.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Lead Type</label>
                  <select name="lead_type_id" value={form.lead_type_id} onChange={handleChange} className={inputCls} style={inputStyle}>
                    <option value="">— None —</option>
                    {leadTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              {verticals.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Vertical</label>
                  <select name="vertical_id" value={form.vertical_id} onChange={handleChange} className={inputCls} style={inputStyle}>
                    <option value="">— None —</option>
                    {verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Contact Type</label>
                <select name="category" value={form.category} onChange={handleChange} className={inputCls} style={inputStyle}>
                  {CONTACT_TYPES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Status</label>
                <select name="status" value={form.status} onChange={handleChange} className={inputCls} style={inputStyle}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <InfoRow label="Phone"    value={contact.phone} link={contact.phone ? `tel:${contact.phone}` : undefined} />
              <InfoRow label="Email"    value={contact.email} link={contact.email ? `mailto:${contact.email}` : undefined} />
              <InfoRow label="Address"  value={contact.address} />
              <InfoRow label="Source"   value={contact.lead_source || contact.source} />
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex gap-2 items-start">
                  <span className="text-xs w-28 pt-1 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>Tags</span>
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
              {contact.lead_type_id && leadTypes.length > 0 && (() => {
                const lt = leadTypes.find(t => t.id === contact.lead_type_id)
                return lt ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-xs w-28 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>Lead Type</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: `${lt.color}20`, color: lt.color }}>{lt.name}</span>
                  </div>
                ) : null
              })()}
              {contact.vertical_id && verticals.length > 0 && (() => {
                const v = verticals.find(v => v.id === contact.vertical_id)
                return v ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-xs w-28 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>Vertical</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: `${v.color}20`, color: v.color }}>{v.name}</span>
                  </div>
                ) : null
              })()}
              <InfoRow label="Follow-up"    value={contact.follow_up_date ? fmtDate(contact.follow_up_date) : undefined} />
              <InfoRow label="Last Contact" value={contact.last_contact_date ? fmtDate(contact.last_contact_date) : undefined} />
              {contact.address && (
                <div className="pt-1">
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(contact.address)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold hover:underline" style={{ color: '#6ABDE0' }}>
                    Open in Maps →
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lead Details + Notes */}
        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <h2 className="font-bold text-base mb-4" style={{ color: 'var(--c-primary)' }}>Lead Details</h2>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Lead Score</label>
                <select name="lead_score" value={form.lead_score} onChange={handleChange} className={inputCls} style={inputStyle}>
                  <option value="">— None —</option>
                  {LEAD_SCORES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Asking Price</label>
                <input name="asking_price" value={form.asking_price} onChange={handleChange} type="number" placeholder="0"
                  className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Motivation</label>
                <textarea name="motivation" value={form.motivation} onChange={handleChange} rows={3}
                  placeholder="Why are they selling? Divorce, foreclosure, relocation…"
                  className={`${inputCls} resize-none`} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Timeline</label>
                <input name="timeline" value={form.timeline} onChange={handleChange}
                  placeholder="e.g. 30-60 days, ASAP, end of year…"
                  className={inputCls} style={inputStyle} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {contact.lead_score ? (
                <div className="flex gap-2 items-center">
                  <span className="text-xs w-28 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>Lead Score</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold"
                    style={{ backgroundColor: `${scoreColors[contact.lead_score] ?? '#888'}20`, color: scoreColors[contact.lead_score] ?? '#888' }}>
                    {contact.lead_score}
                  </span>
                </div>
              ) : null}
              <InfoRow label="Asking Price" value={contact.asking_price ? fmtVal(contact.asking_price) : undefined} />
              {contact.motivation && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Motivation</p>
                  <p className="text-sm" style={{ color: 'var(--c-primary)' }}>{contact.motivation}</p>
                </div>
              )}
              {contact.timeline && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Timeline</p>
                  <p className="text-sm" style={{ color: 'var(--c-primary)' }}>{contact.timeline}</p>
                </div>
              )}
              {!contact.lead_score && !contact.asking_price && !contact.motivation && !contact.timeline && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--c-text-3)' }}>
                  Click Edit to add lead details
                </p>
              )}
            </div>
          )}

          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--c-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--c-primary)' }}>Notes</h3>
              {notesSaved && <span className="text-xs" style={{ color: '#4CAF9A' }}>✓ Saved</span>}
            </div>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder="Notes about this contact…"
              rows={5}
              className="w-full text-sm rounded-xl px-3 py-2.5 resize-y focus:outline-none"
              style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)', minHeight: 100 }}
            />
          </div>
        </div>

        {/* Performance summary */}
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <h2 className="font-bold text-base mb-4" style={{ color: 'var(--c-primary)' }}>Performance</h2>
            <div className="space-y-3">
              {[
                { label: 'Total Deals', value: deals.length.toString(), color: '#C9A84C', tab: 'deals' as Tab },
                { label: 'Active Deals', value: activeDeals.length.toString(), color: '#4CAF9A', tab: 'deals' as Tab },
              ].map(item => (
                <button key={item.label} onClick={() => onTabChange(item.tab)}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-card-alt)' }}>
                  <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>{item.label}</span>
                  <span className="text-lg font-bold" style={{ color: item.color }}>{item.value}</span>
                </button>
              ))}
              {[
                { label: 'Properties', tab: 'properties' as Tab },
                { label: 'Documents', tab: 'documents' as Tab },
                { label: 'Tasks', tab: 'tasks' as Tab },
              ].map(item => (
                <button key={item.label} onClick={() => onTabChange(item.tab)}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-card-alt)' }}>
                  <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>{item.label}</span>
                  <span className="text-xs font-semibold" style={{ color: '#6ABDE0' }}>View →</span>
                </button>
              ))}
            </div>
          </div>

          {deals.length > 0 && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm" style={{ color: 'var(--c-primary)' }}>Recent Deals</h3>
                <button onClick={() => onTabChange('deals')} className="text-xs font-semibold hover:underline" style={{ color: '#C9A84C' }}>
                  All →
                </button>
              </div>
              <div className="space-y-2">
                {deals.slice(0, 3).map(deal => (
                  <a key={deal.id} href={`/deals/${deal.id}`}
                    className="block p-3 rounded-xl hover:opacity-80"
                    style={{ border: '1px solid var(--c-border)' }}>
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-primary)' }}>{deal.address}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>{deal.status}</span>
                      {deal.offer_price && <span className="text-xs font-bold" style={{ color: '#4CAF9A' }}>{fmtVal(deal.offer_price)}</span>}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Communications Tab ───────────────────────────────────────────────────────
function CommunicationsTab({ contact, initialMessages }: { contact: Contact; initialMessages: Msg[] }) {
  const defaultView = contact.phone ? 'sms' : 'email'
  const [view, setView] = useState<'sms' | 'email'>(defaultView)
  const hasPhone = !!contact.phone
  const hasEmail = !!contact.email

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 210px)', minHeight: 0 }}>
      {hasPhone && hasEmail && (
        <div className="flex gap-1 px-6 pt-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--c-border)' }}>
          {(['sms', 'email'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className="px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors"
              style={{
                borderBottomColor: view === v ? '#C9A84C' : 'transparent',
                color: view === v ? '#C9A84C' : 'var(--c-text-2)',
                backgroundColor: 'transparent',
                marginBottom: -1,
              }}>
              {v === 'sms' ? '💬 SMS' : '✉ Email'}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {(view === 'sms' || !hasEmail) && hasPhone && <MessagesTab contact={contact} initialMessages={initialMessages} />}
        {(view === 'email' || !hasPhone) && hasEmail && <EmailThreadsView contact={contact} />}
        {!hasPhone && !hasEmail && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No phone or email on file for this contact.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Email Body Iframe ─────────────────────────────────────────────────────────
function EmailBodyIframe({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const resize = useCallback(() => {
    const f = ref.current
    if (f?.contentDocument?.body) {
      const h = f.contentDocument.body.scrollHeight
      if (h > 0) f.style.height = (h + 24) + 'px'
    }
  }, [])
  const handleLoad = useCallback(() => {
    resize()
    setTimeout(resize, 300)
    setTimeout(resize, 1000)
    const f = ref.current
    if (f?.contentDocument?.body) {
      observerRef.current?.disconnect()
      const ro = new ResizeObserver(resize)
      ro.observe(f.contentDocument.body)
      observerRef.current = ro
    }
  }, [resize])
  useEffect(() => () => observerRef.current?.disconnect(), [])
  return (
    <iframe
      ref={ref}
      srcDoc={html}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      onLoad={handleLoad}
      style={{ width: '100%', minHeight: 80, border: 'none', display: 'block' }}
    />
  )
}

// ─── Email Threads View ────────────────────────────────────────────────────────
function EmailThreadsView({ contact }: { contact: Contact }) {
  const [threads, setThreads]         = useState<GmailThread[]>([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState('')
  const [activeId, setActiveId]       = useState<string | null>(null)
  const [msgs, setMsgs]               = useState<GmailMsg[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [replyBody, setReplyBody]     = useState('')
  const [sending, setSending]         = useState(false)
  const [sendErr, setSendErr]         = useState('')

  useEffect(() => {
    if (!contact.email) return
    const q = `from:${contact.email} OR to:${contact.email}`
    fetch(`/api/gmail/threads?q=${encodeURIComponent(q)}&maxResults=20`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setLoadError(d.error)
        else setThreads(d.threads ?? [])
      })
      .catch(() => setLoadError('Failed to load Gmail threads'))
      .finally(() => setLoading(false))
  }, [contact.email])

  const openThread = async (threadId: string) => {
    if (activeId === threadId) { setActiveId(null); setMsgs([]); return }
    setActiveId(threadId); setMsgs([]); setReplyBody(''); setSendErr('')
    setLoadingMsgs(true)
    try {
      const r = await fetch(`/api/gmail/threads/${threadId}`)
      const d = await r.json()
      setMsgs(d.messages ?? [])
    } catch { /* ignore */ }
    setLoadingMsgs(false)
  }

  const sendReply = async (thread: GmailThread) => {
    if (!replyBody.trim() || sending) return
    setSending(true); setSendErr('')
    const lastMsg = msgs[msgs.length - 1]
    try {
      const r = await fetch('/api/gmail/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id, messageId: lastMsg?.id,
          to: contact.email, subject: thread.subject, body: replyBody,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setSendErr(d.error ?? 'Send failed') }
      else {
        setReplyBody('')
        const r2 = await fetch(`/api/gmail/threads/${thread.id}`)
        const d2 = await r2.json()
        setMsgs(d2.messages ?? [])
      }
    } catch { setSendErr('Send failed') }
    setSending(false)
  }

  if (!contact.email) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm mb-3" style={{ color: 'var(--c-text-3)' }}>{loadError}</p>
        <a href="/inbox" className="text-xs font-semibold" style={{ color: '#C9A84C' }}>Check Gmail connection in Inbox →</a>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No email threads found with {contact.email}</p>
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Use the Email quick action above to compose your first email.</p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full px-4 md:px-6 py-4">
      <div className="max-w-3xl">
        {threads.map(thread => (
          <div key={thread.id} className="mb-2 rounded-xl overflow-hidden"
            style={{ border: `1px solid ${activeId === thread.id ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`, backgroundColor: 'var(--c-card)' }}>

            <button onClick={() => openThread(thread.id)}
              className="w-full flex items-start gap-3 p-4 text-left hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-primary)' }}>
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm truncate ${thread.unread ? 'font-bold' : 'font-medium'}`}
                    style={{ color: 'var(--c-primary)' }}>
                    {thread.subject || '(no subject)'}
                  </p>
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--c-text-3)' }}>
                    {new Date(thread.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--c-text-3)' }}>{thread.snippet}</p>
                <div className="flex items-center gap-2 mt-1">
                  {thread.unread && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}>UNREAD</span>
                  )}
                  {thread.messageCount > 1 && (
                    <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{thread.messageCount} messages</span>
                  )}
                </div>
              </div>
            </button>

            {activeId === thread.id && (
              <div style={{ borderTop: '1px solid var(--c-border)' }}>
                {loadingMsgs ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
                  </div>
                ) : (
                  <>
                    <div className="p-4 space-y-3">
                      {msgs.map(msg => (
                        <div key={msg.id} className="rounded-xl overflow-hidden"
                          style={{ border: '1px solid var(--c-border)' }}>
                          <div className="px-4 py-2.5 flex items-center justify-between"
                            style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)' }}>
                            <div>
                              <p className="text-xs font-semibold" style={{ color: 'var(--c-primary)' }}>{msg.from}</p>
                              {msg.to && <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>to {msg.to}</p>}
                            </div>
                            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                              {new Date(msg.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </div>
                          <div className="px-4 py-3 bg-white">
                            {msg.body ? <EmailBodyIframe html={msg.body} /> : (
                              <p className="text-sm italic" style={{ color: '#666' }}>(No body)</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 pb-4">
                      {sendErr && <p className="text-xs text-red-400 mb-2">{sendErr}</p>}
                      <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)}
                        placeholder={`Reply to ${contact.name}…`} rows={3}
                        className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none"
                        style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      />
                      <div className="flex gap-2 justify-end mt-2">
                        <button onClick={() => { setActiveId(null); setMsgs([]) }}
                          className="px-4 py-2 rounded-xl text-sm font-medium"
                          style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                          Close
                        </button>
                        <button onClick={() => sendReply(thread)} disabled={!replyBody.trim() || sending}
                          className="font-bold px-5 py-2 rounded-xl text-sm hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
                          {sending ? 'Sending…' : 'Reply'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────
function ActivityTab({ contactId, initialActivities }: { contactId: string; initialActivities: Activity[] }) {
  const supabase = createClient()
  const [activities, setActivities] = useState(initialActivities)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState({ type: 'call', notes: '' })
  const [saving, setSaving]         = useState(false)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const { data, error } = await supabase
      .from('activities')
      .insert([{ contact_id: contactId, type: form.type, notes: form.notes }])
      .select()
      .single()
    if (!error && data) { setActivities(prev => [data, ...prev]); setForm({ type: 'call', notes: '' }); setShowForm(false) }
    setSaving(false)
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--c-primary)' }}>Activity Log</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>All interactions with this contact</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90"
          style={showForm
            ? { border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }
            : { backgroundColor: '#0A1F44', color: '#C9A84C' }}>
          {showForm ? 'Cancel' : '+ Log Activity'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="rounded-2xl p-5 mb-5 space-y-3"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
            className={inputCls} style={inputStyle}>
            {ACTIVITY_TYPES.map(k => (
              <option key={k} value={k}>{k.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
            ))}
          </select>
          <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="What happened? Notes, outcome…" rows={3}
            className={`${inputCls} resize-none`} style={inputStyle} />
          <button type="submit" disabled={saving || !form.notes.trim()}
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
            className="font-bold px-5 py-2 rounded-xl text-sm disabled:opacity-60">
            {saving ? 'Saving…' : 'Log It'}
          </button>
        </form>
      )}

      {activities.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ border: '1px dashed var(--c-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No activity yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Log your first interaction above.</p>
        </div>
      ) : (
        <div className="space-y-0">
          {activities.map((a, i) => (
            <div key={a.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={{ backgroundColor: `${activityColors[a.type] ?? '#9CA3AF'}1a`, color: activityColors[a.type] ?? '#9CA3AF' }}>
                  {activityInitial(a.type)}
                </div>
                {i < activities.length - 1 && (
                  <div className="w-px flex-1 my-1" style={{ backgroundColor: 'var(--c-border)', minHeight: 20 }} />
                )}
              </div>
              <div className="pb-5 flex-1 min-w-0 pt-1.5">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold capitalize" style={{ color: 'var(--c-primary)' }}>
                    {a.type.replace('_', ' ')}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                    {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                {a.notes && (
                  <div className="px-4 py-3 rounded-xl mt-1"
                    style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>{a.notes}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Deals Tab ────────────────────────────────────────────────────────────────
const DEAL_STATUS_COLORS: Record<string, string> = {
  New: '#9ca3af', Researching: '#6ABDE0', Contacted: '#7B8FD4',
  Offer: '#C9A84C', Negotiating: '#f59e0b', Under_Contract: '#a78bfa',
  Closed: '#4CAF9A', Dead: '#ef4444', Cancelled: '#9ca3af',
}

function DealsTab({ contactId, initialDeals }: { contactId: string; initialDeals: Deal[] }) {
  const deals = initialDeals

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--c-primary)' }}>Deals</h2>
          {deals.length > 0 && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{deals.length} deal{deals.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <a href={`/deals/new?contact_id=${contactId}`}
          className="text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
          + New Deal
        </a>
      </div>

      {deals.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ border: '1px dashed var(--c-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No deals yet</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--c-text-3)' }}>Create a deal to start tracking offers and closings.</p>
          <a href={`/deals/new?contact_id=${contactId}`}
            className="text-sm font-bold px-6 py-2.5 rounded-xl hover:opacity-90 inline-block"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
            + Create First Deal
          </a>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--c-hover)', borderBottom: '1px solid var(--c-border)' }}>
                  {['Address', 'Status', 'Offer', 'ARV', 'Est. Profit', 'Close Date', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: 'var(--c-text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map((deal, i) => {
                  const profit = deal.arv && deal.offer_price ? deal.arv - deal.offer_price : null
                  const sc = DEAL_STATUS_COLORS[deal.status] ?? '#9ca3af'
                  return (
                    <tr key={deal.id}
                      style={{ borderBottom: i < deals.length - 1 ? '1px solid var(--c-border)' : undefined, backgroundColor: 'var(--c-card)' }}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-sm" style={{ color: 'var(--c-primary)' }}>{deal.address}</p>
                        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>{fmtDate(deal.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: `${sc}1a`, color: sc }}>
                          {deal.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold" style={{ color: '#C9A84C' }}>{fmtVal(deal.offer_price)}</td>
                      <td className="px-4 py-3 font-semibold" style={{ color: 'var(--c-text-2)' }}>{fmtVal(deal.arv)}</td>
                      <td className="px-4 py-3 font-bold"
                        style={{ color: profit != null ? (profit > 0 ? '#4CAF9A' : '#ef4444') : 'var(--c-text-3)' }}>
                        {profit != null ? fmtVal(profit) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-text-3)' }}>
                        {deal.closing_date ? fmtDate(deal.closing_date, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <a href={`/deals/${deal.id}`} className="text-xs font-semibold hover:underline" style={{ color: '#C9A84C' }}>Open →</a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Documents Tab ────────────────────────────────────────────────────────────
interface Doc {
  id: string; name: string; category: string; status: string
  offer_amount: number | null; recipient_name: string | null
  sent_at: string | null; expires_at: string | null
  pdf_path: string | null; created_at: string
}

function DocumentsTab({ contactId }: { contactId: string }) {
  const supabase = createClient()
  const [docs, setDocs]           = useState<Doc[]>([])
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/documents?contact_id=${contactId}`)
      .then(r => r.json())
      .then(d => setDocs(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [contactId])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const path = `contacts/${contactId}/${Date.now()}_${file.name}`
      const { error: storageErr } = await supabase.storage.from('documents').upload(path, file)
      if (storageErr) throw storageErr
      const { data: docData } = await supabase
        .from('documents')
        .insert([{ name: file.name, category: 'other', status: 'draft', pdf_path: path, contact_id: contactId }])
        .select()
        .single()
      if (docData) setDocs(prev => [docData, ...prev])
    } catch (err) {
      console.error('Upload failed:', err)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDownload = async (doc: Doc) => {
    if (!doc.pdf_path) return
    const r = await fetch(`/api/documents/${doc.id}/url`)
    const d = await r.json()
    if (d.url) window.open(d.url, '_blank')
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
    </div>
  )

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--c-primary)' }}>Documents</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>Contracts, offers, photos, and files</p>
        </div>
        <div className="flex gap-2">
          <a href={`/documents/new?contact_id=${contactId}`}
            className="text-xs font-bold px-3 py-2 rounded-xl hover:opacity-90"
            style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            From Template
          </a>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
            {uploading ? 'Uploading…' : '+ Upload File'}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleUpload} />
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ border: '1px dashed var(--c-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No documents yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Upload a file or create from a contract template.</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--c-hover)', borderBottom: '1px solid var(--c-border)' }}>
                  {['Name', 'Category', 'Status', 'Created', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: 'var(--c-text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map((doc, i) => {
                  const sc = DOC_STATUS_COLORS[doc.status] ?? '#9ca3af'
                  return (
                    <tr key={doc.id}
                      style={{ borderBottom: i < docs.length - 1 ? '1px solid var(--c-border)' : undefined, backgroundColor: 'var(--c-card)' }}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-sm truncate max-w-xs" style={{ color: 'var(--c-primary)' }}>{doc.name}</p>
                      </td>
                      <td className="px-4 py-3 text-xs capitalize" style={{ color: 'var(--c-text-2)' }}>{doc.category}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
                          style={{ backgroundColor: `${sc}1a`, color: sc }}>
                          {doc.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-text-3)' }}>
                        {fmtDate(doc.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          {doc.pdf_path && (
                            <button onClick={() => handleDownload(doc)}
                              className="text-xs font-semibold hover:underline" style={{ color: '#6ABDE0' }}>
                              Download
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────
function TasksTab({ contactId }: { contactId: string }) {
  const [tasks, setTasks]     = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', due_date: '', priority: 'normal', assigned_to: '' })
  const [saving, setSaving]   = useState(false)
  const [filter, setFilter]   = useState<'all' | 'pending' | 'completed'>('all')

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/tasks`)
      .then(r => r.json())
      .then(d => setTasks(d.tasks ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [contactId])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const r = await fetch(`/api/contacts/${contactId}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const d = await r.json()
    if (d.task) {
      setTasks(prev => [d.task, ...prev])
      setForm({ title: '', description: '', due_date: '', priority: 'normal', assigned_to: '' })
      setShowForm(false)
    }
    setSaving(false)
  }

  const updateTask = async (taskId: string, updates: Record<string, unknown>) => {
    const r = await fetch(`/api/contacts/${contactId}/tasks`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, ...updates }),
    })
    const d = await r.json()
    if (d.task) setTasks(prev => prev.map(t => t.id === taskId ? d.task : t))
  }

  const filteredTasks = tasks.filter(t => {
    if (filter === 'pending') return t.status === 'pending' || t.status === 'in_progress'
    if (filter === 'completed') return t.status === 'completed'
    return true
  })

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
    </div>
  )

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--c-primary)' }}>Tasks</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            {tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length} pending
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90"
          style={showForm
            ? { border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }
            : { backgroundColor: '#0A1F44', color: '#C9A84C' }}>
          {showForm ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      <div className="flex gap-1 mb-4">
        {(['all', 'pending', 'completed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg capitalize"
            style={filter === f
              ? { backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }
              : { backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-2)' }}>
            {f}
          </button>
        ))}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-2xl p-5 mb-5 space-y-3"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Task Title *</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Follow up on offer, Schedule walkthrough…"
              required className={inputCls} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Due Date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                className={inputCls} style={inputStyle}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Optional details…" rows={2}
              className={`${inputCls} resize-none`} style={inputStyle} />
          </div>
          <button type="submit" disabled={saving || !form.title.trim()}
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
            className="font-bold px-5 py-2 rounded-xl text-sm disabled:opacity-60">
            {saving ? 'Creating…' : 'Create Task'}
          </button>
        </form>
      )}

      {filteredTasks.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ border: '1px dashed var(--c-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>
            {filter === 'all' ? 'No tasks yet' : `No ${filter} tasks`}
          </p>
          {filter === 'all' && (
            <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Create a task to track follow-ups and to-dos.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map(task => {
            const isComplete = task.status === 'completed' || task.status === 'cancelled'
            const dueDate = task.due_date ? futureMeta(task.due_date) : null
            const pc = priorityColors[task.priority] ?? '#9ca3af'
            return (
              <div key={task.id} className="rounded-xl px-4 py-3 flex items-start gap-3"
                style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', opacity: isComplete ? 0.6 : 1 }}>
                <button onClick={() => updateTask(task.id, { status: isComplete ? 'pending' : 'completed' })}
                  className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center mt-0.5 hover:opacity-80"
                  style={{
                    backgroundColor: isComplete ? '#4CAF9A' : 'transparent',
                    border: isComplete ? '2px solid #4CAF9A' : '2px solid var(--c-border)',
                  }}>
                  {isComplete && (
                    <svg className="w-3 h-3" fill="none" stroke="white" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-semibold ${isComplete ? 'line-through' : ''}`}
                      style={{ color: 'var(--c-primary)' }}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded capitalize"
                        style={{ backgroundColor: `${pc}18`, color: pc }}>
                        {task.priority}
                      </span>
                      {!isComplete && (
                        <button onClick={() => updateTask(task.id, { status: 'cancelled' })}
                          className="text-xs hover:opacity-80" style={{ color: 'var(--c-text-3)' }}>✕</button>
                      )}
                    </div>
                  </div>
                  {task.description && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{task.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    {dueDate && !isComplete && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: dueDate.bg, color: dueDate.color }}>
                        {['Today','Tomorrow','Overdue'].includes(dueDate.label)
                          ? dueDate.label
                          : `Due ${fmtDate(task.due_date, { month: 'short', day: 'numeric' })}`}
                      </span>
                    )}
                    {isComplete && task.completed_at && (
                      <span className="text-xs" style={{ color: '#4CAF9A' }}>
                        Completed {timeAgo(task.completed_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Automations Tab ──────────────────────────────────────────────────────────
function AutomationsTab() {
  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="text-center py-20 rounded-2xl" style={{ border: '1px dashed var(--c-border)' }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: 'rgba(201,168,76,0.12)' }}>
          <span className="text-2xl">⚡</span>
        </div>
        <h3 className="text-base font-bold mb-2" style={{ color: 'var(--c-primary)' }}>Automations</h3>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--c-text-3)' }}>
          Automated follow-up sequences, drip campaigns, and trigger-based actions for this contact are not yet available.
        </p>
      </div>
    </div>
  )
}

// ─── Linked Properties Tab ────────────────────────────────────────────────────
const REL_COLORS: Record<string, string> = {
  Owner: '#C9A84C', 'Co-owner': '#C9A84C', Heir: '#a78bfa', Spouse: '#a78bfa',
  Attorney: '#7B8FD4', Agent: '#6ABDE0', Lender: '#B06AE0',
  Buyer: '#4CAF9A', Wholesaler: '#E07B6A', Other: '#9ca3af',
}

interface LinkedProperty {
  id: string; relationship_type: string; is_primary: boolean; notes: string | null; lead_id: string | null
  property: {
    id: string; property_address: string; city: string | null; zip: string | null; county: string | null
    beds: number | null; baths: number | null; living_area: number | null; year_built: number | null
    market_value: number | null; assessed_value: number | null; equity_tier: string | null
    equity_percentage: number | null; is_pre_foreclosure: boolean; is_probate: boolean
    is_auction: boolean; is_tax_deed: boolean; is_divorce: boolean
  } | null
}

function LinkedPropertiesTab({ contactId }: { contactId: string }) {
  const [links, setLinks]     = useState<LinkedProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/properties`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setLinks(d.properties ?? []) })
      .catch(() => setError('Failed to load properties'))
      .finally(() => setLoading(false))
  }, [contactId])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
    </div>
  )
  if (error) return (
    <div className="p-8 text-center"><p className="text-sm" style={{ color: '#ef4444' }}>{error}</p></div>
  )

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--c-primary)' }}>Linked Properties</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>Properties and leads associated with this contact</p>
        </div>
        {links.length > 0 && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
            {links.length} {links.length === 1 ? 'property' : 'properties'}
          </span>
        )}
      </div>

      {links.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ border: '1px dashed var(--c-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No properties linked</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Link this contact from any property or lead detail page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => {
            const p = link.property
            if (!p) return null
            const relColor = REL_COLORS[link.relationship_type] ?? '#9ca3af'
            const leadTypeTags: { label: string; color: string }[] = []
            if (p.is_pre_foreclosure) leadTypeTags.push({ label: 'Pre-FC',  color: '#f59e0b' })
            if (p.is_probate)         leadTypeTags.push({ label: 'Probate', color: '#a78bfa' })
            if (p.is_auction)         leadTypeTags.push({ label: 'Auction', color: '#ef4444' })
            if (p.is_tax_deed)        leadTypeTags.push({ label: 'Tax Deed',color: '#f97316' })
            if (p.is_divorce)         leadTypeTags.push({ label: 'Divorce', color: '#6ABDE0' })
            const equityColor = p.equity_tier === 'High' ? '#4CAF9A' : p.equity_tier === 'Medium' ? '#C9A84C' : '#7B8FD4'
            return (
              <div key={link.id} className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
                <div className="flex items-start justify-between px-4 py-3 gap-3"
                  style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--c-primary)' }}>{p.property_address || '—'}</p>
                      {link.is_primary && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' }}>
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{[p.city, p.zip].filter(Boolean).join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ backgroundColor: `${relColor}18`, color: relColor, border: `1px solid ${relColor}40` }}>
                      {link.relationship_type}
                    </span>
                    <a href={`/leads/${p.id}`}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg hover:opacity-80 whitespace-nowrap"
                      style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                      Open Lead →
                    </a>
                  </div>
                </div>
                <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Est. Value</p>
                    <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>{fmtVal(p.market_value)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Equity</p>
                    <p className="text-sm font-bold" style={{ color: p.equity_tier ? equityColor : 'var(--c-text-3)' }}>
                      {p.equity_tier ?? '—'}{p.equity_percentage != null && ` (${Number(p.equity_percentage).toFixed(0)}%)`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Property</p>
                    <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
                      {[p.beds && `${p.beds}bd`, p.baths && `${p.baths}ba`, p.living_area && `${Number(p.living_area).toLocaleString()}sf`].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Assessed</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>{fmtVal(p.assessed_value)}</p>
                  </div>
                  {leadTypeTags.length > 0 && (
                    <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-1 pt-1">
                      {leadTypeTags.map(t => (
                        <span key={t.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${t.color}20`, color: t.color }}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {link.notes && (
                    <div className="col-span-2 sm:col-span-4 pt-1">
                      <p className="text-[11px] italic" style={{ color: 'var(--c-text-3)' }}>{link.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Messages Tab (SMS) ───────────────────────────────────────────────────────
function MessagesTab({ contact, initialMessages }: { contact: Contact; initialMessages: Msg[] }) {
  const supabase = createClient()
  const [thread, setThread]       = useState<Msg[]>((initialMessages ?? []).filter(m => m != null))
  const [compose, setCompose]     = useState('')
  const [sending, setSending]     = useState(false)
  const [sendError, setSendError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread.length])

  useEffect(() => {
    const channel = supabase
      .channel(`msgs_contact_${contact.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
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
    setSending(true); setSendError('')
    const body = compose.trim()
    setCompose('')
    const tempId = `temp_${Date.now()}`
    const tempMsg: Msg = { id: tempId, direction: 'outbound', body, status: 'sending', created_at: new Date().toISOString() }
    setThread(prev => [...prev, tempMsg])
    const res  = await fetch('/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id, body }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSendError(data.error ?? 'Failed to send')
      setThread(prev => prev.filter(m => m.id !== tempId))
      setCompose(body)
    } else {
      if (data.message?.id) setThread(prev => prev.map(m => m.id === tempId ? data.message : m))
      else setThread(prev => prev.filter(m => m.id !== tempId))
      if (data.warning) setSendError(data.warning)
    }
    setSending(false)
  }

  const getSuggestedReply = async () => {
    if (aiLoading) return; setAiLoading(true)
    const res = await fetch('/api/sms/ai-reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id }),
    })
    const data = await res.json()
    if (data.suggestion) { setCompose(data.suggestion); textareaRef.current?.focus() }
    setAiLoading(false)
  }

  const safeThread = thread.filter((m): m is Msg => m != null)
  const hasInbound = safeThread.some(m => m.direction === 'inbound')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6" style={{ backgroundColor: 'var(--c-bg)' }}>
        {safeThread.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 min-h-32">
            <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No messages yet</p>
            <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
              {contact.phone ? 'Send your first message below' : 'Add a phone number to this contact first'}
            </p>
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
                  <div className="max-w-sm px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                    style={msg.direction === 'outbound'
                      ? { backgroundColor: '#0A1F44', color: '#fff', borderBottomRightRadius: 4 }
                      : { backgroundColor: 'var(--c-card)', color: 'var(--c-primary)', border: '1px solid var(--c-border)', borderBottomLeftRadius: 4 }}>
                    <p>{msg.body}</p>
                    <p className="text-xs mt-1 opacity-50">
                      {msg.status === 'sending' ? 'Sending…' : msg.status === 'failed' ? 'Not delivered' : timeAgo(msg.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-6 md:px-8 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
        {sendError && <p className="text-xs text-red-500 mb-2">{sendError}</p>}
        {hasInbound && (
          <div className="mb-2">
            <button onClick={getSuggestedReply} disabled={aiLoading}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
              {aiLoading ? 'Generating…' : 'AI Suggest Reply'}
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end max-w-2xl mx-auto">
          <textarea ref={textareaRef} value={compose}
            onChange={e => setCompose(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder={contact.phone ? `Message ${contact.name}… (Enter to send)` : 'No phone number on file'}
            disabled={!contact.phone} rows={2}
            className="flex-1 resize-none rounded-2xl px-4 py-3 text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)', color: 'var(--c-primary)', maxHeight: 120 }}
          />
          <button onClick={sendMessage} disabled={!compose.trim() || sending || !contact.phone}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── InfoRow helper ───────────────────────────────────────────────────────────
function InfoRow({ label, value, link }: { label: string; value?: string; link?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-xs w-28 pt-0.5 flex-shrink-0" style={{ color: 'var(--c-text-2)' }}>{label}</span>
      {link ? (
        <a href={link} className="text-sm font-medium hover:underline" style={{ color: 'var(--c-primary)' }}>{value}</a>
      ) : (
        <span className="text-sm font-medium" style={{ color: 'var(--c-primary)' }}>{value}</span>
      )}
    </div>
  )
}
