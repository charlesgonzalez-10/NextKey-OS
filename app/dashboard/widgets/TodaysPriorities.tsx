'use client'

import Link from 'next/link'

interface Priority {
  id: string
  type: string
  label: string
  href: string
  urgency: string
}

const typeIcons: Record<string, string> = {
  followup:  '📞',
  offer:     '📋',
  contract:  '✍️',
  new_lead:  '🏠',
}

const urgencyStyles: Record<string, { dot: string; row: string }> = {
  high:   { dot: 'bg-red-500',    row: 'border-l-red-400' },
  medium: { dot: 'bg-yellow-500', row: 'border-l-yellow-400' },
  low:    { dot: 'bg-blue-400',   row: 'border-l-blue-300' },
}

export default function TodaysPriorities({ priorities }: { priorities: Priority[] }) {
  if (!priorities.length) {
    return (
      <div className="text-sm text-gray-400 py-6 text-center">
        Nothing urgent — you&apos;re all caught up.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {priorities.map(p => {
        const style = urgencyStyles[p.urgency] ?? urgencyStyles.low
        return (
          <Link
            key={p.id}
            href={p.href}
            className={`flex items-center gap-3 p-3 rounded-lg bg-white border border-l-4 ${style.row} border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all`}
          >
            <span className="text-base">{typeIcons[p.type] ?? '•'}</span>
            <span className="flex-1 text-sm text-gray-700">{p.label}</span>
            <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
          </Link>
        )
      })}
    </div>
  )
}
