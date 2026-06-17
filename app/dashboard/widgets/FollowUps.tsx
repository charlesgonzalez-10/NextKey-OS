'use client'

import Link from 'next/link'

interface FollowUp {
  id: string
  lead_id: string
  property_id: string
  address: string
  owner_name: string
  days_since: number
  status: string
}

function urgencyColor(days: number) {
  if (days >= 14) return 'text-red-600 font-semibold'
  if (days >= 7)  return 'text-yellow-600 font-medium'
  return 'text-gray-500'
}

export default function FollowUps({ followUps }: { followUps: FollowUp[] }) {
  if (!followUps.length) {
    return (
      <div className="text-sm text-gray-400 py-6 text-center">
        No pending follow-ups.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Owner</th>
            <th className="text-left py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Address</th>
            <th className="text-right py-2 px-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Days</th>
          </tr>
        </thead>
        <tbody>
          {followUps.map(f => (
            <tr
              key={f.id}
              className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
            >
              <td className="py-2 px-1">
                <Link href={`/leads/${f.property_id}`} className="font-medium text-gray-900 hover:text-blue-600">
                  {f.owner_name}
                </Link>
              </td>
              <td className="py-2 px-1 text-gray-500 max-w-[200px] truncate">{f.address}</td>
              <td className={`py-2 px-1 text-right ${urgencyColor(f.days_since)}`}>
                {f.days_since}d
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-right">
        <Link href="/leads?status=contacted" className="text-xs text-blue-600 hover:underline">
          View all →
        </Link>
      </div>
    </div>
  )
}
