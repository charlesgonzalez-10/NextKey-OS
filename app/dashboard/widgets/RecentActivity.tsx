'use client'

import Link from 'next/link'

interface ActivityItem {
  id: string
  type: string
  label: string
  href: string
  created_at: string
}

const typeIcon: Record<string, string> = {
  communication: '✉️',
  deal:          '🏠',
  document:      '📄',
  lead:          '🎯',
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.floor(diff / 60_000)
  const hr   = Math.floor(diff / 3_600_000)
  const day  = Math.floor(diff / 86_400_000)
  if (min < 2)   return 'Just now'
  if (min < 60)  return `${min}m ago`
  if (hr < 24)   return `${hr}h ago`
  if (day < 7)   return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function RecentActivity({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return (
      <div className="text-sm text-gray-400 py-6 text-center">
        No recent activity.
      </div>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-gray-50">
      {items.map(item => (
        <Link
          key={item.id}
          href={item.href}
          className="flex items-center gap-3 py-2.5 hover:bg-gray-50 rounded px-1 transition-colors"
        >
          <span className="text-base shrink-0">{typeIcon[item.type] ?? '•'}</span>
          <span className="flex-1 text-sm text-gray-700 truncate">{item.label}</span>
          <span className="text-xs text-gray-400 shrink-0">{relativeTime(item.created_at)}</span>
        </Link>
      ))}
    </div>
  )
}
