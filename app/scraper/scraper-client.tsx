'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ColumnPicker, { useColumnPrefs, ColumnDef } from '@/components/ColumnPicker'

// ─── Column definitions for the Leads table ──────────────────────────────────

type LeadCol =
  | 'county' | 'file_date' | 'owner_name' | 'property_address'
  | 'equity_tier' | 'equity_pct' | 'equity_dollar' | 'foreclosure_amount'
  | 'beds' | 'baths' | 'year_built' | 'living_area' | 'lot_size'
  | 'assessed_value' | 'market_value' | 'entity_type' | 'homestead' | 'vacant'
  | 'case_number' | 'folio_number' | 'plaintiff' | 'lender_name'
  | 'foreclosure_type' | 'multiple_liens'
  | 'phone_1' | 'phone_2' | 'phone_3' | 'phone_4' | 'phone_5'
  | 'city' | 'zip' | 'subdivision_name' | 'property_type' | 'status'

const LEAD_COLUMNS: ColumnDef<LeadCol>[] = [
  // Always visible
  { key: 'county',             label: 'County',            locked: true },
  { key: 'file_date',          label: 'Filed',             locked: true },
  { key: 'owner_name',         label: 'Owner / Mortgagor', locked: true },
  { key: 'property_address',   label: 'Address',           locked: true },
  // Equity (default on — the most important for investors)
  { key: 'equity_tier',        label: 'Equity Tier',       defaultVisible: true },
  { key: 'equity_pct',         label: 'Equity %',          defaultVisible: true },
  { key: 'equity_dollar',      label: 'Equity $',          defaultVisible: false },
  { key: 'foreclosure_amount', label: 'Foreclosure Amt',   defaultVisible: true },
  // Property basics
  { key: 'beds',               label: 'Beds',              defaultVisible: true },
  { key: 'baths',              label: 'Baths',             defaultVisible: true },
  { key: 'year_built',         label: 'Yr Built',          defaultVisible: false },
  { key: 'living_area',        label: 'Sqft',              defaultVisible: false },
  { key: 'lot_size',           label: 'Lot Sqft',          defaultVisible: false },
  // Valuation
  { key: 'assessed_value',     label: 'Assessed',          defaultVisible: false },
  { key: 'market_value',       label: 'Market Value',      defaultVisible: false },
  // Entity / occupancy
  { key: 'entity_type',        label: 'Entity Type',       defaultVisible: true },
  { key: 'homestead',          label: 'Homestead',         defaultVisible: false },
  { key: 'vacant',             label: 'Vacant',            defaultVisible: false },
  // Case info
  { key: 'case_number',        label: 'Case #',            defaultVisible: false },
  { key: 'folio_number',       label: 'Folio #',           defaultVisible: false },
  { key: 'plaintiff',          label: 'Plaintiff',         defaultVisible: false },
  { key: 'lender_name',        label: 'Lender',            defaultVisible: false },
  { key: 'foreclosure_type',   label: 'FC Type',           defaultVisible: false },
  { key: 'multiple_liens',     label: 'Multi Liens',       defaultVisible: false },
  // Phones
  { key: 'phone_1',            label: 'Phone 1',           defaultVisible: true },
  { key: 'phone_2',            label: 'Phone 2',           defaultVisible: false },
  { key: 'phone_3',            label: 'Phone 3',           defaultVisible: false },
  { key: 'phone_4',            label: 'Phone 4',           defaultVisible: false },
  { key: 'phone_5',            label: 'Phone 5',           defaultVisible: false },
  // Location extras
  { key: 'city',               label: 'City',              defaultVisible: false },
  { key: 'zip',                label: 'ZIP',               defaultVisible: false },
  { key: 'subdivision_name',   label: 'Subdivision',       defaultVisible: false },
  { key: 'property_type',      label: 'Property Type',     defaultVisible: false },
  // Status
  { key: 'status',             label: 'Import Status',     defaultVisible: false },
]

// ─── Types ────────────────────────────────────────────────────────────────────

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = Record<string, any>

// ─── Component ────────────────────────────────────────────────────────────────

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
  const [tab, setTab] = useState<'runs' | 'leads'>('runs')

  // REIFax CSV Import
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    total: number; created: number; skipped: number; errors: number
    debug?: { detected_headers?: string[]; first_error?: { reason: string; address?: string } | null; first_skip?: { reason: string; address?: string } | null }
  } | null>(null)
  const [importError, setImportError] = useState('')
  const [importCounty, setImportCounty] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Palm Beach Bulk Import
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkResult, setBulkResult] = useState<{
    total: number; file_rows: number; created: number; skipped: number; errors: number
  } | null>(null)
  const [bulkError, setBulkError] = useState('')
  const bulkFileRef = useRef<HTMLInputElement>(null)

  // PropStream CSV Import
  const [propImporting, setPropImporting] = useState(false)
  const [propResult, setPropResult] = useState<{
    total: number; file_rows: number; created: number; skipped: number; errors: number
  } | null>(null)
  const [propError, setPropError] = useState('')
  const [propCounty, setPropCounty] = useState('')
  const propFileRef = useRef<HTMLInputElement>(null)

  // Leads tab state
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsTotal, setLeadsTotal] = useState(0)
  const [leadsPage, setLeadsPage] = useState(1)
  const [leadsPages, setLeadsPages] = useState(1)
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadsSearch, setLeadsSearch] = useState('')
  const [leadsCounty, setLeadsCounty] = useState('')
  const [leadsEquity, setLeadsEquity] = useState('')
  const [leadsLoaded, setLeadsLoaded] = useState(false)

  const { visible: leadCols, toggle: toggleLeadCol, reset: resetLeadCols, isVisible: isLeadColVisible } =
    useColumnPrefs<LeadCol>('properties', LEAD_COLUMNS)

  const fetchLeads = useCallback(async (page = 1, search = leadsSearch, county = leadsCounty, equity = leadsEquity) => {
    setLeadsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '100' })
      if (search) params.set('search', search)
      if (county) params.set('county', county)
      if (equity) params.set('equity', equity)
      const res = await fetch(`/api/scraper/leads?${params}`)
      const data = await res.json()
      setLeads(data.leads || [])
      setLeadsTotal(data.total || 0)
      setLeadsPage(data.page || 1)
      setLeadsPages(data.pages || 1)
      setLeadsLoaded(true)
    } catch { /* noop */ }
    finally { setLeadsLoading(false) }
  }, [leadsSearch, leadsCounty, leadsEquity])

  const handleTabChange = (t: 'runs' | 'leads') => {
    setTab(t)
    if (t === 'leads' && !leadsLoaded) fetchLeads(1)
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerError('')
    setLastRunId('')
    const counties = Object.entries(selectedCounties).filter(([, v]) => v).map(([k]) => k)
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
      setTimeout(() => router.refresh(), 2000)
    } catch (err) {
      setTriggerError(String(err))
    } finally { setTriggering(false) }
  }

  const handlePropStreamImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPropImporting(true)
    setPropError('')
    setPropResult(null)
    const formData = new FormData()
    formData.append('file', file)
    if (propCounty) formData.append('county', propCounty)
    try {
      const res = await fetch('/api/scraper/propstream-import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setPropResult(data)
      router.refresh()
    } catch (err) { setPropError(String(err)) }
    finally {
      setPropImporting(false)
      if (propFileRef.current) propFileRef.current.value = ''
    }
  }

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBulkImporting(true)
    setBulkError('')
    setBulkResult(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/scraper/bulk-import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setBulkResult(data)
      router.refresh()
    } catch (err) { setBulkError(String(err)) }
    finally {
      setBulkImporting(false)
      if (bulkFileRef.current) bulkFileRef.current.value = ''
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
    if (importCounty) formData.append('county', importCounty)
    try {
      const res = await fetch('/api/scraper/import-csv', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setImportResult(data)
      router.refresh()
    } catch (err) { setImportError(String(err)) }
    finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const daysUntilREIFax = Math.ceil(
    (new Date('2026-06-18').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  // ─── Renders ────────────────────────────────────────────────────────────────

  const fmt$ = (v: number | null) => v ? `$${Number(v).toLocaleString()}` : '—'
  const fmtPct = (v: number | null) => v != null ? `${Number(v).toFixed(1)}%` : '—'

  function renderLeadCell(lead: Lead, col: LeadCol) {
    switch (col) {
      case 'county':           return <span className="capitalize text-xs">{COUNTY_LABELS[lead.county] || lead.county}</span>
      case 'file_date':        return <span className="text-xs">{lead.file_date ? new Date(lead.file_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</span>
      case 'owner_name':       return <span className="font-semibold text-sm" style={{ color: '#0A1F44' }}>{lead.owner_name || lead.mortgagor || '—'}</span>
      case 'property_address': return <span className="text-xs text-gray-600">{lead.property_address || '—'}</span>
      case 'equity_tier': {
        const tier = lead.equity_tier
        return tier ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `${EQUITY_COLORS[tier]}25`, color: EQUITY_COLORS[tier] }}>{tier}</span>
        ) : <span className="text-gray-300">—</span>
      }
      case 'equity_pct':         return <span className="text-xs font-semibold" style={{ color: lead.equity_percentage > 0 ? '#4CAF9A' : '#ccc' }}>{fmtPct(lead.equity_percentage)}</span>
      case 'equity_dollar':      return <span className="text-xs">{fmt$(lead.equity_dollar_amount)}</span>
      case 'foreclosure_amount': return <span className="text-xs">{fmt$(lead.foreclosure_amount)}</span>
      case 'beds':               return <span className="text-xs">{lead.beds ?? '—'}</span>
      case 'baths':              return <span className="text-xs">{lead.baths ?? '—'}</span>
      case 'year_built':         return <span className="text-xs">{lead.year_built || '—'}</span>
      case 'living_area':        return <span className="text-xs">{lead.living_area ? `${Number(lead.living_area).toLocaleString()} sqft` : '—'}</span>
      case 'lot_size':           return <span className="text-xs">{lead.lot_size ? `${Number(lead.lot_size).toLocaleString()} sqft` : '—'}</span>
      case 'assessed_value':     return <span className="text-xs">{fmt$(lead.assessed_value)}</span>
      case 'market_value':       return <span className="text-xs">{fmt$(lead.market_value)}</span>
      case 'entity_type':        return <span className="text-xs text-gray-500">{lead.entity_type || '—'}</span>
      case 'homestead':          return <span className="text-xs">{lead.homestead ? '✓' : '—'}</span>
      case 'vacant':             return <span className="text-xs">{lead.vacant ? '✓' : '—'}</span>
      case 'case_number':        return <span className="text-xs font-mono text-gray-500">{lead.case_number || '—'}</span>
      case 'folio_number':       return <span className="text-xs font-mono text-gray-500">{lead.folio_number || '—'}</span>
      case 'plaintiff':          return <span className="text-xs">{lead.plaintiff || '—'}</span>
      case 'lender_name':        return <span className="text-xs">{lead.lender_name || '—'}</span>
      case 'foreclosure_type':   return <span className="text-xs">{lead.foreclosure_type === 'P' ? 'Pre-FC' : lead.foreclosure_type || '—'}</span>
      case 'multiple_liens':     return <span className="text-xs">{lead.multiple_liens ? '⚠ Yes' : '—'}</span>
      case 'phone_1':            return <span className="text-xs">{lead.phone_1 || '—'}</span>
      case 'phone_2':            return <span className="text-xs">{lead.phone_2 || '—'}</span>
      case 'phone_3':            return <span className="text-xs">{lead.phone_3 || '—'}</span>
      case 'phone_4':            return <span className="text-xs">{lead.phone_4 || '—'}</span>
      case 'phone_5':            return <span className="text-xs">{lead.phone_5 || '—'}</span>
      case 'city':               return <span className="text-xs">{lead.city || '—'}</span>
      case 'zip':                return <span className="text-xs">{lead.zip || '—'}</span>
      case 'subdivision_name':   return <span className="text-xs">{lead.subdivision_name || '—'}</span>
      case 'property_type':      return <span className="text-xs">{lead.property_type || '—'}</span>
      case 'status': {
        const colors: Record<string, string> = { imported: 'text-green-600 bg-green-50', pending: 'text-yellow-600 bg-yellow-50', skipped: 'text-gray-400 bg-gray-50', error: 'text-red-500 bg-red-50' }
        return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${colors[lead.status] || ''}`}>{lead.status || '—'}</span>
      }
      default: return <span className="text-xs text-gray-400">—</span>
    }
  }

  const visibleLeadCols = LEAD_COLUMNS.filter(c => isLeadColVisible(c.key))

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 style={{ color: '#0A1F44' }} className="text-xl md:text-3xl font-bold">County Records Scraper</h1>
          <p className="text-gray-400 mt-1 text-xs md:text-sm">Automated Florida lis pendens — replaces REIFax</p>
        </div>
        {/* REIFax deadline badge */}
        <div style={{ backgroundColor: daysUntilREIFax <= 14 ? '#E07B6A20' : '#C9A84C20', borderColor: daysUntilREIFax <= 14 ? '#E07B6A' : '#C9A84C' }}
          className="border rounded-xl px-3 py-2 md:px-4 text-center">
          <p className="text-xs font-semibold" style={{ color: daysUntilREIFax <= 14 ? '#E07B6A' : '#C9A84C' }}>REIFax</p>
          <p className="text-xl md:text-2xl font-bold" style={{ color: daysUntilREIFax <= 14 ? '#E07B6A' : '#C9A84C' }}>{daysUntilREIFax}d</p>
          <p className="text-xs text-gray-400 hidden sm:block">June 18, 2026</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
        {[
          { label: 'This Week',  value: stats.week },
          { label: 'This Month', value: stats.month },
          { label: 'Total Leads', value: stats.total },
          { label: 'Next Run',   value: 'Sunday 6am' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{s.label}</p>
            <p style={{ color: '#0A1F44' }} className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
        {/* Left — controls + tabs */}
        <div className="md:col-span-2 space-y-5">
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
              Upload a REIFax export to bulk import leads.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">County (if not in CSV)</p>
                <select
                  value={importCounty}
                  onChange={e => setImportCounty(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-[#C9A84C]"
                >
                  <option value="">Auto-detect</option>
                  <option value="miami-dade">Miami-Dade</option>
                  <option value="broward">Broward</option>
                  <option value="palm-beach">Palm Beach</option>
                </select>
              </div>
              <div className="pt-5">
                <label
                  className="cursor-pointer font-bold px-5 py-2 rounded-xl text-sm transition-opacity hover:opacity-90 inline-block"
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
              </div>
            </div>
            {importError && <p className="text-red-500 text-sm mt-2">{importError}</p>}
            {importResult && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Rows', value: importResult.total,   color: '#0A1F44', bg: '#F8F7F4' },
                    { label: 'Created',   value: importResult.created,  color: '#4CAF9A', bg: '#4CAF9A10' },
                    { label: 'Skipped',   value: importResult.skipped,  color: '#C9A84C', bg: '#C9A84C10' },
                    { label: 'Errors',    value: importResult.errors,   color: '#E07B6A', bg: '#E07B6A10' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: s.bg }}>
                      <p className="text-xs text-gray-400">{s.label}</p>
                      <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {/* Debug info when things go wrong */}
                {importResult.created === 0 && importResult.debug && (
                  <div className="rounded-xl bg-orange-50 border border-orange-100 p-3 text-xs space-y-1">
                    <p className="font-semibold text-orange-700">No leads were created — debug info:</p>
                    {importResult.debug.detected_headers && (
                      <p className="text-gray-600">
                        <span className="font-medium">CSV headers:</span>{' '}
                        {importResult.debug.detected_headers.slice(0, 12).join(', ')}
                        {importResult.debug.detected_headers.length > 12 ? '…' : ''}
                      </p>
                    )}
                    {importResult.debug.first_error && (
                      <p className="text-red-600">
                        <span className="font-medium">First error:</span> {importResult.debug.first_error.reason}
                      </p>
                    )}
                    {importResult.debug.first_skip && (
                      <p className="text-orange-600">
                        <span className="font-medium">First skip:</span> {importResult.debug.first_skip.reason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PropStream CSV Import */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start justify-between mb-1">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base">PropStream Import</h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#7B8FD420', color: '#7B8FD4' }}>$99/mo</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Export pre-foreclosures from PropStream and upload the CSV here.
              Phones, equity, and property details come pre-filled — no PA lookup needed.
            </p>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <select
                value={propCounty}
                onChange={e => setPropCounty(e.target.value)}
                className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 focus:outline-none border border-gray-100"
              >
                <option value="">County from CSV (auto-detect)</option>
                <option value="miami-dade">Miami-Dade</option>
                <option value="broward">Broward</option>
                <option value="palm-beach">Palm Beach</option>
              </select>
              <label
                className="cursor-pointer font-bold px-5 py-2.5 rounded-xl text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: propImporting ? '#ccc' : '#7B8FD4', color: 'white' }}
              >
                {propImporting ? '⏳ Importing...' : '📂 Upload PropStream CSV'}
                <input
                  ref={propFileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handlePropStreamImport}
                  disabled={propImporting}
                />
              </label>
            </div>
            <p className="text-xs text-gray-300">
              In PropStream: Lists → Pre-Foreclosure → filter by county → Export CSV
            </p>
            {propError && <p className="text-red-500 text-sm mt-3">{propError}</p>}
            {propResult && (
              <div className="mt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'LP Records', value: propResult.total,   color: '#0A1F44', bg: '#F8F7F4' },
                    { label: 'Imported',   value: propResult.created, color: '#4CAF9A', bg: '#4CAF9A10' },
                    { label: 'Skipped',    value: propResult.skipped, color: '#C9A84C', bg: '#C9A84C10' },
                    { label: 'Errors',     value: propResult.errors,  color: '#E07B6A', bg: '#E07B6A10' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: s.bg }}>
                      <p className="text-xs text-gray-400">{s.label}</p>
                      <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-300 mt-2">{propResult.file_rows?.toLocaleString()} total rows in file</p>
              </div>
            )}
          </div>

          {/* Palm Beach Bulk File Import */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start justify-between mb-1">
              <h2 style={{ color: '#0A1F44' }} className="font-bold text-base">Palm Beach Bulk Import</h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#4CAF9A20', color: '#4CAF9A' }}>$40/yr</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Upload the Palm Beach Official Records bulk index file (pipe-delimited).
              Filters lis pendens automatically — replaces web scraping.
            </p>
            <div className="flex items-center gap-4">
              <label
                className="cursor-pointer font-bold px-5 py-2.5 rounded-xl text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: bulkImporting ? '#ccc' : '#0A1F44', color: '#C9A84C' }}
              >
                {bulkImporting ? '⏳ Processing...' : '📂 Upload Index File'}
                <input
                  ref={bulkFileRef}
                  type="file"
                  accept=".txt,.csv,.pipe,.dat,.tsv"
                  className="hidden"
                  onChange={handleBulkImport}
                  disabled={bulkImporting}
                />
              </label>
              <p className="text-xs text-gray-400">Pipe-delimited .txt from mypalmbeachclerk.com</p>
            </div>
            {bulkError && <p className="text-red-500 text-sm mt-3">{bulkError}</p>}
            {bulkResult && (
              <div className="mt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'LP Records', value: bulkResult.total,      color: '#0A1F44', bg: '#F8F7F4' },
                    { label: 'Imported',   value: bulkResult.created,    color: '#4CAF9A', bg: '#4CAF9A10' },
                    { label: 'Skipped',    value: bulkResult.skipped,    color: '#C9A84C', bg: '#C9A84C10' },
                    { label: 'Errors',     value: bulkResult.errors,     color: '#E07B6A', bg: '#E07B6A10' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: s.bg }}>
                      <p className="text-xs text-gray-400">{s.label}</p>
                      <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-300 mt-2">{bulkResult.file_rows?.toLocaleString()} total rows in file</p>
              </div>
            )}
          </div>

          {/* Tabs: Run History / Leads */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-gray-100">
              {(['runs', 'leads'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => handleTabChange(t)}
                  className={`px-6 py-3.5 text-sm font-semibold transition-colors border-b-2 ${
                    tab === t
                      ? 'border-yellow-500 text-yellow-600'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {t === 'runs' ? 'Run History' : `Leads${leadsTotal > 0 ? ` (${leadsTotal.toLocaleString()})` : ''}`}
                </button>
              ))}
            </div>

            {/* ── Run History ── */}
            {tab === 'runs' && (
              runs.length === 0 ? (
                <div className="p-6 text-center">
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
                          {new Date(run.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-400 capitalize">{run.triggered_by}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            run.status === 'completed' ? 'bg-green-100 text-green-600' :
                            run.status === 'running'   ? 'bg-yellow-100 text-yellow-600' :
                            run.status === 'failed'    ? 'bg-red-100 text-red-500' :
                            'bg-gray-100 text-gray-500'
                          }`}>{run.status}</span>
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
              )
            )}

            {/* ── Leads Table ── */}
            {tab === 'leads' && (
              <div>
                {/* Leads toolbar */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 flex-wrap">
                  <input
                    type="text"
                    placeholder="Search owner, address, case#..."
                    value={leadsSearch}
                    onChange={e => setLeadsSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchLeads(1, leadsSearch, leadsCounty, leadsEquity)}
                    className="text-sm text-gray-700 placeholder-gray-300 focus:outline-none bg-gray-50 rounded-lg px-3 py-1.5 w-60"
                  />
                  <select
                    value={leadsCounty}
                    onChange={e => { setLeadsCounty(e.target.value); fetchLeads(1, leadsSearch, e.target.value, leadsEquity) }}
                    className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 focus:outline-none"
                  >
                    <option value="">All Counties</option>
                    <option value="miami-dade">Miami-Dade</option>
                    <option value="broward">Broward</option>
                    <option value="palm-beach">Palm Beach</option>
                  </select>
                  <select
                    value={leadsEquity}
                    onChange={e => { setLeadsEquity(e.target.value); fetchLeads(1, leadsSearch, leadsCounty, e.target.value) }}
                    className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 focus:outline-none"
                  >
                    <option value="">All Equity</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                    <option value="None">None</option>
                  </select>
                  <button
                    onClick={() => fetchLeads(1, leadsSearch, leadsCounty, leadsEquity)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100"
                  >
                    Search
                  </button>

                  <div className="ml-auto flex items-center gap-2">
                    {leadsLoading && <span className="text-xs text-gray-400">Loading...</span>}
                    {leadsTotal > 0 && !leadsLoading && (
                      <span className="text-xs text-gray-400">{leadsTotal.toLocaleString()} leads</span>
                    )}
                    <ColumnPicker
                      columns={LEAD_COLUMNS}
                      visible={leadCols}
                      onToggle={toggleLeadCol}
                      onReset={resetLeadCols}
                    />
                  </div>
                </div>

                {!leadsLoaded && (
                  <div className="p-12 text-center">
                    <p className="text-gray-400 text-sm">Loading leads...</p>
                  </div>
                )}

                {leadsLoaded && leads.length === 0 && (
                  <div className="p-12 text-center">
                    <p className="text-gray-400 text-sm">No leads found.</p>
                    <p className="text-gray-300 text-xs mt-1">Run the scraper or import a REIFax CSV to populate leads.</p>
                  </div>
                )}

                {leadsLoaded && leads.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-max">
                      <thead style={{ backgroundColor: '#F8F7F4' }}>
                        <tr>
                          {visibleLeadCols.map(col => (
                            <th key={col.key} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 whitespace-nowrap">
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {leads.map(lead => (
                          <tr key={lead.id} className="hover:bg-gray-50">
                            {visibleLeadCols.map(col => (
                              <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                                {renderLeadCell(lead, col.key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {leadsLoaded && leadsPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-gray-50">
                    <button
                      onClick={() => { const p = leadsPage - 1; setLeadsPage(p); fetchLeads(p) }}
                      disabled={leadsPage <= 1}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                    >← Prev</button>
                    <span className="text-xs text-gray-400">Page {leadsPage} of {leadsPages}</span>
                    <button
                      onClick={() => { const p = leadsPage + 1; setLeadsPage(p); fetchLeads(p) }}
                      disabled={leadsPage >= leadsPages}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                    >Next →</button>
                  </div>
                )}
              </div>
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
                <span style={{ color: '#0A1F44' }} className="font-bold text-sm">{stats.by_county[county] || 0}</span>
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
                <span className="font-bold text-sm" style={{ color: EQUITY_COLORS[tier] }}>{stats.by_equity[tier] || 0}</span>
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
              <p className="text-white/80 text-xs">Palm Beach Bulk Index File</p>
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
