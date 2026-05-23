'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Contact {
  id: string
  name: string
  phone: string
  address: string
}

export default function NewDealClient({
  contacts,
  defaultContactId,
}: {
  contacts: Contact[]
  defaultContactId?: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    address: '',
    contact_id: defaultContactId || '',
    status: 'Lead',
    arv: '',
    repair_cost: '',
    closing_cost: '',
    desired_profit: '',
    offer_price: '',
    notes: '',
    source: '',
  })

  // Auto-fill address from selected contact
  useEffect(() => {
    if (form.contact_id) {
      const c = contacts.find(c => c.id === form.contact_id)
      if (c?.address) setForm(prev => ({ ...prev, address: c.address }))
    }
  }, [form.contact_id, contacts])

  // Auto-calculate offer price (MAO formula)
  // MAO = (ARV × 0.70) - Repairs - Closing Costs
  const arv = parseFloat(form.arv) || 0
  const repairs = parseFloat(form.repair_cost) || 0
  const closing = parseFloat(form.closing_cost) || 0
  const desiredProfit = parseFloat(form.desired_profit) || 0
  const mao = arv > 0 ? (arv * 0.70) - repairs - closing : 0
  const netProfit = arv > 0 && parseFloat(form.offer_price) > 0
    ? arv - repairs - closing - parseFloat(form.offer_price)
    : null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.from('deals').insert([{
      address: form.address,
      contact_id: form.contact_id || null,
      status: form.status,
      arv: arv || null,
      repair_cost: repairs || null,
      closing_cost: closing || null,
      desired_profit: desiredProfit || null,
      offer_price: parseFloat(form.offer_price) || null,
      notes: form.notes,
      source: form.source || 'Manual',
    }]).select().single()

    if (error) { setError(error.message); setLoading(false) }
    else router.push(`/deals/${data.id}`)
  }

  const formatCurrency = (n: number) =>
    n > 0 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-8">
        <a href="/deals" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <h1 style={{ color: '#0A1F44' }} className="text-2xl font-bold">New Deal</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Deal basics */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 style={{ color: '#0A1F44' }} className="font-bold">Deal Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Property Address *</label>
              <input name="address" value={form.address} onChange={handleChange} required
                placeholder="123 Main St, Hollywood, FL 33020"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
            </div>
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Contact (Seller)</label>
              <select name="contact_id" value={form.contact_id} onChange={handleChange}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 bg-white">
                <option value="">— No contact —</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Status</label>
              <select name="status" value={form.status} onChange={handleChange}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 bg-white">
                {['Lead', 'Analyzing', 'Offer Sent', 'Under Contract', 'Closed', 'Dead'].map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Source</label>
              <input name="source" value={form.source} onChange={handleChange}
                placeholder="Spesio, Cold call, Referral..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
            </div>
          </div>
        </div>

        {/* Deal analyzer */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 style={{ color: '#0A1F44' }} className="font-bold">Deal Analyzer</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">ARV (After Repair Value)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input name="arv" value={form.arv} onChange={handleChange} type="number" min="0"
                  placeholder="250000"
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
              </div>
            </div>
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Repair Cost (Estimate)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input name="repair_cost" value={form.repair_cost} onChange={handleChange} type="number" min="0"
                  placeholder="30000"
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
              </div>
            </div>
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Closing / Holding Costs</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input name="closing_cost" value={form.closing_cost} onChange={handleChange} type="number" min="0"
                  placeholder="10000"
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
              </div>
            </div>
            <div>
              <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Your Desired Profit</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input name="desired_profit" value={form.desired_profit} onChange={handleChange} type="number" min="0"
                  placeholder="20000"
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
              </div>
            </div>
          </div>

          {/* MAO calculator output */}
          {arv > 0 && (
            <div style={{ backgroundColor: '#0A1F44' }} className="rounded-xl p-4 mt-2">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-white/50 text-xs mb-1">MAO (70% Rule)</p>
                  <p style={{ color: '#C9A84C' }} className="text-xl font-bold">{formatCurrency(mao)}</p>
                  <p className="text-white/30 text-xs">(ARV × 70%) − Repairs − Closing</p>
                </div>
                <div>
                  <p className="text-white/50 text-xs mb-1">Target Offer</p>
                  <p className="text-white text-xl font-bold">
                    {desiredProfit > 0 ? formatCurrency(arv - repairs - closing - desiredProfit) : '—'}
                  </p>
                  <p className="text-white/30 text-xs">ARV − Repairs − Closing − Profit</p>
                </div>
                <div>
                  <p className="text-white/50 text-xs mb-1">Est. Net Profit</p>
                  <p style={{ color: netProfit && netProfit > 0 ? '#4CAF9A' : '#E07B6A' }} className="text-xl font-bold">
                    {netProfit !== null ? formatCurrency(netProfit) : '—'}
                  </p>
                  <p className="text-white/30 text-xs">at your offer price</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <label style={{ color: '#0A1F44' }} className="block text-sm font-semibold mb-1.5">Your Offer Price</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input name="offer_price" value={form.offer_price} onChange={handleChange} type="number" min="0"
                placeholder="Enter your actual offer..."
                className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300" />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <label style={{ color: '#0A1F44' }} className="block text-sm font-bold mb-2">Notes</label>
          <textarea name="notes" value={form.notes} onChange={handleChange} rows={4}
            placeholder="Deal details, property condition, seller situation..."
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none text-gray-800 placeholder-gray-300 resize-none" />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading}
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
            className="font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60">
            {loading ? 'Saving...' : 'Save Deal'}
          </button>
          <a href="/deals" className="px-8 py-3 rounded-xl border border-gray-200 text-gray-500 font-medium hover:bg-gray-50 transition-colors text-sm flex items-center">
            Cancel
          </a>
        </div>
      </form>
    </div>
  )
}
