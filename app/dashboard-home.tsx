'use client'

interface Props {
  contactCount: number
  dealCount: number
}

export default function DashboardHome({ contactCount, dealCount }: Props) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const stats = [
    { label: 'Total Contacts', value: contactCount, href: '/contacts', color: '#C9A84C' },
    { label: 'Active Deals', value: dealCount, href: '/deals', color: '#4CAF9A' },
    { label: 'Pipeline Stages', value: 6, href: '/pipeline', color: '#7B8FD4' },
  ]

  const quickActions = [
    { label: 'Add Contact', href: '/contacts/new', icon: '👤' },
    { label: 'New Deal', href: '/deals/new', icon: '📋' },
    { label: 'View Pipeline', href: '/pipeline', icon: '📊' },
  ]

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-5 md:mb-8">
        <p className="text-gray-400 text-xs md:text-sm mb-1">{today}</p>
        <h1 style={{ color: '#0A1F44' }} className="text-2xl md:text-3xl font-bold">Good morning, Charles</h1>
        <p className="text-gray-400 mt-1 text-sm">Here's what's happening with NextKey today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 md:gap-6 mb-5 md:mb-8">
        {stats.map((s) => (
          <a
            key={s.label}
            href={s.href}
            className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 hover:shadow-md transition-shadow block"
          >
            <p className="text-gray-400 text-xs md:text-sm mb-1 md:mb-2">{s.label}</p>
            <p style={{ color: s.color }} className="text-3xl md:text-4xl font-bold">{s.value}</p>
          </a>
        ))}
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 mb-5 md:mb-8">
        <h2 style={{ color: '#0A1F44' }} className="font-bold text-base md:text-lg mb-3 md:mb-4">Quick Actions</h2>
        <div className="flex gap-3 flex-wrap">
          {quickActions.map((a) => (
            <a
              key={a.label}
              href={a.href}
              style={{ backgroundColor: '#F8F7F4', borderColor: '#EDE9E0' }}
              className="flex items-center gap-2 border rounded-xl px-4 py-2.5 text-sm font-semibold hover:shadow-sm transition-shadow"
            >
              <span>{a.icon}</span>
              <span style={{ color: '#0A1F44' }}>{a.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Spesio feed placeholder */}
      <div style={{ backgroundColor: '#0A1F44' }} className="rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">Spesio Lead Feed</h2>
          <span style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}
            className="text-xs font-semibold px-3 py-1 rounded-full">
            Auto-sync
          </span>
        </div>
        <p className="text-white/40 text-sm">
          New leads from Spesio.io will appear here automatically once the webhook is connected.
        </p>
      </div>
    </div>
  )
}
