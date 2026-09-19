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
  fieldType: string       // 'merge_text' | 'signature' | 'initial' | 'date' | 'checkbox'
  signerRoleId: string | null
}

interface SignerRole {
  id: string
  name: string
  color: string
  auto_suggest: string | null
}

interface ContractTemplate {
  id: string
  name: string
  category: string
  page_count: number | null
  current_version_id: string | null
  draft_field_count: number
  created_at: string
}

interface DetectedSuggestion {
  label: string
  fieldType: 'signature' | 'initial'
  signerRoleId: string | null
  roleName: string
  page: number
  x: number
  y: number
  w: number
  h: number
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

function fieldColor(field: TemplateField, signerRoles: SignerRole[]): string {
  if (field.fieldType === 'signature' || field.fieldType === 'initial') {
    const role = signerRoles.find(r => r.id === field.signerRoleId)
    return role?.color ?? '#7B8FD4'
  }
  return variableColor(field.variable)
}

function fieldDisplayLabel(field: TemplateField, signerRoles: SignerRole[]): string {
  if (field.fieldType === 'signature' || field.fieldType === 'initial') {
    const role = signerRoles.find(r => r.id === field.signerRoleId)
    const roleName = role?.name ?? 'Signer'
    return field.fieldType === 'signature' ? `${roleName} — Sig` : `${roleName} — INI`
  }
  return field.label || variableLabel(field.variable)
}

// ── Signing label detection patterns ─────────────────────────────────────────
// Used by detectSigningFields() to propose signature/initial placements from PDF text.

const SIGNING_DETECT_PATTERNS: Array<{
  re: RegExp
  fieldType: 'signature' | 'initial'
  roleKey: string   // matches signer_roles.name (case-insensitive); '' = unknown role
  displayLabel: string
}> = [
  { re: /buyer['']?s?\s+signature/i,     fieldType: 'signature', roleKey: 'Buyer',   displayLabel: 'Buyer Signature' },
  { re: /purchaser['']?s?\s+signature/i, fieldType: 'signature', roleKey: 'Buyer',   displayLabel: 'Purchaser Signature' },
  { re: /seller['']?s?\s+signature/i,    fieldType: 'signature', roleKey: 'Seller',  displayLabel: 'Seller Signature' },
  { re: /owner['']?s?\s+signature/i,     fieldType: 'signature', roleKey: 'Seller',  displayLabel: 'Owner Signature' },
  { re: /client['']?s?\s+signature/i,    fieldType: 'signature', roleKey: 'Client',  displayLabel: 'Client Signature' },
  { re: /agent['']?s?\s+signature/i,     fieldType: 'signature', roleKey: 'Agent',   displayLabel: 'Agent Signature' },
  { re: /witness['']?s?\s+signature/i,   fieldType: 'signature', roleKey: 'Witness', displayLabel: 'Witness Signature' },
  { re: /buyer['']?s?\s+initial/i,       fieldType: 'initial',   roleKey: 'Buyer',   displayLabel: 'Buyer Initials' },
  { re: /purchaser['']?s?\s+initial/i,   fieldType: 'initial',   roleKey: 'Buyer',   displayLabel: 'Purchaser Initials' },
  { re: /seller['']?s?\s+initial/i,      fieldType: 'initial',   roleKey: 'Seller',  displayLabel: 'Seller Initials' },
  { re: /owner['']?s?\s+initial/i,       fieldType: 'initial',   roleKey: 'Seller',  displayLabel: 'Owner Initials' },
  { re: /client['']?s?\s+initial/i,      fieldType: 'initial',   roleKey: 'Client',  displayLabel: 'Client Initials' },
  { re: /^initial[s]?:?\s*$/i,           fieldType: 'initial',   roleKey: '',        displayLabel: 'Initials' },
  { re: /^sign\s*here:?\s*$/i,           fieldType: 'signature', roleKey: '',        displayLabel: 'Sign Here' },
]

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
  { re: /\bbuyer\s*(#?\s*1\s*)?(name)?:?\s*$/i,                  variable: '{{Contact.FullName}}',        label: 'Buyer Name' },
  { re: /\bbuyer\s*#?\s*2\s*(name)?:?\s*$/i,                     variable: '{{Buyer.Name2}}',             label: 'Buyer 2 Name' },
  { re: /\bseller\s*(#?\s*1\s*)?(name)?:?\s*$/i,                 variable: '{{Seller.Name}}',             label: 'Seller Name' },
  { re: /\bseller\s*#?\s*2\s*(name)?:?\s*$/i,                    variable: '{{Seller.Name2}}',            label: 'Seller 2 Name' },
  { re: /\b(property\s*)?address:?\s*$/i,                        variable: '{{Property.Address}}',        label: 'Address' },
  { re: /\bcity:?\s*$/i,                                         variable: '{{Property.City}}',           label: 'City' },
  { re: /\bstate:?\s*$/i,                                        variable: '{{Property.State}}',          label: 'State' },
  { re: /\bzip(\s*code)?:?\s*$/i,                                variable: '{{Property.Zip}}',            label: 'ZIP' },
  { re: /\bcounty:?\s*$/i,                                       variable: '{{Property.County}}',         label: 'County' },
  { re: /\b(folio|parcel)\s*(no\.?|#|number)?:?\s*$/i,          variable: '{{Property.Folio}}',          label: 'Folio / Parcel #' },
  { re: /\blegal\s*(description)?:?\s*$/i,                       variable: '{{Property.LegalDesc}}',      label: 'Legal Description' },
  { re: /\b(purchase\s*price|offer\s*price|total\s*price):?\s*$/i, variable: '{{Deal.OfferPrice}}',      label: 'Purchase Price' },
  { re: /\b(initial\s*)?(earnest\s*money|binder|escrow\s*deposit):?\s*$/i, variable: '{{Deal.EarnestMoney}}', label: 'Earnest Money' },
  { re: /\badditional\s*deposit:?\s*$/i,                         variable: '{{Deal.AdditionalDeposit}}',  label: 'Additional Deposit' },
  { re: /\bbalance\s*(to\s*(close|closing))?:?\s*$/i,            variable: '{{Deal.BalanceToClose}}',     label: 'Balance to Close' },
  { re: /\b(loan|mortgage|financing)\s*(amount)?:?\s*$/i,        variable: '{{Deal.LoanAmount}}',         label: 'Loan Amount' },
  { re: /\b(loan|financing)\s*type:?\s*$/i,                      variable: '{{Deal.LoanType}}',           label: 'Loan Type' },
  { re: /\b(closing\s*date|close\s*date):?\s*$/i,                variable: '{{Deal.ClosingDate}}',        label: 'Closing Date' },
  { re: /\b(inspection|due\s*diligence)\s*(period|days?)?:?\s*$/i, variable: '{{Deal.InspectionDays}}',  label: 'Inspection Days' },
  { re: /\b(offer\s*)?(expires?|expiration|void\s*after):?\s*$/i, variable: '{{Deal.ExpirationDate}}',   label: 'Expiration Date' },
  { re: /\beffective\s*date:?\s*$/i,                             variable: '{{Date.Effective}}',          label: 'Effective Date' },
  { re: /\bseller\s*(credit|contribution|concession|allowance):?\s*$/i, variable: '{{Deal.SellerContribution}}', label: 'Seller Contribution' },
  { re: /\brepair\s*(limit|allowance|cap)?:?\s*$/i,              variable: '{{Deal.RepairLimit}}',        label: 'Repair Limit' },
  { re: /\bemail:?\s*$/i,                                        variable: '{{Contact.Email}}',           label: 'Buyer Email' },
  { re: /\bphone:?\s*$/i,                                        variable: '{{Contact.Phone}}',           label: 'Buyer Phone' },
  { re: /\b(agent|realtor|broker)\s*(name)?:?\s*$/i,             variable: '{{Agent.Name}}',              label: 'Agent Name' },
  { re: /\blicense\s*(no\.?|#|number)?:?\s*$/i,                  variable: '{{Agent.License}}',           label: 'License #' },
  { re: /\bbrokerage:?\s*$/i,                                    variable: '{{Agent.Company}}',           label: 'Brokerage' },
  { re: /\b(escrow|title|closing)\s*(agent|company|officer|attorney)?:?\s*$/i, variable: '{{Escrow.Agent}}', label: 'Escrow Agent' },
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
  selectedFieldIds: Set<string>
  hasActiveTool: boolean
  signerRoles: SignerRole[]
  onPlace: (page: number, x: number, y: number) => void
  onSelect: (id: string, multi: boolean) => void
  onDelete: (id: string) => void
  onDrag: (e: React.MouseEvent, id: string, pw: number, ph: number) => void
  onResize: (e: React.MouseEvent, id: string, pw: number, ph: number) => void
  onDimsReady: (page: number, w: number, h: number) => void
}

function PageCanvas({
  pdfDoc, pageNum, scale, fields, activeVariable,
  selectedFieldIds, hasActiveTool, signerRoles,
  onPlace, onSelect, onDelete, onDrag, onResize, onDimsReady,
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
    if (!hasActiveTool || !dims.w) return
    const rect = e.currentTarget.getBoundingClientRect()
    onPlace(pageNum, (e.clientX - rect.left) / dims.w, (e.clientY - rect.top) / dims.h)
  }

  const pageFields = fields.filter(f => f.page === pageNum)

  return (
    <div style={{ position: 'relative', marginBottom: 20, display: 'inline-block', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <div
        onClick={handleClick}
        style={{ position: 'absolute', inset: 0, cursor: hasActiveTool ? 'crosshair' : 'default' }}
      />
      {dims.w > 0 && pageFields.map(field => {
        const color = fieldColor(field, signerRoles)
        const isSigning = field.fieldType === 'signature' || field.fieldType === 'initial'
        const isSelected = selectedFieldIds.has(field.id)
        const isOnlySelected = isSelected && selectedFieldIds.size === 1
        const textPx = (field.fontSize ?? 11) * scale
        return (
          <div
            key={field.id}
            onMouseDown={e => { e.stopPropagation(); onDrag(e, field.id, dims.w, dims.h) }}
            onClick={e => { e.stopPropagation(); onSelect(field.id, e.shiftKey || e.metaKey || e.ctrlKey) }}
            style={{
              position: 'absolute',
              left: `${field.x * dims.w}px`,
              top: `${field.y * dims.h}px`,
              width: `${field.w * dims.w}px`,
              height: `${field.h * dims.h}px`,
              backgroundColor: isSigning ? `${color}20` : `${color}28`,
              border: `2px solid ${isSelected ? color : color + '90'}`,
              borderRadius: isSigning ? 6 : 3,
              cursor: 'move',
              overflow: 'hidden',
              userSelect: 'none', zIndex: 10,
              boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 3px ${color}` : undefined,
            }}
          >
            <span style={{
              position: 'absolute', top: 1, left: 3,
              fontSize: 7, fontWeight: 700, color, whiteSpace: 'nowrap',
              pointerEvents: 'none', lineHeight: 1, opacity: 0.85,
            }}>
              {fieldDisplayLabel(field, signerRoles)}
            </span>
            {isSigning ? (
              <span style={{
                position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                fontSize: Math.max(10, (field.h * dims.h) * 0.45), lineHeight: 1, color,
                pointerEvents: 'none', opacity: 0.4,
              }}>
                {field.fieldType === 'signature' ? '✍' : 'INI'}
              </span>
            ) : (
              <span style={{
                position: 'absolute', bottom: 2, left: 4,
                fontSize: textPx, lineHeight: 1, color,
                whiteSpace: 'nowrap', pointerEvents: 'none', opacity: 0.5,
                fontFamily: 'Helvetica, Arial, sans-serif',
              }}>
                Abc
              </span>
            )}
            {/* Delete × button — only in single-select */}
            {isOnlySelected && (
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
            {/* Resize handle */}
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

// ── Alignment button config ───────────────────────────────────────────────────

const ALIGN_BUTTONS: Array<{ key: string; label: string; title: string }> = [
  { key: 'left',    label: '⊣L',  title: 'Align left edges' },
  { key: 'center-h',label: '↔C', title: 'Center horizontally' },
  { key: 'right',   label: 'R⊢',  title: 'Align right edges' },
  { key: 'dist-h',  label: '⇔',   title: 'Distribute horizontal gaps evenly (3+ fields)' },
  { key: 'top',     label: '⊤T',  title: 'Align top edges' },
  { key: 'center-v',label: '↕C',  title: 'Center vertically' },
  { key: 'bottom',  label: 'B⊥',  title: 'Align bottom edges' },
  { key: 'dist-v',  label: '⇕',   title: 'Distribute vertical gaps evenly (3+ fields)' },
]

// ── Main Builder ──────────────────────────────────────────────────────────────

export default function BuilderClient() {
  const searchParams = useSearchParams()
  const idParam = searchParams.get('id')

  // ── Core state ────────────────────────────────────────────────────────────
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
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savedBanner, setSavedBanner] = useState<string | null>(null)
  const [autoDetecting, setAutoDetecting] = useState(false)
  const [currentVersionLabel, setCurrentVersionLabel] = useState<string | null>(null)
  const [signerRoles, setSignerRoles] = useState<SignerRole[]>([])
  const [activeSigningFieldType, setActiveSigningFieldType] = useState<'signature' | 'initial' | null>(null)
  const [activeSigningRoleId, setActiveSigningRoleId] = useState<string | null>(null)
  const [contracts, setContracts] = useState<ContractTemplate[]>([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ── Productivity state ────────────────────────────────────────────────────
  const [clipboard, setClipboard] = useState<TemplateField[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [detectedSuggestions, setDetectedSuggestions] = useState<DetectedSuggestion[]>([])
  const [showDetectModal, setShowDetectModal] = useState(false)
  const [detectingSignFields, setDetectingSignFields] = useState(false)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const undoStackRef = useRef<TemplateField[][]>([])
  const redoStackRef = useRef<TemplateField[][]>([])
  const fieldsRef = useRef<TemplateField[]>([])
  const selectedFieldIdsRef = useRef<Set<string>>(new Set())

  // Keep refs in sync with state
  useEffect(() => { fieldsRef.current = fields }, [fields])
  useEffect(() => { selectedFieldIdsRef.current = selectedFieldIds }, [selectedFieldIds])

  // ── History helpers ───────────────────────────────────────────────────────

  const setFieldsWithHistory = useCallback((newFields: TemplateField[]) => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), fieldsRef.current]
    redoStackRef.current = []
    setCanUndo(true)
    setCanRedo(false)
    setFields(newFields)
  }, [])

  const undo = useCallback(() => {
    if (!undoStackRef.current.length) return
    const prev = undoStackRef.current[undoStackRef.current.length - 1]
    redoStackRef.current = [...redoStackRef.current, fieldsRef.current]
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    setCanUndo(undoStackRef.current.length > 0)
    setCanRedo(true)
    setFields(prev)
    setSelectedFieldIds(new Set())
  }, [])

  const redo = useCallback(() => {
    if (!redoStackRef.current.length) return
    const next = redoStackRef.current[redoStackRef.current.length - 1]
    undoStackRef.current = [...undoStackRef.current, fieldsRef.current]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    setCanUndo(true)
    setCanRedo(redoStackRef.current.length > 0)
    setFields(next)
    setSelectedFieldIds(new Set())
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 'builder') return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return

      const meta = e.metaKey || e.ctrlKey
      const cur = fieldsRef.current
      const ids = selectedFieldIdsRef.current

      if (e.key === 'Escape') {
        e.preventDefault()
        setSelectedFieldIds(new Set())
        setActiveVariable(null)
        setActiveSigningFieldType(null)
        setActiveSigningRoleId(null)
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !meta && ids.size > 0) {
        e.preventDefault()
        setFieldsWithHistory(cur.filter(f => !ids.has(f.id)))
        setSelectedFieldIds(new Set())
        return
      }

      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (meta && e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); return }

      if (meta && e.key === 'c' && !e.shiftKey && ids.size > 0) {
        e.preventDefault()
        setClipboard(cur.filter(f => ids.has(f.id)))
        return
      }

      if (meta && e.key === 'v' && !e.shiftKey) {
        e.preventDefault()
        const cb = clipboard
        if (cb.length > 0) {
          const pasted = cb.map(f => ({ ...f, id: crypto.randomUUID(), x: Math.min(f.x + 0.02, 0.95), y: Math.min(f.y + 0.02, 0.95) }))
          setFieldsWithHistory([...cur, ...pasted])
          setSelectedFieldIds(new Set(pasted.map(f => f.id)))
        }
        return
      }

      if (meta && e.key === 'd' && !e.shiftKey && ids.size > 0) {
        e.preventDefault()
        const duped = cur.filter(f => ids.has(f.id)).map(f => ({ ...f, id: crypto.randomUUID(), x: Math.min(f.x + 0.02, 0.95), y: Math.min(f.y + 0.02, 0.95) }))
        setFieldsWithHistory([...cur, ...duped])
        setSelectedFieldIds(new Set(duped.map(f => f.id)))
        return
      }

      // Arrow nudge — does not push to undo (too frequent; drag can always reverse)
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && ids.size > 0) {
        e.preventDefault()
        const nudge = e.shiftKey ? 0.01 : 0.002
        setFields(cur.map(f => {
          if (!ids.has(f.id)) return f
          return {
            ...f,
            x: e.key === 'ArrowLeft'  ? Math.max(0, f.x - nudge)
              : e.key === 'ArrowRight' ? Math.min(1 - f.w, f.x + nudge)
              : f.x,
            y: e.key === 'ArrowUp'    ? Math.max(0, f.y - nudge)
              : e.key === 'ArrowDown'  ? Math.min(1 - f.h, f.y + nudge)
              : f.y,
          }
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, clipboard, undo, redo, setFieldsWithHistory])

  // ── Load PDF with pdfjs when pdfUrl is set ────────────────────────────────

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

  // ── Load signer roles once on mount ──────────────────────────────────────

  useEffect(() => {
    fetch('/api/signer-roles')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.roles)) setSignerRoles(d.roles) })
      .catch(() => {})
  }, [])

  // ── Template load ─────────────────────────────────────────────────────────

  const loadTemplate = useCallback(async (id: string) => {
    const res = await fetch(`/api/contract-templates/${id}`)
    if (!res.ok) return
    const data = await res.json()
    setTemplateId(id)
    setTemplateName(data.name ?? '')

    const fieldsRes = await fetch(`/api/contract-templates/${id}/fields`)
    if (fieldsRes.ok) {
      const fd = await fieldsRes.json()
      if (Array.isArray(fd.fields) && fd.fields.length > 0) setFields(fd.fields)
    }

    const versRes = await fetch(`/api/contract-templates/${id}/versions`)
    if (versRes.ok) {
      const vd = await versRes.json()
      const current = Array.isArray(vd.versions) ? vd.versions.find((v: { is_current: boolean; version_label: string }) => v.is_current) : null
      if (current) setCurrentVersionLabel(current.version_label)
    }

    if (data.url) setPdfUrl(data.url)
    setStep('builder')
  }, [])

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

  // ── Upload new PDF → create template → load into builder ─────────────────

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

  const handleDimsReady = useCallback((_page: number, _w: number, _h: number) => {}, [])

  // ── Place field on click ──────────────────────────────────────────────────

  const handlePlace = useCallback((page: number, xFrac: number, yFrac: number) => {
    const isSigning = !!(activeSigningFieldType && activeSigningRoleId)
    if (!activeVariable && !isSigning) return
    const w = isSigning ? 0.28 : 0.22
    const h = isSigning ? 0.06 : 0.04
    const role = isSigning ? signerRoles.find(r => r.id === activeSigningRoleId) : null
    const newField: TemplateField = {
      id: crypto.randomUUID(),
      page,
      x: Math.max(0, Math.min(xFrac - w / 2, 1 - w)),
      y: Math.max(0, Math.min(yFrac - h / 2, 1 - h)),
      w, h,
      variable: activeVariable ?? '',
      label: isSigning
        ? `${role?.name ?? 'Signer'} ${activeSigningFieldType === 'signature' ? 'Signature' : 'Initials'}`
        : variableLabel(activeVariable!),
      defaultValue: '',
      fontSize: 11,
      fieldType: isSigning ? activeSigningFieldType! : 'merge_text',
      signerRoleId: isSigning ? activeSigningRoleId : null,
    }
    setFieldsWithHistory([...fieldsRef.current, newField])
    setSelectedFieldIds(new Set([newField.id]))
  }, [activeVariable, activeSigningFieldType, activeSigningRoleId, signerRoles, setFieldsWithHistory])

  // ── Drag — supports multi-select: dragging any selected field moves the group ─

  const handleDrag = useCallback((e: React.MouseEvent, fieldId: string, pw: number, ph: number) => {
    e.stopPropagation()

    const cur = fieldsRef.current
    const ids = selectedFieldIdsRef.current
    const dragIds = ids.has(fieldId) ? [...ids] : [fieldId]
    if (!ids.has(fieldId)) setSelectedFieldIds(new Set([fieldId]))

    const origPositions: Record<string, { x: number; y: number }> = {}
    for (const f of cur) {
      if (dragIds.includes(f.id)) origPositions[f.id] = { x: f.x, y: f.y }
    }

    // Capture pre-drag state for undo
    const preDrag = [...cur]
    const startX = e.clientX, startY = e.clientY

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / pw
      const dy = (ev.clientY - startY) / ph
      setFields(prev => prev.map(f => {
        if (!dragIds.includes(f.id)) return f
        const orig = origPositions[f.id]
        if (!orig) return f
        return {
          ...f,
          x: Math.max(0, Math.min(orig.x + dx, 1 - f.w)),
          y: Math.max(0, Math.min(orig.y + dy, 1 - f.h)),
        }
      }))
    }

    const onUp = () => {
      undoStackRef.current = [...undoStackRef.current.slice(-49), preDrag]
      redoStackRef.current = []
      setCanUndo(true)
      setCanRedo(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // ── Resize field ──────────────────────────────────────────────────────────

  const handleResize = useCallback((e: React.MouseEvent, fieldId: string, pw: number, ph: number) => {
    e.stopPropagation()
    const cur = fieldsRef.current
    const field = cur.find(f => f.id === fieldId)
    if (!field) return

    const preDrag = [...cur]
    const startX = e.clientX, startY = e.clientY
    const origW = field.w, origH = field.h

    const onMove = (ev: MouseEvent) => {
      setFields(prev => prev.map(f => f.id === fieldId ? {
        ...f,
        w: Math.max(0.04, Math.min(origW + (ev.clientX - startX) / pw, 1 - f.x)),
        h: Math.max(0.015, Math.min(origH + (ev.clientY - startY) / ph, 1 - f.y)),
      } : f))
    }

    const onUp = () => {
      undoStackRef.current = [...undoStackRef.current.slice(-49), preDrag]
      redoStackRef.current = []
      setCanUndo(true)
      setCanRedo(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    setSelectedFieldIds(new Set([fieldId]))
  }, [])

  // ── Selection ─────────────────────────────────────────────────────────────

  const handleSelect = useCallback((id: string, multi: boolean) => {
    if (multi) {
      setSelectedFieldIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedFieldIds(new Set([id]))
    }
  }, [])

  // ── Remove single field (from × button or right panel) ───────────────────

  const removeField = useCallback((id: string) => {
    setFieldsWithHistory(fieldsRef.current.filter(f => f.id !== id))
    setSelectedFieldIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [setFieldsWithHistory])

  // ── Delete all selected ───────────────────────────────────────────────────

  const deleteSelected = useCallback(() => {
    const ids = selectedFieldIdsRef.current
    setFieldsWithHistory(fieldsRef.current.filter(f => !ids.has(f.id)))
    setSelectedFieldIds(new Set())
  }, [setFieldsWithHistory])

  // ── Alignment ─────────────────────────────────────────────────────────────

  const alignSelected = useCallback((direction: string) => {
    const ids = [...selectedFieldIdsRef.current]
    if (ids.length < 2) return
    const cur = fieldsRef.current
    const sel = cur.filter(f => ids.includes(f.id))

    const minX = Math.min(...sel.map(f => f.x))
    const maxX = Math.max(...sel.map(f => f.x + f.w))
    const minY = Math.min(...sel.map(f => f.y))
    const maxY = Math.max(...sel.map(f => f.y + f.h))

    setFieldsWithHistory(cur.map(f => {
      if (!ids.includes(f.id)) return f
      switch (direction) {
        case 'left':     return { ...f, x: minX }
        case 'center-h': return { ...f, x: (minX + maxX) / 2 - f.w / 2 }
        case 'right':    return { ...f, x: maxX - f.w }
        case 'top':      return { ...f, y: minY }
        case 'center-v': return { ...f, y: (minY + maxY) / 2 - f.h / 2 }
        case 'bottom':   return { ...f, y: maxY - f.h }
        case 'dist-h': {
          if (sel.length < 3) return f
          const sorted = [...sel].sort((a, b) => a.x - b.x)
          const totalW = sorted.reduce((s, ff) => s + ff.w, 0)
          const gap = (maxX - minX - totalW) / (sorted.length - 1)
          const idx = sorted.findIndex(s => s.id === f.id)
          let x = minX
          for (let i = 0; i < idx; i++) x += sorted[i].w + gap
          return { ...f, x: Math.max(0, Math.min(x, 1 - f.w)) }
        }
        case 'dist-v': {
          if (sel.length < 3) return f
          const sorted = [...sel].sort((a, b) => a.y - b.y)
          const totalH = sorted.reduce((s, ff) => s + ff.h, 0)
          const gap = (maxY - minY - totalH) / (sorted.length - 1)
          const idx = sorted.findIndex(s => s.id === f.id)
          let y = minY
          for (let i = 0; i < idx; i++) y += sorted[i].h + gap
          return { ...f, y: Math.max(0, Math.min(y, 1 - f.h)) }
        }
        default: return f
      }
    }))
  }, [setFieldsWithHistory])

  // ── Repeat selected fields to all pages ───────────────────────────────────

  const repeatToAllPages = useCallback(() => {
    const ids = [...selectedFieldIdsRef.current]
    if (ids.length === 0 || numPages <= 1) return
    const cur = fieldsRef.current
    const sel = cur.filter(f => ids.includes(f.id))
    const newFields: TemplateField[] = []
    for (let p = 1; p <= numPages; p++) {
      for (const field of sel) {
        if (field.page === p) continue
        newFields.push({ ...field, id: crypto.randomUUID(), page: p })
      }
    }
    if (newFields.length > 0) {
      setFieldsWithHistory([...cur, ...newFields])
      setSavedBanner(`Added to ${numPages} pages (${newFields.length} new field${newFields.length !== 1 ? 's' : ''}).`)
      setTimeout(() => setSavedBanner(null), 4000)
    }
  }, [numPages, setFieldsWithHistory])

  // ── Auto-detect merge text fields ─────────────────────────────────────────

  const autoDetect = async () => {
    if (!pdfDoc) return
    setAutoDetecting(true)
    const newFields: TemplateField[] = []
    let foundAnyContent = false

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const pw = vp.width
      const ph = vp.height

      // Path 1: AcroForm widget annotations (fillable PDFs)
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
          const normY = 1 - y2 / ph
          const normW = Math.max((x2 - x1) / pw, 0.08)
          const normH = Math.max((y2 - y1) / ph, 0.025)
          newFields.push({
            id: crypto.randomUUID(), page: p,
            x: Math.max(0, Math.min(normX, 1 - normW)),
            y: Math.max(0, Math.min(normY, 1 - normH)),
            w: normW, h: normH,
            variable: match.variable, label: match.label,
            defaultValue: '', fontSize: 10,
            fieldType: 'merge_text', signerRoleId: null,
          })
        }
      } catch { /* annotations unavailable */ }

      // Path 2: Text content (digital PDFs with text layer)
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
              const textW = (item.width ?? trimmed.length * 7)
              const fieldX = Math.max(0, Math.min((tx + textW) / pw + 0.01, 0.72))
              const fieldW = Math.min(0.26, 0.98 - fieldX)
              const fieldY = Math.max(0, Math.min(1 - ty / ph - 0.035, 0.96))
              newFields.push({
                id: crypto.randomUUID(), page: p,
                x: fieldX, y: fieldY, w: fieldW, h: 0.04,
                variable: pattern.variable, label: pattern.label,
                defaultValue: '', fontSize: 11,
                fieldType: 'merge_text', signerRoleId: null,
              })
              break
            }
          }
        }
      } catch { /* text content unavailable */ }
    }

    setFieldsWithHistory([...fieldsRef.current, ...newFields])
    setAutoDetecting(false)

    if (!foundAnyContent) {
      setSavedBanner('This PDF has no text layer (scanned image). Place fields manually — auto-detect only works on digital PDFs.')
      setTimeout(() => setSavedBanner(null), 7000)
    } else if (!newFields.length) {
      setSavedBanner('No matching field labels found. Try placing fields manually.')
      setTimeout(() => setSavedBanner(null), 4000)
    } else {
      setSavedBanner(`Added ${newFields.length} field${newFields.length !== 1 ? 's' : ''}. Drag to reposition.`)
      setTimeout(() => setSavedBanner(null), 4000)
    }
  }

  // ── Detect signing fields — scan text for signing labels, propose review ──

  const detectSigningFields = async () => {
    if (!pdfDoc) return
    setDetectingSignFields(true)
    const suggestions: DetectedSuggestion[] = []

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const pw = vp.width
      const ph = vp.height

      try {
        const content = await page.getTextContent()
        const items = content.items as Array<{ str: string; transform: number[]; width?: number }>
        for (const item of items) {
          const trimmed = item.str.trim()
          if (!trimmed || trimmed.length < 3) continue
          for (const pat of SIGNING_DETECT_PATTERNS) {
            if (!pat.re.test(trimmed)) continue
            const role = signerRoles.find(r => r.name.toLowerCase() === pat.roleKey.toLowerCase())
            const [, , , , tx, ty] = item.transform
            const fw = pat.fieldType === 'signature' ? 0.28 : 0.16
            const fh = pat.fieldType === 'signature' ? 0.06 : 0.04
            const fx = Math.max(0, Math.min(tx / pw, 0.70))
            const fy = Math.max(0, Math.min(1 - ty / ph - fh / 2, 0.96 - fh))
            suggestions.push({
              label: pat.displayLabel,
              fieldType: pat.fieldType,
              signerRoleId: role?.id ?? null,
              roleName: role?.name ?? (pat.roleKey || 'Unknown'),
              page: p, x: fx, y: fy, w: fw, h: fh,
            })
            break
          }
        }
      } catch { /* text unavailable */ }
    }

    setDetectingSignFields(false)
    if (suggestions.length === 0) {
      setSavedBanner('No signing labels detected. Place signing fields manually from the left panel.')
      setTimeout(() => setSavedBanner(null), 5000)
      return
    }
    setDetectedSuggestions(suggestions)
    setShowDetectModal(true)
  }

  const acceptSuggestion = (s: DetectedSuggestion) => {
    const newField: TemplateField = {
      id: crypto.randomUUID(),
      page: s.page, x: s.x, y: s.y, w: s.w, h: s.h,
      variable: '', label: s.label,
      defaultValue: '', fontSize: 11,
      fieldType: s.fieldType, signerRoleId: s.signerRoleId,
    }
    setFieldsWithHistory([...fieldsRef.current, newField])
  }

  const acceptAllSuggestions = () => {
    const newFields = detectedSuggestions.map(s => ({
      id: crypto.randomUUID(),
      page: s.page, x: s.x, y: s.y, w: s.w, h: s.h,
      variable: '', label: s.label,
      defaultValue: '', fontSize: 11,
      fieldType: s.fieldType, signerRoleId: s.signerRoleId,
    }))
    setFieldsWithHistory([...fieldsRef.current, ...newFields])
    setShowDetectModal(false)
    setSavedBanner(`Added ${newFields.length} signing field${newFields.length !== 1 ? 's' : ''}. Review roles in the right panel.`)
    setTimeout(() => setSavedBanner(null), 5000)
  }

  // ── Save / Publish ────────────────────────────────────────────────────────

  const save = async () => {
    if (!templateId) return
    setSaving(true)
    try {
      const [nameRes, fieldsRes] = await Promise.all([
        fetch(`/api/contract-templates/${templateId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: templateName }),
        }),
        fetch(`/api/contract-templates/${templateId}/fields`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: fieldsRef.current }),
        }),
      ])
      if (nameRes.ok && fieldsRes.ok) {
        setSavedBanner('Template saved!')
      } else {
        const failed = nameRes.ok ? fieldsRes : nameRes
        const d = await failed.json()
        setSavedBanner(d.error ?? 'Save failed.')
      }
    } catch {
      setSavedBanner('Save failed.')
    } finally {
      setSaving(false)
      setTimeout(() => setSavedBanner(null), 4000)
    }
  }

  const publish = async () => {
    if (!templateId) return
    setPublishing(true)
    try {
      await fetch(`/api/contract-templates/${templateId}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fieldsRef.current }),
      })
      const res = await fetch(`/api/contract-templates/${templateId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const d = await res.json()
        const label = d.version?.version_label ?? 'v1.0'
        setCurrentVersionLabel(label)
        setSavedBanner(`Published ${label}!`)
      } else {
        const d = await res.json()
        setSavedBanner(d.error ?? 'Publish failed.')
      }
    } catch {
      setSavedBanner('Publish failed.')
    } finally {
      setPublishing(false)
      setTimeout(() => setSavedBanner(null), 5000)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedCount = selectedFieldIds.size
  const selectedField = selectedCount === 1
    ? fields.find(f => selectedFieldIds.has(f.id)) ?? null
    : null
  const hasActiveTool = !!activeVariable || !!(activeSigningFieldType && activeSigningRoleId)

  // ── Source picker ─────────────────────────────────────────────────────────

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
                        {c.draft_field_count > 0 ? ` · ${c.draft_field_count} draft fields` : c.current_version_id ? ' · Published' : ''}
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
                      {(c.draft_field_count > 0 || !!c.current_version_id) ? 'Edit Fields' : 'Add Fields'}
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

  // ── Builder ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-bg)' }}>

      {/* ── Left panel ── */}
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
            Merge Variables
          </p>
          {VARIABLE_GROUPS.map(group => (
            <div key={group.category} className="mb-3">
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: group.color }}>
                {group.category}
              </p>
              {group.items.map(item => (
                <button
                  key={item.variable}
                  onClick={() => {
                    setActiveVariable(prev => prev === item.variable ? null : item.variable)
                    setActiveSigningFieldType(null)
                    setActiveSigningRoleId(null)
                  }}
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

        {/* Signing Fields */}
        {signerRoles.length > 0 && (
          <div className="p-3 shrink-0 border-t" style={{ borderColor: 'var(--c-border)' }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>
              Signing Fields
            </p>
            {signerRoles.map(role => {
              const sigActive = activeSigningFieldType === 'signature' && activeSigningRoleId === role.id
              const iniActive = activeSigningFieldType === 'initial'  && activeSigningRoleId === role.id
              const rc = role.color || '#7B8FD4'
              return (
                <div key={role.id} className="mb-2">
                  <p className="text-[9px] font-bold uppercase mb-1" style={{ color: rc }}>{role.name}</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => {
                        setActiveSigningFieldType(sigActive ? null : 'signature')
                        setActiveSigningRoleId(sigActive ? null : role.id)
                        setActiveVariable(null)
                      }}
                      className="flex-1 text-[10px] font-semibold px-1 py-1 rounded-lg"
                      style={{
                        backgroundColor: sigActive ? `${rc}22` : 'transparent',
                        color: sigActive ? rc : 'var(--c-text-2)',
                        border: `1px solid ${sigActive ? rc : 'var(--c-border)'}`,
                      }}
                    >✍ Sig</button>
                    <button
                      onClick={() => {
                        setActiveSigningFieldType(iniActive ? null : 'initial')
                        setActiveSigningRoleId(iniActive ? null : role.id)
                        setActiveVariable(null)
                      }}
                      className="flex-1 text-[10px] font-semibold px-1 py-1 rounded-lg"
                      style={{
                        backgroundColor: iniActive ? `${rc}22` : 'transparent',
                        color: iniActive ? rc : 'var(--c-text-2)',
                        border: `1px solid ${iniActive ? rc : 'var(--c-border)'}`,
                      }}
                    >INI</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Active tool hint */}
        {hasActiveTool ? (
          <div className="p-3 shrink-0">
            <p className="text-[10px] font-bold text-center" style={{ color: '#C9A84C' }}>
              Click on the PDF to place ↓
            </p>
          </div>
        ) : (
          <div className="p-3 shrink-0">
            <p className="text-[10px] text-center" style={{ color: 'var(--c-text-3)' }}>
              Select a variable or signing field above
            </p>
          </div>
        )}

        {/* Keyboard hint */}
        <div className="p-3 border-t mt-auto shrink-0" style={{ borderColor: 'var(--c-border)' }}>
          <p className="text-[8px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
            <strong style={{ color: 'var(--c-text-2)' }}>Shortcuts</strong><br />
            ⌫ Delete · ⌘C Copy · ⌘V Paste<br />
            ⌘D Duplicate · ⌘Z Undo · ⌘⇧Z Redo<br />
            ↑↓←→ Nudge · ⇧+Arrow Large nudge<br />
            ⇧+Click Multi-select · Esc Deselect
          </p>
        </div>
      </div>

      {/* ── PDF area ── */}
      <div
        className="flex-1 overflow-auto p-8"
        style={{ backgroundColor: '#d1d5db' }}
        onClick={() => { if (!hasActiveTool) setSelectedFieldIds(new Set()) }}
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
                selectedFieldIds={selectedFieldIds}
                hasActiveTool={hasActiveTool}
                signerRoles={signerRoles}
                onPlace={handlePlace}
                onSelect={handleSelect}
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

      {/* ── Right panel ── */}
      <div className="w-52 shrink-0 flex flex-col border-l"
        style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }}>

        <div className="flex-1 overflow-y-auto p-4">

          {/* ── Single field properties ── */}
          {selectedField && selectedCount === 1 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-3)' }}>
                Field Properties
              </p>
              <div className="space-y-3">
                {/* Type badge */}
                <div>
                  <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Type</label>
                  <div className="text-[10px] px-2 py-1.5 rounded-lg font-semibold"
                    style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                    {selectedField.fieldType === 'signature' ? '✍ Signature'
                      : selectedField.fieldType === 'initial' ? 'INI Initials'
                      : selectedField.fieldType === 'date' ? '📅 Date'
                      : selectedField.fieldType === 'checkbox' ? '☑ Checkbox'
                      : 'T Merge Text'}
                  </div>
                </div>

                {/* Signer Role — signature/initial only */}
                {(selectedField.fieldType === 'signature' || selectedField.fieldType === 'initial') && (
                  <div>
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Signer Role</label>
                    <select
                      value={selectedField.signerRoleId ?? ''}
                      onChange={e => {
                        const roleId = e.target.value || null
                        const role = signerRoles.find(r => r.id === roleId)
                        setFields(prev => prev.map(f => f.id === selectedField.id ? {
                          ...f,
                          signerRoleId: roleId,
                          label: role
                            ? `${role.name} ${f.fieldType === 'signature' ? 'Signature' : 'Initials'}`
                            : f.label,
                        } : f))
                      }}
                      className="w-full text-[10px] px-2 py-1.5 rounded-lg focus:outline-none"
                      style={{ backgroundColor: 'var(--c-input-bg)', border: `1px solid ${selectedField.signerRoleId ? 'var(--c-border)' : '#ef4444'}`, color: 'var(--c-primary)' }}
                    >
                      <option value="">— Select role —</option>
                      {signerRoles.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    {!selectedField.signerRoleId && (
                      <p className="text-[9px] mt-0.5" style={{ color: '#ef4444' }}>Role required to request signatures</p>
                    )}
                  </div>
                )}

                {/* Variable — merge_text only */}
                {selectedField.fieldType !== 'signature' && selectedField.fieldType !== 'initial' && (
                  <div>
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Variable</label>
                    <select
                      value={selectedField.variable}
                      onChange={e => {
                        const v = e.target.value
                        setFields(prev => prev.map(f => f.id === selectedField.id
                          ? { ...f, variable: v, label: variableLabel(v) } : f))
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
                )}

                <div>
                  <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--c-text-3)' }}>Label</label>
                  <input
                    value={selectedField.label}
                    onChange={e => setFields(prev => prev.map(f => f.id === selectedField.id ? { ...f, label: e.target.value } : f))}
                    className="w-full text-xs px-2 py-1.5 rounded-lg focus:outline-none"
                    style={{ backgroundColor: 'var(--c-input-bg)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                  />
                </div>

                {selectedField.fieldType !== 'signature' && selectedField.fieldType !== 'initial' && (
                  <>
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
                  </>
                )}

                {/* Single-field actions */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => {
                      const f = fields.find(ff => ff.id === selectedField.id)
                      if (f) {
                        setClipboard([f])
                        const duped = { ...f, id: crypto.randomUUID(), x: Math.min(f.x + 0.02, 0.95), y: Math.min(f.y + 0.02, 0.95) }
                        setFieldsWithHistory([...fieldsRef.current, duped])
                        setSelectedFieldIds(new Set([duped.id]))
                      }
                    }}
                    className="flex-1 text-[10px] font-semibold py-1.5 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
                  >⧉ Dup</button>
                  <button
                    onClick={() => removeField(selectedField.id)}
                    className="flex-1 text-[10px] font-semibold py-1.5 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
                  >✕ Del</button>
                </div>

                {/* Repeat to pages — single field */}
                {numPages > 1 && (
                  <button
                    onClick={repeatToAllPages}
                    className="w-full text-[10px] font-semibold py-1.5 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)' }}
                  >
                    ↕ Repeat on all {numPages} pages
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── Multi-select panel ── */}
          {selectedCount >= 2 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--c-text-3)' }}>
                {selectedCount} Fields Selected
              </p>

              {/* Alignment tools */}
              <div className="mb-3">
                <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--c-text-3)' }}>Align</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 3 }}>
                  {ALIGN_BUTTONS.map(btn => (
                    <button
                      key={btn.key}
                      title={btn.title}
                      onClick={() => alignSelected(btn.key)}
                      className="text-[9px] font-mono font-bold py-1 rounded-lg hover:opacity-80"
                      style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Repeat to pages */}
              {numPages > 1 && (
                <button
                  onClick={repeatToAllPages}
                  className="w-full text-[10px] font-semibold py-1.5 rounded-lg hover:opacity-80 mb-2"
                  style={{ backgroundColor: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)' }}
                >
                  ↕ Repeat on all {numPages} pages
                </button>
              )}

              {/* Duplicate group */}
              <button
                onClick={() => {
                  const ids = [...selectedFieldIds]
                  const sel = fieldsRef.current.filter(f => ids.includes(f.id))
                  const duped = sel.map(f => ({ ...f, id: crypto.randomUUID(), x: Math.min(f.x + 0.02, 0.95), y: Math.min(f.y + 0.02, 0.95) }))
                  setFieldsWithHistory([...fieldsRef.current, ...duped])
                  setSelectedFieldIds(new Set(duped.map(f => f.id)))
                }}
                className="w-full text-[10px] font-semibold py-1.5 rounded-lg hover:opacity-80 mb-2"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
              >
                ⧉ Duplicate Group
              </button>

              <button
                onClick={deleteSelected}
                className="w-full text-[10px] font-semibold py-1.5 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                ✕ Delete {selectedCount} Fields
              </button>
            </>
          )}

          {/* ── Empty state ── */}
          {selectedCount === 0 && (
            <div className="text-center pt-8">
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                {hasActiveTool
                  ? 'Click on the PDF to place a field'
                  : 'Select a field to edit · Shift+click to multi-select'}
              </p>
            </div>
          )}
        </div>

        {/* ── Bottom action buttons ── */}
        <div className="p-4 border-t space-y-2 shrink-0" style={{ borderColor: 'var(--c-border)' }}>
          {/* Undo / Redo */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              className="flex-1 py-1.5 rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-30"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
            >↩ Undo</button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⌘⇧Z)"
              className="flex-1 py-1.5 rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-30"
              style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
            >↪ Redo</button>
          </div>

          {currentVersionLabel && (
            <div className="text-center">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A', border: '1px solid rgba(74,207,154,0.3)' }}>
                Published {currentVersionLabel}
              </span>
            </div>
          )}
          {savedBanner && (
            <p className="text-xs text-center font-semibold" style={{ color: savedBanner.includes('failed') || savedBanner.includes('No ') ? '#ef4444' : '#4ACF9A' }}>
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
            onClick={detectSigningFields}
            disabled={detectingSignFields || !pdfDoc}
            className="w-full py-2 rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: 'rgba(123,143,212,0.1)', color: '#7B8FD4', border: '1px solid rgba(123,143,212,0.3)' }}
          >
            {detectingSignFields ? 'Scanning…' : '✍ Detect Signing Fields'}
          </button>
          <button
            onClick={save}
            disabled={saving || publishing}
            className="w-full py-2.5 rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', border: '1px solid var(--c-border)' }}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            onClick={publish}
            disabled={publishing || saving}
            className="w-full py-3 rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          >
            {publishing ? 'Publishing…' : '⬆ Publish Version'}
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

      {/* ── Detected Signing Fields Modal ── */}
      {showDetectModal && detectedSuggestions.length > 0 && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowDetectModal(false) }}
        >
          <div style={{
            backgroundColor: 'var(--c-card)', borderRadius: 16, padding: 24, width: 440,
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            border: '1px solid var(--c-border)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          }}>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                Detected Signing Labels
              </h2>
              <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                {detectedSuggestions.length} potential signing field{detectedSuggestions.length !== 1 ? 's' : ''} found.
                Review and accept the ones you want to place.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
              {detectedSuggestions.map((s, idx) => (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0', borderBottom: '1px solid var(--c-border)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>
                      {s.fieldType === 'signature' ? '✍' : 'INI'} {s.label}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--c-text-2)' }}>
                      Page {s.page} · Role: <strong>{s.roleName || 'Unknown'}</strong>
                      {!s.signerRoleId && (
                        <span style={{ color: '#f59e0b', marginLeft: 6 }}>⚠ no role matched</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      acceptSuggestion(s)
                      setDetectedSuggestions(prev => prev.filter((_, i) => i !== idx))
                      if (detectedSuggestions.length === 1) setShowDetectModal(false)
                    }}
                    style={{
                      padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A',
                      border: '1px solid rgba(74,207,154,0.3)', cursor: 'pointer',
                    }}
                  >Accept</button>
                  <button
                    onClick={() => {
                      setDetectedSuggestions(prev => prev.filter((_, i) => i !== idx))
                      if (detectedSuggestions.length === 1) setShowDetectModal(false)
                    }}
                    style={{
                      padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
                      border: '1px solid var(--c-border)', cursor: 'pointer',
                    }}
                  >Skip</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={acceptAllSuggestions}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  backgroundColor: '#0A1F44', color: '#C9A84C', border: 'none', cursor: 'pointer',
                }}
              >Accept All ({detectedSuggestions.length})</button>
              <button
                onClick={() => setShowDetectModal(false)}
                style={{
                  padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
                  border: '1px solid var(--c-border)', cursor: 'pointer',
                }}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
