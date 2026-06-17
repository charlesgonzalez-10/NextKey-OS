'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const CATEGORIES = ['Seller', 'Buyer', 'Investor', 'Wholesaler', 'Agent', 'Lender', 'Student', 'Other']

const iCls = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300 bg-white'
const lCls = 'block text-sm font-semibold mb-1.5'

export default function NewContactClient() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])
  const [verticals, setVerticals] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '',
    category: 'Seller', tags: '', notes: '', lead_source: '',
    lead_type_id: '', vertical_id: '',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/lead-types').then(r => r.ok ? r.json() : []),
      fetch('/api/business-verticals').then(r => r.ok ? r.json() : []),
    ]).then(([types, verts]) => {
      setLeadTypes((types as { id: string; name: string; is_active: boolean }[]).filter(t => t.is_active))
      setVerticals((verts as { id: string; name: string; is_active: boolean }[]).filter(v => v.is_active))
    })
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.from('contacts').insert([{
      name: form.name,
      phone: form.phone,
      email: form.email,
      address: form.address,
      category: form.category,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      notes: form.notes,
      lead_source: form.lead_source || null,
      source: form.lead_source || 'Manual',
      lead_type_id: form.lead_type_id || null,
      vertical_id: form.vertical_id || null,
      status: 'Active',
    }]).select().single()

    if (error) { setError(error.message); setLoading(false) }
    else router.push(`/contacts/${data.id}`)
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <a href="/contacts" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <h1 style={{ color: '#0A1F44' }} className="text-2xl font-bold">Add Contact</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-8 space-y-5">
        <div className="grid grid-cols-2 gap-5">
          <div className="col-span-2">
            <label style={{ color: '#0A1F44' }} className={lCls}>Full Name *</label>
            <input name="name" value={form.name} onChange={handleChange} required placeholder="John Smith" className={iCls} />
          </div>
          <div>
            <label style={{ color: '#0A1F44' }} className={lCls}>Phone</label>
            <input name="phone" value={form.phone} onChange={handleChange} placeholder="(954) 000-0000" type="tel" className={iCls} />
          </div>
          <div>
            <label style={{ color: '#0A1F44' }} className={lCls}>Email</label>
            <input name="email" value={form.email} onChange={handleChange} placeholder="john@email.com" type="email" className={iCls} />
          </div>
          <div className="col-span-2">
            <label style={{ color: '#0A1F44' }} className={lCls}>Property Address</label>
            <input name="address" value={form.address} onChange={handleChange} placeholder="123 Main St, Hollywood, FL 33020" className={iCls} />
          </div>
          <div>
            <label style={{ color: '#0A1F44' }} className={lCls}>Category *</label>
            <select name="category" value={form.category} onChange={handleChange} className={iCls}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: '#0A1F44' }} className={lCls}>Lead Source</label>
            <input name="lead_source" value={form.lead_source} onChange={handleChange} placeholder="Spesio, Cold call, Referral…" className={iCls} />
          </div>
          {leadTypes.length > 0 && (
            <div>
              <label style={{ color: '#0A1F44' }} className={lCls}>Lead Type</label>
              <select name="lead_type_id" value={form.lead_type_id} onChange={handleChange} className={iCls}>
                <option value="">— None —</option>
                {leadTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {verticals.length > 0 && (
            <div>
              <label style={{ color: '#0A1F44' }} className={lCls}>Vertical</label>
              <select name="vertical_id" value={form.vertical_id} onChange={handleChange} className={iCls}>
                <option value="">— None —</option>
                {verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          )}
          <div className="col-span-2">
            <label style={{ color: '#0A1F44' }} className={lCls}>Tags <span className="text-gray-400 font-normal">(comma separated)</span></label>
            <input name="tags" value={form.tags} onChange={handleChange} placeholder="motivated, foreclosure, probate" className={iCls} />
          </div>
          <div className="col-span-2">
            <label style={{ color: '#0A1F44' }} className={lCls}>Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={4}
              placeholder="First contact details, situation summary…"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300 resize-none" />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading}
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
            className="font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60">
            {loading ? 'Saving…' : 'Save Contact'}
          </button>
          <a href="/contacts" className="px-8 py-3 rounded-xl border border-gray-200 text-gray-500 font-medium hover:bg-gray-50 transition-colors text-sm flex items-center">
            Cancel
          </a>
        </div>
      </form>
    </div>
  )
}
