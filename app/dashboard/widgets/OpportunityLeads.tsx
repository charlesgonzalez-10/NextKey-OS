'use client'

import Link from 'next/link'

interface OpportunityLead {
  id: string
  address: string
  owner_name: string
  lead_types: string[]
  estimated_value: number | null
  equity_percent: number | null
  distress_score: number
  lead_id: string | null
  lead_status: string | null
}

const typeColors: Record<string, string> = {
  'Pre-Foreclosure': 'bg-red-100 text-red-700',
  'Foreclosure':     'bg-red-200 text-red-800',
  'Auction':         'bg-orange-100 text-orange-700',
  'High Equity':     'bg-green-100 text-green-700',
  'Absentee':        'bg-blue-100 text-blue-700',
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, (score / 10) * 100))
  const color = pct >= 70 ? 'bg-red-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-blue-400'
  return (
    <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function OpportunityLeads({ leads }: { leads: OpportunityLead[] }) {
  if (!leads.length) {
    return (
      <div className="text-sm text-gray-400 py-6 text-center">
        No flagged opportunity leads.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {leads.map(lead => (
        <Link
          key={lead.id}
          href={`/leads/${lead.id}`}
          className="flex items-start gap-3 p-3 rounded-lg bg-white border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900 truncate">{lead.address}</span>
              {lead.lead_types.slice(0, 2).map(t => (
                <span key={t} className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColors[t] ?? 'bg-gray-100 text-gray-600'}`}>
                  {t}
                </span>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{lead.owner_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {lead.estimated_value ? (
              <span className="text-xs text-gray-600">{fmt(lead.estimated_value)}</span>
            ) : null}
            {lead.equity_percent ? (
              <span className="text-xs text-green-600">{lead.equity_percent.toFixed(0)}% equity</span>
            ) : null}
            {lead.distress_score > 0 && <ScoreBar score={lead.distress_score} />}
          </div>
        </Link>
      ))}
      <div className="mt-1 text-right">
        <Link href="/leads" className="text-xs text-blue-600 hover:underline">
          View all leads →
        </Link>
      </div>
    </div>
  )
}
