'use client'

import { useState } from 'react'
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

export default function ContactDetailClient({
  contact: initialContact,
  activities: initialActivities,
  deals,
}: {
  contact: Contact
  activities: Activity[]
  deals: Deal[]
}) {
  const router = useRouter()
  const supabase = createClient()

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
  })

  // Activity log form
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [activityForm, setActivityForm] = useState({ type: 'call', notes: '' })
  const [activitySaving, setActivitySaving] = useState(false)

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
      })
      .eq('id', contact.id)
      .select()
      .single()

    if (error) { setError(error.message); setSaving(false) }
    else {
      setContact(data)
      setEditing(false)
      setSaving(false)
    }
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
      .insert([{
        contact_id: contact.id,
        type: activityForm.type,
        notes: activityForm.notes,
      }])
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

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/contacts" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 style={{ color: '#0A1F44' }} className="text-2xl font-bold">{contact.name}</h1>
            <span
              style={{ backgroundColor: `${catColor}20`, color: catColor }}
              className="px-2.5 py-1 rounded-full text-xs font-semibold"
            >
              {contact.category}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
              {contact.status}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            Added {new Date(contact.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            {contact.source ? ` · ${contact.source}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
                className="font-bold px-5 py-2 rounded-xl hover:opacity-90 transition-opacity text-sm"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-2 rounded-xl border border-red-200 text-red-400 font-medium hover:bg-red-50 transition-colors text-sm"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
                className="font-bold px-5 py-2 rounded-xl hover:opacity-90 transition-opacity text-sm disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setError('') }}
                className="px-5 py-2 rounded-xl border border-gray-200 text-gray-500 font-medium hover:bg-gray-50 transition-colors text-sm"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-3 gap-6">
        {/* Left column — contact info */}
        <div className="col-span-2 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-4">Contact Info</h2>
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Full Name</label>
                  <input name="name" value={form.name} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Phone</label>
                  <input name="phone" value={form.phone} onChange={handleChange} type="tel"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Email</label>
                  <input name="email" value={form.email} onChange={handleChange} type="email"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Property Address</label>
                  <input name="address" value={form.address} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Category</label>
                  <select name="category" value={form.category} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 bg-white">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Status</label>
                  <select name="status" value={form.status} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 bg-white">
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Source</label>
                  <input name="source" value={form.source} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Tags (comma separated)</label>
                  <input name="tags" value={form.tags} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Notes</label>
                  <textarea name="notes" value={form.notes} onChange={handleChange} rows={4}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 resize-none" />
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
                    <span className="text-xs text-gray-400 w-32 pt-1">Tags</span>
                    <div className="flex flex-wrap gap-1.5">
                      {contact.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {contact.notes && (
                  <div className="pt-2 border-t border-gray-50">
                    <p className="text-xs text-gray-400 mb-1">Notes</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Activity log */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base">Activity Log</h2>
              <button
                onClick={() => setShowActivityForm(!showActivityForm)}
                style={showActivityForm ? {} : { backgroundColor: '#0A1F44', color: '#C9A84C' }}
                className={`text-xs font-bold px-4 py-1.5 rounded-lg transition-opacity hover:opacity-90 ${showActivityForm ? 'border border-gray-200 text-gray-500' : ''}`}
              >
                {showActivityForm ? 'Cancel' : '+ Log Activity'}
              </button>
            </div>

            {showActivityForm && (
              <form onSubmit={handleAddActivity} className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <select
                      value={activityForm.type}
                      onChange={e => setActivityForm(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 bg-white"
                    >
                      {Object.entries(activityIcons).map(([key, icon]) => (
                        <option key={key} value={key}>{icon} {key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <textarea
                  value={activityForm.notes}
                  onChange={e => setActivityForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="What happened? Add details..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 resize-none"
                />
                <button
                  type="submit"
                  disabled={activitySaving || !activityForm.notes.trim()}
                  style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
                  className="font-bold px-5 py-2 rounded-xl text-sm hover:opacity-90 disabled:opacity-60"
                >
                  {activitySaving ? 'Saving...' : 'Log It'}
                </button>
              </form>
            )}

            {activities.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-6">No activity yet. Log your first interaction above.</p>
            ) : (
              <div className="space-y-3">
                {activities.map((a) => (
                  <div key={a.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm flex-shrink-0">
                      {activityIcons[a.type] || '📌'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span style={{ color: '#0A1F44' }} className="text-xs font-semibold capitalize">
                          {a.type.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      {a.notes && <p className="text-sm text-gray-600">{a.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — deals */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base">Deals</h2>
              <a
                href={`/deals/new?contact_id=${contact.id}`}
                style={{ color: '#C9A84C' }}
                className="text-xs font-bold hover:underline"
              >
                + New Deal
              </a>
            </div>
            {deals.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No deals yet.</p>
            ) : (
              <div className="space-y-3">
                {deals.map((deal) => (
                  <a
                    key={deal.id}
                    href={`/deals/${deal.id}`}
                    className="block p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                  >
                    <p style={{ color: '#0A1F44' }} className="text-xs font-semibold truncate">{deal.address}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-400">{deal.status}</span>
                      {deal.offer_price && (
                        <span style={{ color: '#4CAF9A' }} className="text-xs font-bold">
                          ${deal.offer_price.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Quick contact actions */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-3">Quick Actions</h2>
            <div className="space-y-2">
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-sm">📞</span>
                  <span className="text-sm text-gray-700 font-medium">Call {contact.phone}</span>
                </a>
              )}
              {contact.phone && (
                <a
                  href={`sms:${contact.phone}`}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-sm">💬</span>
                  <span className="text-sm text-gray-700 font-medium">Text</span>
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-sm">✉️</span>
                  <span className="text-sm text-gray-700 font-medium">Email</span>
                </a>
              )}
              {contact.address && (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(contact.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-sm">📍</span>
                  <span className="text-sm text-gray-700 font-medium">Maps</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, link }: { label: string; value?: string; link?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-xs text-gray-400 w-32 pt-0.5 flex-shrink-0">{label}</span>
      {link ? (
        <a href={link} style={{ color: '#0A1F44' }} className="text-sm font-medium hover:underline">{value}</a>
      ) : (
        <span style={{ color: '#0A1F44' }} className="text-sm font-medium">{value}</span>
      )}
    </div>
  )
}
