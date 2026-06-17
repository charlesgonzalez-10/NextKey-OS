'use client'

import Link from 'next/link'

interface BriefingData {
  follow_ups_due: number
  overdue_follow_ups: number
  new_leads_week: number
  offers_awaiting: number
  contracts_awaiting_signature: number
  pipeline_value: number
}

function getGreeting(name: string) {
  const h = new Date().getHours()
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return `${prefix}, ${name}`
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function MorningBriefing({
  data,
  userName,
}: {
  data: BriefingData
  userName: string
}) {
  const items = [
    {
      label: 'Follow-ups due',
      value: data.follow_ups_due,
      sub: data.overdue_follow_ups > 0 ? `${data.overdue_follow_ups} overdue` : undefined,
      href: '/leads',
      urgency: data.overdue_follow_ups > 0 ? 'red' : data.follow_ups_due > 0 ? 'yellow' : 'green',
    },
    {
      label: 'New leads this week',
      value: data.new_leads_week,
      href: '/leads',
      urgency: data.new_leads_week > 0 ? 'yellow' : 'green',
    },
    {
      label: 'Offers awaiting response',
      value: data.offers_awaiting,
      href: '/documents',
      urgency: data.offers_awaiting > 0 ? 'red' : 'green',
    },
    {
      label: 'Contracts awaiting signature',
      value: data.contracts_awaiting_signature,
      href: '/documents',
      urgency: data.contracts_awaiting_signature > 0 ? 'yellow' : 'green',
    },
    {
      label: 'Pipeline value',
      value: fmt(data.pipeline_value),
      href: '/deals',
      urgency: 'blue',
    },
  ]

  const urgencyStyles: Record<string, string> = {
    red:    'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    green:  'bg-green-50 border-green-200 text-green-600',
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{getGreeting(userName)}</h2>
        <p className="text-sm text-gray-500 mt-0.5">Here&apos;s what needs your attention today.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map(item => (
          <Link
            key={item.label}
            href={item.href}
            className={`rounded-lg border px-4 py-3 hover:opacity-80 transition-opacity ${urgencyStyles[item.urgency]}`}
          >
            <div className="text-2xl font-bold">{item.value}</div>
            <div className="text-xs font-medium mt-0.5 leading-tight">{item.label}</div>
            {item.sub && (
              <div className="text-xs mt-1 font-semibold opacity-80">{item.sub}</div>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
