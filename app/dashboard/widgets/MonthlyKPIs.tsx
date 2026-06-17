'use client'

import { useState } from 'react'

interface MonthlyData {
  leads_added: number
  contacts_created: number
  offers_sent: number
  contracts_signed: number
  deals_closed: number
  deals_active: number
}

interface Goals {
  lead_goal: number
  deal_goal: number
  contract_goal: number
  revenue_goal: number
}

// ── KPI models ────────────────────────────────────────────────────────────────
//
// Based on South Florida wholesale real estate benchmarks.
// Revenue = assignment fees / net profit per deal.
//
// Beginner    — solo, learning systems, first deals
// Intermediate — consistent pipeline, small team or VA support
// Expert       — full operation, dedicated acquisitions manager
// Enterprise   — multi-market, acquisitions team, high volume

const KPI_MODELS: Array<{
  id: string
  label: string
  tagline: string
  color: string
  goals: Goals
  notes: Record<keyof Goals, string>
}> = [
  {
    id: 'beginner',
    label: 'Beginner',
    tagline: 'Solo investor building first systems',
    color: '#6366f1',
    goals: { lead_goal: 30, deal_goal: 2, contract_goal: 1, revenue_goal: 5000 },
    notes: {
      lead_goal:     '30 leads/mo — pulling from scraper + public records',
      deal_goal:     '2 active deals — learning to analyze & make offers',
      contract_goal: '1 contract/mo — closing your first wholesale deals',
      revenue_goal:  '$5k/mo — one $5k assignment fee per month',
    },
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    tagline: '1–3 years in, building consistent deal flow',
    color: '#0ea5e9',
    goals: { lead_goal: 100, deal_goal: 5, contract_goal: 2, revenue_goal: 20000 },
    notes: {
      lead_goal:     '100 leads/mo — automated scraper + driving for dollars',
      deal_goal:     '5 active deals — offers going out consistently',
      contract_goal: '2 contracts/mo — double-close or assign',
      revenue_goal:  '$20k/mo — 2–3 deals averaging $7–10k each',
    },
  },
  {
    id: 'expert',
    label: 'Expert',
    tagline: '3–5 years, small team, systemized',
    color: '#C9A84C',
    goals: { lead_goal: 250, deal_goal: 10, contract_goal: 4, revenue_goal: 50000 },
    notes: {
      lead_goal:     '250 leads/mo — VA pulling lists + scraper automation',
      deal_goal:     '10 active deals — acquisition manager handling pipeline',
      contract_goal: '4 contracts/mo — strong seller pipeline',
      revenue_goal:  '$50k/mo — 4+ deals averaging $12–15k each',
    },
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    tagline: 'Full acquisitions operation, multi-market',
    color: '#10b981',
    goals: { lead_goal: 500, deal_goal: 25, contract_goal: 8, revenue_goal: 150000 },
    notes: {
      lead_goal:     '500 leads/mo — acquisitions team + multi-channel lead gen',
      deal_goal:     '25 active deals — dedicated dispositions + acquisitions',
      contract_goal: '8 contracts/mo — predictable closing machine',
      revenue_goal:  '$150k/mo — team operation across South Florida',
    },
  },
]

function buildItems(goals: Goals) {
  return [
    { key: 'leads_added'      as keyof MonthlyData, label: 'Leads Added',       target: goals.lead_goal },
    { key: 'contacts_created' as keyof MonthlyData, label: 'Contacts Created',  target: Math.round(goals.lead_goal * 0.4) },
    { key: 'offers_sent'      as keyof MonthlyData, label: 'Offers Sent',       target: goals.deal_goal },
    { key: 'contracts_signed' as keyof MonthlyData, label: 'Contracts Signed',  target: goals.contract_goal },
    { key: 'deals_closed'     as keyof MonthlyData, label: 'Deals Closed',      target: goals.contract_goal },
    { key: 'deals_active'     as keyof MonthlyData, label: 'Active Deals',      target: goals.deal_goal },
  ]
}

function currency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

// ── Goals editor modal ────────────────────────────────────────────────────────

function GoalsModal({
  currentGoals,
  onSave,
  onClose,
}: {
  currentGoals: Goals
  onSave: (g: Goals) => void
  onClose: () => void
}) {
  const [form,    setForm]    = useState<Goals>(currentGoals)
  const [saving,  setSaving]  = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const applyModel = (model: typeof KPI_MODELS[number]) => {
    setSelected(model.id)
    setForm(model.goals)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/user/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        onSave(form)
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Monthly KPI Goals</h2>
              <p className="text-sm text-gray-400 mt-0.5">Pick a model or set custom targets for this month.</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Model presets */}
        <div className="p-6 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Performance Models</p>
          <div className="grid grid-cols-2 gap-3">
            {KPI_MODELS.map(model => (
              <button
                key={model.id}
                onClick={() => applyModel(model)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  selected === model.id
                    ? 'border-current shadow-sm'
                    : 'border-gray-100 hover:border-gray-200'
                }`}
                style={selected === model.id ? { borderColor: model.color } : {}}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: model.color + '20', color: model.color }}
                  >
                    {model.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{model.tagline}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span className="text-[11px] text-gray-400">{model.goals.lead_goal} leads/mo</span>
                  <span className="text-[11px] text-gray-400">{model.goals.deal_goal} deals active</span>
                  <span className="text-[11px] text-gray-400">{model.goals.contract_goal} contracts/mo</span>
                  <span className="text-[11px] text-gray-400">{currency(model.goals.revenue_goal)}/mo</span>
                </div>
                {selected === model.id && (
                  <div className="mt-3 space-y-1">
                    {(Object.keys(model.notes) as (keyof Goals)[]).map(k => (
                      <p key={k} className="text-[11px] text-gray-400 leading-snug">
                        · {model.notes[k]}
                      </p>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Custom inputs */}
        <div className="p-6 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Custom Targets</p>
          <div className="grid grid-cols-2 gap-4">
            {([
              { key: 'lead_goal' as keyof Goals,     label: 'Leads Added / Month',     prefix: '' },
              { key: 'deal_goal' as keyof Goals,     label: 'Active Deals Target',     prefix: '' },
              { key: 'contract_goal' as keyof Goals, label: 'Contracts / Month',       prefix: '' },
              { key: 'revenue_goal' as keyof Goals,  label: 'Revenue Goal / Month',    prefix: '$' },
            ]).map(field => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                <div className="flex items-center gap-1.5">
                  {field.prefix && <span className="text-sm text-gray-400">{field.prefix}</span>}
                  <input
                    type="number"
                    min={0}
                    value={form[field.key]}
                    onChange={e => {
                      setSelected(null)
                      setForm(f => ({ ...f, [field.key]: Number(e.target.value) || 0 }))
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 flex items-center justify-between">
          <p className="text-xs text-gray-400">Goals reset each month. AI coaching coming soon.</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Goals'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main widget ────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: Goals = { lead_goal: 50, deal_goal: 5, contract_goal: 2, revenue_goal: 0 }

export default function MonthlyKPIs({
  data,
  goals: initialGoals,
}: {
  data: MonthlyData
  goals?: Goals | null
}) {
  const [goals,     setGoals]     = useState<Goals>(initialGoals ?? DEFAULT_GOALS)
  const [showModal, setShowModal] = useState(false)

  const monthName = new Date().toLocaleString('default', { month: 'long' })
  const items = buildItems(goals)

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">{monthName} MTD</div>
          <button
            onClick={() => setShowModal(true)}
            className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Set Goals
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {items.map(item => {
            const val      = data[item.key]
            const pct      = item.target ? Math.min(100, Math.round((val / item.target) * 100)) : 0
            const barColor = pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-gray-300'

            return (
              <div key={item.key} className="bg-white border border-gray-100 rounded-lg px-3 py-3">
                <div className="text-2xl font-bold text-gray-900">{val}</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-tight">{item.label}</div>
                {item.target != null && (
                  <div className="mt-2">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {pct}% of {item.target}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {goals.revenue_goal > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round((goals.deal_goal * 10000 / goals.revenue_goal) * 100))}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 shrink-0">
              Revenue target: {currency(goals.revenue_goal)}/mo
            </span>
          </div>
        )}
      </div>

      {showModal && (
        <GoalsModal
          currentGoals={goals}
          onSave={setGoals}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
