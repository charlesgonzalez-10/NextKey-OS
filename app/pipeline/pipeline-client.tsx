'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineStage {
  id: string
  name: string
  position: number
  color: string
  probability: number
  is_closed_won: boolean
  is_closed_lost: boolean
}

interface Pipeline {
  id: string
  name: string
  description: string | null
  pipeline_stages: PipelineStage[]
}

interface Deal {
  id: string
  address: string
  status: string
  pipeline_id: string | null
  pipeline_stage_id: string | null
  arv: number
  offer_price: number
  repair_cost: number
  closing_cost: number
  created_at: string
  contacts?: { name: string } | { name: string }[] | null
}

// ─── Legacy status view (for deals not yet assigned to a pipeline) ─────────────

const LEGACY_STAGES = ['Lead', 'Analyzing', 'Offer Sent', 'Under Contract']

const LEGACY_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  Lead:             { accent: '#7B8FD4', bg: 'rgba(123,143,212,0.08)',  border: 'rgba(123,143,212,0.2)'  },
  Analyzing:        { accent: '#C9A84C', bg: 'rgba(201,168,76,0.08)',   border: 'rgba(201,168,76,0.2)'   },
  'Offer Sent':     { accent: '#6ABDE0', bg: 'rgba(106,189,224,0.08)',  border: 'rgba(106,189,224,0.2)'  },
  'Under Contract': { accent: '#4CAF9A', bg: 'rgba(76,175,154,0.08)',   border: 'rgba(76,175,154,0.2)'   },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n > 0 ? `$${(n / 1000).toFixed(0)}k` : '—' }
function fmtFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function hex2rgb(hex: string) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r},${g},${b}`
}

// ─── Deal Card ────────────────────────────────────────────────────────────────

function DealCard({ deal, accent, dragging, onDragStart, onDragEnd }: {
  deal: Deal
  accent: string
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const profit = deal.arv && deal.offer_price
    ? deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - deal.offer_price
    : null

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="rounded-xl p-3 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md"
      style={{
        backgroundColor: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        opacity: dragging ? 0.5 : 1,
      }}
    >
      <a href={`/deals/${deal.id}`} className="block" onClick={e => e.stopPropagation()}>
        <p className="text-xs font-bold leading-tight mb-1 line-clamp-2" style={{ color: 'var(--c-primary)' }}>
          {deal.address}
        </p>
        {deal.contacts && (
          <p className="text-xs mb-2" style={{ color: 'var(--c-text-2)' }}>
            {Array.isArray(deal.contacts) ? deal.contacts[0]?.name : deal.contacts.name}
          </p>
        )}
        <div className="flex items-center justify-between">
          {deal.offer_price ? (
            <span className="text-xs font-semibold" style={{ color: 'var(--c-primary)' }}>{fmt(deal.offer_price)}</span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>No offer</span>
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
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({ label, accent, bg, border, deals, draggingId, onDrop, onDragStart, onDragEnd }: {
  label: string
  accent: string
  bg: string
  border: string
  deals: Deal[]
  draggingId: string | null
  onDrop: () => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
}) {
  const stageVal = deals.reduce((s, d) => s + (d.offer_price || 0), 0)

  return (
    <div
      className="rounded-2xl min-h-48"
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="p-3" style={{ borderBottom: `1px solid ${border}` }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold" style={{ color: accent }}>{label}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${accent}20`, color: accent }}>
            {deals.length}
          </span>
        </div>
        {stageVal > 0 && (
          <p className="text-xs mt-0.5" style={{ color: accent }}>{fmt(stageVal)} pipeline</p>
        )}
      </div>
      <div className="p-2 space-y-2">
        {deals.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: `${accent}60` }}>Drop deals here</p>
        )}
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            accent={accent}
            dragging={draggingId === deal.id}
            onDragStart={() => onDragStart(deal.id)}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PipelineClient({
  deals: initialDeals,
  pipelines,
}: {
  deals: Deal[]
  pipelines: Pipeline[]
}) {
  const supabase = createClient()
  const [deals, setDeals]         = useState(initialDeals)
  const [dragging, setDragging]   = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | 'legacy'>(
    pipelines.length > 0 ? pipelines[0].id : 'legacy'
  )

  const selectedPipeline = pipelines.find(p => p.id === selectedId) ?? null
  const showLegacy = selectedId === 'legacy' || !selectedPipeline

  // For pipeline view — deals assigned to this pipeline
  const pipelineDeals = showLegacy
    ? deals.filter(d => !d.pipeline_id)
    : deals.filter(d => d.pipeline_id === selectedId)

  const handleDragStart = (id: string) => setDragging(id)
  const handleDragEnd   = () => setDragging(null)

  // Legacy drag-drop (by status)
  const handleLegacyDrop = async (stage: string) => {
    if (!dragging) return
    const prev = deals.find(d => d.id === dragging)?.status
    if (prev === stage) return
    setDeals(d => d.map(deal => deal.id === dragging ? { ...deal, status: stage } : deal))
    await supabase.from('deals').update({ status: stage }).eq('id', dragging)
    setDragging(null)
  }

  // Pipeline drag-drop (by stage id)
  const handlePipelineDrop = async (stageId: string) => {
    if (!dragging) return
    const prev = deals.find(d => d.id === dragging)?.pipeline_stage_id
    if (prev === stageId) return
    setDeals(d => d.map(deal => deal.id === dragging ? { ...deal, pipeline_stage_id: stageId } : deal))
    await supabase.from('deals').update({ pipeline_stage_id: stageId }).eq('id', dragging)
    setDragging(null)
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const activePipelineDeals = showLegacy
    ? pipelineDeals
    : deals.filter(d => d.pipeline_id === selectedId)

  const pipelineValue   = activePipelineDeals.reduce((s, d) => s + (d.offer_price || 0), 0)
  const projectedProfit = activePipelineDeals.reduce((s, d) => {
    if (!d.arv || !d.offer_price) return s
    return s + (d.arv - (d.repair_cost || 0) - (d.closing_cost || 0) - d.offer_price)
  }, 0)

  const wonStageIds = new Set(
    selectedPipeline?.pipeline_stages.filter(s => s.is_closed_won).map(s => s.id) ?? []
  )
  const underContract = showLegacy
    ? deals.filter(d => d.status === 'Under Contract')
    : activePipelineDeals.filter(d => d.pipeline_stage_id && wonStageIds.has(d.pipeline_stage_id))

  const stats = [
    { label: 'Active Deals',     value: activePipelineDeals.length.toString(),                                 accent: '#7B8FD4' },
    { label: 'Pipeline Value',   value: pipelineValue > 0 ? fmtFull(pipelineValue) : '—',                     accent: '#C9A84C' },
    { label: showLegacy ? 'Under Contract' : 'Won Stage', value: underContract.length.toString(),              accent: '#4CAF9A' },
    { label: 'Projected Profit', value: projectedProfit > 0 ? fmtFull(projectedProfit) : '—',                 accent: projectedProfit > 0 ? '#4CAF9A' : '#6b7280' },
  ]

  return (
    <div className="p-4 md:p-8" style={{ color: 'var(--c-primary)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--c-primary)' }}>Pipeline</h1>
          <p className="mt-1 text-xs md:text-sm" style={{ color: 'var(--c-text-2)' }}>
            {activePipelineDeals.length} active deal{activePipelineDeals.length !== 1 ? 's' : ''} · Drag cards to move stages
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

      {/* ── Pipeline selector tabs ── */}
      {pipelines.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-5">
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                backgroundColor: selectedId === p.id ? 'var(--c-primary)' : 'var(--c-hover)',
                color:           selectedId === p.id ? '#C9A84C' : 'var(--c-text-2)',
                border:          `1px solid ${selectedId === p.id ? 'transparent' : 'var(--c-border)'}`,
              }}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => setSelectedId('legacy')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              backgroundColor: selectedId === 'legacy' ? 'var(--c-primary)' : 'var(--c-hover)',
              color:           selectedId === 'legacy' ? '#C9A84C' : 'var(--c-text-2)',
              border:          `1px solid ${selectedId === 'legacy' ? 'transparent' : 'var(--c-border)'}`,
            }}
          >
            Unassigned
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map(stat => (
          <div key={stat.label} className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-2)' }}>
              {stat.label}
            </p>
            <p className="text-2xl font-bold" style={{ color: stat.accent }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Kanban board ── */}
      <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0 pb-2 md:pb-0">
        {showLegacy ? (
          // Legacy status-based board
          <div className="grid gap-4 items-start" style={{ gridTemplateColumns: `repeat(${LEGACY_STAGES.length}, minmax(200px, 1fr))`, minWidth: '640px' }}>
            {LEGACY_STAGES.map(stage => {
              const colors = LEGACY_COLORS[stage]
              return (
                <KanbanColumn
                  key={stage}
                  label={stage}
                  accent={colors.accent}
                  bg={colors.bg}
                  border={colors.border}
                  deals={pipelineDeals.filter(d => d.status === stage)}
                  draggingId={dragging}
                  onDrop={() => handleLegacyDrop(stage)}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              )
            })}
          </div>
        ) : (
          // Pipeline stages board
          selectedPipeline!.pipeline_stages.length === 0 ? (
            <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>No stages configured</p>
              <p className="text-xs mb-4" style={{ color: 'var(--c-text-3)' }}>Add stages in Admin → Pipelines</p>
              <a href="/admin/pipelines" className="text-xs font-bold hover:underline" style={{ color: '#C9A84C' }}>
                Configure Pipeline →
              </a>
            </div>
          ) : (
            <div
              className="grid gap-4 items-start"
              style={{ gridTemplateColumns: `repeat(${selectedPipeline!.pipeline_stages.length}, minmax(200px, 1fr))`, minWidth: '640px' }}
            >
              {selectedPipeline!.pipeline_stages.map(stage => {
                const rgb = hex2rgb(stage.color || '#6B7280')
                return (
                  <KanbanColumn
                    key={stage.id}
                    label={stage.name}
                    accent={stage.color || '#6B7280'}
                    bg={`rgba(${rgb},0.08)`}
                    border={`rgba(${rgb},0.2)`}
                    deals={pipelineDeals.filter(d => d.pipeline_stage_id === stage.id)}
                    draggingId={dragging}
                    onDrop={() => handlePipelineDrop(stage.id)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                )
              })}
            </div>
          )
        )}
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
            View Closed
          </a>
          <a href="/deals?status=Dead"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            View Dead
          </a>
        </div>
      </div>
    </div>
  )
}
