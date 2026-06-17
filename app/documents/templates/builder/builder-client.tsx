'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateField {
  id: string
  page: number
  x: number
  y: number
  w: number
  h: number
  variable: string
  label: string
  defaultValue: string
  fontSize: number
}

interface ContractTemplate {
  id: string
  name: string
  category: string
  page_count: number | null
  created_at: string
  field_mappings: TemplateField[] | null
}

// ── Variable Groups ───────────────────────────────────────────────────────────

const VARIABLE_GROUPS = [
  { category: 'Buyer', color: '#4CAF9A', items: [
    { variable: '{{Contact.FullName}}', label: 'Buyer Full Name' },
    { variable: '{{Buyer.Name2}}',      label: 'Buyer 2 Name' },
    { variable: '{{Contact.Email}}',    label: 'Buyer Email' },
    { variable: '{{Contact.Phone}}',    label: 'Buyer Phone' },
    { variable: '{{Contact.Address}}',  label: 'Buyer Address' },
  ]},
  { category: 'Seller', color: '#E07B6A', items: [
    { variable: '{{Seller.Name}}',  label: 'Seller Name' },
    { variable: '{{Seller.Name2}}', label: 'Seller 2 Name' },
    { variable: '{{Seller.Email}}', label: 'Seller Email' },
    { variable: '{{Seller.Phone}}', label: 'Seller Phone' },
  ]},
  { category: 'Property', color: '#22c55e', items: [
    { variable: '{{Property.Address}}',   label: 'Address' },
    { variable: '{{Property.City}}',      label: 'City' },
    { variable: '{{Property.State}}',     label: 'State' },
    { variable: '{{Property.Zip}}',       label: 'ZIP' },
    { variable: '{{Property.County}}',    label: 'County' },
    { variable: '{{Property.Folio}}',     label: 'Folio / Parcel #' },
    { variable: '{{Property.OwnerName}}', label: 'Owner Name' },
    { variable: '{{Property.LegalDesc}}', label: 'Legal Description' },
  ]},
  { category: 'Deal', color: '#C9A84C', items: [
    { variable: '{{Deal.OfferPrice}}',        label: 'Purchase Price' },
    { variable: '{{Deal.EarnestMoney}}',      label: 'Earnest Money / Initial Deposit' },
    { variable: '{{Deal.DepositDays}}',       label: 'Deposit Delivery Days' },
    { variable: '{{Deal.AdditionalDeposit}}', label: 'Additional Deposit' },
    { variable: '{{Deal.BalanceToClose}}',    label: 'Balance to Close' },
    { variable: '{{Deal.LoanAmount}}',        label: 'Loan Amount' },
    { variable: '{{Deal.LoanType}}',          label: 'Loan Type (Cash/Conv/FHA/VA)' },
    { variable: '{{Deal.ClosingDate}}',       label: 'Closing Date' },
    { variable: '{{Deal.InspectionDays}}',    label: 'Inspection Period (Days)' },
    { variable: '{{Deal.SellerContribution}}',label: 'Seller Contribution / Credit' },
    { variable: '{{Deal.RepairLimit}}',       label: 'Repair Limit' },
    { variable: '{{Deal.ExpirationDate}}',    label: 'Offer Expiration Date' },
  ]},
  { category: 'Agent', color: '#7B8FD4', items: [
    { variable: '{{Agent.Name}}',    label: 'Agent Name' },
    { variable: '{{Agent.Email}}',   label: 'Agent Email' },
    { variable: '{{Agent.Phone}}',   label: 'Agent Phone' },
    { variable: '{{Agent.License}}', label: 'License #' },
    { variable: '{{Agent.Company}}', label: 'Brokerage / Company' },
  ]},
  { category: 'Escrow', color: '#B06AE0', items: [
    { variable: '{{Escrow.Agent}}',   label: 'Escrow / Title Agent' },
    { variable: '{{Escrow.Email}}',   label: 'Escrow Email' },
    { variable: '{{Escrow.Phone}}',   label: 'Escrow Phone' },
    { variable: '{{Escrow.Address}}', label: 'Escrow Address' },
  ]},
  { category: 'Date', color: '#6ABDE0', items: [
    { variable: '{{Date.Today}}',      label: "Today's Date" },
    { variable: '{{Date.Effective}}',  label: 'Effective Date' },
  ]},
]

function variableColor(variable: string): string {
  for (const g of VARIABLE_GROUPS) {
    if (g.items.some(i => i.variable === variable)) return g.color
  }
  return '#C9A84C'
}

function variableLabel(variable: string): string {
  for (const g of VARIABLE_GROUPS) {
    const item = g.items.find(i => i.variable === variable)
    if (item) return item.label
  }
  return variable
}

// ── Map AcroForm field names → variables (for fillable PDFs) ─────────────────

function matchAnnotationName(raw: string): { variable: string; label: string } | null {
  const s = raw.toLowerCase().replace(/[\s_\-\.]+/g, '')
  const MATCHERS: Array<{ re: RegExp; variable: string; label: string }> = [
    { re: /buyer(name|1)?$|buyersname/,           variable: '{{Contact.FullName}}',        label: 'Buyer Name' },
    { re: /buyer2|secondbuyer/,                    variable: '{{Buyer.Name2}}',             label: 'Buyer 2 Name' },
    { re: /seller(name|1)?$|sellersname/,          variable: '{{Seller.Name}}',             label: 'Seller Name' },
    { re: /seller2|secondseller/,                  variable: '{{Seller.Name2}}',            label: 'Seller 2 Name' },
    { re: /purchaseprice|saleprice|offerprice/,    variable: '{{Deal.OfferPrice}}',         label: 'Purchase Price' },
    { re: /earnest|binder|initialdep/,             variable: '{{Deal.EarnestMoney}}',       label: 'Earnest Money' },
    { re: /additionaldep|addldep|deposit2/,        variable: '{{Deal.AdditionalDeposit}}',  label: 'Additional Deposit' },
    { re: /balancetoclose|closingbalance/,         variable: '{{Deal.BalanceToClose}}',     label: 'Balance to Close' },
    { re: /loanamt|loanamount|mortgage|financing/, variable: '{{Deal.LoanAmount}}',         label: 'Loan Amount' },
    { re: /loantype|financingtype/,                variable: '{{Deal.LoanType}}',           label: 'Loan Type' },
    { re: /closingdate|closedate/,                 variable: '{{Deal.ClosingDate}}',        label: 'Closing Date' },
    { re: /inspect|duediligence/,                  variable: '{{Deal.InspectionDays}}',     label: 'Inspection Days' },
    { re: /sellercredit|sellercontr|sellerallowan/,variable: '{{Deal.SellerContribution}}', label: 'Seller Contribution' },
    { re: /repairlimit|repairallowan/,             variable: '{{Deal.RepairLimit}}',        label: 'Repair Limit' },
    { re: /expir/,                                 variable: '{{Deal.ExpirationDate}}',     label: 'Expiration Date' },
    { re: /propaddr|streetaddr|propertyaddr/,      variable: '{{Property.Address}}',        label: 'Address' },
    { re: /^city$/,                                variable: '{{Property.City}}',           label: 'City' },
    { re: /^state$/,                               variable: '{{Property.State}}',          label: 'State' },
    { re: /^zip/,                                  variable: '{{Property.Zip}}',            label: 'ZIP' },
    { re: /county/,                                variable: '{{Property.County}}',         label: 'County' },
    { re: /folio|parcel/,                          variable: '{{Property.Folio}}',          label: 'Folio / Parcel #' },
    { re: /legaldesc/,                             variable: '{{Property.LegalDesc}}',      label: 'Legal Description' },
    { re: /buyeremail|contactemail/,               variable: '{{Contact.Email}}',           label: 'Buyer Email' },
    { re: /buyerphone|contactphone/,               variable: '{{Contact.Phone}}',           label: 'Buyer Phone' },
    { re: /agentname|realtorname|brokername/,      variable: '{{Agent.Name}}',              label: 'Agent Name' },
    { re: /license|licno/,                         variable: '{{Agent.License}}',           label: 'License #' },
    { re: /brokerage|companyname/,                 variable: '{{Agent.Company}}',           label: 'Brokerage' },
    { re: /escrow|titleco|closingco/,              variable: '{{Escrow.Agent}}',            label: 'Escrow Agent' },
    { re: /effectivedate/,                         variable: '{{Date.Effective}}',          label: 'Effective Date' },
  ]
  for (const m of MATCHERS) {
    if (m.re.test(s)) return { variable: m.variable, label: m.label }
  }
  return null
}

// ── Auto-detect patterns ──────────────────────────────────────────────────────

const AUTO_DETECT_PATTERNS = [
  // Parties
  { re: /\bbuyer\s*(#?\s*1\s*)?(name)?:?\s*$/i,                  variable: '{{Contact.FullName}}',        label: 'Buyer Name' },
  { re: /\bbuyer\s*#?\s*2\s*(name)?:?\s*$/i,                     variable: '{{Buyer.Name2}}',             label: 'Buyer 2 Name' },
  { re: /\bseller\s*(#?\s*1\s*)?(name)?:?\s*$/i,                 variable: '{{Seller.Name}}',             label: 'Seller Name' },
  { re: /\bseller\s*#?\s*2\s*(name)?:?\s*$/i,                    variable: '{{Seller.Name2}}',            label: 'Seller 2 Name' },
  // Property
  { re: /\b(property\s*)?address:?\s*$/i,                        variable: '{{Property.Address}}',        label: 'Address' },
  { re: /\bcity:?\s*$/i,                                         variable: '{{Property.City}}',           label: 'City' },
  { re: /\bstate:?\s*$/i,                                        variable: '{{Property.State}}',          label: 'State' },
  { re: /\bzip(\s*code)?:?\s*$/i,                                variable: '{{Property.Zip}}',            label: 'ZIP' },
  { re: /\bcounty:?\s*$/i,                                       variable: '{{Property.County}}',         label: 'County' },
  { re: /\b(folio|parcel)\s*(no\.?|#|number)?:?\s*$/i,          variable: '{{Property.Folio}}',          label: 'Folio / Parcel #' },
  { re: /\blegal\s*(description)?:?\s*$/i,                       variable: '{{Property.LegalDesc}}',      label: 'Legal Description' },
  // Deal — price & deposits
  { re: /\b(purchase\s*price|offer\s*price|total\s*price):?\s*$/i, variable: '{{Deal.OfferPrice}}',      label: 'Purchase Price' },
  { re: /\b(initial\s*)?(earnest\s*money|binder|escrow\s*deposit):?\s*$/i, variable: '{{Deal.EarnestMoney}}', label: 'Earnest Money' },
  { re: /\badditional\s*deposit:?\s*$/i,                         variable: '{{Deal.AdditionalDeposit}}',  label: 'Additional Deposit' },
  { re: /\bbalance\s*(to\s*(close|closing))?:?\s*$/i,            variable: '{{Deal.BalanceToClose}}',     label: 'Balance to Close' },
  { re: /\b(loan|mortgage|financing)\s*(amount)?:?\s*$/i,        variable: '{{Deal.LoanAmount}}',         label: 'Loan Amount' },
  { re: /\b(loan|financing)\s*type:?\s*$/i,                      variable: '{{Deal.LoanType}}',           label: 'Loan Type' },
  // Deal — dates & timeline
  { re: /\b(closing\s*date|close\s*date):?\s*$/i,                variable: '{{Deal.ClosingDate}}',        label: 'Closing Date' },
  { re: /\b(inspection|due\s*diligence)\s*(period|days?)?:?\s*$/i, variable: '{{Deal.InspectionDays}}',  label: 'Inspection Days' },
  { re: /\b(offer\s*)?(expires?|expiration|void\s*after):?\s*$/i, variable: '{{Deal.ExpirationDate}}',   label: 'Expiration Date' },
  { re: /\beffective\s*date:?\s*$/i,                             variable: '{{Date.Effective}}',          label: 'Effective Date' },
  // Deal — terms
  { re: /\bseller\s*(credit|contribution|concession|allowance):?\s*$/i, variable: '{{Deal.SellerContribution}}', label: 'Seller Contribution' },
  { re: /\brepair\s*(limit|allowance|cap)?:?\s*$/i,              variable: '{{Deal.RepairLimit}}',        label: 'Repair Limit' },
  // Contacts
  { re: /\bemail:?\s*$/i,                                        variable: '{{Contact.Email}}',           label: 'Buyer Email' },
  { re: /\bphone:?\s*$/i,                                        variable: '{{Contact.Phone}}',           label: 'Buyer Phone' },
  // Agent
  { re: /\b(agent|realtor|broker)\s*(name)?:?\s*$/i,             variable: '{{Agent.Name}}',              label: 'Agent Name' },
  { re: /\blicense\s*(no\.?|#|number)?:?\s*$/i,                  variable: '{{Agent.License}}',           label: 'License #' },
  { re: /\bbrokerage:?\s*$/i,                                    variable: '{{Agent.Company}}',           label: 'Brokerage' },
  // Escrow
  { re: /\b(escrow|title|closing)\s*(agent|company|officer|attorney)?:?\s*$/i, variable: '{{Escrow.Agent}}', label: 'Escrow Agent' },
  // Date
  { re: /\b(date|today):?\s*$/i,                                 variable: '{{Date.Today}}',              label: "Today's Date" },
]

// ── Per-page PDF canvas + field overlay ──────────────────────────────────────

interface PageProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any
  pageNum: number
  scale: number
  fields: TemplateField[]
  activeVariable: string | null
  selectedFieldId: string | null
  onPlace: (page: number, x: number, y: number) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onDrag: (e: React.MouseEvent, id: string, pw: number, ph: number) => void
  onResize: (e: React.MouseEvent, id: string, pw: number, ph: number) => void
  onDimsReady: (page: number, w: number, h: number) => void
}

function PageCanvas({
  pdfDoc, pageNum, scale, fields, activeVariable,
  selectedFieldId, onPlace, onSelect, onDelete, onDrag, onResize, onDimsReady,
}: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    const render = async () => {
      const page = await pdfDoc.getPage(pageNum)
      const vp = page.getViewport({ scale })
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = vp.width; canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      if (!cancelled) { setDims({ w: vp.width, h: vp.height }); onDimsReady(pageNum, vp.width, vp.height) }
    }
    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageNum, scale, onDimsReady])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeVariable || !dims.w) return
    const rect = e.currentTarget.getBoundingClientRect()
    onPlace(pageNum, (e.clientX - rect.left) / dims.w, (e.clientY - rect.top) / dims.h)
  }

  const pageFields = fields.filter(f => f.page === pageNum)

  return (
    <div style={{ position: 'relative', marginBottom: 20, display: 'inline-block', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <div
        onClick={handleClick}
        style={{ position: 'absolute', inset: 0, cursor: activeVariable ? 'crosshair' : 'default' }}
      />
      {dims.w > 0 && pageFields.map(field => {
        const color = variableColor(field.variable)
        const isSelected = field.id === selectedFieldId
        const textPx = (field.fontSize ?? 11) * scale   // actual render size of the filled text
        return (
          <div
            key={field.id}
            onMouseDown={e => { e.stopPropagation(); onDrag(e, field.id, dims.w, dims.h) }}
            onClick={e => { e.stopPropagation(); onSelect(field.id) }}
            style={{
              position: 'absolute',
              left: `${field.x * dims.w}px`,
              top: `${field.y * dims.h}px`,
              width: `${field.w * dims.w}px`,
              height: `${field.h * dims.h}px`,
              backgroundColor: `${color}28`,
              border: `2px solid ${isSelected ? color : color + '90'}`,
              borderRadius: 3,
              cursor: 'move',
              overflow: 'hidden',
              userSelect: 'none', zIndex: 10,
              boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 3px ${color}` : undefined,
            }}
          >
            {/* Variable name badge — always tiny */}
            <span style={{
              position: 'absolute', top: 1, left: 3,
              fontSize: 7, fontWeight: 700, color, whiteSpace: 'nowrap',
              pointerEvents: 'none', lineHeight: 1, opacity: 0.7,
            }}>
              {field.label || variableLabel(field.variable)}
            </span>
            {/* Text size preview — matches what pdf-lib will print */}
            <span style={{
              position: 'absolute', bottom: 2, left: 4,
              fontSize: textPx, lineHeight: 1, color,
              whiteSpace: 'nowrap', pointerEvents: 'none', opacity: 0.5,
              fontFamily: 'Helvetica, Arial, sans-serif',
            }}>
              Abc
            </span>
            {/* Delete button */}
            {isSelected && (
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onDelete(field.id) }}
                style={{
                  position: 'absolute', top: -9, right: -9,
                  width: 18, height: 18, borderRadius: '50%',
                  backgroundColor: '#ef4444', color: '#fff',
                  fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11,
                }}
              >×</button>
            )}
            {/* Resize handle — bottom-right corner */}
            <div
              onMouseDown={e => { e.stopPropagation(); onResize(e, field.id, dims.w, dims.h) }}
              style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 12, height: 12,
                cursor: 'se-resize', zIndex: 12,
                background: `linear-gradient(135deg, transparent 50%, ${color} 50%)`,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Main Builder ──────────────────────────────────────────────────────────────

export default function BuilderClient() {
  const searchParams = useSearchParams()
  const idParam = searchParams.get('id')

  const [step, setStep] = useState<'source' | 'builder'>('source')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [activeVariable, setActiveVariable] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedBanner, setSavedBanner] = useState<string | null>(null)
  const [autoDetecting, setAutoDetecting] = useState(false)

  // Source picker state
  const [contracts, setContracts] = useState<ContractTemplate[]>([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load pdf with pdfjs when pdfUrl is set
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    const load = async () => {
      setPdfLoading(true)
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise
      if (!cancelled) { setPdfDoc(doc); setNumPages(doc.numPages); setPdfLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [pdfUrl])

  // Load a contract template and switch to builder
  const loadTemplate = useCallback(async (id: string) => {
    const res = await fetch(`/api/contract-templates/${id}`)
    if (!res.ok) return
    const data = await res.json()
    setTemplateId(id)
    setTemplateName(data.name ?? '')
    if (Array.isArray(data.field_mappings)) setFields(data.field_mappings)
    if (data.url) setPdfUrl(data.url)
    setStep('builder')
  }, [])

  // If URL has ?id=, jump straight to builder
  useEffect(() => {
    if (idParam) {
      loadTemplate(idParam)
    } else {
      fetch('/api/contract-templates')
        .then(r => r.json())
        .then(d => setContracts(Array.isArray(d) ? d : []))
        .catch(() => {})
        .finally(() => setContractsLoading(false))
    }
  }, [idParam, loadTemplate])

  // Upload a new PDF → creates contract template → loads into builder
  const handleUpload = async (file: File) => {
    if (file.type !== 'application/pdf') { setUploadError('Only PDF files accepted.'); return }
    setUploading(true); setUploadError(null)
    const fd = new FormData()
    fd.append('file', file); fd.append('name', file.name.replace(/\.pdf$/i, ''))
    const res = await fetch('/api/contract-templates/upload', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setUploadError(data.error ?? 'Upload failed'); return }
    await loadTemplate(data.id)
  }

  // Page dims callback (stored for potential future use by parent)
  const handleDimsReady = useCallback((_page: number, _w: number, _h: number) => {}, [])

  // Place a field on click
  const handlePlace = useCallback((page: number, xFrac: number, yFrac: number) => {
    if (!activeVariable) return
    const w = 0.22, h = 0.04
    const newField: TemplateField = {
      id: crypto.randomUUID(),
      page,
      x: Math.max(0, Math.min(xFrac - w / 2, 1 - w)),
      y: Math.max(0, Math.min(yFrac - h / 2, 1 - h)),
      w, h,
      variable: activeVariable,
      label: variableLabel(activeVariable),
      defaultValue: '',
      fontSize: 11,
    }
    setFields(prev => [...prev, newField])
    setSelectedFieldId(newField.id)
  }, [activeVariable])

  // Drag a field
  const handleDrag = useCallback((e: React.MouseEvent, fieldId: string, pw: number, ph: number) => {
    e.stopPropagation()
    const field = fields.find(f => f.id === fieldId)
    if (!field) return
    const startX = e.clientX, startY = e.clientY
    const origX = field.x, origY = field.y
    const onMove = (ev: MouseEvent) => {
      setFields(prev => prev.map(f => f.id === fieldId ? {
        ...f,
        x: Math.max(0, Math.min(origX + (ev.clientX - startX) / pw, 1 - f.w)),
        y: Math.max(0, Math.min(origY + (ev.clientY - startY) / ph, 1 - f.h)),
      } : f))
    }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    setSelectedFieldId(fieldId)
  }, [fields])

  const handleResize = useCallback((e: React.MouseEvent, fieldId: string, pw: number, ph: number) => {
    e.stopPropagation()
    const field = fields.find(f => f.id === fieldId)
    if (!field) return
    const startX = e.clientX, startY = e.clientY
    const origW = field.w, origH = field.h
    const onMove = (ev: MouseEvent) => {
      setFields(prev => prev.map(f => f.id === fieldId ? {
        ...f,
        w: Math.max(0.04, Math.min(origW + (ev.clientX - startX) / pw, 1 - f.x)),
        h: Math.max(0.015, Math.min(origH + (ev.clientY - startY) / ph, 1 - f.y)),
      } : f))
    }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    setSelectedFieldId(fieldId)
  }, [fields])

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
    if (selectedFieldId === id) setSelectedFieldId(null)
  }

  // Auto-detect fields using pdfjs text content
  const autoDetect = async () => {
    if (!pdfDoc) return
    setAutoDetecting(true)
    const newFields: TemplateField[] = []
    let foundAnyContent = false  // true if PDF has text or form fields

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const pw = vp.width
      const ph = vp.height

      // ── Path 1: AcroForm widget annotations (fillable/interactive PDFs) ──────
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const annotations: any[] = await page.getAnnotations()
        const widgets = annotations.filter(
          a => a.subtype === 'Widget' && (a.fieldType === 'Tx' || a.fieldType === 'Ch')
        )
        if (widgets.length) foundAnyContent = true

        for (const w of widgets) {
          const name = String(w.fieldName ?? w.alternativeText ?? w.T ?? '')
          const match = matchAnnotationName(name)
          if (!match) continue

          const [x1, y1, x2, y2] = (w.rect as number[]) ?? [0, 0, 0, 0]
          const normX = x1 / pw
          const normY = 1 - y2 / ph        // y2 is TOP of widget in PDF coords (y from bottom)
          const normW = Math.max((x2 - x1) / pw, 0.08)
          const normH = Math.max((y2 - y1) / ph, 0.025)

          newFields.push({
            id: crypto.randomUUID(),
            page: p,
            x: Math.max(0, Math.min(normX, 1 - normW)),
            y: Math.max(0, Math.min(normY, 1 - normH)),
            w: normW, h: normH,
            variable: match.variable,
            label: match.label,
            defaultValue: '',
            fontSize: 10,
          })
        }
      } catch { /* annotations unavailable */ }

      // ── Path 2: Text content (digitally-created PDFs with text layer) ─────────
      try {
        const content = await page.getTextContent()
        const items = content.items as Array<{ str: string; transform: number[]; width?: number }>

        for (const item of items) {
          const trimmed = item.str.trim()
          if (!trimmed) continue
          foundAnyContent = true

          for (const pattern of AUTO_DETECT_PATTERNS) {
            if (pattern.re.test(trimmed)) {
              const [, , , , tx, ty] = item.transform
              // Place field immediately to the right of the matched label text
              const textW = (item.width ?? trimmed.length * 7)
              const fieldX = Math.max(0, Math.min((tx + textW) / pw + 0.01, 0.72))
              const fieldW = Math.min(0.26, 0.98 - fieldX)
              const fieldY = Math.max(0, Math.min(1 - ty / ph - 0.035, 0.96))

              newFields.push({
                id: crypto.randomUUID(),
                page: p,
                x: fieldX,
                y: fieldY,
                w: fieldW, h: 0.04,
                variable: pattern.variable,
                label: pattern.label,
                defaultValue: '',
                fontSize: 11,
              })
              break
            }
          }
        }
      } catch { /* text content unavailable */ }
    }

    setFields(prev => [...prev, ...newFields])
    setAutoDetecting(false)

    if (!foundAnyContent) {
      setSavedBanner('This PDF has no text layer (scanned image). Place fields manually by clicking on the PDF — auto-detect only works on digital PDFs.')
      setTimeout(() => setSavedBanner(null), 7000)
    } else if (!newFields.length) {
      setSavedBanner('No matching field labels found. Try placing fields manually.')
      setTimeout(() => setSavedBanner(null), 4000)
    } else {
      setSavedBanner(`Added ${newFields.length} field${newFields.length !== 1 ? 's' : ''}. Drag to reposition.`)
      setTimeout(() => setSavedBanner(null), 4000)
    }
  }

  // Save template mappings
  const save = async () => {
    if (!templateId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/contract-templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_mappings: fields, name: templateName }),
      })
      if (res.ok) {
        setSavedBanner('Template saved!')
      } else {
        const d = await res.json()
        setSavedBanner(d.error ?? 'Save failed.')
      }
    } catch {
      setSavedBanner('Save failed.')
    } finally {
      setSaving(false)
      setTimeout(() => setSavedBanner(null), 4000)
    }
  }

  const selectedField = fields.find(f => f.id === selectedFieldId) ?? null

  // ── Source picker ─────────────────────────────────────────────────────────────

  if (step === 'source') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--c-bg)', color: 'var(--c-primary)' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px' }}>

          <div style={{ marginBottom: 32 }}>
            <a href="/documents/templates" style={{ fontSize: 13, color: 'var(--c-text-2)', textDecoration: 'none' }}>
              ← Templates
            </a>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>Build a PDF Template</h1>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginTop: 4 }}>
              Click fields on your PDF to map them to auto-fill variables like Buyer Name, Address, Offer Price, and more.
            </p>
          </div>

          {/* Upload new */}
          <div style={{
            backgroundColor: 'var(--c-card)', border: '2px dashed var(--c-border)', borderRadius: 14,
            padding: '28px 24px', marginBottom: 24, cursor: 'pointer', textAlign: 'center',
            transition: 'border-color 0.15s',
          }}
            onClick={() => fileRef.current?.click()}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#C9A84C')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--c-border)')}
          >
            <input
              ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
            />
            <div style={{ fontSize: 28, marginBottom: 8 }}>⬆</div>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              {uploading ? 'Uploading…' : 'Upload a New PDF'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
              Uploads to your Contract Library and opens the builder
            </p>
            {uploadError && <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{uploadError}</p>}
          </div>

          {/* From existing library */}
          {contractsLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 13 }}>Loading library…</div>
          ) : contracts.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Or choose from your Contract Library
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {contracts.map(c => (
                  <div key={c.id} style={{
                    backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12,
                    padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <div style={{ fontSize: 20 }}>📄</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--c-text-2)' }}>
                        {c.category}{c.page_count ? ` · ${c.page_count}p` : ''}
                        {c.field_mappings?.length ? ` · ${c.field_mappings.length} mapped fields` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => loadTemplate(c.id)}
                      style={{
                        padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C',
                        border: '1px solid rgba(201,168,76,0.3)', cursor: 'pointer',
                      }}
                    >
                      {c.field_mappings?.length ? 'Edit Fields' : 'Add Fields'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Builder ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-bg)' }}>

      {/* Left panel — variable picker */}
      <div className="w-56 shrink-0 flex flex-col border-r overflow-y-auto"
        style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }}>

        <div className="p-4 shrink-0 border-b" style={{ borderColor: 'var(--c-border)' }}>
          <button
            onClick={() => setStep('source')}
            className="text-xs font-semibold hover:underline mb-2 block"
            style={{ color: 'var(--c-text-2)' }}
          >
            ← Templates
          </button>
          <input
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            className="w-full text-sm font-bold focus:outline-none bg-transparent"
            style={{ color: 'var(--c-primary)' }}
            placeholder="Template name"
          />
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-2)' }}>{fields.length} field{fields.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="p-3 shrink-0 border-b" style={{ borderColor: 'var(--c-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>
            Select Variable — then click PDF
          </p>
          {VARIABLE_GROUPS.map(group => (
            <div key={group.category} className="mb-3">
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: group.color }}>
                {group.category}
              </p>
              {group.items.map(item => (
                <button
                  key={item.variable}
                  onClick={() => setActiveVariable(prev => prev === item.variable ? null : item.variable)}
                  className="w-full text-left text-[11px] font-semibold px-2 py-1 rounded-lg mb-0.5"
                  style={{
                    backgroundColor: activeVariable === item.variable ? `${group.color}20` : 'transparent',
                    color: activeVariable === item.variable ? group.color : 'var(--c-text-2)',
                    border: `1px solid ${activeVariable === item.variable ? group.color : 'transparent'}`,
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {activeVariable ? (
          <div className="p-3 shrink-0">
            <p className="text-[10px] font-bold text-center" style={{ color: '#C9A84C' }}>
              Click on the PDF to place ↓
            </p>
          </div>
        ) : (
          <div className="p-3 shrink-0">
            <p className="text-[10px] text-center" style={{ color: 'var(--c-text-3)' }}>
              Select a variable above
            </p>
          </div>
        )}
      </div>

      {/* PDF area */}
      <div
        className="flex-1 overflow-auto p-8"
        style={{ backgroundColor: '#d1d5db' }}
        onClick={() => { if (!activeVariable) setSelectedFieldId(null) }}
      >
        {pdfLoading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm font-semibold text-gray-600">Loading PDF…</p>
          </div>
        )}
        {!pdfLoading && pdfDoc && (
          <div className="flex flex-col items-center">
            {Array.from({ length: numPages }, (_, i) => i + 1).map(p => (
              <PageCanvas
                key={p}
                pdfDoc={pdfDoc}
                pageNum={p}
                scale={Math.min(800 / 612, 1.5)}
                fields={fields}
                activeVariable={activeVariable}
                selectedFieldId={selectedFieldId}
                onPlace={handlePlace}
                onSelect={setSelectedFieldId}
                onDelete={removeField}
                onDrag={handleDrag}
                onResize={handleResize}
                onDimsReady={handleDimsReady}
              />
            ))}
          </div>
        )}
        {!pdfLoading && !pdfDoc && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-500">No PDF loaded.</p>
          </div>
        )}
      </div>

      {/* Right panel — field properties + actions */}
      <div className="w-52 shrink-0 flex flex-col border-l"
        style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }}>

        <div className="flex-1 overflow-y-auto p-4">
          {selectedField ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-3)' }}>
                Field Properties
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Variable</label>
                  <select
                    value={selectedField.variable}
                    onChange={e => {
                      const v = e.target.value
                      setFields(prev => prev.map(f => f.id === selectedField.id
                        ? { ...f, variable: v, label: variableLabel(v) }
                        : f))
                    }}
                    className="w-full text-[10px] px-2 py-1.5 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                  >
                    {VARIABLE_GROUPS.map(g => (
                      <optgroup key={g.category} label={g.category}>
                        {g.items.map(i => (
                          <option key={i.variable} value={i.variable}>{i.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Label</label>
                  <input
                    value={selectedField.label}
                    onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, label: e.target.value } : f))}
                    className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Default Value</label>
                  <input
                    value={selectedField.defaultValue}
                    onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, defaultValue: e.target.value } : f))}
                    placeholder="Leave blank to auto-fill"
                    className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Font Size</label>
                  <input
                    type="number" min={7} max={24}
                    value={selectedField.fontSize}
                    onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, fontSize: Number(e.target.value) } : f))}
                    className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                  />
                </div>
                <button
                  onClick={() => removeField(selectedField.id)}
                  className="w-full text-xs font-semibold py-1.5 rounded-lg hover:opacity-80"
                  style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  Delete Field
                </button>
              </div>
            </>
          ) : (
            <div className="text-center pt-8">
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                {activeVariable
                  ? 'Click on the PDF to place a field'
                  : 'Select a field or variable to get started'}
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t space-y-2 shrink-0" style={{ borderColor: 'var(--c-border)' }}>
          {savedBanner && (
            <p className="text-xs text-center font-semibold" style={{ color: savedBanner.includes('failed') || savedBanner.includes('No') ? '#ef4444' : '#4ACF9A' }}>
              {savedBanner}
            </p>
          )}
          <button
            onClick={autoDetect}
            disabled={autoDetecting || !pdfDoc}
            className="w-full py-2 rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
          >
            {autoDetecting ? 'Detecting…' : '✦ Auto Detect Fields'}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          >
            {saving ? 'Saving…' : 'Save Template'}
          </button>
          <a
            href="/documents/templates"
            className="block text-center text-xs py-1 hover:underline"
            style={{ color: 'var(--c-text-3)' }}
          >
            ← Back to Templates
          </a>
        </div>
      </div>

    </div>
  )
}
