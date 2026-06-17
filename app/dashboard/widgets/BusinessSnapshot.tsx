'use client'

import Link from 'next/link'

interface KpiData {
  total_leads: number
  total_contacts: number
  active_deals: number
  pipeline_value: number
  new_leads_today: number
  new_leads_week: number
  follow_ups_due: number
  contracts_sent: number
  under_contract: number
  closed_month: number
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

const CARDS: Array<{
  key: keyof KpiData
  label: string
  href: string
  format?: 'currency'
  accent?: string
}> = [
  { key: 'total_leads',      label: 'Total Leads',          href: '/leads' },
  { key: 'total_contacts',   label: 'Contacts',             href: '/contacts' },
  { key: 'new_leads_today',  label: 'New Today',            href: '/leads',     accent: 'blue' },
  { key: 'new_leads_week',   label: 'New This Week',        href: '/leads',     accent: 'blue' },
  { key: 'follow_ups_due',   label: 'Follow-Ups Due',       href: '/leads',     accent: 'yellow' },
  { key: 'active_deals',     label: 'Active Deals',         href: '/deals' },
  { key: 'pipeline_value',   label: 'Pipeline Value',       href: '/deals',     format: 'currency', accent: 'green' },
  { key: 'under_contract',   label: 'Under Contract',       href: '/deals',     accent: 'purple' },
  { key: 'closed_month',     label: 'Closed This Month',    href: '/deals',     accent: 'green' },
  { key: 'contracts_sent',   label: 'Contracts Sent',       href: '/documents', accent: 'orange' },
]

const accentStyles: Record<string, string> = {
  blue:   'text-blue-600',
  yellow: 'text-yellow-600',
  green:  'text-green-600',
  purple: 'text-purple-600',
  orange: 'text-orange-600',
}

export default function BusinessSnapshot({ data }: { data: KpiData }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARDS.map(card => {
        const raw = data[card.key]
        const display = card.format === 'currency' ? fmt(Number(raw)) : String(raw)
        return (
          <Link
            key={card.key}
            href={card.href}
            className="bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 hover:shadow-sm transition-all group"
          >
            <div className={`text-2xl font-bold ${card.accent ? accentStyles[card.accent] : 'text-gray-900'} group-hover:opacity-80`}>
              {display}
            </div>
            <div className="text-xs text-gray-500 font-medium mt-0.5">{card.label}</div>
          </Link>
        )
      })}
    </div>
  )
}
