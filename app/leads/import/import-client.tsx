'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import {
  parseFile, autoDetectMapping, normalizeRow, generateFolioKey,
  LEAD_FIELD_LABELS,
  type LeadField, type RawRow, type NormalizedLead,
} from '@/lib/importFramework'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pipeline { id: string; name: string; slug: string; color: string; icon: string }

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done'

interface ImportResult {
  imported: number; skipped: number; errors: { folio: string; message: string }[]; total: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COUNTY_OPTIONS = [
  { value: 'lee',        label: 'Lee County' },
  { value: 'miami-dade', label: 'Miami-Dade' },
  { value: 'broward',    label: 'Broward' },
  { value: 'palm-beach', label: 'Palm Beach' },
  { value: 'hillsborough', label: 'Hillsborough' },
  { value: 'orange',     label: 'Orange' },
  { value: 'other',      label: 'Other' },
]

const CHUNK = 100

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImportClient() {
  const router = useRouter()

  // Step state
  const [step, setStep]         = useState<Step>('upload')

  // Config
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipeline,  setPipeline]  = useState('surplus-funds')
  const [county,    setCounty]    = useState('lee')

  // File / parse state
  const [fileName,    setFileName]    = useState('')
  const [headers,     setHeaders]     = useState<string[]>([])
  const [rawRows,     setRawRows]     = useState<RawRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [mapping,     setMapping]     = useState<Record<string, LeadField>>({})

  // Preview
  const [normalized, setNormalized]   = useState<NormalizedLead[]>([])
  const [warnings,   setWarnings]     = useState<string[]>([])

  // Import progress
  const [progress,   setProgress]     = useState(0)
  const [result,     setResult]       = useState<ImportResult | null>(null)

  // Drag state
  const [dragging, setDragging] = useState(false)

  // Load pipelines
  useEffect(() => {
    fetch('/api/acquisition/pipelines')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.pipelines) setPipelines(d.pipelines) })
      .catch(() => {})
  }, [])

  // ── File handling ──────────────────────────────────────────────────────────

  const processText = useCallback((text: string, name: string) => {
    setFileName(name)
    const { headers: h, rows, errors } = parseFile(text)
    setHeaders(h)
    setRawRows(rows)
    setParseErrors(errors)
    setMapping(autoDetectMapping(h))
    setStep('map')
  }, [])

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => processText(e.target?.result as string, file.name)
    reader.readAsText(file)
  }, [processText])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text')
    if (text.includes('\t') || text.includes(',')) {
      e.preventDefault()
      processText(text, 'pasted-data.tsv')
    }
  }, [processText])

  // ── Mapping → Preview ──────────────────────────────────────────────────────

  const buildPreview = useCallback(() => {
    const results: NormalizedLead[] = []
    const warns: string[] = []

    for (const row of rawRows) {
      const lead = normalizeRow(row, mapping, { county, state: 'FL' })
      if (!lead) { warns.push(`Skipped row — no address found`); continue }
      if (!lead.folio_number) lead.folio_number = generateFolioKey(lead)
      results.push(lead)
    }

    const noAddr  = rawRows.length - results.length
    if (noAddr > 0) warns.push(`${noAddr} rows skipped — no property address`)

    const noFolio = results.filter(l => l.folio_number?.startsWith('AUTO-')).length
    if (noFolio > 0) warns.push(`${noFolio} rows have no folio — auto-generated dedup key used`)

    setNormalized(results)
    setWarnings(warns)
    setStep('preview')
  }, [rawRows, mapping, county])

  // ── Import ─────────────────────────────────────────────────────────────────

  const runImport = useCallback(async () => {
    if (!normalized.length) return
    setStep('importing')
    setProgress(0)

    let totalImported = 0
    let totalSkipped  = 0
    const allErrors: { folio: string; message: string }[] = []

    const chunks = Math.ceil(normalized.length / CHUNK)

    for (let i = 0; i < chunks; i++) {
      const chunk = normalized.slice(i * CHUNK, (i + 1) * CHUNK)
      const isFirst = i === 0

      try {
        const res = await fetch('/api/acquisition/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leads:        chunk,
            pipeline,
            county,
            file_name:    isFirst ? fileName : undefined,
            source_type:  fileName.endsWith('.csv') ? 'csv' : 'tsv',
            field_mapping: isFirst ? mapping : undefined,
            session_name: isFirst ? `${pipeline} — ${fileName}` : undefined,
          }),
        })
        const data = await res.json()
        if (res.ok) {
          totalImported += data.imported ?? 0
          totalSkipped  += data.skipped  ?? 0
          allErrors.push(...(data.errors ?? []))
        } else {
          allErrors.push({ folio: 'batch', message: data.error ?? 'Unknown error' })
        }
      } catch (e) {
        allErrors.push({ folio: 'batch', message: String(e) })
      }

      setProgress(Math.round(((i + 1) / chunks) * 100))
    }

    setResult({ imported: totalImported, skipped: totalSkipped, errors: allErrors, total: normalized.length })
    setStep('done')
  }, [normalized, pipeline, county, fileName, mapping])

  // ── Render ─────────────────────────────────────────────────────────────────

  const activePipeline = pipelines.find(p => p.slug === pipeline)

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--c-bg)', color: 'var(--c-primary)' }}>

      {/* Header */}
      <div className="px-6 md:px-10 pt-6 pb-4" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => router.push('/leads')}
            className="text-xs hover:opacity-70 transition-opacity"
            style={{ color: 'var(--c-text-3)' }}>
            ← Leads
          </button>
          <span style={{ color: 'var(--c-text-3)' }}>/</span>
          <span className="text-xs font-semibold">Import Leads</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-xl font-bold">Import Leads</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
              Upload CSV or TSV — map columns — preview — import
            </p>
          </div>
          {/* Step indicator */}
          <div className="hidden md:flex items-center gap-1">
            {(['upload','map','preview','done'] as const).map((s, idx) => {
              const labels = ['Upload','Map','Preview','Done']
              const stepOrder: Step[] = ['upload','map','preview','importing','done']
              const current = stepOrder.indexOf(step)
              const thisIdx  = stepOrder.indexOf(s === 'done' ? 'done' : s)
              const done     = current > thisIdx
              const active   = step === s || (s === 'done' && step === 'importing')
              return (
                <div key={s} className="flex items-center gap-1">
                  {idx > 0 && <div className="w-8 h-px" style={{ backgroundColor: done ? '#4CAF9A' : 'var(--c-border)' }} />}
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold"
                    style={{
                      backgroundColor: active ? 'rgba(201,168,76,0.12)' : done ? 'rgba(76,175,154,0.1)' : 'var(--c-hover)',
                      color: active ? '#C9A84C' : done ? '#4CAF9A' : 'var(--c-text-3)',
                    }}>
                    {done && <span>✓</span>}
                    {labels[idx]}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 md:px-10 py-6 max-w-5xl mx-auto w-full">

        {/* ── STEP 1: Upload ─────────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="flex flex-col gap-6">

            {/* Pipeline + County */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <label className="text-xs font-bold mb-2 block" style={{ color: 'var(--c-text-2)' }}>
                  Acquisition Pipeline
                </label>
                <div className="flex flex-col gap-1.5">
                  {pipelines.map(p => (
                    <button key={p.slug}
                      onClick={() => setPipeline(p.slug)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-semibold transition-all"
                      style={{
                        backgroundColor: pipeline === p.slug ? `${p.color}15` : 'var(--c-hover)',
                        color: pipeline === p.slug ? p.color : 'var(--c-text-2)',
                        border: `1px solid ${pipeline === p.slug ? `${p.color}40` : 'transparent'}`,
                      }}>
                      <span>{p.icon}</span>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <label className="text-xs font-bold mb-2 block" style={{ color: 'var(--c-text-2)' }}>
                  County (default for rows without one)
                </label>
                <select value={county} onChange={e => setCounty(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm font-semibold focus:outline-none"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', border: '1px solid var(--c-border)' }}>
                  {COUNTY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className="rounded-xl p-8 flex flex-col items-center gap-4 transition-all"
              style={{
                border: `2px dashed ${dragging ? '#C9A84C' : 'var(--c-border)'}`,
                backgroundColor: dragging ? 'rgba(201,168,76,0.04)' : 'var(--c-card)',
              }}>
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-bold">Drop a CSV or TSV file here</p>
                <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>or choose a file or paste data below</p>
              </div>
              <label className="px-4 py-2 rounded-lg text-sm font-bold cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                Choose File
                <input type="file" accept=".csv,.tsv,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </label>
            </div>

            {/* Paste area */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <label className="text-xs font-bold mb-2 block" style={{ color: 'var(--c-text-2)' }}>
                Or paste CSV / TSV data directly
              </label>
              <textarea
                rows={6}
                placeholder="Paste your data here (with headers in first row)…"
                onPaste={handlePaste}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono focus:outline-none resize-none"
                style={{
                  backgroundColor: 'var(--c-hover)',
                  color: 'var(--c-primary)',
                  border: '1px solid var(--c-border)',
                }}
              />
              <p className="text-[10px] mt-1" style={{ color: 'var(--c-text-3)' }}>
                Delimiter auto-detected (tab or comma). First row must be headers.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 2: Column Mapping ──────────────────────────────────────────── */}
        {step === 'map' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Map Columns</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                  {rawRows.length.toLocaleString()} rows · {headers.length} columns · {fileName}
                </p>
              </div>
              <button onClick={() => setStep('upload')}
                className="text-xs hover:opacity-70" style={{ color: 'var(--c-text-3)' }}>
                ← Back
              </button>
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: 'var(--c-hover)', borderBottom: '1px solid var(--c-border)' }}>
                    <th className="px-4 py-2.5 text-left font-bold" style={{ color: 'var(--c-text-2)' }}>Your Column</th>
                    <th className="px-4 py-2.5 text-left font-bold" style={{ color: 'var(--c-text-2)' }}>Sample Value</th>
                    <th className="px-4 py-2.5 text-left font-bold" style={{ color: 'var(--c-text-2)' }}>Maps To</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => {
                    const sample = rawRows.slice(0, 3).map(r => r[h]).filter(Boolean).join(' · ').slice(0, 60)
                    const isSkipped = mapping[h] === 'skip'
                    return (
                      <tr key={h} style={{
                        borderBottom: '1px solid var(--c-border)',
                        opacity: isSkipped ? 0.5 : 1,
                        backgroundColor: i % 2 === 0 ? 'var(--c-card)' : 'var(--c-hover)',
                      }}>
                        <td className="px-4 py-2 font-semibold" style={{ color: 'var(--c-primary)' }}>
                          {h}
                        </td>
                        <td className="px-4 py-2 font-mono" style={{ color: 'var(--c-text-3)' }}>
                          {sample || '—'}
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={mapping[h] ?? 'skip'}
                            onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value as LeadField }))}
                            className="text-xs font-semibold px-2 py-1 rounded-lg focus:outline-none"
                            style={{
                              backgroundColor: isSkipped ? 'var(--c-hover)' : 'rgba(201,168,76,0.1)',
                              color: isSkipped ? 'var(--c-text-3)' : '#C9A84C',
                              border: `1px solid ${isSkipped ? 'var(--c-border)' : 'rgba(201,168,76,0.3)'}`,
                            }}>
                            {(Object.entries(LEAD_FIELD_LABELS) as [LeadField, string][]).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button onClick={buildPreview}
                className="px-5 py-2 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity"
                style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                Preview Import →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Preview ─────────────────────────────────────────────────── */}
        {step === 'preview' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Preview</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                  {normalized.length.toLocaleString()} leads ready to import
                  {activePipeline && ` → ${activePipeline.icon} ${activePipeline.name}`}
                </p>
              </div>
              <button onClick={() => setStep('map')}
                className="text-xs hover:opacity-70" style={{ color: 'var(--c-text-3)' }}>
                ← Back
              </button>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-xl p-3 text-xs flex flex-col gap-1"
                style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
                {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--c-border)' }}>
              <table className="text-xs min-w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--c-hover)', borderBottom: '1px solid var(--c-border)' }}>
                    {['Folio','Address','Owner','County','Surplus $','Last Sale'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-bold whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {normalized.slice(0, 25).map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: i % 2 === 0 ? 'var(--c-card)' : 'var(--c-hover)' }}>
                      <td className="px-3 py-2 font-mono" style={{ color: l.folio_number?.startsWith('AUTO-') ? '#f59e0b' : 'var(--c-text-3)' }}>
                        {l.folio_number?.startsWith('AUTO-') ? '(auto)' : (l.folio_number || '—')}
                      </td>
                      <td className="px-3 py-2 font-semibold" style={{ color: 'var(--c-primary)' }}>
                        {l.property_address}
                        {l.city && <span className="font-normal text-[10px] ml-1" style={{ color: 'var(--c-text-3)' }}>{l.city}</span>}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--c-text-2)' }}>{l.owner_name || '—'}</td>
                      <td className="px-3 py-2 capitalize" style={{ color: 'var(--c-text-3)' }}>{l.county || county}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: l.surplus_funds_amount ? '#4CAF9A' : 'var(--c-text-3)' }}>
                        {l.surplus_funds_amount ? fmt$(l.surplus_funds_amount) : '—'}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--c-text-3)' }}>{l.last_sale_date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {normalized.length > 25 && (
                <div className="px-4 py-2 text-xs text-center" style={{ color: 'var(--c-text-3)', borderTop: '1px solid var(--c-border)' }}>
                  + {(normalized.length - 25).toLocaleString()} more rows not shown
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setStep('map')}
                className="px-4 py-2 rounded-xl text-sm font-bold hover:opacity-70"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                Back
              </button>
              <button onClick={runImport}
                className="px-6 py-2 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity"
                style={{ backgroundColor: '#4CAF9A', color: '#fff' }}>
                Import {normalized.length.toLocaleString()} Leads
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: Importing ─────────────────────────────────────────────────── */}
        {step === 'importing' && (
          <div className="flex flex-col items-center gap-6 py-16">
            <div className="text-4xl animate-pulse">📥</div>
            <div className="text-center">
              <p className="text-base font-bold">Importing leads…</p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>{progress}% complete</p>
            </div>
            <div className="w-64 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--c-hover)' }}>
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: '#4CAF9A' }} />
            </div>
          </div>
        )}

        {/* ── STEP: Done ──────────────────────────────────────────────────────── */}
        {step === 'done' && result && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <div className="text-4xl mb-3">{result.errors.length === result.total ? '❌' : result.imported === result.total ? '✅' : '⚠️'}</div>
              <h2 className="text-xl font-bold mb-4">
                {result.errors.length === result.total ? 'Import Failed' : 'Import Complete'}
              </h2>
              <div className="flex justify-center gap-8">
                <div className="text-center">
                  <p className="text-3xl font-bold" style={{ color: '#4CAF9A' }}>{result.imported.toLocaleString()}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>imported</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold" style={{ color: '#C9A84C' }}>{result.skipped.toLocaleString()}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>skipped</p>
                </div>
                {result.errors.length > 0 && (
                  <div className="text-center">
                    <p className="text-3xl font-bold" style={{ color: '#ef4444' }}>{result.errors.length.toLocaleString()}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>errors</p>
                  </div>
                )}
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <p className="font-bold mb-2" style={{ color: '#ef4444' }}>Errors (first 10)</p>
                {result.errors.slice(0, 10).map((e, i) => (
                  <div key={i} className="mb-0.5" style={{ color: 'var(--c-text-2)' }}>
                    <span className="font-mono" style={{ color: '#ef4444' }}>{e.folio}</span>: {e.message}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button onClick={() => { setStep('upload'); setFileName(''); setHeaders([]); setRawRows([]); setNormalized([]) }}
                className="px-4 py-2 rounded-xl text-sm font-bold hover:opacity-70"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                Import Another File
              </button>
              <button onClick={() => router.push('/leads')}
                className="px-5 py-2 rounded-xl text-sm font-bold hover:opacity-80"
                style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                View Leads →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
