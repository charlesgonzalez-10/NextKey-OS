'use client'

import Link from 'next/link'

interface FunnelData {
  total: number
  reviewing: number
  contacted: number
  offer: number
  under_contract: number
  closed: number
}

const STAGES = [
  { key: 'total',          label: 'Total Leads',       href: '/leads',                   color: 'bg-gray-200' },
  { key: 'reviewing',      label: 'Reviewing',         href: '/leads?status=reviewing',  color: 'bg-blue-300' },
  { key: 'contacted',      label: 'Contacted',         href: '/leads?status=contacted',  color: 'bg-indigo-300' },
  { key: 'offer',          label: 'Offer Made',        href: '/leads?status=offer',      color: 'bg-violet-400' },
  { key: 'under_contract', label: 'Under Contract',    href: '/deals',                   color: 'bg-purple-500' },
  { key: 'closed',         label: 'Closed (MTD)',      href: '/deals',                   color: 'bg-green-500' },
] as const

export default function PipelineFunnel({ data }: { data: FunnelData }) {
  const max = data.total || 1

  return (
    <div className="flex flex-col gap-2">
      {STAGES.map((stage, i) => {
        const count = data[stage.key]
        const pct   = Math.round((count / max) * 100)
        const prev  = i > 0 ? data[STAGES[i - 1].key] : max
        const conv  = prev > 0 ? Math.round((count / prev) * 100) : 0

        return (
          <Link key={stage.key} href={stage.href} className="group hover:opacity-80 transition-opacity">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-28 shrink-0 truncate">{stage.label}</span>
              <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden relative">
                <div
                  className={`h-full ${stage.color} rounded transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              <span className="text-sm font-semibold text-gray-700 w-8 text-right shrink-0">{count}</span>
              {i > 0 && (
                <span className="text-xs text-gray-400 w-10 text-right shrink-0">{conv}%</span>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
