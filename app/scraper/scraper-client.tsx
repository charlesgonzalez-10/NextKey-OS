'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const COUNTY_LABELS: Record<string, string> = {
  'miami-dade': 'Miami-Dade',
  'broward': 'Broward',
  'palm-beach': 'Palm Beach',
}

const EQUITY_COLORS: Record<string, string> = {
  High:   '#4CAF9A',
  Medium: '#C9A84C',
  Low:    '#7B8FD4',
  None:   '#ccc',
}

interface ScraperRun {
  id: string
  created_at: string
  triggered_by: string
  status: string
  completed_at?: string
  miami_dade_new: number
  broward_new: number
  palm_beach_new: number
  total_new: number
  total_skipped: number
  total_errors: number
  notes?: string
}

interface Stats {
  week: number
  month: number
  total: number
  by_county: Record<string, number>
  by_equity: Record<string, number>
}

export default function ScraperClient({
  runs: initialRuns,
  stats,
}: {
  runs: ScraperRun[]
  stats: Stats
}) {
  const router = useRouter()
  const [runs, setRuns] = useState(initialRuns)
  const [triggering, setTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState('')
  const [lastRunId, setLastRunId] = useState('')
  const [selectedCounties, setSelectedCounties] = useState({
    'miami-dade': true,
    'broward': true,
    'palm-beach': true,
  })

  // CSV Import
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    total: number; created: number; skipped: number; errors: number
  } | null>(null)
  const [importError, setImportError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerError('')
    setLastRunId('')

    const counties = Object.entries(selectedCounties)
      .filter(([, v]) => v)
      .map(([k]) => k)

    if (counties.length === 0) {
      setTriggerError('Select at least one county')
      setTriggering(false)
      return
    }

    try {
      const res = await fetch('/api/scraper/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counties }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trigger failed')
      setLastRunId(data.run_id)
      // Refresh to show new run
      setTimeout(() => router.refresh(), 2000)
    } catch (err) {
      setTriggerError(String(err))
    } finally {
      setTriggering(false)
    }
  }

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportError('')
    setImportResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/scraper/import-csv', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setImportResult(data)
      router.refresh()
    } catch (err) {
      setImportError(String(err))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const daysUntilREIFax = Math.ceil(
    (new Date('2026-06-18').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ color: '#0A1F44' }} className="text-3xl font-bold">County Records Scraper</h1>
          <p className="text-gray-400 mt-1">Automated Florida lis pendens — replaces REIFax</p>
        </div>
        {/* REIFax deadline badge */}
        <div style={{ backgroundColor: daysUntilREIFax <= 14 ? '#E07B6A20' : '#C9A84C20', borderColor: daysUntilREIFax <= 14 ? '#E07B6A' : '#C9A84C' }}
          className="border rounded-xl px-4 py-2 text-center">
          <p className="text-xs font-semibold" style={{ color: daysUntilREIFax <= 14 ? '#E07B6A' : '#C9A84C' }}>
            REIFax Renewal
          </p>
          <p className="text-2xl font-bold" style={{ color: daysUntilREIFax <= 14 ? '#E07B6A' : '#C9A84C' }}>
            {daysUntilREIFax}d
          </p>
          <p className="text-xs text-gray-400">June 18, 2026</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'This Week', value: stats.week },
          { label: 'This Month', value: stats.month },
          { label: 'Total Leads', value: stats.total },
          { label: 'Next Run', value: 'Sunday 6am' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{s.label}</p>
            <p style={{ color: '#0A1F44' }} className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left — controls */}
        <div className="col-span-2 space-y-5">
          {/* Manual trigger */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-4">Manual Pull</h2>
            <div className="flex gap-3 mb-4 flex-wrap">
              {Object.entries(selectedCounties).map(([county, checked]) => (
                <label key={county} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => setSelectedCounties(prev => ({ ...prev, [county]: e.target.checked }))}
                    className="w-4 h-4 accent-yellow-600"
                  />
                  <span className="text-sm font-medium text-gray-700">{COUNTY_LABELS[county]}</span>
                </label>
              ))}
            </div>
            <button
              onClick={handleTrigger}
              disabled={triggering}
              style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
              className="font-bold px-6 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 text-sm"
            >
              {triggering ? '⏳ Pulling records...' : '▶ Run Scraper Now'}
            </button>
            {triggerError && <p className="text-red-500 text-sm mt-2">{triggerError}</p>}
            {lastRunId && (
              <p className="text-green-600 text-sm mt-2">
                ✓ Run started — ID: <code className="bg-gray-100 px-1 rounded text-xs">{lastRunId}</code>
              </p>
            )}
          </div>

          {/* CSV Import */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-1">REIFax CSV Import</h2>
            <p className="text-gray-400 text-sm mb-4">
              Upload a REIFax export to bulk import leads. Used for validation and migration.
            </p>
            <div className="flex items-center gap-4">
              <label
                className="cursor-pointer font-bold px-5 py-2.5 rounded-xl text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: importing ? '#ccc' : '#4CAF9A', color: 'white' }}
              >
                {importing ? '⏳ Importing...' : '📂 Upload CSV'}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCSVImport}
                  disabled={importing}
                />
              </label>
              <p className="text-xs text-gray-400">Accepts any REIFax CSV export format</p>
            </div>

            {importError && <p className="text-red-500 text-sm mt-3">{importError}</p>}

            {importResult && (
              <div className="mt-4 grid grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400">Total Rows</p>
                  <p style={{ color: '#0A1F44' }} className="text-xl font-bold">{importResult.total}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400">Created</p>
                  <p className="text-xl font-bold text-green-600">{importResult.created}</p>
                </div>
                <div className="bg-yellow-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400">Skipped</p>
                  <p className="text-xl font-bold text-yellow-600">{importResult.skipped}</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400">Errors</p>
                  <p className="text-xl font-bold text-red-500">{importResult.errors}</p>
                </div>
              </div>
            )}
          </div>

          {/* Run history */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base">Run History</h2>
            </div>
            {runs.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-sm">No runs yet. Trigger a manual pull above.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead style={{ backgroundColor: '#F8F7F4' }}>
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Trigger</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">MD</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">BWD</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">PB</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Total</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Skip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {runs.map(run => (
                    <tr key={run.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-xs text-gray-600">
                        {new Date(run.created_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                        })}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400 capitalize">{run.triggered_by}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          run.status === 'completed' ? 'bg-green-100 text-green-600' :
                          run.status === 'running'   ? 'bg-yellow-100 text-yellow-600' :
                          run.status === 'failed'    ? 'bg-red-100 text-red-500' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-right font-semibold" style={{ color: '#0A1F44' }}>{run.miami_dade_new}</td>
                      <td className="px-5 py-3 text-xs text-right font-semibold" style={{ color: '#0A1F44' }}>{run.broward_new}</td>
                      <td className="px-5 py-3 text-xs text-right font-semibold" style={{ color: '#0A1F44' }}>{run.palm_beach_new}</td>
                      <td className="px-5 py-3 text-xs text-right font-bold" style={{ color: '#4CAF9A' }}>{run.total_new}</td>
                      <td className="px-5 py-3 text-xs text-right text-gray-400">{run.total_skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {/* County breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-4">By County</h2>
            {Object.keys(COUNTY_LABELS).map(county => (
              <div key={county} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-600">{COUNTY_LABELS[county]}</span>
                <span style={{ color: '#0A1F44' }} className="font-bold text-sm">
                  {stats.by_county[county] || 0}
                </span>
              </div>
            ))}
          </div>

          {/* Equity breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 style={{ color: '#0A1F44' }} className="font-bold text-base mb-4">By Equity Tier</h2>
            {['High', 'Medium', 'Low', 'None'].map(tier => (
              <div key={tier} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: EQUITY_COLORS[tier] }} />
                  <span className="text-sm text-gray-600">{tier}</span>
                </div>
                <span className="font-bold text-sm" style={{ color: EQUITY_COLORS[tier] }}>
                  {stats.by_equity[tier] || 0}
                </span>
              </div>
            ))}
          </div>

          {/* Info */}
          <div style={{ backgroundColor: '#0A1F44' }} className="rounded-2xl p-5">
            <h2 className="text-white font-bold text-sm mb-3">Cron Schedule</h2>
            <p className="text-white/60 text-xs leading-relaxed">
              Automated pull runs every <strong className="text-white">Sunday at 6:00am ET</strong>.
              Pulls lis pendens from all 3 Florida counties and auto-imports to your contacts.
            </p>
            <div className="mt-3 pt-3 border-t border-white/10">
              <p className="text-white/60 text-xs">Sources</p>
              <p className="text-white/80 text-xs mt-1">Miami-Dade Clerk OCS</p>
              <p className="text-white/80 text-xs">Broward Clerk Civil Search</p>
              <p className="text-white/80 text-xs">Palm Beach Clerk OR Search</p>
            </div>
            <div className="mt-3 pt-3 border-t border-white/10">
              <p className="text-white/60 text-xs">Replaces</p>
              <p style={{ color: '#C9A84C' }} className="text-sm font-bold mt-0.5">REIFax — saves $2,000/yr</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
