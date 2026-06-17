'use client'

import Link from 'next/link'

interface Deal {
  id: string
  address: string
  status: string
  offer_price: number | null
  desired_profit: number | null
  created_at: string
}

const statusColors: Record<string, string> = {
  'New':            'bg-blue-100 text-blue-700',
  'Under Contract': 'bg-purple-100 text-purple-700',
  'Active':         'bg-green-100 text-green-700',
  'Pending':        'bg-yellow-100 text-yellow-700',
  'Closing':        'bg-indigo-100 text-indigo-700',
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

export default function ActiveDeals({ deals }: { deals: Deal[] }) {
  if (!deals.length) {
    return (
      <div className="text-sm text-gray-400 py-6 text-center">
        No active deals.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Address</th>
            <th className="text-left py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
            <th className="text-right py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Offer</th>
            <th className="text-right py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Profit</th>
          </tr>
        </thead>
        <tbody>
          {deals.map(d => (
            <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="py-2 px-1">
                <Link href={`/deals/${d.id}`} className="font-medium text-gray-900 hover:text-blue-600 max-w-[160px] truncate block">
                  {d.address}
                </Link>
              </td>
              <td className="py-2 px-1">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColors[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {d.status}
                </span>
              </td>
              <td className="py-2 px-1 text-right text-gray-700">
                {d.offer_price ? fmt(d.offer_price) : '—'}
              </td>
              <td className="py-2 px-1 text-right">
                {d.desired_profit ? (
                  <span className="text-green-600 font-medium">{fmt(d.desired_profit)}</span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-right">
        <Link href="/deals" className="text-xs text-blue-600 hover:underline">
          View all deals →
        </Link>
      </div>
    </div>
  )
}
