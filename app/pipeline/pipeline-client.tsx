'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const STAGES = ['Lead', 'Analyzing', 'Offer Sent', 'Under Contract']

const stageColors: Record<string, { bg: string; text: string; border: string }> = {
  Lead: { bg: '#EEF0FB', text: '#7B8FD4', border: '#C5CCEF' },
  Analyzing: { bg: '#FEF8EC', text: '#C9A84C', border: '#ECD99A' },
  'Offer Sent': { bg: '#EBF6FB', text: '#6ABDE0', border: '#A5D8EF' },
  'Under Contract': { bg: '#EDF7F4', text: '#4CAF9A', border: '#9FD8CC' },
}

interface Deal {
  id: string
  address: string
  status: string
  arv: number
  offer_price: number
  repair_cost: number
  closing_cost: number
  created_at: string
  contacts?: { name: string } | { name: string }[] | null
}

export default function PipelineClient({ deals: initialDeals }: { deals: Deal[] }) {
  const supabase = createClient()
  const [deals, setDeals] = useState(initialDeals)
  const [dragging, setDragging] = useState<string | null>(null)

  const byStage = (stage: string) => deals.filter(d => d.status === stage)

  const handleDragStart = (id: string) => setDragging(id)
  const handleDragEnd = () => setDragging(null)

  const handleDrop = async (stage: string) => {
    if (!dragging) return
    const prev = deals.find(d => d.id === dragging)?.status
    if (prev === stage) return

    setDeals(d => d.map(deal => deal.id === dragging ? { ...deal, status: stage } : deal))
    await supabase.from('deals').update({ status: stage }).eq('id', dragging)
    setDragging(null)
  }

  const totalValue = (stage: string) =>
    byStage(stage).reduce((sum, d) => sum + (d.offer_price || 0), 0)

  const fmt = (n: number) => n > 0 ? `$${(n / 1000).toFixed(0)}k` : '—'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ color: '#0A1F44' }} className="text-3xl font-bold">Pipeline</h1>
          <p className="text-gray-400 mt-1">{deals.length} active deals · Drag to move stages</p>
        </div>
        <a
          href="/deals/new"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          className="flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Deal
        </a>
      </div>

      <div className="grid grid-cols-4 gap-4 items-start">
        {STAGES.map(stage => {
          const colors = stageColors[stage]
          const stageDeals = byStage(stage)

          return (
            <div
              key={stage}
              className="rounded-2xl min-h-48"
              style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(stage)}
            >
              {/* Column header */}
              <div className="p-3 border-b" style={{ borderColor: colors.border }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: colors.text }}>{stage}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${colors.text}20`, color: colors.text }}>
                    {stageDeals.length}
                  </span>
                </div>
                {totalValue(stage) > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: colors.text }}>
                    {fmt(totalValue(stage))} pipeline
                  </p>
                )}
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2">
                {stageDeals.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: `${colors.text}80` }}>
                    Drop deals here
                  </p>
                )}
                {stageDeals.map(deal => {
                  const profit = deal.arv && deal.offer_price
                    ? deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - deal.offer_price
                    : null

                  return (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => handleDragStart(deal.id)}
                      onDragEnd={handleDragEnd}
                      className="bg-white rounded-xl p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                      style={{ opacity: dragging === deal.id ? 0.5 : 1 }}
                    >
                      <a href={`/deals/${deal.id}`} className="block" onClick={e => e.stopPropagation()}>
                        <p style={{ color: '#0A1F44' }} className="text-xs font-bold leading-tight mb-1 line-clamp-2">
                          {deal.address}
                        </p>
                        {deal.contacts && (
                          <p className="text-xs text-gray-400 mb-2">
                            {Array.isArray(deal.contacts) ? deal.contacts[0]?.name : deal.contacts.name}
                          </p>
                        )}
                        <div className="flex items-center justify-between">
                          {deal.offer_price ? (
                            <span style={{ color: '#0A1F44' }} className="text-xs font-semibold">
                              {fmt(deal.offer_price)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">No offer</span>
                          )}
                          {profit !== null && (
                            <span className="text-xs font-semibold" style={{ color: profit > 0 ? '#4CAF9A' : '#E07B6A' }}>
                              {fmt(profit)}
                            </span>
                          )}
                        </div>
                      </a>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Closed / Dead summary */}
      <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-5">
        <h2 style={{ color: '#0A1F44' }} className="font-bold text-sm mb-3">Recently Closed / Dead</h2>
        <div className="flex gap-3">
          <a href="/deals?status=Closed"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-50 text-green-600 text-sm font-semibold hover:bg-green-100 transition-colors">
            ✅ View Closed Deals
          </a>
          <a href="/deals?status=Dead"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold hover:bg-gray-200 transition-colors">
            ✗ View Dead Deals
          </a>
        </div>
      </div>
    </div>
  )
}
