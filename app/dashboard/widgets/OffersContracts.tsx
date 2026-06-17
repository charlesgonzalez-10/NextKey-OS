'use client'

import Link from 'next/link'

interface DocStats {
  draft: number
  generated: number
  signed_by_me: number
  sent: number
  fully_signed: number
  expired: number
}

const ITEMS = [
  { key: 'draft',        label: 'Drafts',               color: 'bg-gray-200 text-gray-700',    href: '/documents?status=draft' },
  { key: 'generated',    label: 'Generated',            color: 'bg-blue-100 text-blue-700',    href: '/documents?status=generated' },
  { key: 'signed_by_me', label: 'Signed by Me',         color: 'bg-indigo-100 text-indigo-700',href: '/documents?status=signed_by_me' },
  { key: 'sent',         label: 'Sent / Awaiting',      color: 'bg-yellow-100 text-yellow-700',href: '/documents?status=sent' },
  { key: 'fully_signed', label: 'Fully Signed',         color: 'bg-green-100 text-green-700',  href: '/documents?status=fully_signed' },
  { key: 'expired',      label: 'Expired',              color: 'bg-red-100 text-red-700',      href: '/documents?status=expired' },
] as const

export default function OffersContracts({ data }: { data: DocStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {ITEMS.map(item => {
        const count = data[item.key]
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`rounded-lg px-3 py-2 ${item.color} hover:opacity-80 transition-opacity`}
          >
            <div className="text-2xl font-bold">{count}</div>
            <div className="text-xs font-medium mt-0.5">{item.label}</div>
          </Link>
        )
      })}
    </div>
  )
}
