'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const STATUSES = ['Lead', 'Analyzing', 'Offer Sent', 'Under Contract', 'Closed', 'Dead']

interface Deal {
  id: string
  address: string
  status: string
  arv: number
  repair_cost: number
  closing_cost: number
  desired_profit: number
  offer_price: number
  notes: string
  source: string
  created_at: string
  contact_id: string
  contacts?: { id: string; name: string; phone: string; email: string }
}

interface Contact {
  id: string
  name: string
}

export default function DealDetailClient({
  deal: initialDeal,
  contacts,
}: {
  deal: Deal
  contacts: Contact[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [deal, setDeal] = useState(initialDeal)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    address: deal.address || '',
    contact_id: deal.contact_id || '',
    status: deal.status || 'Lead',
    arv: deal.arv?.toString() || '',
    repair_cost: deal.repair_cost?.toString() || '',
    closing_cost: deal.closing_cost?.toString() || '',
    desired_profit: deal.desired_profit?.toString() || '',
    offer_price: deal.offer_price?.toString() || '',
    notes: deal.notes || '',
    source: deal.source || '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  // Live analyzer from form values
  const arv = parseFloat(form.arv) || 0
  const repairs = parseFloat(form.repair_cost) || 0
  const closing = parseFloat(form.closing_cost) || 0
  const offerPrice = parseFloat(form.offer_price) || 0
  const mao = arv > 0 ? (arv * 0.70) - repairs - closing : 0
  const netProfit = arv > 0 && offerPrice > 0 ? arv - repairs - closing - offerPrice : null
  const roi = netProfit && offerPrice > 0 ? ((netProfit / offerPrice) * 100).toFixed(1) : null

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const { data, error } = await supabase
      .from('deals')
      .update({
        address: form.address,
        contact_id: form.contact_id || null,
        status: form.status,
        arv: parseFloat(form.arv) || null,
        repair_cost: parseFloat(form.repair_cost) || null,
        closing_cost: parseFloat(form.closing_cost) || null,
        desired_profit: parseFloat(form.desired_profit) || null,
        offer_price: parseFloat(form.offer_price) || null,
        notes: form.notes,
        source: form.source,
      })
      .eq('id', deal.id)
      .select(`*, contacts ( id, name, phone, email )`)
      .single()

    if (error) { setError(error.message); setSaving(false) }
    else { setDeal(data); setEditing(false); setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    setDeleting(true)
    await supabase.from('deals').delete().eq('id', deal.id)
    router.push('/deals')
  }

  const fmt = (n?: number) => n ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/deals" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <div className="flex-1">
          <h1 style={{ color: '#0A1F44' }} className="text-2xl font-bold leading-tight">
            {editing ? form.address || 'Deal' : deal.address}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {deal.source ? `${deal.source} · ` : ''}
            Added {new Date(deal.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
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
        {/* Left — deal info + analyzer */}
        <div className="col-span-2 space-y-5">
          {/* Deal info */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-4">Deal Info</h2>
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Property Address</label>
                  <input name="address" value={form.address} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Contact (Seller)</label>
                  <select name="contact_id" value={form.contact_id} onChange={handleChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 bg-white">
                    <option value="">— No contact —</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
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
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <span className="text-xs text-gray-400 w-32 pt-0.5">Status</span>
                  <span style={{ color: '#0A1F44' }} className="text-sm font-semibold">{deal.status}</span>
                </div>
                {deal.contacts && (
                  <div className="flex gap-2">
                    <span className="text-xs text-gray-400 w-32 pt-0.5">Contact</span>
                    <a href={`/contacts/${deal.contacts.id}`} style={{ color: '#0A1F44' }}
                      className="text-sm font-medium hover:underline">
                      {deal.contacts.name}
                    </a>
                  </div>
                )}
                {deal.source && (
                  <div className="flex gap-2">
                    <span className="text-xs text-gray-400 w-32 pt-0.5">Source</span>
                    <span style={{ color: '#0A1F44' }} className="text-sm">{deal.source}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Deal analyzer */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-4">Deal Analyzer</h2>

            {editing ? (
              <div className="grid grid-cols-2 gap-4 mb-4">
                {[
                  { name: 'arv', label: 'ARV' },
                  { name: 'repair_cost', label: 'Repair Cost' },
                  { name: 'closing_cost', label: 'Closing / Holding' },
                  { name: 'desired_profit', label: 'Desired Profit' },
                  { name: 'offer_price', label: 'Offer Price' },
                ].map(field => (
                  <div key={field.name}>
                    <label className="block text-xs font-semibold text-gray-400 mb-1">{field.label}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        name={field.name}
                        value={(form as Record<string, string>)[field.name]}
                        onChange={handleChange}
                        type="number" min="0"
                        className="w-full border border-gray-200 rounded-xl pl-6 pr-3 py-2.5 text-sm focus:outline-none text-gray-800"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'ARV', value: deal.arv },
                  { label: 'Repair Cost', value: deal.repair_cost },
                  { label: 'Closing / Holding', value: deal.closing_cost },
                  { label: 'Desired Profit', value: deal.desired_profit },
                  { label: 'Offer Price', value: deal.offer_price },
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-xs text-gray-400">{item.label}</span>
                    <span style={{ color: '#0A1F44' }} className="text-sm font-semibold">{fmt(item.value)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Analysis output */}
            {(editing ? arv : deal.arv) > 0 && (
              <div style={{ backgroundColor: '#0A1F44' }} className="rounded-xl p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-white/50 text-xs mb-1">MAO (70% Rule)</p>
                    <p style={{ color: '#C9A84C' }} className="text-lg font-bold">{fmt(mao > 0 ? mao : (deal.arv * 0.70) - (deal.repair_cost || 0) - (deal.closing_cost || 0))}</p>
                  </div>
                  <div>
                    <p className="text-white/50 text-xs mb-1">Net Profit</p>
                    <p className="text-lg font-bold" style={{
                      color: (netProfit ?? (deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - (deal.offer_price || 0))) > 0 ? '#4CAF9A' : '#E07B6A'
                    }}>
                      {fmt(netProfit ?? (deal.offer_price ? deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - deal.offer_price : undefined))}
                    </p>
                  </div>
                  <div>
                    <p className="text-white/50 text-xs mb-1">ROI</p>
                    <p style={{ color: '#C9A84C' }} className="text-lg font-bold">
                      {roi ?? (deal.offer_price && deal.arv
                        ? (((deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - deal.offer_price) / deal.offer_price) * 100).toFixed(1) + '%'
                        : '—')}
                      {roi ? '%' : ''}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          {(editing || deal.notes) && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-3">Notes</h2>
              {editing ? (
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={4}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none text-gray-800 resize-none" />
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{deal.notes}</p>
              )}
            </div>
          )}
        </div>

        {/* Right — contact sidebar */}
        <div className="space-y-5">
          {deal.contacts && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-3">Seller</h2>
              <a href={`/contacts/${deal.contacts.id}`}
                style={{ color: '#0A1F44' }} className="font-semibold text-sm hover:underline block mb-3">
                {deal.contacts.name}
              </a>
              <div className="space-y-2">
                {deal.contacts.phone && (
                  <a href={`tel:${deal.contacts.phone}`}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <span className="text-sm">📞</span>
                    <span className="text-sm text-gray-700">{deal.contacts.phone}</span>
                  </a>
                )}
                {deal.contacts.email && (
                  <a href={`mailto:${deal.contacts.email}`}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <span className="text-sm">✉️</span>
                    <span className="text-sm text-gray-700 truncate">{deal.contacts.email}</span>
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-3">Property</h2>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(deal.address)}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm">📍</span>
              <span className="text-xs text-gray-700 leading-tight">{deal.address}</span>
            </a>
            <a
              href={`https://www.zillow.com/homes/${encodeURIComponent(deal.address)}_rb/`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors mt-2"
            >
              <span className="text-sm">🏠</span>
              <span className="text-sm text-gray-700">View on Zillow</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
