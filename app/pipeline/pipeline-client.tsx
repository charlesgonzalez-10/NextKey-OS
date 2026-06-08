'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const STAGES = ['Lead', 'Analyzing', 'Offer Sent', 'Under Contract']

const stageColors: Record<string, { accent: string; bg: string; border: string }> = {
  Lead:             { accent: '#7B8FD4', bg: 'rgba(123,143,212,0.08)',  border: 'rgba(123,143,212,0.2)'  },
  Analyzing:        { accent: '#C9A84C', bg: 'rgba(201,168,76,0.08)',   border: 'rgba(201,168,76,0.2)'   },
  'Offer Sent':     { accent: '#6ABDE0', bg: 'rgba(106,189,224,0.08)',  border: 'rgba(106,189,224,0.2)'  },
  'Under Contract': { accent: '#4CAF9A', bg: 'rgba(76,175,154,0.08)',   border: 'rgba(76,175,154,0.2)'   },
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

function fmt(n: number) { return n > 0 ? `$${(n / 1000).toFixed(0)}k` : '—' }
function fmtFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function PipelineClient({ deals: initialDeals }: { deals: Deal[] }) {
  const supabase = createClient()
  const [deals, setDeals] = useState(initialDeals)
  const [dragging, setDragging] = useState<string | null>(null)

  const byStage = (stage: string) => deals.filter(d => d.status === stage)

  const handleDragStart = (id: string) => setDragging(id)
  const handleDragEnd   = () => setDragging(null)

  const handleDrop = async (stage: string) => {
    if (!dragging) return
    const prev = deals.find(d => d.id === dragging)?.status
    if (prev === stage) return
    setDeals(d => d.map(deal => deal.id === dragging ? { ...deal, status: stage } : deal))
    await supabase.from('deals').update({ status: stage }).eq('id', dragging)
    setDragging(null)
  }

  // ── Revenue stats ─────────────────────────────────────────────────────────
  const pipelineValue     = deals.reduce((s, d) => s + (d.offer_price || 0), 0)
  const underContract     = byStage('Under Contract')
  const underContractVal  = underContract.reduce((s, d) => s + (d.offer_price || 0), 0)
  const projectedProfit   = deals.reduce((s, d) => {
    if (!d.arv || !d.offer_price) return s
    return s + (d.arv - (d.repair_cost || 0) - (d.closing_cost || 0) - d.offer_price)
  }, 0)

  const stats = [
    { label: 'Active Deals',     value: deals.length.toString(), sub: `${STAGES.map(s => `${byStage(s).length} ${s}`).join(' · ')}`, accent: '#7B8FD4' },
    { label: 'Pipeline Value',   value: fmtFull(pipelineValue),  sub: 'sum of all offer prices',                                      accent: '#C9A84C' },
    { label: 'Under Contract',   value: underContract.length.toString(), sub: underContractVal > 0 ? fmtFull(underContractVal) : 'No deals yet', accent: '#4CAF9A' },
    { label: 'Projected Profit', value: projectedProfit > 0 ? fmtFull(projectedProfit) : '—', sub: 'ARV − repairs − costs − offer',  accent: projectedProfit > 0 ? '#4CAF9A' : '#6b7280' },
  ]

  return (
    <div className="p-4 md:p-8" style={{ color: 'var(--c-primary)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--c-primary)' }}>Pipeline</h1>
          <p className="mt-1 text-xs md:text-sm" style={{ color: 'var(--c-text-2)' }}>
            {deals.length} active deal{deals.length !== 1 ? 's' : ''} · Drag cards to move stages
          </p>
        </div>
        <a
          href="/deals/new"
          className="flex items-center gap-2 font-bold px-4 py-2 md:px-5 md:py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">New Deal</span>
        </a>
      </div>

      {/* ── Revenue dashboard ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map(stat => (
          <div key={stat.label}
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-2)' }}>
              {stat.label}
            </p>
            <p className="text-2xl font-bold mb-1" style={{ color: stat.accent }}>{stat.value}</p>
            <p className="text-xs truncate" style={{ color: 'var(--c-text-3)' }}>{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Kanban board ── */}
      <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0 pb-2 md:pb-0">
      <div className="grid grid-cols-4 gap-4 items-start" style={{ minWidth: '640px' }}>
        {STAGES.map(stage => {
          const colors     = stageColors[stage]
          const stageDeals = byStage(stage)
          const stageVal   = stageDeals.reduce((s, d) => s + (d.offer_price || 0), 0)

          return (
            <div
              key={stage}
              className="rounded-2xl min-h-48"
              style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(stage)}
            >
              {/* Column header */}
              <div className="p-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: colors.accent }}>{stage}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${colors.accent}20`, color: colors.accent }}>
                    {stageDeals.length}
                  </span>
                </div>
                {stageVal > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: colors.accent }}>
                    {fmt(stageVal)} pipeline
                  </p>
                )}
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2">
                {stageDeals.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: `${colors.accent}60` }}>
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
                      className="rounded-xl p-3 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md"
                      style={{
                        backgroundColor: 'var(--c-card)',
                        border: '1px solid var(--c-border)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        opacity: dragging === deal.id ? 0.5 : 1,
                      }}
                    >
                      <a href={`/deals/${deal.id}`} className="block" onClick={e => e.stopPropagation()}>
                        <p className="text-xs font-bold leading-tight mb-1 line-clamp-2"
                          style={{ color: 'var(--c-primary)' }}>
                          {deal.address}
                        </p>
                        {deal.contacts && (
                          <p className="text-xs mb-2" style={{ color: 'var(--c-text-2)' }}>
                            {Array.isArray(deal.contacts) ? deal.contacts[0]?.name : deal.contacts.name}
                          </p>
                        )}
                        <div className="flex items-center justify-between">
                          {deal.offer_price ? (
                            <span className="text-xs font-semibold" style={{ color: 'var(--c-primary)' }}>
                              {fmt(deal.offer_price)}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>No offer</span>
                          )}
                          {profit !== null && (
                            <span className="text-xs font-semibold"
                              style={{ color: profit > 0 ? '#4CAF9A' : '#E07B6A' }}>
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
      </div>

      {/* ── Closed / Dead ── */}
      <div className="mt-6 rounded-2xl p-5"
        style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--c-primary)' }}>
          Closed &amp; Dead Deals
        </h2>
        <div className="flex gap-3">
          <a href="/deals?status=Closed"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{ backgroundColor: 'rgba(76,175,154,0.1)', color: '#4CAF9A' }}>
            ✅ View Closed
          </a>
          <a href="/deals?status=Dead"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            ✗ View Dead
          </a>
        </div>
      </div>
    </div>
  )
}
