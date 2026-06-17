'use client'

import Link from 'next/link'

interface LeadTypeItem {
  id: string
  name: string
  color: string
  count: number
}

export default function LeadTypeBreakdown({ items }: { items: LeadTypeItem[] }) {
  if (!items.length) {
    return (
      <div className="text-center py-8">
        <p className="text-sm font-medium text-gray-500 mb-1">No lead types assigned yet</p>
        <p className="text-xs text-gray-400">
          Assign lead types in{' '}
          <Link href="/admin/lead-types" className="underline hover:text-gray-600">Admin → Lead Types</Link>
          , then tag your contacts.
        </p>
      </div>
    )
  }

  const total = items.reduce((s, i) => s + i.count, 0)

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {items.map(item => (
          <div
            key={item.id}
            title={`${item.name}: ${item.count}`}
            style={{
              width: `${(item.count / total) * 100}%`,
              backgroundColor: item.color,
              minWidth: item.count > 0 ? '4px' : 0,
            }}
          />
        ))}
      </div>

      {/* Legend rows */}
      <div className="space-y-2">
        {items.map(item => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
          return (
            <div key={item.id} className="flex items-center gap-3">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="flex-1 text-sm text-gray-700 truncate">{item.name}</span>
              <span className="text-sm font-bold text-gray-900">{item.count}</span>
              <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
            </div>
          )
        })}
      </div>

      <div className="pt-1 border-t border-gray-100 flex items-center justify-between">
        <span className="text-xs text-gray-400">{total} total tagged contacts</span>
        <Link href="/contacts" className="text-xs font-semibold text-blue-600 hover:underline">
          View all →
        </Link>
      </div>
    </div>
  )
}
