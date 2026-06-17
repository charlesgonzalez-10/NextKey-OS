'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ALL_COLUMN_DEFS, COLUMN_CATEGORIES, COLUMN_DEFS, DEFAULT_COLUMNS,
  fmt$, getLeadTypeTags,
  type ColumnDef, type Lead,
} from './column-defs'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  total: number
  highEquity: number
  thisWeek: number
  starred: number
}

type RecordType  = 'all' | 'lp' | 'probate' | 'auction' | 'tax_deed' | 'divorce'
type WorkflowTab = 'all' | 'following' | 'imported' | 'blocked'
type ViewMode    = 'table' | 'detail'

interface DrawerFilters {
  county?: string; city?: string; zip?: string
  lead_types?: string[]
  property_type?: string; beds_min?: string; baths_min?: string
  sqft_min?: string; sqft_max?: string; year_min?: string; year_max?: string
  homestead?: string; entity_type?: string; out_of_state?: boolean
  value_min?: string; value_max?: string
  equity?: string; equity_min?: string; equity_max?: string; free_clear?: boolean
  open_mortgage_max?: string; has_phone?: boolean
  file_from?: string; file_to?: string; days_min?: string; days_max?: string
  ai_score_min?: string; starred?: boolean; imported?: boolean; blocked?: boolean
}

interface LeadTemplate {
  id: string
  name: string
  emoji: string
  columns: string[]
  sortBy: string
  sortDir: string
  filters: DrawerFilters
  createdAt: string
  isPreset?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECORD_TABS: { value: RecordType; label: string; color: string }[] = [
  { value: 'all',      label: 'All',             color: '#7B8FD4' },
  { value: 'lp',       label: 'Pre-Foreclosure', color: '#f59e0b' },
  { value: 'probate',  label: 'Probate',          color: '#a78bfa' },
  { value: 'auction',  label: 'Auction',          color: '#ef4444' },
  { value: 'tax_deed', label: 'Tax Deed',         color: '#f97316' },
  { value: 'divorce',  label: 'Divorce',          color: '#6ABDE0' },
]

const PRESET_TEMPLATES: LeadTemplate[] = [
  {
    id: 'preset-mentor', name: 'Mentor Review', emoji: '', isPreset: true, createdAt: '',
    columns: ['star', 'address', 'owner', 'county', 'lead_type', 'phone_1', 'market_value', 'equity', 'known_debt', 'lien_amount', 'case_age', 'case_number', 'stage', 'score'],
    sortBy: 'lead_score', sortDir: 'desc', filters: {},
  },
  {
    id: 'preset-cold-call', name: 'Cold Call List', emoji: '', isPreset: true, createdAt: '',
    columns: ['star', 'address', 'owner', 'phone_indicator', 'phone_1', 'all_phones', 'county', 'lead_type', 'equity', 'market_value', 'stage'],
    sortBy: 'file_date', sortDir: 'desc', filters: {},
  },
  {
    id: 'preset-pre-fc', name: 'Pre-Foreclosure Review', emoji: '', isPreset: true, createdAt: '',
    columns: ['star', 'address', 'owner', 'county', 'case_age', 'case_number', 'plaintiff', 'lien_amount', 'lender', 'market_value', 'equity', 'known_debt', 'phone_indicator', 'stage'],
    sortBy: 'file_date', sortDir: 'desc', filters: { lead_types: ['pre_foreclosure'] },
  },
  {
    id: 'preset-high-equity', name: 'High Equity Leads', emoji: '', isPreset: true, createdAt: '',
    columns: ['star', 'address', 'owner', 'county', 'lead_type', 'equity', 'equity_dollar', 'equity_pct', 'market_value', 'assessed_value', 'known_debt', 'phone_indicator', 'stage'],
    sortBy: 'equity_percentage', sortDir: 'desc', filters: { equity: 'High' },
  },
  {
    id: 'preset-pipeline', name: 'Pipeline Review', emoji: '', isPreset: true, createdAt: '',
    columns: ['star', 'address', 'owner', 'county', 'lead_type', 'equity', 'market_value', 'phone_indicator', 'stage', 'score'],
    sortBy: 'lead_score', sortDir: 'desc', filters: {},
  },
]

// ─── Template storage ─────────────────────────────────────────────────────────

const LS_KEY         = 'nk_lead_templates'
const LS_DEFAULT_KEY = 'nk_lead_default_template'

function loadTemplates(): LeadTemplate[] {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}
function persistTemplates(t: LeadTemplate[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(t)) } catch { /* noop */ }
}
function loadDefaultTemplateId(): string | null {
  try { return localStorage.getItem(LS_DEFAULT_KEY) } catch { return null }
}
function getInitialViewFromDefault(): { cols: string[]; sortBy: string; sortDir: string; filters: DrawerFilters } | null {
  try {
    const id = localStorage.getItem(LS_DEFAULT_KEY)
    if (!id) return null
    const saved: LeadTemplate[] = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    const tpl = [...PRESET_TEMPLATES, ...saved].find(t => t.id === id)
    if (!tpl) return null
    return {
      cols:    tpl.columns.filter(k => COLUMN_DEFS[k]),
      sortBy:  tpl.sortBy,
      sortDir: tpl.sortDir,
      filters: tpl.filters,
    }
  } catch { return null }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFetchParams(
  search: string, filters: DrawerFilters, page: number,
  rt: RecordType, sortBy: string, sortDir: string,
  wt: WorkflowTab = 'all',
): URLSearchParams {
  const p = new URLSearchParams()
  p.set('is_lead', 'true'); p.set('page', String(page)); p.set('limit', '200')
  if (wt === 'following') p.set('starred',  'true')
  if (wt === 'imported')  p.set('imported', 'true')
  if (wt === 'blocked')   p.set('blocked',  'true')
  p.set('sort_by', sortBy); p.set('sort_dir', sortDir)
  if (rt !== 'all')              p.set('record_type', rt)
  if (search)                    p.set('search', search)
  if (filters.county)            p.set('county', filters.county)
  if (filters.city)              p.set('city', filters.city)
  if (filters.zip)               p.set('zip', filters.zip)
  if (filters.lead_types?.length) p.set('lead_types', filters.lead_types.join(','))
  if (filters.property_type)     p.set('property_type', filters.property_type)
  if (filters.beds_min)          p.set('beds_min', filters.beds_min)
  if (filters.baths_min)         p.set('baths_min', filters.baths_min)
  if (filters.sqft_min)          p.set('sqft_min', filters.sqft_min)
  if (filters.sqft_max)          p.set('sqft_max', filters.sqft_max)
  if (filters.year_min)          p.set('year_min', filters.year_min)
  if (filters.year_max)          p.set('year_max', filters.year_max)
  if (filters.homestead)         p.set('homestead', filters.homestead)
  if (filters.entity_type)       p.set('entity_type', filters.entity_type)
  if (filters.out_of_state)      p.set('out_of_state', 'true')
  if (filters.value_min)         p.set('value_min', filters.value_min)
  if (filters.value_max)         p.set('value_max', filters.value_max)
  if (filters.equity)            p.set('equity', filters.equity)
  if (filters.equity_min)        p.set('equity_min', filters.equity_min)
  if (filters.equity_max)        p.set('equity_max', filters.equity_max)
  if (filters.free_clear)        p.set('free_clear', 'true')
  if (filters.has_phone)         p.set('has_phone', 'true')
  if (filters.open_mortgage_max) p.set('open_mortgage_max', filters.open_mortgage_max)
  if (filters.file_from)         p.set('file_from', filters.file_from)
  if (filters.file_to)           p.set('file_to', filters.file_to)
  if (filters.days_min)          p.set('days_min', filters.days_min)
  if (filters.days_max)          p.set('days_max', filters.days_max)
  if (filters.ai_score_min)      p.set('ai_score_min', filters.ai_score_min)
  if (filters.starred)           p.set('starred', 'true')
  if (filters.imported)          p.set('imported', 'true')
  if (filters.blocked)           p.set('blocked',  'true')
  return p
}

function countActiveFilters(f: DrawerFilters): number {
  let n = 0
  if (f.county) n++; if (f.city) n++; if (f.zip) n++
  if (f.lead_types?.length) n++; if (f.property_type) n++
  if (f.beds_min) n++; if (f.baths_min) n++
  if (f.sqft_min || f.sqft_max) n++; if (f.year_min || f.year_max) n++
  if (f.homestead) n++; if (f.entity_type) n++; if (f.out_of_state) n++
  if (f.value_min || f.value_max) n++; if (f.equity) n++
  if (f.equity_min || f.equity_max) n++; if (f.free_clear) n++
  if (f.has_phone) n++; if (f.open_mortgage_max) n++
  if (f.file_from || f.file_to) n++; if (f.days_min || f.days_max) n++
  if (f.ai_score_min) n++; if (f.starred) n++
  return n
}

// ─── Export ───────────────────────────────────────────────────────────────────

function doExportCSV(rows: Lead[], colKeys: string[], filename: string) {
  const cols = colKeys.map(k => COLUMN_DEFS[k]).filter(Boolean) as ColumnDef[]
  const q    = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const csv  = '﻿' + [
    cols.map(c => q(c.exportHeader)).join(','),
    ...rows.map(r => cols.map(c => q(c.exportValue(r))).join(',')),
  ].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = filename + '.csv'; a.click(); URL.revokeObjectURL(a.href)
}

function doExportExcel(rows: Lead[], colKeys: string[], filename: string) {
  const cols = colKeys.map(k => COLUMN_DEFS[k]).filter(Boolean) as ColumnDef[]
  const esc  = (s: string) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const html = [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    '<head><meta charset="UTF-8"></head><body><table>',
    '<tr>' + cols.map(c => `<th>${esc(c.exportHeader)}</th>`).join('') + '</tr>',
    rows.map(r => '<tr>' + cols.map(c => `<td>${esc(c.exportValue(r))}</td>`).join('') + '</tr>').join(''),
    '</table></body></html>',
  ].join('')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' }))
  a.download = filename + '.xls'; a.click(); URL.revokeObjectURL(a.href)
}

// ─── Filter Section ───────────────────────────────────────────────────────────

function FilterSection({
  title, sectionKey, expanded, onToggle, active, children,
}: {
  title: string; sectionKey: string; expanded: boolean
  onToggle: (k: string) => void; active: boolean; children: React.ReactNode
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--c-border)' }}>
      <button onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center justify-between px-5 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: 'var(--c-primary)' }}>{title}</span>
          {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#C9A84C' }} />}
        </div>
        <svg className={`w-4 h-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

// ─── Filter Drawer ────────────────────────────────────────────────────────────

function FilterDrawer({ open, onClose, onApply, applied }: {
  open: boolean; onClose: () => void; onApply: (f: DrawerFilters) => void; applied: DrawerFilters
}) {
  const [draft, setDraft]       = useState<DrawerFilters>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['location', 'lead_types']))

  useEffect(() => { if (open) setDraft({ ...applied }) }, [open, applied])

  const toggle = (k: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s })

  const set = <K extends keyof DrawerFilters>(key: K, value: DrawerFilters[K] | '') =>
    setDraft(prev => ({ ...prev, [key]: value === '' ? undefined : value }))

  const toggleLT = (v: string) => {
    const cur = draft.lead_types ?? []
    set('lead_types', cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v])
  }

  const clearAll = () => { setDraft({}); onApply({}); onClose() }
  const activeCount = countActiveFilters(draft)
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-40 w-full max-w-[360px] flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--c-card)', borderLeft: '1px solid var(--c-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>Filters</h2>
            {activeCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>{activeCount}</span>
            )}
          </div>
          <button onClick={onClose} className="hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <FilterSection title="Location" sectionKey="location" expanded={expanded.has('location')}
            onToggle={toggle} active={!!(draft.county || draft.city || draft.zip)}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--c-text-3)' }}>County</p>
            <div className="flex gap-2 mb-4 flex-wrap">
              {[{ v: 'miami-dade', l: 'Miami-Dade', c: '#7B8FD4' }, { v: 'broward', l: 'Broward', c: '#4CAF9A' }, { v: 'palm-beach', l: 'Palm Beach', c: '#C9A84C' }].map(({ v, l, c }) => (
                <button key={v} onClick={() => set('county', draft.county === v ? '' : v)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                  style={{ backgroundColor: draft.county === v ? `${c}22` : 'var(--c-hover)', color: draft.county === v ? c : 'var(--c-text-2)', border: `1px solid ${draft.county === v ? c : 'var(--c-border)'}` }}>
                  {l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[{ k: 'city' as const, p: 'Miami' }, { k: 'zip' as const, p: '33101' }].map(({ k, p }) => (
                <div key={k}>
                  <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>{k === 'city' ? 'City' : 'ZIP'}</label>
                  <input value={draft[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={p}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                </div>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="Lead Types" sectionKey="lead_types" expanded={expanded.has('lead_types')}
            onToggle={toggle} active={!!(draft.lead_types?.length)}>
            <div className="flex flex-col gap-2.5">
              {[{ v: 'pre_foreclosure', l: 'Pre-Foreclosure', c: '#f59e0b' }, { v: 'probate', l: 'Probate', c: '#a78bfa' }, { v: 'auction', l: 'Auction', c: '#ef4444' }, { v: 'tax_deed', l: 'Tax Deed', c: '#f97316' }, { v: 'divorce', l: 'Divorce', c: '#6ABDE0' }].map(({ v, l, c }) => {
                const checked = draft.lead_types?.includes(v) ?? false
                return (
                  <label key={v} className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={() => toggleLT(v)} style={{ accentColor: c }} />
                    <span className="text-xs font-semibold" style={{ color: checked ? c : 'var(--c-text-2)' }}>{l}</span>
                  </label>
                )
              })}
            </div>
          </FilterSection>

          <FilterSection title="Property Attributes" sectionKey="property" expanded={expanded.has('property')}
            onToggle={toggle} active={!!(draft.property_type || draft.beds_min || draft.baths_min || draft.sqft_min || draft.sqft_max || draft.year_min || draft.year_max)}>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Property Type</label>
                <select value={draft.property_type ?? ''} onChange={e => set('property_type', e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                  <option value="">Any</option>
                  {['SFR','Condo','Townhome','Multi-Family','Land'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[{ k: 'beds_min' as const, l: 'Min Beds', opts: [1,2,3,4,5] }, { k: 'baths_min' as const, l: 'Min Baths', opts: [1,2,3,4] }].map(({ k, l, opts }) => (
                  <div key={k}>
                    <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>{l}</label>
                    <select value={draft[k] ?? ''} onChange={e => set(k, e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                      <option value="">Any</option>
                      {opts.map(n => <option key={n} value={String(n)}>{n}+</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {[{ la: 'Sqft Range', ka: 'sqft_min' as const, kb: 'sqft_max' as const, pa: 'Min', pb: 'Max', t: 'number' as const }, { la: 'Year Built', ka: 'year_min' as const, kb: 'year_max' as const, pa: 'From', pb: 'To', t: 'number' as const }].map(({ la, ka, kb, pa, pb }) => (
                <div key={la}>
                  <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>{la}</label>
                  <div className="flex items-center gap-2">
                    <input value={draft[ka] ?? ''} onChange={e => set(ka, e.target.value)} placeholder={pa} type="number"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                    <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>–</span>
                    <input value={draft[kb] ?? ''} onChange={e => set(kb, e.target.value)} placeholder={pb} type="number"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  </div>
                </div>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="Ownership Info" sectionKey="ownership" expanded={expanded.has('ownership')}
            onToggle={toggle} active={!!(draft.homestead || draft.entity_type || draft.out_of_state)}>
            <div className="space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={draft.homestead === 'false'} style={{ accentColor: '#C9A84C' }}
                  onChange={e => set('homestead', e.target.checked ? 'false' : '')} />
                <span className="text-xs font-semibold" style={{ color: draft.homestead === 'false' ? '#C9A84C' : 'var(--c-text-2)' }}>Absentee Owner Only</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!draft.out_of_state} style={{ accentColor: '#C9A84C' }}
                  onChange={e => set('out_of_state', e.target.checked || undefined)} />
                <span className="text-xs font-semibold" style={{ color: draft.out_of_state ? '#C9A84C' : 'var(--c-text-2)' }}>Out-of-State Owner</span>
              </label>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Entity Type</label>
                <select value={draft.entity_type ?? ''} onChange={e => set('entity_type', e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                  <option value="">Any</option>
                  {['LLC','Corp','Trust','Estate','Individual'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </FilterSection>

          <FilterSection title="Sales and Value" sectionKey="value" expanded={expanded.has('value')}
            onToggle={toggle} active={!!(draft.value_min || draft.value_max || draft.equity || draft.equity_min || draft.equity_max || draft.free_clear)}>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Estimated Value</label>
                <div className="flex items-center gap-2">
                  {[{ k: 'value_min' as const, p: 'Min $' }, { k: 'value_max' as const, p: 'Max $' }].map(({ k, p }) => (
                    <input key={k} value={draft[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={p} type="number"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Equity Tier</label>
                <div className="flex gap-2 flex-wrap">
                  {[{ v: 'High', c: '#4CAF9A' }, { v: 'Medium', c: '#C9A84C' }, { v: 'Low', c: '#7B8FD4' }].map(({ v, c }) => (
                    <button key={v} onClick={() => set('equity', draft.equity === v ? '' : v)}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                      style={{ backgroundColor: draft.equity === v ? `${c}22` : 'var(--c-hover)', color: draft.equity === v ? c : 'var(--c-text-2)', border: `1px solid ${draft.equity === v ? c : 'var(--c-border)'}` }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Equity %</label>
                <div className="flex items-center gap-2">
                  {[{ k: 'equity_min' as const, p: 'Min %' }, { k: 'equity_max' as const, p: 'Max %' }].map(({ k, p }) => (
                    <input key={k} value={draft[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={p} type="number" min="0" max="100"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!draft.free_clear} style={{ accentColor: '#4CAF9A' }}
                  onChange={e => set('free_clear', e.target.checked || undefined)} />
                <span className="text-xs font-semibold" style={{ color: draft.free_clear ? '#4CAF9A' : 'var(--c-text-2)' }}>Free &amp; Clear</span>
              </label>
            </div>
          </FilterSection>

          <FilterSection title="Mortgage Info" sectionKey="mortgage" expanded={expanded.has('mortgage')}
            onToggle={toggle} active={!!(draft.open_mortgage_max || draft.has_phone)}>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Max Open Mortgage</label>
                <input value={draft.open_mortgage_max ?? ''} onChange={e => set('open_mortgage_max', e.target.value)}
                  placeholder="e.g. 200000" type="number" className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!draft.has_phone} style={{ accentColor: '#4CAF9A' }}
                  onChange={e => set('has_phone', e.target.checked || undefined)} />
                <span className="text-xs font-semibold" style={{ color: draft.has_phone ? '#4CAF9A' : 'var(--c-text-2)' }}>Has Phone Number</span>
              </label>
            </div>
          </FilterSection>

          <FilterSection title="Tax Info" sectionKey="tax" expanded={expanded.has('tax')}
            onToggle={toggle} active={!!(draft.file_from || draft.file_to || draft.days_min || draft.days_max)}>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Case Filed Date</label>
                <div className="flex items-center gap-2">
                  {[{ k: 'file_from' as const }, { k: 'file_to' as const }].map(({ k }) => (
                    <input key={k} value={draft[k] ?? ''} onChange={e => set(k, e.target.value)} type="date"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Case Age (days)</label>
                <div className="flex items-center gap-2">
                  {[{ k: 'days_min' as const, p: 'Min' }, { k: 'days_max' as const, p: 'Max' }].map(({ k, p }) => (
                    <input key={k} value={draft[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={p} type="number"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
                  ))}
                </div>
              </div>
            </div>
          </FilterSection>

          <FilterSection title="AI Score" sectionKey="ai" expanded={expanded.has('ai')}
            onToggle={toggle} active={!!(draft.ai_score_min || draft.starred)}>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Minimum AI Score (0–100)</label>
                <input value={draft.ai_score_min ?? ''} onChange={e => set('ai_score_min', e.target.value)}
                  placeholder="e.g. 60" type="number" min="0" max="100"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!draft.starred} style={{ accentColor: '#C9A84C' }}
                  onChange={e => set('starred', e.target.checked || undefined)} />
                <span className="text-xs font-semibold" style={{ color: draft.starred ? '#C9A84C' : 'var(--c-text-2)' }}>★ Starred Only</span>
              </label>
            </div>
          </FilterSection>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--c-border)' }}>
          <button onClick={clearAll} className="text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            Clear All
          </button>
          <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            Cancel
          </button>
          <button onClick={() => { onApply(draft); onClose() }}
            className="flex-1 text-xs font-bold py-2 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            Apply Filters
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Column Picker Drawer ─────────────────────────────────────────────────────

function ColumnPickerDrawer({ open, onClose, colOrder, onChange }: {
  open: boolean; onClose: () => void; colOrder: string[]; onChange: (cols: string[]) => void
}) {
  const [draft, setDraft] = useState<string[]>([])
  useEffect(() => { if (open) setDraft([...colOrder]) }, [open, colOrder])

  const move   = (idx: number, dir: -1 | 1) => {
    const next = [...draft]; const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]; setDraft(next)
  }
  const remove = (key: string) => setDraft(d => d.filter(k => k !== key))
  const add    = (key: string) => setDraft(d => d.includes(key) ? d : [...d, key])
  const reset  = () => setDraft([...DEFAULT_COLUMNS])

  const hidden = ALL_COLUMN_DEFS.filter(c => !draft.includes(c.key))
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-40 w-full max-w-[380px] flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--c-card)', borderLeft: '1px solid var(--c-border)' }}>

        <div className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>Columns</h2>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(107,189,224,0.15)', color: '#6ABDE0' }}>
              {draft.length} active
            </span>
          </div>
          <button onClick={onClose} className="hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Visible columns */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                Visible ({draft.length})
              </p>
              <button onClick={reset} className="text-[10px] font-semibold hover:opacity-70" style={{ color: '#C9A84C' }}>
                Reset to Default
              </button>
            </div>
            <div className="space-y-1">
              {draft.map((key, idx) => {
                const col = COLUMN_DEFS[key]
                if (!col) return null
                return (
                  <div key={key} className="flex items-center gap-2 px-2.5 py-2 rounded-lg group"
                    style={{ backgroundColor: 'var(--c-hover)' }}>
                    <span className="text-[11px] font-semibold flex-1 truncate" style={{ color: 'var(--c-primary)' }}>
                      {col.label}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0}
                        className="w-5 h-5 rounded flex items-center justify-center text-[11px] disabled:opacity-30 hover:opacity-70"
                        style={{ color: 'var(--c-text-3)' }}>↑</button>
                      <button onClick={() => move(idx, 1)} disabled={idx === draft.length - 1}
                        className="w-5 h-5 rounded flex items-center justify-center text-[11px] disabled:opacity-30 hover:opacity-70"
                        style={{ color: 'var(--c-text-3)' }}>↓</button>
                      <button onClick={() => remove(key)}
                        className="w-5 h-5 rounded flex items-center justify-center text-sm ml-0.5 hover:opacity-70"
                        style={{ color: '#ef4444' }}>×</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Add columns */}
          {hidden.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-3)' }}>
                Add Column
              </p>
              {COLUMN_CATEGORIES.map(cat => {
                const catCols = hidden.filter(c => c.category === cat.key)
                if (catCols.length === 0) return null
                return (
                  <div key={cat.key} className="mb-4">
                    <p className="text-[10px] font-bold mb-2" style={{ color: 'var(--c-text-3)' }}>{cat.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {catCols.map(col => (
                        <button key={col.key} onClick={() => add(col.key)}
                          className="text-[10px] font-semibold px-2 py-1 rounded-full border hover:opacity-80"
                          style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', borderColor: 'var(--c-border)' }}>
                          + {col.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--c-border)' }}>
          <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            Cancel
          </button>
          <button onClick={() => { onChange(draft); onClose() }}
            className="flex-1 text-xs font-bold py-2 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            Apply Columns
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Save Template Modal ──────────────────────────────────────────────────────

function SaveTemplateModal({ open, onClose, colOrder, filters, sortBy, sortDir, onSave }: {
  open: boolean; onClose: () => void; colOrder: string[]; filters: DrawerFilters
  sortBy: string; sortDir: string; onSave: (t: LeadTemplate) => void
}) {
  const [name, setName]   = useState('')

  if (!open) return null

  const save = () => {
    if (!name.trim()) return
    onSave({ id: crypto.randomUUID(), name: name.trim(), emoji: '', columns: colOrder, sortBy, sortDir, filters, createdAt: new Date().toISOString() })
    setName(''); onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--c-primary)' }}>Save View as Template</h2>
          <div className="mb-3">
            <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Template Name</label>
            <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="e.g. Mentor Review" autoFocus
              className="w-full text-sm px-3 py-2 rounded-lg focus:outline-none"
              style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
          </div>
          <p className="text-[10px] mb-5" style={{ color: 'var(--c-text-3)' }}>
            Saves {colOrder.length} columns · current filters · sort by {sortBy}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 text-xs font-semibold py-2 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={save} disabled={!name.trim()}
              className="flex-1 text-xs font-bold py-2 rounded-lg hover:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
              Save Template
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Offer Calculator Modal ───────────────────────────────────────────────────

function OfferCalculatorModal({ lead, onClose, onSave }: {
  lead: Lead
  onClose: () => void
  onSave: (id: string, pct: number, amount: number) => void
}) {
  const [pct,  setPct]  = useState<number>(lead.offer_pct ?? 65)
  const [base, setBase] = useState<'market' | 'arv' | 'custom'>('market')
  const [customVal, setCustomVal] = useState('')
  const [saving, setSaving] = useState(false)

  const mv = Number(lead.market_value || lead.assessed_value || 0)
  const baseVal = base === 'market' ? mv : base === 'custom' ? Number(customVal) || 0 : mv
  const offer   = baseVal ? Math.round(baseVal * pct / 100) : 0

  const fmt = (n: number) => n ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'

  const save = async () => {
    if (!offer) return
    setSaving(true)
    await fetch(`/api/leads/${lead.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer_pct: pct, offer_amount: offer }),
    })
    onSave(lead.id, pct, offer)
    setSaving(false)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(201,168,76,0.06)' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>Make Offer</p>
              <p className="text-[11px] mt-0.5 truncate max-w-[240px]" style={{ color: 'var(--c-text-3)' }}>
                {lead.property_address}
              </p>
            </div>
            <button onClick={onClose} style={{ color: 'var(--c-text-3)', fontSize: 20, lineHeight: 1 }}>×</button>
          </div>

          <div className="px-5 py-5 space-y-4">
            {/* Base value selector */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>
                Base Value
              </p>
              <div className="flex gap-2">
                {[
                  { v: 'market' as const, label: 'Market Value' },
                  { v: 'arv'    as const, label: 'ARV' },
                  { v: 'custom' as const, label: 'Custom' },
                ].map(({ v, label }) => (
                  <button key={v} onClick={() => setBase(v)}
                    className="flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all"
                    style={{
                      backgroundColor: base === v ? '#C9A84C' : 'var(--c-hover)',
                      color: base === v ? '#0A1F44' : 'var(--c-text-2)',
                      border: `1px solid ${base === v ? '#C9A84C' : 'var(--c-border)'}`,
                    }}>
                    {label}
                  </button>
                ))}
              </div>
              {base === 'custom' ? (
                <input
                  type="number" value={customVal} onChange={e => setCustomVal(e.target.value)}
                  placeholder="Enter value…"
                  className="w-full mt-2 text-sm px-3 py-2 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                />
              ) : (
                <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--c-text-2)' }}>
                  {fmt(baseVal)} {base === 'market' ? '(from records)' : ''}
                </p>
              )}
            </div>

            {/* Offer % */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>
                Offer %
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {[50, 55, 60, 65, 70, 75].map(n => (
                  <button key={n} onClick={() => setPct(n)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      backgroundColor: pct === n ? '#C9A84C' : 'var(--c-hover)',
                      color: pct === n ? '#0A1F44' : 'var(--c-text-2)',
                      border: `1px solid ${pct === n ? '#C9A84C' : 'var(--c-border)'}`,
                    }}>
                    {n}%
                  </button>
                ))}
              </div>
              <input
                type="range" min={30} max={90} step={1} value={pct}
                onChange={e => setPct(Number(e.target.value))}
                className="w-full mt-2" style={{ accentColor: '#C9A84C' }}
              />
            </div>

            {/* Calculated amount */}
            <div className="rounded-xl p-4 text-center"
              style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)' }}>
              <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--c-text-3)' }}>
                {pct}% × {fmt(baseVal)}
              </p>
              <p className="text-2xl font-bold" style={{ color: '#C9A84C' }}>{fmt(offer)}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--c-text-3)' }}>Offer Amount</p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-5 pb-5">
            <button onClick={onClose}
              className="flex-1 text-xs font-semibold py-2 rounded-lg"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={save} disabled={!offer || saving}
              className="flex-1 text-xs font-bold py-2 rounded-lg disabled:opacity-40"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              {saving ? 'Saving…' : 'Save Offer'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Quick Note Modal ─────────────────────────────────────────────────────────

function QuickNoteModal({ lead, onClose, onSaved }: {
  lead: Lead
  onClose: () => void
  onSaved: () => void
}) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!body.trim()) return
    setSaving(true)
    await fetch(`/api/leads/${lead.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim() }),
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl shadow-2xl"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--c-border)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>Quick Note</p>
            <button onClick={onClose} style={{ color: 'var(--c-text-3)', fontSize: 20 }}>×</button>
          </div>
          <div className="px-5 py-4">
            <p className="text-[11px] mb-3 truncate" style={{ color: 'var(--c-text-3)' }}>{lead.property_address}</p>
            <textarea
              value={body} onChange={e => setBody(e.target.value)}
              placeholder="Add a note…" rows={4} autoFocus
              className="w-full text-sm px-3 py-2 rounded-lg focus:outline-none resize-none"
              style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            />
          </div>
          <div className="flex gap-2 px-5 pb-5">
            <button onClick={onClose}
              className="flex-1 text-xs font-semibold py-2 rounded-lg"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={save} disabled={!body.trim() || saving}
              className="flex-1 text-xs font-bold py-2 rounded-lg disabled:opacity-40"
              style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Dynamic Row ──────────────────────────────────────────────────────────────

function DynamicRow({ lead, selected, onSelect, onStar, onClick, onDelete, columns, renderCtx, onMakeOffer, onQuickNote }: {
  lead: Lead; selected: boolean; columns: string[]
  onSelect:    (id: string, v: boolean) => void
  onStar:      (id: string, v: boolean) => void
  onClick:     (id: string) => void
  onDelete:    (id: string) => void
  onMakeOffer: (lead: Lead) => void
  onQuickNote: (lead: Lead) => void
  renderCtx:   import('./column-defs').RenderCtx
}) {
  return (
    <tr
      onClick={() => onClick(lead.id)}
      className="group cursor-pointer transition-colors hover:bg-yellow-50/30"
      style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: selected ? 'rgba(201,168,76,0.06)' : undefined }}>

      <td className="pl-4 pr-2 py-3 w-8" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={e => onSelect(lead.id, e.target.checked)}
          className="rounded" style={{ accentColor: '#C9A84C' }} />
      </td>

      {columns.map(key => {
        const col = COLUMN_DEFS[key]
        return col ? col.renderTd(lead, renderCtx) : null
      })}

      {/* Row quick-action buttons (visible on hover) */}
      <td className="py-2 pr-3 w-32" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
          {/* Call */}
          {lead.phone_1 && (
            <a href={`tel:${lead.phone_1}`}
              title={`Call ${lead.phone_1}`}
              className="p-1.5 rounded-lg hover:bg-green-500/10 transition-colors"
              style={{ color: '#4CAF9A' }}
              onClick={e => e.stopPropagation()}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>
              </svg>
            </a>
          )}
          {/* Make Offer */}
          <button onClick={() => onMakeOffer(lead)}
            title="Make Offer"
            className="p-1.5 rounded-lg hover:bg-yellow-500/10 transition-colors"
            style={{ color: '#C9A84C' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
          </button>
          {/* Quick Note */}
          <button onClick={() => onQuickNote(lead)}
            title="Add Note"
            className="p-1.5 rounded-lg hover:bg-blue-500/10 transition-colors"
            style={{ color: '#6ABDE0' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          {/* Delete */}
          <button onClick={() => onDelete(lead.id)}
            title="Delete lead"
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            style={{ color: 'rgba(239,68,68,0.5)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Offer pct localStorage helper ───────────────────────────────────────────

const LS_OFFER_KEY = 'nk_offer_pct_map'
function loadOfferPctMap(): Record<string, number> {
  try { const s = localStorage.getItem(LS_OFFER_KEY); return s ? JSON.parse(s) : {} } catch { return {} }
}
function persistOfferPct(map: Record<string, number>) {
  try { localStorage.setItem(LS_OFFER_KEY, JSON.stringify(map)) } catch { /* noop */ }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LeadsClient({ initialStats }: { initialStats: Stats }) {
  const router = useRouter()

  const [leads, setLeads]     = useState<Lead[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pages, setPages]     = useState(1)
  const [loading, setLoading] = useState(true)
  const [stats, setStats]     = useState(initialStats)

  const [searchInput, setSearchInput] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [recordType, setRecordType] = useState<RecordType>('all')
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('all')
  const [viewMode, setViewMode]       = useState<ViewMode>('table')
  const [sortBy, setSortBy]         = useState<string>(() => getInitialViewFromDefault()?.sortBy  ?? 'file_date')
  const [sortDir, setSortDir]       = useState<'desc' | 'asc'>(() => (getInitialViewFromDefault()?.sortDir as 'asc' | 'desc') ?? 'desc')

  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [appliedFilters, setAppliedFilters]     = useState<DrawerFilters>(() => getInitialViewFromDefault()?.filters ?? {})

  const [colOrder, setColOrder]         = useState<string[]>(() => getInitialViewFromDefault()?.cols ?? DEFAULT_COLUMNS)
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templates, setTemplates]       = useState<LeadTemplate[]>([])
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(() => loadDefaultTemplateId())
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen]     = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [bulkStaging, setBulkStaging]     = useState(false)
  const [listError, setListError]         = useState<string | null>(null)

  // Offer / note modals
  const [offerLead,   setOfferLead]   = useState<Lead | null>(null)
  const [noteLead,    setNoteLead]    = useState<Lead | null>(null)
  // Offer % per lead (locally cached + persisted to DB)
  const [offerPctMap, setOfferPctMap] = useState<Record<string, number>>({})

  // Load templates and offer pct map from localStorage on mount
  useEffect(() => {
    setTemplates(loadTemplates())
    setOfferPctMap(loadOfferPctMap())
  }, [])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async (
    filters: DrawerFilters, search: string, p: number,
    rt: RecordType = recordType, wt: WorkflowTab = workflowTab,
  ) => {
    setLoading(true)
    const params = buildFetchParams(search, filters, p, rt, sortBy, sortDir, wt)
    try {
      const res  = await fetch(`/api/properties?${params}`)
      const data = await res.json()
      setLeads(data.properties || data.leads || [])
      setTotal(data.total || 0)
      setPage(data.page  || 1)
      setPages(data.pages || 1)
    } catch { setListError('Failed to load leads — check your connection and try again.') }
    finally { setLoading(false) }
  }, [sortBy, sortDir, recordType])

  useEffect(() => { fetchLeads(appliedFilters, searchInput, 1, recordType, workflowTab) }, [sortBy, sortDir, recordType, workflowTab]) // eslint-disable-line

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => fetchLeads(appliedFilters, value, 1), 300)
  }

  const applyFilters = (f: DrawerFilters) => { setAppliedFilters(f); fetchLeads(f, searchInput, 1) }

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = (id: string, v: boolean) =>
    setSelected(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s })
  const selectAll  = () => setSelected(new Set(leads.map(l => l.id)))
  const clearSelect = () => setSelected(new Set())

  // ── Star ──────────────────────────────────────────────────────────────────

  const handleStar = (id: string, starred: boolean) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, starred } : l))
    setStats(prev => ({ ...prev, starred: starred ? prev.starred + 1 : Math.max(0, prev.starred - 1) }))
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const exportRows = selected.size > 0 ? leads.filter(l => selected.has(l.id)) : leads
  const dateStr    = new Date().toISOString().slice(0, 10)

  const handleExportCSV   = () => { doExportCSV(exportRows, colOrder, `leads-${dateStr}`);   setExportMenuOpen(false) }
  const handleExportExcel = () => { doExportExcel(exportRows, colOrder, `leads-${dateStr}`); setExportMenuOpen(false) }
  const handleExportAllFieldsCSV = () => {
    doExportCSV(exportRows, ALL_COLUMN_DEFS.map(c => c.key), `leads-all-fields-${dateStr}`)
    setExportMenuOpen(false)
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  const applyTemplate = (t: LeadTemplate) => {
    setColOrder(t.columns.filter(k => COLUMN_DEFS[k]))
    setAppliedFilters(t.filters)
    setSortBy(t.sortBy)
    setSortDir(t.sortDir as 'asc' | 'desc')
    fetchLeads(t.filters, searchInput, 1)
    setTemplateMenuOpen(false)
  }

  const saveTemplate = (t: LeadTemplate) => {
    const next = [...templates, t]
    setTemplates(next)
    persistTemplates(next)
  }

  const deleteTemplate = (id: string) => {
    const next = templates.filter(t => t.id !== id)
    setTemplates(next)
    persistTemplates(next)
    if (defaultTemplateId === id) {
      localStorage.removeItem(LS_DEFAULT_KEY)
      setDefaultTemplateId(null)
    }
  }

  const setDefaultTemplate = (id: string) => {
    localStorage.setItem(LS_DEFAULT_KEY, id)
    setDefaultTemplateId(id)
    setTemplateMenuOpen(false)
  }

  const removeDefaultTemplate = () => {
    localStorage.removeItem(LS_DEFAULT_KEY)
    setDefaultTemplateId(null)
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteSelected = async () => {
    if (selected.size === 0) return
    setDeleting(true)
    const results = await Promise.all(Array.from(selected).map(id =>
      fetch(`/api/leads/${id}`, { method: 'DELETE' }).then(r => ({ id, ok: r.ok })).catch(() => ({ id, ok: false }))
    ))
    const deletedIds = new Set(results.filter(r => r.ok).map(r => r.id))
    if (deletedIds.size > 0) setLeads(prev => prev.filter(l => !deletedIds.has(l.id)))
    const failed = results.length - deletedIds.size
    if (failed > 0) setListError(`${failed} lead${failed > 1 ? 's' : ''} could not be deleted.`)
    setSelected(new Set()); setDeleteConfirm(false); setDeleting(false)
  }

  const bulkSetStage = async (stage: string) => {
    if (selected.size === 0) return
    setBulkStaging(true)
    const results = await Promise.all(Array.from(selected).map(id =>
      fetch(`/api/leads/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: stage }),
      }).then(r => ({ id, ok: r.ok })).catch(() => ({ id, ok: false }))
    ))
    const succeededIds = new Set(results.filter(r => r.ok).map(r => r.id))
    if (succeededIds.size > 0) setLeads(prev => prev.map(l => succeededIds.has(l.id) ? { ...l, pipeline_stage: stage } : l))
    const failed = results.length - succeededIds.size
    if (failed > 0) setListError(`${failed} lead${failed > 1 ? 's' : ''} could not be updated.`)
    setSelected(new Set())
    setBulkStaging(false)
  }

  const deleteSingle = async (id: string) => {
    await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    setLeads(prev => prev.filter(l => l.id !== id))
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  // ── Field change (call/sms/email status, offer pct) ──────────────────────

  const handleFieldChange = useCallback(async (id: string, field: string, value: string | number | boolean | null) => {
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l))
    if (field === 'offer_pct') {
      const next = { ...offerPctMap }
      if (value == null) delete next[id]
      else next[id] = value as number
      setOfferPctMap(next)
      persistOfferPct(next)
    }
    await fetch(`/api/leads/${id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
  }, [offerPctMap])

  // ── Offer save callback ───────────────────────────────────────────────────

  const handleOfferSave = useCallback((id: string, pct: number, amount: number) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, offer_pct: pct, offer_amount: amount } : l))
    const next = { ...offerPctMap, [id]: pct }
    setOfferPctMap(next)
    persistOfferPct(next)
  }, [offerPctMap])

  // ── Bulk block ────────────────────────────────────────────────────────────

  const bulkBlock = async () => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    const results = await Promise.all(ids.map(id =>
      fetch(`/api/leads/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: true, pipeline_stage: 'blocked' }),
      }).then(r => ({ id, ok: r.ok })).catch(() => ({ id, ok: false }))
    ))
    const done = new Set(results.filter(r => r.ok).map(r => r.id))
    setLeads(prev => prev.map(l => done.has(l.id) ? { ...l, blocked: true, pipeline_stage: 'blocked' } : l))
    setSelected(new Set())
  }

  const allSelected   = leads.length > 0 && selected.size === leads.length
  const activeFilters = countActiveFilters(appliedFilters)
  const isCustomCols  = colOrder.join(',') !== DEFAULT_COLUMNS.join(',')

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--c-primary)' }}>

      {/* Header */}
      <div className="px-4 md:px-8 pt-5 pb-3"
        style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--c-primary)' }}>My Leads</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                <span className="font-bold" style={{ color: 'var(--c-primary)' }}>{stats.total.toLocaleString()}</span> total
              </span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                <span className="font-bold" style={{ color: '#4CAF9A' }}>{stats.highEquity.toLocaleString()}</span> high equity
              </span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                <span className="font-bold" style={{ color: '#C9A84C' }}>{stats.thisWeek.toLocaleString()}</span> this week
              </span>
            </div>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center rounded-xl overflow-hidden shadow-sm"
          style={{ border: '2px solid var(--c-primary)', backgroundColor: 'var(--c-card)' }}>
          <div className="pl-4 pr-2 shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ color: loading ? '#C9A84C' : 'var(--c-primary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
          </div>
          <input type="text" value={searchInput} onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setSearchInput(''); handleSearchChange('') }
              else if (e.key === 'Enter') fetchLeads(appliedFilters, searchInput, 1)
            }}
            placeholder="Search address, owner, case #, folio, phone, city, ZIP…"
            className="flex-1 py-3 pr-3 text-sm md:text-base bg-transparent focus:outline-none"
            style={{ color: 'var(--c-primary)' }} />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); handleSearchChange('') }}
              className="px-3 py-3 shrink-0 hover:opacity-60" style={{ color: 'var(--c-text-3)' }}>✕</button>
          )}
          {searchInput && (
            <button onClick={() => router.push(`/leads/property?q=${encodeURIComponent(searchInput)}`)}
              className="px-3 py-3 text-[11px] font-bold shrink-0 border-l hover:opacity-80 whitespace-nowrap"
              style={{ borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
              Lookup
            </button>
          )}
          <button onClick={() => fetchLeads(appliedFilters, searchInput, 1)}
            className="px-4 py-3 text-sm font-bold shrink-0 hover:opacity-80"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            Search
          </button>
        </div>

        {/* Workflow tabs + Record type tabs row */}
        <div className="flex flex-col gap-2 mt-3">
          {/* Workflow tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {([
              { value: 'all'       as WorkflowTab, label: 'All Leads',  color: '#7B8FD4' },
              { value: 'following' as WorkflowTab, label: `Following ${stats.starred > 0 ? `(${stats.starred})` : ''}`, color: '#C9A84C' },
              { value: 'imported'  as WorkflowTab, label: 'Imported',   color: '#4CAF9A' },
              { value: 'blocked'   as WorkflowTab, label: 'Blocked',    color: '#9ca3af' },
            ] as { value: WorkflowTab; label: string; color: string }[]).map(tab => {
              const active = workflowTab === tab.value
              return (
                <button key={tab.value} onClick={() => setWorkflowTab(tab.value)}
                  className="text-[11px] font-bold px-3 py-1 rounded-full transition-all whitespace-nowrap"
                  style={{
                    backgroundColor: active ? tab.color : 'transparent',
                    color:           active ? (tab.value === 'following' ? '#0A1F44' : '#fff') : 'var(--c-text-2)',
                    border:          `1px solid ${active ? tab.color : 'var(--c-border)'}`,
                  }}>
                  {tab.label}
                </button>
              )
            })}
            {/* View mode toggle */}
            <div className="ml-auto flex items-center gap-1">
              {([
                { mode: 'table' as ViewMode, icon: '☰', title: 'Table view' },
                { mode: 'detail' as ViewMode, icon: '▦', title: 'Card view' },
              ] as { mode: ViewMode; icon: string; title: string }[]).map(({ mode, icon, title }) => (
                <button key={mode} onClick={() => setViewMode(mode)} title={title}
                  className="text-xs font-bold w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: viewMode === mode ? 'var(--c-primary)' : 'var(--c-hover)',
                    color: viewMode === mode ? '#C9A84C' : 'var(--c-text-3)',
                    border: '1px solid var(--c-border)',
                  }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          {/* Record type tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {RECORD_TABS.map(tab => {
              const active = recordType === tab.value
              return (
                <button key={tab.value} onClick={() => setRecordType(tab.value)}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all whitespace-nowrap"
                  style={{
                    backgroundColor: active ? tab.color : 'var(--c-hover)',
                    color:           active ? '#fff'    : 'var(--c-text-2)',
                    border:          `1px solid ${active ? tab.color : 'var(--c-border)'}`,
                    opacity:         tab.value === 'tax_deed' || tab.value === 'divorce' ? (active ? 1 : 0.6) : 1,
                  }}>
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 overflow-auto">

        {/* Toolbar */}
        <div className="sticky top-0 z-10 px-4 md:px-8 py-2 flex items-center gap-2 flex-wrap"
          style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>

          {/* Select All */}
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <input type="checkbox" checked={allSelected}
              onChange={e => e.target.checked ? selectAll() : clearSelect()}
              style={{ accentColor: '#C9A84C' }} />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>
              {selected.size > 0 ? `${selected.size} selected` : 'Select All'}
            </span>
          </label>

          {/* Selection count */}
          {selected.size > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
              {selected.size} selected
            </span>
          )}

          {/* Result count */}
          <span className="text-[11px] font-semibold ml-auto" style={{ color: 'var(--c-text-3)' }}>
            {loading ? 'Loading…' : `${total.toLocaleString()} lead${total !== 1 ? 's' : ''}`}
            {activeFilters > 0 && ` · ${activeFilters} filter${activeFilters !== 1 ? 's' : ''}`}
          </span>

          {/* Sort */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Sort:</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="text-[11px] font-semibold rounded-lg px-2 py-1 focus:outline-none"
              style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
              <option value="file_date">Filed Date</option>
              <option value="equity_percentage">Equity %</option>
              <option value="market_value">Value</option>
              <option value="lead_score">AI Score</option>
            </select>
            <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
              className="text-[11px] px-2 py-1 rounded-lg"
              style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
              {sortDir === 'desc' ? '↓' : '↑'}
            </button>
          </div>

          {/* Columns button */}
          <button onClick={() => setColPickerOpen(true)}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80 shrink-0 transition-all"
            style={{
              backgroundColor: isCustomCols ? 'rgba(107,189,224,0.15)' : 'var(--c-hover)',
              color:           isCustomCols ? '#6ABDE0'                : 'var(--c-text-2)',
              border:          `1px solid ${isCustomCols ? '#6ABDE0' : 'var(--c-border)'}`,
            }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
            Columns
            {isCustomCols && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded-full"
                style={{ backgroundColor: '#6ABDE0', color: '#0A1F44' }}>{colOrder.length}</span>
            )}
          </button>

          {/* Templates dropdown */}
          <div className="relative shrink-0">
            <button onClick={() => setTemplateMenuOpen(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Templates
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {templateMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setTemplateMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl shadow-2xl overflow-hidden"
                  style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>

                  {/* Default indicator */}
                  {defaultTemplateId && (
                    <div className="flex items-center justify-between px-3 py-2"
                      style={{ backgroundColor: 'rgba(201,168,76,0.08)', borderBottom: '1px solid var(--c-border)' }}>
                      <span className="text-[10px] font-bold" style={{ color: '#C9A84C' }}>
                        ★ Default view active
                      </span>
                      <button onClick={removeDefaultTemplate}
                        className="text-[10px] hover:underline" style={{ color: 'var(--c-text-3)' }}>
                        Clear
                      </button>
                    </div>
                  )}

                  <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Presets</p>
                  </div>
                  {PRESET_TEMPLATES.map(t => {
                    const isDefault = defaultTemplateId === t.id
                    return (
                      <div key={t.id} className="flex items-center group"
                        style={{ borderBottom: '1px solid var(--c-border)' }}>
                        <button onClick={() => applyTemplate(t)}
                          className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left hover:opacity-80">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                            style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                            {t.name[0]?.toUpperCase() ?? 'T'}
                          </span>
                          <span className="text-[11px] font-semibold flex-1" style={{ color: 'var(--c-primary)' }}>{t.name}</span>
                          {isDefault && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}>DEFAULT</span>
                          )}
                        </button>
                        <button
                          onClick={() => isDefault ? removeDefaultTemplate() : setDefaultTemplate(t.id)}
                          title={isDefault ? 'Remove default' : 'Set as default'}
                          className="pr-3 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-bold shrink-0"
                          style={{ color: isDefault ? '#C9A84C' : 'var(--c-text-3)' }}>
                          {isDefault ? '★' : '☆'}
                        </button>
                      </div>
                    )
                  })}

                  {templates.length > 0 && (
                    <>
                      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Saved</p>
                      </div>
                      {templates.map(t => {
                        const isDefault = defaultTemplateId === t.id
                        return (
                          <div key={t.id} className="flex items-center group"
                            style={{ borderBottom: '1px solid var(--c-border)' }}>
                            <button onClick={() => applyTemplate(t)}
                              className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left hover:opacity-80">
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                                style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                                {t.name[0]?.toUpperCase() ?? 'T'}
                              </span>
                              <span className="text-[11px] font-semibold flex-1" style={{ color: 'var(--c-primary)' }}>{t.name}</span>
                              {isDefault && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                                  style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}>DEFAULT</span>
                              )}
                            </button>
                            <div className="flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => isDefault ? removeDefaultTemplate() : setDefaultTemplate(t.id)}
                                title={isDefault ? 'Remove default' : 'Set as default'}
                                className="text-[11px] font-bold"
                                style={{ color: isDefault ? '#C9A84C' : 'var(--c-text-3)' }}>
                                {isDefault ? '★' : '☆'}
                              </button>
                              <button onClick={() => deleteTemplate(t.id)}
                                className="text-sm" style={{ color: '#ef4444' }}>×</button>
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}

                  <button onClick={() => { setTemplateMenuOpen(false); setSaveTemplateOpen(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 hover:opacity-80"
                    style={{ color: '#C9A84C' }}>
                    <span className="text-sm">+</span>
                    <span className="text-[11px] font-semibold">Save Current View</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Export dropdown */}
          <div className="relative shrink-0">
            <button onClick={() => setExportMenuOpen(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export {selected.size > 0 ? `(${selected.size})` : ''}
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-xl shadow-2xl overflow-hidden"
                  style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                      {selected.size > 0 ? `${selected.size} selected rows` : `${total.toLocaleString()} visible rows`}
                    </p>
                  </div>
                  {[
                    { label: 'Export CSV', fn: handleExportCSV },
                    { label: 'Export Excel (.xls)', fn: handleExportExcel },
                    { label: 'Export All Fields (CSV)', fn: handleExportAllFieldsCSV },
                  ].map(({ label, fn }) => (
                    <button key={label} onClick={fn}
                      className="w-full text-left px-3 py-2.5 text-[11px] font-semibold hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--c-primary)', borderBottom: '1px solid var(--c-border)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Filters button */}
          <button onClick={() => setFilterDrawerOpen(true)}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80 shrink-0 transition-all"
            style={{
              backgroundColor: activeFilters > 0 ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
              color:           activeFilters > 0 ? '#C9A84C'                : 'var(--c-text-2)',
              border:          `1px solid ${activeFilters > 0 ? '#C9A84C' : 'var(--c-border)'}`,
            }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilters > 0 && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded-full"
                style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>{activeFilters}</span>
            )}
          </button>
        </div>

        {/* Error banner */}
        {listError && (
          <div className="mb-3 px-4 py-3 rounded-xl text-sm flex items-center justify-between"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span>{listError}</span>
            <button onClick={() => setListError(null)} className="ml-4 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
          </div>
        )}

        {/* Detail Card View */}
        {!loading && viewMode === 'detail' && leads.length > 0 && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {leads.map(lead => {
              const mv    = Number(lead.market_value || lead.assessed_value || 0)
              const pct   = offerPctMap[lead.id] ?? lead.offer_pct
              const offer = pct && mv ? Math.round(mv * pct / 100) : null
              const tags  = getLeadTypeTags(lead)
              const sel   = selected.has(lead.id)
              return (
                <div key={lead.id}
                  onClick={() => router.push(`/leads/${lead.id}`)}
                  className="rounded-xl p-4 cursor-pointer transition-all hover:shadow-lg"
                  style={{
                    backgroundColor: sel ? 'rgba(201,168,76,0.06)' : 'var(--c-card)',
                    border: `1px solid ${sel ? 'rgba(201,168,76,0.4)' : 'var(--c-border)'}`,
                  }}>
                  <div className="flex items-start gap-3 mb-3">
                    <input type="checkbox" checked={sel}
                      onChange={e => { e.stopPropagation(); toggleSelect(lead.id, e.target.checked) }}
                      onClick={e => e.stopPropagation()}
                      style={{ accentColor: '#C9A84C', marginTop: 2 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--c-primary)' }}>
                        {lead.property_address || '—'}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                        {[lead.city, lead.zip].filter(Boolean).join(' ')}
                      </p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setOfferLead(lead) }}
                      className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg"
                      style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
                      Offer
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--c-hover)' }}>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>Market Value</p>
                      <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>{fmt$(mv) || '—'}</p>
                    </div>
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: offer ? 'rgba(201,168,76,0.08)' : 'var(--c-hover)' }}>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>
                        Offer {pct ? `(${pct}%)` : ''}
                      </p>
                      <p className="text-sm font-bold" style={{ color: offer ? '#C9A84C' : 'var(--c-text-3)' }}>
                        {offer ? fmt$(offer) : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {tags.map(t => (
                      <span key={t.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `${t.color}20`, color: t.color }}>{t.label}</span>
                    ))}
                    {lead.pipeline_stage && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                        style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                        {lead.pipeline_stage}
                      </span>
                    )}
                    {lead.phone_1 && (
                      <a href={`tel:${lead.phone_1}`} onClick={e => e.stopPropagation()}
                        className="text-[9px] font-semibold hover:underline ml-auto"
                        style={{ color: '#4CAF9A' }}>
                        {lead.phone_1}
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Table (grid mode only) */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Loading leads…</p>
            </div>
          </div>
        ) : leads.length === 0 && viewMode === 'table' ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ backgroundColor: 'var(--c-hover)' }}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>No leads found</p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                {activeFilters > 0 ? 'Try adjusting or clearing your filters.' : 'No saved leads yet — add them from Property Search.'}
              </p>
              {activeFilters > 0 && (
                <button onClick={() => applyFilters({})}
                  className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        ) : leads.length === 0 && viewMode === 'detail' ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>No leads found</p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: '900px' }}>
              <thead className="sticky top-0 z-[5]"
                style={{ backgroundColor: 'var(--c-card-alt)', borderBottom: '2px solid var(--c-border)' }}>
                <tr>
                  <th className="pl-4 pr-2 py-2.5 text-[10px] font-bold uppercase tracking-widest w-8"
                    style={{ color: 'var(--c-text-3)' }} />
                  {colOrder.map(key => (
                    <th key={key} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                      style={{ color: 'var(--c-text-3)' }}>
                      {COLUMN_DEFS[key]?.headerLabel || key}
                    </th>
                  ))}
                  <th className="py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <DynamicRow
                    key={lead.id}
                    lead={lead}
                    selected={selected.has(lead.id)}
                    columns={colOrder}
                    onSelect={toggleSelect}
                    onStar={handleStar}
                    onClick={id => router.push(`/leads/${id}`)}
                    onDelete={deleteSingle}
                    onMakeOffer={setOfferLead}
                    onQuickNote={setNoteLead}
                    renderCtx={{
                      onStar: handleStar,
                      onFieldChange: handleFieldChange,
                      offerPctOverride: offerPctMap,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* Pagination */}
        {pages > 1 && !loading && (
          <div className="flex items-center justify-center gap-3 py-4 px-8"
            style={{ borderTop: '1px solid var(--c-border)' }}>
            <button onClick={() => fetchLeads(appliedFilters, searchInput, page - 1)} disabled={page <= 1}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              ← Previous
            </button>
            <span className="text-xs font-semibold" style={{ color: 'var(--c-text-3)' }}>Page {page} of {pages}</span>
            <button onClick={() => fetchLeads(appliedFilters, searchInput, page + 1)} disabled={page >= pages}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Drawers & Modals */}
      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        onApply={applyFilters}
        applied={appliedFilters}
      />
      <ColumnPickerDrawer
        open={colPickerOpen}
        onClose={() => setColPickerOpen(false)}
        colOrder={colOrder}
        onChange={setColOrder}
      />
      <SaveTemplateModal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        colOrder={colOrder}
        filters={appliedFilters}
        sortBy={sortBy}
        sortDir={sortDir}
        onSave={saveTemplate}
      />
      {offerLead && (
        <OfferCalculatorModal
          lead={offerLead}
          onClose={() => setOfferLead(null)}
          onSave={handleOfferSave}
        />
      )}
      {noteLead && (
        <QuickNoteModal
          lead={noteLead}
          onClose={() => setNoteLead(null)}
          onSaved={() => {}}
        />
      )}

      {/* ── Floating bulk action bar ─────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-2 px-6 py-3 shadow-2xl overflow-x-auto"
          style={{ backgroundColor: 'var(--c-card)', borderTop: '2px solid var(--c-primary)' }}>

          {/* Count badge */}
          <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full mr-1"
            style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
            {selected.size} lead{selected.size !== 1 ? 's' : ''}
          </span>

          {/* Stage */}
          <select
            disabled={bulkStaging}
            onChange={e => { if (e.target.value) { bulkSetStage(e.target.value); e.target.value = '' } }}
            className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            <option value="">{bulkStaging ? 'Updating…' : 'Set Stage ▾'}</option>
            <option value="reviewing">Reviewing</option>
            <option value="contacted">Contacted</option>
            <option value="offer">Offer Sent</option>
            <option value="dead">Dead</option>
          </select>

          {/* Generate Offer */}
          <button
            onClick={() => {
              const first = leads.find(l => selected.has(l.id))
              if (first) setOfferLead(first)
            }}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            Make Offer
          </button>

          {/* Export */}
          <button
            onClick={() => doExportCSV(leads.filter(l => selected.has(l.id)), colOrder, `leads-selected-${new Date().toISOString().slice(0,10)}`)}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Export
          </button>

          {/* Block */}
          <button
            onClick={bulkBlock}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'rgba(156,163,175,0.12)', color: '#9ca3af', border: '1px solid rgba(156,163,175,0.3)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
            </svg>
            Block
          </button>

          {/* Delete */}
          {deleteConfirm ? (
            <div className="shrink-0 flex items-center gap-1.5">
              <span className="text-[11px] font-semibold" style={{ color: '#ef4444' }}>Delete {selected.size}?</span>
              <button onClick={deleteSelected} disabled={deleting}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}>
                {deleting ? '…' : 'Confirm'}
              </button>
              <button onClick={() => setDeleteConfirm(false)}
                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setDeleteConfirm(true)}
              className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
              Delete
            </button>
          )}

          {/* Clear */}
          <button onClick={clearSelect}
            className="shrink-0 ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            ✕ Clear
          </button>
        </div>
      )}
    </div>
  )
}
