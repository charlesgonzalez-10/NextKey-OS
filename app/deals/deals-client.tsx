'use client'

import { useState } from 'react'

const STATUSES = ['All', 'Lead', 'Analyzing', 'Offer Sent', 'Under Contract', 'Closed', 'Dead']

const statusColors: Record<string, string> = {
  Lead: '#7B8FD4',
  Analyzing: '#C9A84C',
  'Offer Sent': '#6ABDE0',
  'Under Contract': '#4CAF9A',
  Closed: '#4CAF9A',
  Dead: '#ccc',
}

interface Deal {
  id: string
  address: string
  status: string
  arv: number
  repair_cost: number
  offer_price: number
  created_at: string
  contacts?: { name: string; phone: string }
}

export default function DealsClient({ deals }: { deals: Deal[] }) {
  const [search, setSearch] = useState('')
  const [activeStatus, setActiveStatus] = useState('All')

  const filtered = deals.filter((d) => {
    const matchesSearch =
      d.address?.toLowerCase().includes(search.toLowerCase()) ||
      d.contacts?.name?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = activeStatus === 'All' || d.status === activeStatus
    return matchesSearch && matchesStatus
  })

  const totalPipeline = filtered
    .filter(d => !['Closed', 'Dead'].includes(d.status))
    .reduce((sum, d) => sum + (d.offer_price || 0), 0)

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 style={{ color: '#0A1F44' }} className="text-2xl md:text-3xl font-bold">Deals</h1>
          <p className="text-gray-400 mt-1 text-xs md:text-sm">{deals.length} total · ${totalPipeline.toLocaleString()} active pipeline</p>
        </div>
        <a
          href="/deals/new"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          className="flex items-center gap-2 font-bold px-4 py-2 md:px-5 md:py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">New Deal</span>
        </a>
      </div>

      {/* Search + filter */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6">
        <input
          type="text"
          placeholder="Search by address or contact name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-sm text-gray-800 placeholder-gray-300 focus:outline-none mb-4"
        />
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setActiveStatus(s)}
              style={activeStatus === s ? { backgroundColor: '#0A1F44', color: '#C9A84C' } : {}}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                activeStatus === s ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Deals grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No deals found.</p>
          <a href="/deals/new" style={{ color: '#C9A84C' }} className="text-sm font-semibold mt-2 inline-block hover:underline">
            Analyze your first deal →
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((deal) => {
            const profit = deal.arv && deal.repair_cost && deal.offer_price
              ? deal.arv - deal.repair_cost - deal.offer_price
              : null
            const roi = profit && deal.offer_price ? ((profit / deal.offer_price) * 100).toFixed(1) : null

            return (
              <a
                key={deal.id}
                href={`/deals/${deal.id}`}
                className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow block"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 pr-2">
                    <p style={{ color: '#0A1F44' }} className="font-bold text-sm leading-tight">{deal.address}</p>
                    {deal.contacts?.name && (
                      <p className="text-gray-400 text-xs mt-0.5">{deal.contacts.name}</p>
                    )}
                  </div>
                  <span
                    style={{ backgroundColor: `${statusColors[deal.status] || '#888'}20`, color: statusColors[deal.status] || '#888' }}
                    className="px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
                  >
                    {deal.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-xs text-gray-400">ARV</p>
                    <p style={{ color: '#0A1F44' }} className="text-sm font-bold">
                      {deal.arv ? `$${(deal.arv / 1000).toFixed(0)}k` : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-xs text-gray-400">Offer</p>
                    <p style={{ color: '#0A1F44' }} className="text-sm font-bold">
                      {deal.offer_price ? `$${(deal.offer_price / 1000).toFixed(0)}k` : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl p-2" style={{ backgroundColor: profit && profit > 0 ? '#4CAF9A20' : '#f5f5f5' }}>
                    <p className="text-xs text-gray-400">Profit</p>
                    <p className="text-sm font-bold" style={{ color: profit && profit > 0 ? '#4CAF9A' : '#ccc' }}>
                      {profit ? `$${(profit / 1000).toFixed(0)}k` : '—'}
                    </p>
                  </div>
                </div>

                {roi && (
                  <div className="mt-2 text-right">
                    <span className="text-xs text-gray-400">ROI: </span>
                    <span style={{ color: '#C9A84C' }} className="text-xs font-bold">{roi}%</span>
                  </div>
                )}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
