'use client'

import Link from 'next/link'

const ACTIONS = [
  { label: 'Add Lead',         href: '/leads/new',          color: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'New Deal',         href: '/deals/new',          color: 'bg-purple-600 hover:bg-purple-700' },
  { label: 'Generate Doc',     href: '/documents/new',      color: 'bg-indigo-600 hover:bg-indigo-700' },
  { label: 'Add Contact',      href: '/contacts/new',       color: 'bg-teal-600 hover:bg-teal-700' },
  { label: 'Send Message',     href: '/inbox',              color: 'bg-green-600 hover:bg-green-700' },
  { label: 'Compose Email',    href: '/inbox',              color: 'bg-orange-600 hover:bg-orange-700' },
]

export default function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ACTIONS.map(a => (
        <Link
          key={a.label}
          href={a.href}
          className={`${a.color} text-white text-center text-sm font-medium px-3 py-2.5 rounded-lg transition-colors`}
        >
          {a.label}
        </Link>
      ))}
    </div>
  )
}
