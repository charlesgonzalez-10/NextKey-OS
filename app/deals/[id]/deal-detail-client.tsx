'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const STATUSES = ['Lead', 'Analyzing', 'Offer Sent', 'Under Contract', 'Closed', 'Dead']
type AnalyzerTab = 'wholesale' | 'flip' | 'ltr' | 'str' | 'mf'

interface Deal {
  id: string
  address: string
  status: string
  arv: number
  repair_cost: number
  closing_cost: number
  desired_profit: number
  offer_price: number
  notes: string
  source: string
  created_at: string
  contact_id: string
  contacts?: { id: string; name: string; phone: string; email: string }
}

interface Contact { id: string; name: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const f$ = (n?: number | null) =>
  n != null && !isNaN(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
const fp = (n?: number | null) =>
  n != null && !isNaN(n) ? `${n.toFixed(1)}%` : '—'

function useLocalAnalyzer<T extends object>(dealId: string, key: string, defaults: T) {
  const storageKey = `nk_analyzer_${dealId}_${key}`
  const [state, setStateRaw] = useState<T>(() => {
    if (typeof window === 'undefined') return defaults
    try {
      const s = localStorage.getItem(storageKey)
      return s ? { ...defaults, ...JSON.parse(s) } : defaults
    } catch { return defaults }
  })
  const setState = (updater: Partial<T> | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }
  return [state, setState] as const
}

// ─── NumInput ─────────────────────────────────────────────────────────────────

function NumInput({ label, value, onChange, prefix = '$', suffix = '', hint = '' }: {
  label: string; value: string; onChange: (v: string) => void
  prefix?: string; suffix?: string; hint?: string
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>
        {label}{hint && <span className="ml-1 font-normal" style={{ color: 'var(--c-text-3)' }}>({hint})</span>}
      </label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--c-text-2)' }}>{prefix}</span>}
        <input
          type="number" min="0" value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
          style={{
            paddingLeft: prefix ? '1.75rem' : undefined,
            paddingRight: suffix ? '2.5rem' : undefined,
            border: '1px solid var(--c-border)',
            backgroundColor: 'var(--c-input-bg)',
            color: 'var(--c-primary)',
          }}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--c-text-2)' }}>{suffix}</span>}
      </div>
    </div>
  )
}

// ─── Result row ───────────────────────────────────────────────────────────────

function Row({ label, value, accent, bold }: { label: string; value: string; accent?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>{label}</span>
      <span className={bold ? 'text-sm font-bold' : 'text-sm font-semibold'}
        style={{ color: accent === undefined ? 'var(--c-primary)' : accent ? '#4CAF9A' : '#E07B6A' }}>
        {value}
      </span>
    </div>
  )
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: color ?? 'var(--c-gold)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{sub}</p>}
    </div>
  )
}

// ─── Fix & Flip Tab ───────────────────────────────────────────────────────────

function FlipTab({ dealId, arv: initialArv, repairs: initialRepairs }: { dealId: string; arv: number; repairs: number }) {
  const [f, setF] = useLocalAnalyzer(dealId, 'flip', {
    purchase: '', reno: initialRepairs.toString(), holding_months: '6',
    holding_mo: '', sell_pct: '8', arv: initialArv.toString(),
  })
  const n = (v: string) => parseFloat(v) || 0

  const arv        = n(f.arv)
  const purchase   = n(f.purchase)
  const reno       = n(f.reno)
  const holdMos    = n(f.holding_months)
  const holdMo     = n(f.holding_mo)
  const sellPct    = n(f.sell_pct)
  const holdTotal  = holdMo * holdMos
  const sellCosts  = arv * (sellPct / 100)
  const totalCost  = purchase + reno + holdTotal + sellCosts
  const profit     = arv > 0 && purchase > 0 ? arv - totalCost : null
  const roi        = profit != null && totalCost > 0 ? (profit / totalCost) * 100 : null
  const annROI     = roi != null && holdMos > 0 ? (roi / holdMos) * 12 : null
  const lowProfit  = profit != null && profit < 30000

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <NumInput label="Purchase Price"   value={f.purchase}        onChange={v => setF({ purchase: v })} />
        <NumInput label="Renovation Cost"  value={f.reno}            onChange={v => setF({ reno: v })} />
        <NumInput label="ARV"              value={f.arv}             onChange={v => setF({ arv: v })} />
        <NumInput label="Selling Costs"    value={f.sell_pct}        onChange={v => setF({ sell_pct: v })} prefix="" suffix="% of ARV" hint="agent fees, title, etc." />
        <NumInput label="Holding Period"   value={f.holding_months}  onChange={v => setF({ holding_months: v })} prefix="" suffix="months" />
        <NumInput label="Holding Cost/mo"  value={f.holding_mo}      onChange={v => setF({ holding_mo: v })} hint="taxes, insurance, utils" />
      </div>

      {arv > 0 && purchase > 0 && (
        <>
          {lowProfit && (
            <div className="rounded-xl px-4 py-3 text-sm font-semibold"
              style={{ backgroundColor: 'rgba(224,123,106,0.1)', border: '1px solid rgba(224,123,106,0.3)', color: '#E07B6A' }}>
              ⚠️ Projected profit is under $30k — review numbers before proceeding.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Net Profit"       value={f$(profit)}  color={profit != null && profit >= 30000 ? '#4CAF9A' : profit != null ? '#E07B6A' : undefined} />
            <ResultCard label="ROI"              value={fp(roi)}     color={roi != null && roi >= 15 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Annualized Return" value={fp(annROI)} color={annROI != null && annROI >= 20 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Total Project Cost" value={f$(totalCost)} color="var(--c-primary)" />
          </div>
          <div>
            <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>Cost Breakdown</p>
            <Row label="Purchase Price"  value={f$(purchase)} />
            <Row label="Renovation"      value={f$(reno)} />
            <Row label={`Holding (${holdMos} mo × ${f$(holdMo)})`} value={f$(holdTotal)} />
            <Row label={`Selling Costs (${sellPct}% of ARV)`}       value={f$(sellCosts)} />
            <Row label="Total Costs"     value={f$(totalCost)} bold />
            <Row label="ARV"             value={f$(arv)} bold />
            <Row label="Net Profit"      value={f$(profit)} bold accent={profit != null && profit > 0} />
          </div>
        </>
      )}
    </div>
  )
}

// ─── LTR Tab ──────────────────────────────────────────────────────────────────

function LtrTab({ dealId }: { dealId: string }) {
  const [f, setF] = useLocalAnalyzer(dealId, 'ltr', {
    purchase: '', down_pct: '20', rate: '7', term: '30',
    rent: '', vacancy: '8', mgmt: '10',
    insurance: '', taxes: '', other_exp: '',
    rent_growth: '3', value_growth: '3',
  })
  const n = (v: string) => parseFloat(v) || 0

  const purchase   = n(f.purchase)
  const downPct    = n(f.down_pct)
  const rate       = n(f.rate)
  const term       = n(f.term)
  const rent       = n(f.rent)
  const vacPct     = n(f.vacancy)
  const mgmtPct    = n(f.mgmt)
  const insurance  = n(f.insurance)
  const taxes      = n(f.taxes)
  const otherExp   = n(f.other_exp)
  const rentGrowth = n(f.rent_growth)
  const valGrowth  = n(f.value_growth)

  const downAmt    = purchase * (downPct / 100)
  const loanAmt    = purchase - downAmt
  const monthRate  = rate / 100 / 12
  const nPayments  = term * 12
  const piPayment  = loanAmt > 0 && monthRate > 0
    ? loanAmt * (monthRate * Math.pow(1 + monthRate, nPayments)) / (Math.pow(1 + monthRate, nPayments) - 1)
    : 0

  const effRent    = rent * (1 - vacPct / 100)
  const mgmtCost   = effRent * (mgmtPct / 100)
  const totalExp   = mgmtCost + insurance + taxes + otherExp
  const noi        = rent * 12 * (1 - vacPct / 100) - (insurance + taxes + otherExp + mgmtCost) * 12
  const annCF      = noi - piPayment * 12
  const moCF       = annCF / 12
  const coc        = downAmt > 0 ? (annCF / downAmt) * 100 : null
  const capRate    = purchase > 0 ? (noi / purchase) * 100 : null
  const grm        = rent > 0 ? purchase / (rent * 12) : null
  const dscr       = piPayment > 0 ? (effRent - totalExp) / piPayment : null
  const breakEven  = (piPayment + totalExp) / (1 - vacPct / 100)
  const rule1      = purchase > 0 ? ((rent / purchase) * 100) : null
  const rule50     = effRent > 0 ? ((totalExp / effRent) * 100) : null

  // 5-year table
  const fiveYr = Array.from({ length: 5 }, (_, i) => {
    const yr     = i + 1
    const yRent  = rent * Math.pow(1 + rentGrowth / 100, yr)
    const yVal   = purchase * Math.pow(1 + valGrowth / 100, yr)
    const yEff   = yRent * (1 - vacPct / 100)
    const yExp   = (insurance + taxes + otherExp + yEff * (mgmtPct / 100)) * 12
    const yNOI   = yEff * 12 - yExp

    // Remaining balance
    let bal = loanAmt
    for (let p = 0; p < yr * 12; p++) bal = bal * (1 + monthRate) - piPayment
    const equity = yVal - Math.max(0, bal)

    return { yr, rent: yRent, noi: yNOI, cf: yNOI - piPayment * 12, value: yVal, equity }
  })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <NumInput label="Purchase Price"   value={f.purchase}   onChange={v => setF({ purchase: v })} />
        <NumInput label="Down Payment"     value={f.down_pct}   onChange={v => setF({ down_pct: v })}   prefix="" suffix="%" />
        <NumInput label="Interest Rate"    value={f.rate}       onChange={v => setF({ rate: v })}       prefix="" suffix="%" />
        <NumInput label="Loan Term"        value={f.term}       onChange={v => setF({ term: v })}       prefix="" suffix="yrs" />
        <NumInput label="Monthly Rent"     value={f.rent}       onChange={v => setF({ rent: v })} />
        <NumInput label="Vacancy Rate"     value={f.vacancy}    onChange={v => setF({ vacancy: v })}    prefix="" suffix="%" hint="default 8%" />
        <NumInput label="Property Mgmt"    value={f.mgmt}       onChange={v => setF({ mgmt: v })}       prefix="" suffix="% of rent" hint="default 10%" />
        <NumInput label="Insurance/mo"     value={f.insurance}  onChange={v => setF({ insurance: v })} />
        <NumInput label="Taxes/mo"         value={f.taxes}      onChange={v => setF({ taxes: v })} />
        <NumInput label="Other Expenses/mo" value={f.other_exp} onChange={v => setF({ other_exp: v })} hint="repairs, HOA, etc." />
      </div>

      {purchase > 0 && rent > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <ResultCard label="Monthly Cash Flow" value={f$(moCF)}   color={moCF >= 0 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Cash-on-Cash"      value={fp(coc)}    color={coc != null && coc >= 8 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Cap Rate"          value={fp(capRate)} color={capRate != null && capRate >= 6 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="DSCR"              value={dscr != null ? dscr.toFixed(2) : '—'} color={dscr != null && dscr >= 1.25 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="GRM"               value={grm != null ? grm.toFixed(1) : '—'} color="var(--c-primary)" />
            <ResultCard label="Break-Even Rent"   value={f$(breakEven)} color="var(--c-primary)" />
          </div>

          <div>
            <Row label="1% Rule"           value={rule1 != null ? `${rule1.toFixed(2)}% ${rule1 >= 1 ? '✓' : '✗'}` : '—'} accent={rule1 != null && rule1 >= 1} />
            <Row label="50% Rule Expenses" value={rule50 != null ? `${rule50.toFixed(1)}% of eff. rent` : '—'} accent={rule50 != null && rule50 <= 50} />
            <Row label="Down Payment"      value={f$(downAmt)} />
            <Row label="Loan Amount"       value={f$(loanAmt)} />
            <Row label="P&I Payment/mo"    value={f$(piPayment)} />
            <Row label="Effective Rent/mo" value={f$(effRent)} />
            <Row label="Total Exp/mo"      value={f$(totalExp)} />
            <Row label="NOI (annual)"      value={f$(noi)} bold />
            <Row label="Annual Cash Flow"  value={f$(annCF)} bold accent={annCF > 0} />
          </div>

          {/* 5-year table */}
          <div>
            <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>5-Year Projection</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--c-border)' }}>
                    {['Yr', 'Rent/mo', 'NOI', 'Cash Flow', 'Value', 'Equity'].map(h => (
                      <th key={h} className="pb-1.5 text-left font-semibold pr-3" style={{ color: 'var(--c-text-2)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fiveYr.map(r => (
                    <tr key={r.yr} style={{ borderBottom: '1px solid var(--c-border)' }}>
                      <td className="py-1.5 pr-3 font-bold" style={{ color: 'var(--c-gold)' }}>{r.yr}</td>
                      <td className="py-1.5 pr-3" style={{ color: 'var(--c-primary)' }}>{f$(r.rent)}</td>
                      <td className="py-1.5 pr-3" style={{ color: r.noi >= 0 ? '#4CAF9A' : '#E07B6A' }}>{f$(r.noi)}</td>
                      <td className="py-1.5 pr-3" style={{ color: r.cf >= 0 ? '#4CAF9A' : '#E07B6A' }}>{f$(r.cf)}</td>
                      <td className="py-1.5 pr-3" style={{ color: 'var(--c-primary)' }}>{f$(r.value)}</td>
                      <td className="py-1.5 pr-3 font-semibold" style={{ color: '#4CAF9A' }}>{f$(r.equity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Growth assumptions */}
          <div>
            <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>Projection Assumptions</p>
            <div className="grid grid-cols-2 gap-3">
              <NumInput label="Annual Rent Growth"  value={f.rent_growth}  onChange={v => setF({ rent_growth: v })}  prefix="" suffix="%" />
              <NumInput label="Annual Value Growth" value={f.value_growth} onChange={v => setF({ value_growth: v })} prefix="" suffix="%" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── STR Tab ──────────────────────────────────────────────────────────────────

function StrTab({ dealId }: { dealId: string }) {
  const [f, setF] = useLocalAnalyzer(dealId, 'str', {
    purchase: '', down_pct: '20', rate: '7', term: '30',
    nightly: '', occupancy: '65', seasonal_adj: '0',
    furnishing: '', platform_fee: '3',
    insurance: '', taxes: '', other_exp: '',
    ltr_comp: '',
  })
  const n = (v: string) => parseFloat(v) || 0

  const purchase   = n(f.purchase)
  const downPct    = n(f.down_pct)
  const rate       = n(f.rate)
  const term       = n(f.term)
  const nightly    = n(f.nightly)
  const occupancy  = n(f.occupancy)
  const seasonal   = n(f.seasonal_adj)
  const furnishing = n(f.furnishing)
  const platFee    = n(f.platform_fee)
  const insurance  = n(f.insurance)
  const taxes      = n(f.taxes)
  const otherExp   = n(f.other_exp)
  const ltrComp    = n(f.ltr_comp)

  const downAmt    = purchase * (downPct / 100)
  const loanAmt    = purchase - downAmt
  const monthRate  = rate / 100 / 12
  const nPayments  = term * 12
  const piPayment  = loanAmt > 0 && monthRate > 0
    ? loanAmt * (monthRate * Math.pow(1 + monthRate, nPayments)) / (Math.pow(1 + monthRate, nPayments) - 1)
    : 0

  const grossAnnual   = nightly * (occupancy / 100) * 365 * (1 + seasonal / 100)
  const platformCosts = grossAnnual * (platFee / 100)
  const annExp        = (insurance + taxes + otherExp) * 12
  const netRevenue    = grossAnnual - platformCosts
  const annCF         = netRevenue - annExp - piPayment * 12
  const moCF          = annCF / 12
  const coc           = downAmt > 0 ? (annCF / (downAmt + furnishing)) * 100 : null

  // Break-even occupancy
  const annFixed      = annExp + piPayment * 12
  const revenuePerNight = nightly * (1 - platFee / 100)
  const beOccupancy   = revenuePerNight > 0 ? (annFixed / (revenuePerNight * 365)) * 100 : null

  // STR vs LTR
  const strVsLtr      = ltrComp > 0 ? annCF - ((ltrComp * 12) - annExp - piPayment * 12) : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <NumInput label="Purchase Price"    value={f.purchase}     onChange={v => setF({ purchase: v })} />
        <NumInput label="Down Payment"      value={f.down_pct}     onChange={v => setF({ down_pct: v })}     prefix="" suffix="%" />
        <NumInput label="Interest Rate"     value={f.rate}         onChange={v => setF({ rate: v })}         prefix="" suffix="%" />
        <NumInput label="Loan Term"         value={f.term}         onChange={v => setF({ term: v })}         prefix="" suffix="yrs" />
        <NumInput label="Nightly Rate"      value={f.nightly}      onChange={v => setF({ nightly: v })} />
        <NumInput label="Occupancy Rate"    value={f.occupancy}    onChange={v => setF({ occupancy: v })}    prefix="" suffix="%" hint="default 65%" />
        <NumInput label="Seasonal Adj"      value={f.seasonal_adj} onChange={v => setF({ seasonal_adj: v })} prefix="" suffix="%" hint="+ or - vs baseline" />
        <NumInput label="Furnishing Cost"   value={f.furnishing}   onChange={v => setF({ furnishing: v })} />
        <NumInput label="Platform Fee"      value={f.platform_fee} onChange={v => setF({ platform_fee: v })} prefix="" suffix="%" hint="Airbnb/VRBO, default 3%" />
        <NumInput label="Insurance/mo"      value={f.insurance}    onChange={v => setF({ insurance: v })} />
        <NumInput label="Taxes/mo"          value={f.taxes}        onChange={v => setF({ taxes: v })} />
        <NumInput label="Other Expenses/mo" value={f.other_exp}    onChange={v => setF({ other_exp: v })} hint="mgmt, cleaning, utils" />
      </div>

      {purchase > 0 && nightly > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Gross Annual Rev"    value={f$(grossAnnual)}   color="var(--c-primary)" />
            <ResultCard label="Net Annual Revenue"  value={f$(netRevenue)}    color="var(--c-primary)" />
            <ResultCard label="Annual Cash Flow"    value={f$(annCF)}         color={annCF >= 0 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Monthly Cash Flow"   value={f$(moCF)}          color={moCF >= 0 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Cash-on-Cash"        value={fp(coc)}           color={coc != null && coc >= 10 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Break-Even Occupancy" value={fp(beOccupancy)}  color="var(--c-primary)" />
          </div>

          <div>
            <Row label="Down + Furnishing"     value={f$(downAmt + furnishing)} />
            <Row label="Gross Revenue"         value={f$(grossAnnual)} />
            <Row label={`Platform Fees (${platFee}%)`} value={f$(platformCosts)} />
            <Row label="Net Revenue"           value={f$(netRevenue)} />
            <Row label="Annual Expenses"       value={f$(annExp)} />
            <Row label="P&I Annual"            value={f$(piPayment * 12)} />
            <Row label="Annual Cash Flow"      value={f$(annCF)} bold accent={annCF > 0} />
          </div>

          {/* STR vs LTR */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
            <p className="text-xs font-bold mb-3 uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>STR vs LTR Comparison</p>
            <NumInput label="LTR Monthly Rent (comparable)"  value={f.ltr_comp} onChange={v => setF({ ltr_comp: v })} hint="what would this rent for long-term?" />
            {ltrComp > 0 && (
              <div className="mt-3">
                <Row label="STR Annual Cash Flow" value={f$(annCF)} />
                <Row label="LTR Annual Cash Flow" value={f$((ltrComp * 12) - annExp - piPayment * 12)} />
                <Row label="STR Premium vs LTR"   value={strVsLtr != null ? f$(strVsLtr) : '—'} bold accent={strVsLtr != null && strVsLtr > 0} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Multi-Family Tab ─────────────────────────────────────────────────────────

function MfTab({ dealId }: { dealId: string }) {
  const [f, setF] = useLocalAnalyzer(dealId, 'mf', {
    purchase: '', down_pct: '25', rate: '7.5', term: '30',
    units: '4', cur_rent: '', mkt_rent: '', vacancy: '7',
    insurance: '', taxes: '', other_exp: '',
    rent_growth: '3', value_growth: '3',
  })
  const n = (v: string) => parseFloat(v) || 0

  const purchase  = n(f.purchase)
  const downPct   = n(f.down_pct)
  const rate      = n(f.rate)
  const term      = n(f.term)
  const units     = Math.max(1, Math.round(n(f.units)))
  const curRent   = n(f.cur_rent)
  const mktRent   = n(f.mkt_rent)
  const vacPct    = n(f.vacancy)
  const insurance = n(f.insurance)
  const taxes     = n(f.taxes)
  const otherExp  = n(f.other_exp)
  const rentGrowth= n(f.rent_growth)
  const valGrowth = n(f.value_growth)

  const downAmt   = purchase * (downPct / 100)
  const loanAmt   = purchase - downAmt
  const monthRate = rate / 100 / 12
  const nPay      = term * 12
  const piPayment = loanAmt > 0 && monthRate > 0
    ? loanAmt * (monthRate * Math.pow(1 + monthRate, nPay)) / (Math.pow(1 + monthRate, nPay) - 1)
    : 0

  const effRent   = curRent * units * (1 - vacPct / 100)
  const annExp    = (insurance + taxes + otherExp) * 12
  const noi       = effRent * 12 - annExp
  const annCF     = noi - piPayment * 12
  const moCF      = annCF / 12
  const capRate   = purchase > 0 ? (noi / purchase) * 100 : null
  const coc       = downAmt > 0 ? (annCF / downAmt) * 100 : null
  const dscr      = piPayment > 0 ? (effRent - (insurance + taxes + otherExp)) / piPayment : null
  const grm       = curRent > 0 ? purchase / (curRent * units * 12) : null
  const ppu       = purchase / units

  // Value-add: market rent upside
  const mktEffRent = mktRent * units * (1 - vacPct / 100)
  const mktNOI     = mktEffRent * 12 - annExp
  const mktCF      = mktNOI - piPayment * 12
  const mktCapRate = purchase > 0 ? (mktNOI / purchase) * 100 : null
  const rentUpside = (mktRent - curRent) * units

  // 5-year table
  const fiveYr = Array.from({ length: 5 }, (_, i) => {
    const yr    = i + 1
    const yRent = curRent * Math.pow(1 + rentGrowth / 100, yr)
    const yVal  = purchase * Math.pow(1 + valGrowth / 100, yr)
    const yEff  = yRent * units * (1 - vacPct / 100)
    const yNOI  = yEff * 12 - annExp
    let bal = loanAmt
    for (let p = 0; p < yr * 12; p++) bal = bal * (1 + monthRate) - piPayment
    const equity = yVal - Math.max(0, bal)
    return { yr, rent: yRent, noi: yNOI, cf: yNOI - piPayment * 12, value: yVal, equity }
  })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <NumInput label="Purchase Price"    value={f.purchase}   onChange={v => setF({ purchase: v })} />
        <NumInput label="Down Payment"      value={f.down_pct}   onChange={v => setF({ down_pct: v })}   prefix="" suffix="%" />
        <NumInput label="Interest Rate"     value={f.rate}       onChange={v => setF({ rate: v })}       prefix="" suffix="%" />
        <NumInput label="Loan Term"         value={f.term}       onChange={v => setF({ term: v })}       prefix="" suffix="yrs" />
        <NumInput label="Number of Units"   value={f.units}      onChange={v => setF({ units: v })}      prefix="" />
        <NumInput label="Current Rent/Unit" value={f.cur_rent}   onChange={v => setF({ cur_rent: v })} />
        <NumInput label="Market Rent/Unit"  value={f.mkt_rent}   onChange={v => setF({ mkt_rent: v })}   hint="for value-add analysis" />
        <NumInput label="Vacancy Rate"      value={f.vacancy}    onChange={v => setF({ vacancy: v })}    prefix="" suffix="%" hint="default 7%" />
        <NumInput label="Insurance/mo"      value={f.insurance}  onChange={v => setF({ insurance: v })} />
        <NumInput label="Taxes/mo"          value={f.taxes}      onChange={v => setF({ taxes: v })} />
        <NumInput label="Other Expenses/mo" value={f.other_exp}  onChange={v => setF({ other_exp: v })} hint="maintenance, landscaping" />
      </div>

      {purchase > 0 && curRent > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <ResultCard label="Monthly Cash Flow" value={f$(moCF)}    color={moCF >= 0 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Cap Rate"          value={fp(capRate)} color={capRate != null && capRate >= 6 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="Cash-on-Cash"      value={fp(coc)}     color={coc != null && coc >= 8 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="DSCR"              value={dscr != null ? dscr.toFixed(2) : '—'} color={dscr != null && dscr >= 1.25 ? '#4CAF9A' : '#E07B6A'} />
            <ResultCard label="GRM"               value={grm != null ? grm.toFixed(1) : '—'} color="var(--c-primary)" />
            <ResultCard label="Price Per Unit"    value={f$(ppu)}     color="var(--c-primary)" />
          </div>

          <div>
            <Row label={`Gross Income (${units} units @ ${f$(curRent)}/mo)`} value={f$(curRent * units)} />
            <Row label={`Effective Income (${vacPct}% vacancy)`}             value={f$(effRent)} />
            <Row label="Annual Expenses"           value={f$(annExp)} />
            <Row label="NOI (annual)"              value={f$(noi)} bold />
            <Row label="P&I Annual"                value={f$(piPayment * 12)} />
            <Row label="Annual Cash Flow"          value={f$(annCF)} bold accent={annCF > 0} />
          </div>

          {/* Value-add */}
          {mktRent > 0 && mktRent !== curRent && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)' }}>
              <p className="text-xs font-bold mb-3 uppercase tracking-wider" style={{ color: 'var(--c-gold)' }}>
                Value-Add Scenario (at Market Rent)
              </p>
              <Row label={`Rent Upside (${units} units)`}    value={`+${f$(rentUpside)}/mo`} />
              <Row label="Market Rate NOI"                   value={f$(mktNOI)} />
              <Row label="Market Rate Cash Flow"             value={f$(mktCF)}    accent={mktCF > 0} />
              <Row label="Market Rate Cap Rate"              value={fp(mktCapRate)} bold />
            </div>
          )}

          {/* 5-year table */}
          <div>
            <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--c-text-2)' }}>5-Year Projection</p>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <NumInput label="Annual Rent Growth"  value={f.rent_growth}  onChange={v => setF({ rent_growth: v })}  prefix="" suffix="%" />
              <NumInput label="Annual Value Growth" value={f.value_growth} onChange={v => setF({ value_growth: v })} prefix="" suffix="%" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--c-border)' }}>
                    {['Yr', 'Rent/Unit', 'NOI', 'Cash Flow', 'Value', 'Equity'].map(h => (
                      <th key={h} className="pb-1.5 text-left font-semibold pr-3" style={{ color: 'var(--c-text-2)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fiveYr.map(r => (
                    <tr key={r.yr} style={{ borderBottom: '1px solid var(--c-border)' }}>
                      <td className="py-1.5 pr-3 font-bold" style={{ color: 'var(--c-gold)' }}>{r.yr}</td>
                      <td className="py-1.5 pr-3" style={{ color: 'var(--c-primary)' }}>{f$(r.rent)}</td>
                      <td className="py-1.5 pr-3" style={{ color: r.noi >= 0 ? '#4CAF9A' : '#E07B6A' }}>{f$(r.noi)}</td>
                      <td className="py-1.5 pr-3" style={{ color: r.cf >= 0 ? '#4CAF9A' : '#E07B6A' }}>{f$(r.cf)}</td>
                      <td className="py-1.5 pr-3" style={{ color: 'var(--c-primary)' }}>{f$(r.value)}</td>
                      <td className="py-1.5 pr-3 font-semibold" style={{ color: '#4CAF9A' }}>{f$(r.equity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function DealDetailClient({
  deal: initialDeal,
  contacts,
}: {
  deal: Deal
  contacts: Contact[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [deal, setDeal] = useState(initialDeal)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [analyzerTab, setAnalyzerTab] = useState<AnalyzerTab>('wholesale')

  const [form, setForm] = useState({
    address: deal.address || '',
    contact_id: deal.contact_id || '',
    status: deal.status || 'Lead',
    arv: deal.arv?.toString() || '',
    repair_cost: deal.repair_cost?.toString() || '',
    closing_cost: deal.closing_cost?.toString() || '',
    desired_profit: deal.desired_profit?.toString() || '',
    offer_price: deal.offer_price?.toString() || '',
    notes: deal.notes || '',
    source: deal.source || '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  // Wholesale calculations
  const arv      = parseFloat(form.arv) || 0
  const repairs  = parseFloat(form.repair_cost) || 0
  const closing  = parseFloat(form.closing_cost) || 0
  const offerPrice = parseFloat(form.offer_price) || 0
  const mao      = arv > 0 ? (arv * 0.70) - repairs - closing : 0
  const netProfit = arv > 0 && offerPrice > 0 ? arv - repairs - closing - offerPrice : null
  const roi      = netProfit && offerPrice > 0 ? ((netProfit / offerPrice) * 100).toFixed(1) : null

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const { data, error } = await supabase
      .from('deals')
      .update({
        address: form.address,
        contact_id: form.contact_id || null,
        status: form.status,
        arv: parseFloat(form.arv) || null,
        repair_cost: parseFloat(form.repair_cost) || null,
        closing_cost: parseFloat(form.closing_cost) || null,
        desired_profit: parseFloat(form.desired_profit) || null,
        offer_price: parseFloat(form.offer_price) || null,
        notes: form.notes,
        source: form.source,
      })
      .eq('id', deal.id)
      .select(`*, contacts ( id, name, phone, email )`)
      .single()
    if (error) { setError(error.message); setSaving(false) }
    else { setDeal(data); setEditing(false); setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this deal? This cannot be undone.')) return
    setDeleting(true)
    await supabase.from('deals').delete().eq('id', deal.id)
    router.push('/deals')
  }

  const TABS: { key: AnalyzerTab; label: string }[] = [
    { key: 'wholesale', label: 'Wholesale' },
    { key: 'flip',      label: 'Fix & Flip' },
    { key: 'ltr',       label: 'LTR' },
    { key: 'str',       label: 'STR' },
    { key: 'mf',        label: 'Multi-Family' },
  ]

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 md:mb-6">
        <a href="/deals" style={{ color: 'var(--c-text-3)' }} className="hover:opacity-70 transition-opacity shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <div className="flex-1 min-w-0">
          <h1 style={{ color: 'var(--c-primary)' }} className="text-lg md:text-2xl font-bold leading-tight truncate">
            {editing ? form.address || 'Deal' : deal.address}
          </h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: 'var(--c-text-2)' }}>
            {deal.source ? `${deal.source} · ` : ''}
            Added {new Date(deal.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!editing ? (
            <>
              <button onClick={() => setEditing(true)}
                style={{ backgroundColor: 'var(--c-primary)', color: 'var(--c-gold)' }}
                className="font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity text-sm">
                Edit
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ border: '1px solid rgba(224,123,106,0.4)', color: '#E07B6A' }}>
                {deleting ? '...' : 'Del'}
              </button>
            </>
          ) : (
            <>
              <button onClick={handleSave} disabled={saving}
                style={{ backgroundColor: 'var(--c-primary)', color: 'var(--c-gold)' }}
                className="font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity text-sm disabled:opacity-60">
                {saving ? '...' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setError('') }}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
        {/* Left column */}
        <div className="md:col-span-2 space-y-5">

          {/* Deal info */}
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <h2 className="font-bold text-base mb-4" style={{ color: 'var(--c-primary)' }}>Deal Info</h2>
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Property Address</label>
                  <input name="address" value={form.address} onChange={handleChange}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Contact (Seller)</label>
                  <select name="contact_id" value={form.contact_id} onChange={handleChange}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }}>
                    <option value="">— No contact —</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Status</label>
                  <select name="status" value={form.status} onChange={handleChange}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>Source</label>
                  <input name="source" value={form.source} onChange={handleChange}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <span className="text-xs w-32 pt-0.5" style={{ color: 'var(--c-text-2)' }}>Status</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>{deal.status}</span>
                </div>
                {deal.contacts && (
                  <div className="flex gap-2">
                    <span className="text-xs w-32 pt-0.5" style={{ color: 'var(--c-text-2)' }}>Contact</span>
                    <a href={`/contacts/${deal.contacts.id}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--c-primary)' }}>
                      {deal.contacts.name}
                    </a>
                  </div>
                )}
                {deal.source && (
                  <div className="flex gap-2">
                    <span className="text-xs w-32 pt-0.5" style={{ color: 'var(--c-text-2)' }}>Source</span>
                    <span className="text-sm" style={{ color: 'var(--c-primary)' }}>{deal.source}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Deal Analyzer — tabbed */}
          <div className="rounded-2xl" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-4 pt-4 pb-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--c-border)' }}>
              <span className="text-xs font-bold uppercase tracking-wider mr-2 shrink-0" style={{ color: 'var(--c-text-2)' }}>Analyzer</span>
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setAnalyzerTab(tab.key)}
                  className="px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors relative shrink-0"
                  style={{
                    color: analyzerTab === tab.key ? 'var(--c-gold)' : 'var(--c-text-2)',
                    backgroundColor: analyzerTab === tab.key ? 'var(--c-card-alt)' : 'transparent',
                    borderBottom: analyzerTab === tab.key ? '2px solid var(--c-gold)' : '2px solid transparent',
                    marginBottom: '-1px',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* ── Wholesale ── */}
              {analyzerTab === 'wholesale' && (
                <>
                  {editing ? (
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {[
                        { name: 'arv',            label: 'ARV' },
                        { name: 'repair_cost',     label: 'Repair Cost' },
                        { name: 'closing_cost',    label: 'Closing / Holding' },
                        { name: 'desired_profit',  label: 'Desired Profit' },
                        { name: 'offer_price',     label: 'Offer Price' },
                      ].map(field => (
                        <div key={field.name}>
                          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--c-text-2)' }}>{field.label}</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--c-text-2)' }}>$</span>
                            <input
                              name={field.name}
                              value={(form as Record<string, string>)[field.name]}
                              onChange={handleChange}
                              type="number" min="0"
                              className="w-full rounded-xl pl-6 pr-3 py-2.5 text-sm focus:outline-none"
                              style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {[
                        { label: 'ARV',              value: deal.arv },
                        { label: 'Repair Cost',      value: deal.repair_cost },
                        { label: 'Closing/Holding',  value: deal.closing_cost },
                        { label: 'Desired Profit',   value: deal.desired_profit },
                        { label: 'Offer Price',      value: deal.offer_price },
                      ].map(item => (
                        <div key={item.label} className="flex justify-between items-center py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
                          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>{item.label}</span>
                          <span className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>{f$(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(editing ? arv : deal.arv) > 0 && (
                    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--c-primary)' }}>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>MAO (70% Rule)</p>
                          <p className="text-lg font-bold" style={{ color: '#C9A84C' }}>
                            {f$(mao > 0 ? mao : (deal.arv * 0.70) - (deal.repair_cost || 0) - (deal.closing_cost || 0))}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Net Profit</p>
                          <p className="text-lg font-bold" style={{
                            color: (netProfit ?? (deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - (deal.offer_price || 0))) > 0 ? '#4CAF9A' : '#E07B6A'
                          }}>
                            {f$(netProfit ?? (deal.offer_price ? deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - deal.offer_price : undefined))}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>ROI</p>
                          <p className="text-lg font-bold" style={{ color: '#C9A84C' }}>
                            {roi
                              ? `${roi}%`
                              : (deal.offer_price && deal.arv
                                ? `${(((deal.arv - (deal.repair_cost || 0) - (deal.closing_cost || 0) - deal.offer_price) / deal.offer_price) * 100).toFixed(1)}%`
                                : '—')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {analyzerTab === 'flip' && (
                <FlipTab dealId={deal.id} arv={deal.arv || 0} repairs={deal.repair_cost || 0} />
              )}
              {analyzerTab === 'ltr' && <LtrTab dealId={deal.id} />}
              {analyzerTab === 'str' && <StrTab dealId={deal.id} />}
              {analyzerTab === 'mf'  && <MfTab  dealId={deal.id} />}
            </div>
          </div>

          {/* Notes */}
          {(editing || deal.notes) && (
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <h2 className="font-bold text-base mb-3" style={{ color: 'var(--c-primary)' }}>Notes</h2>
              {editing ? (
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={4}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none"
                  style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }} />
              ) : (
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--c-primary)' }}>{deal.notes}</p>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {deal.contacts && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <h2 className="font-bold text-base mb-3" style={{ color: 'var(--c-primary)' }}>Seller</h2>
              <a href={`/contacts/${deal.contacts.id}`}
                className="font-semibold text-sm hover:underline block mb-3" style={{ color: 'var(--c-primary)' }}>
                {deal.contacts.name}
              </a>
              <div className="space-y-2">
                {deal.contacts.phone && (
                  <a href={`tel:${deal.contacts.phone}`}
                    className="flex items-center gap-2 p-2.5 rounded-xl transition-colors"
                    style={{ backgroundColor: 'var(--c-card-alt)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--c-card-alt)')}>
                    <span className="text-sm">📞</span>
                    <span className="text-sm" style={{ color: 'var(--c-primary)' }}>{deal.contacts.phone}</span>
                  </a>
                )}
                {deal.contacts.email && (
                  <a href={`mailto:${deal.contacts.email}`}
                    className="flex items-center gap-2 p-2.5 rounded-xl transition-colors"
                    style={{ backgroundColor: 'var(--c-card-alt)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--c-card-alt)')}>
                    <span className="text-sm">✉️</span>
                    <span className="text-sm truncate" style={{ color: 'var(--c-primary)' }}>{deal.contacts.email}</span>
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <h2 className="font-bold text-base mb-3" style={{ color: 'var(--c-primary)' }}>Property</h2>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(deal.address)}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl transition-colors mb-2"
              style={{ backgroundColor: 'var(--c-card-alt)' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--c-card-alt)')}>
              <span className="text-sm">📍</span>
              <span className="text-xs leading-tight" style={{ color: 'var(--c-primary)' }}>{deal.address}</span>
            </a>
            <a
              href={`https://www.zillow.com/homes/${encodeURIComponent(deal.address)}_rb/`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl transition-colors"
              style={{ backgroundColor: 'var(--c-card-alt)' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--c-card-alt)')}>
              <span className="text-sm">🏠</span>
              <span className="text-sm" style={{ color: 'var(--c-primary)' }}>View on Zillow</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
