// Centralized Acquisition Engine
// Pure functions — no React, no side effects.
// Every workspace component reads from this; nothing computes its own workflow logic.

// ─── Data shapes ──────────────────────────────────────────────────────────────

export interface WorkspaceLead {
  id: string
  property_address: string
  city?: string
  state?: string
  zip?: string
  folio_number?: string | null
  owner_name?: string | null
  mortgagor?: string | null
  entity_type?: string | null
  estimated_value?: number | null
  market_value?: number | null
  assessed_value?: number | null
  equity_dollar_amount?: number | null
  equity_percentage?: number | null
  equity_tier?: string | null
  beds?: number | null
  baths?: number | null
  sqft?: number | null
  living_area?: number | null
  lot_size?: number | null
  year_built?: number | null
  property_type?: string | null
  subdivision?: string | null
  subdivision_name?: string | null
  occupancy?: string | null
  homestead?: boolean | null
  vacant?: boolean | null
  multiple_liens?: boolean | null
  mailing_address?: string | null
  owner_state?: string | null
  phone_1?: string | null
  phone_2?: string | null
  phone_3?: string | null
  phone_4?: string | null
  phone_5?: string | null
  lead_type?: string | null
  lead_type_id?: string | null
  vertical_id?: string | null
  pipeline_stage?: string | null
  starred?: boolean
  lead_score?: number | null
  ai_score?: number | null
  call_status?: string | null
  sms_status?: string | null
  email_status?: string | null
  offer_sent?: boolean | null
  offer_pct?: number | null
  offer_amount?: number | null
  blocked?: boolean
  imported_to_contact?: string | null
  lead_added_at?: string | null
  lead_id?: string | null
  is_lead: boolean
  // Foreclosure / distress
  case_number?: string | null
  foreclosure_type?: string | null
  foreclosure_amount?: number | null
  surplus_funds_amount?: number | null
  // Acquisition Operations (Phase 5.6)
  acquisition_pipeline?: string | null
  surplus_status?: string | null
  assigned_to?: string | null
  follow_up_at?: string | null
  last_contact_at?: string | null
  is_pre_foreclosure?: boolean | null
  is_foreclosure?: boolean | null
  file_date?: string | null
  sale_date?: string | null
  auction_date?: string | null
  plaintiff?: string | null
  lender_name?: string | null
  probate_type?: string | null
  county?: string | null
  data_source?: string | null
  // PA enrichment
  enrichment_src?: string | null
  enriched_at?: string | null
  legal_description?: string | null
  zoning?: string | null
  tax_year?: string | number | null
  tax_amount?: number | null
  last_sale_date?: string | null
  sold_price?: number | null
  property_id?: string | null
  // Location
  latitude?: number | null
  longitude?: number | null
  // MLS
  mls_status?: string | null
  mls_listing_price?: number | null
  mls_active?: boolean | null
  mls_number?: string | null
  mls_dom?: number | null
  mls_price_reductions?: number | null
  mls_original_price?: number | null
  mls_cdom?: number | null
  mls_agent_name?: string | null
  mls_agent_phone?: string | null
  mls_agent_email?: string | null
  mls_broker_name?: string | null
  mls_photos?: string[] | null
  mls_remarks_public?: string | null
  mls_remarks_private?: string | null
  mls_showing_instructions?: string | null
  mls_hoa_amount?: number | null
  mls_price_history?: { date: string; price: number; event: string }[] | null
  mls_open_houses?: { date: string; start: string; end: string }[] | null
  // Rental estimate (Rentcast cache)
  suggested_rent?: number | null
  rent_estimate?: number | null
  rent_range_low?: number | null
  rent_range_high?: number | null
  rent_fetched_at?: string | null
  // Opportunity score
  opportunity_score?: number | null
  opportunity_label?: string | null
  opportunity_summary?: string | null
  // Foreclosure override (operational — REAPI never writes these)
  foreclosure_status_override?:   string | null
  foreclosure_status_source?:     string | null
  foreclosure_status_updated_at?: string | null
  foreclosure_notes?:             string | null
  foreclosure_reapi_changed?:     boolean | null
}

export interface WorkspaceNote {
  id: string
  body: string
  author?: string
  created_at: string
  note_type?: 'note' | 'call_log' | 'sms_log' | 'email_log' | 'task'
}

export interface WorkspaceDocument {
  id:                  string
  name:                string
  category?:           string | null
  status:              string
  document_type?:      string | null
  offer_amount?:       number | null
  pdf_path?:           string | null
  signed_pdf_path?:    string | null
  file_path?:          string | null
  file_type?:          string | null
  signing_session_id?: string | null
  version?:            number
  is_executed?:        boolean
  executed_at?:        string | null
  sent_at?:            string | null
  recipient_name?:     string | null
  created_at:          string
  updated_at?:         string
}

export interface WorkspaceContact {
  id: string
  relationship_type: string
  is_primary: boolean
  notes?: string | null
  created_at: string
  contact: {
    id: string
    name: string
    phone?: string | null
    email?: string | null
    address?: string | null
    category?: string | null
    status?: string | null
  }
}

export interface WorkspaceDeal {
  id: string
  address: string
  status: string
  offer_price?: number | null
  arv?: number | null
  closing_date?: string | null
}

export interface WorkspaceAISummary {
  distress_score?: number | null
  motivation?: string | null
  strategy?: string | null
  urgency?: string | null
  lead_quality?: number | null
  summary?: string | null
  highlights?: string[] | null
  model?: string | null
  created_at?: string
}

export interface WorkspaceComp {
  id: string
  address: string
  sale_price?: number | null
  list_price?: number | null
  status: string
  beds?: number | null
  baths?: number | null
  sqft?: number | null
  year_built?: number | null
  distance_miles?: number | null
  price_per_sqft?: number | null
  sale_date?: string | null
}

export interface WorkspaceData {
  lead: WorkspaceLead
  notes: WorkspaceNote[]
  documents: WorkspaceDocument[]
  contacts: WorkspaceContact[]
  deals: WorkspaceDeal[]
  aiSummary: WorkspaceAISummary | null
  comps: WorkspaceComp[]
}

// ─── Acquisition Progress ──────────────────────────────────────────────────────

export type ProgressPhase =
  | 'lead_added'
  | 'property_analyzed'
  | 'owner_contacted'
  | 'offer_made'
  | 'under_contract'
  | 'deal_opened'
  | 'inspection'
  | 'closing'
  | 'closed'

export type ProgressStatus = 'done' | 'current' | 'future'

export interface ProgressStep {
  phase: ProgressPhase
  label: string
  sublabel?: string
  status: ProgressStatus
}

// ─── Next Actions ──────────────────────────────────────────────────────────────

export type TabId = 'overview' | 'people' | 'contact' | 'analyze' | 'offer' | 'documents' | 'comms' | 'close' | 'listing' | 'comps'

export type ActionType =
  | 'navigate'
  | 'call'
  | 'sms'
  | 'email'
  | 'create_offer'
  | 'sign_contract'
  | 'create_deal'
  | 'add_contact'
  | 'generate_contract'
  | 'analyze'

export interface NextAction {
  id: string
  priority: number           // 1 = highest
  label: string
  sublabel?: string
  tab: TabId
  actionType: ActionType
}

// ─── Derived state ────────────────────────────────────────────────────────────

export interface OfferStatus {
  hasOffer: boolean
  amount?: number | null
  pct?: number | null
  sent: boolean
  response?: 'pending' | 'accepted' | 'countered' | 'rejected' | null
}

export interface CommunicationStatus {
  callStatus: string
  smsStatus: string
  emailStatus: string
  hasAnyContact: boolean
  hasTalked: boolean
}

export interface DocumentStatus {
  hasContract: boolean
  contractSigned: boolean
  pendingSignature: boolean
  contractDoc?: WorkspaceDocument | null
}

export interface DealStatus {
  hasDeal: boolean
  dealId?: string
  dealStatus?: string
  dealStage?: string
}

// ─── Full acquisition state ───────────────────────────────────────────────────

export interface AcquisitionState {
  progress: ProgressStep[]
  nextActions: NextAction[]
  currentPhase: ProgressPhase
  offerStatus: OfferStatus
  communicationStatus: CommunicationStatus
  documentStatus: DocumentStatus
  dealStatus: DealStatus
}

// ─── Engine ───────────────────────────────────────────────────────────────────

const PHASES: { phase: ProgressPhase; label: string }[] = [
  { phase: 'lead_added',          label: 'Lead Added' },
  { phase: 'property_analyzed',   label: 'Property Analyzed' },
  { phase: 'owner_contacted',     label: 'Owner Contacted' },
  { phase: 'offer_made',          label: 'Offer Made' },
  { phase: 'under_contract',      label: 'Under Contract' },
  { phase: 'deal_opened',         label: 'Deal Opened' },
  { phase: 'inspection',          label: 'Inspection' },
  { phase: 'closing',             label: 'Closing' },
  { phase: 'closed',              label: 'Closed ✦' },
]

export function computeAcquisitionState(data: WorkspaceData): AcquisitionState {
  const { lead, notes, documents, contacts, deals, aiSummary } = data

  // ── Communication ──
  const callStatus  = lead.call_status  ?? 'not_called'
  const smsStatus   = lead.sms_status   ?? 'not_sent'
  const emailStatus = lead.email_status ?? 'not_sent'
  const hasTalked       = callStatus === 'talked'
  const hasAnyContact   =
    callStatus  !== 'not_called' ||
    smsStatus   !== 'not_sent'   ||
    emailStatus !== 'not_sent'

  const communicationStatus: CommunicationStatus = {
    callStatus, smsStatus, emailStatus, hasAnyContact, hasTalked,
  }

  // ── Offer ──
  const hasOffer = !!lead.offer_amount && lead.offer_amount > 0
  const offerSent = !!lead.offer_sent
  const offerStatus: OfferStatus = {
    hasOffer,
    amount: lead.offer_amount,
    pct: lead.offer_pct,
    sent: offerSent,
    response: offerSent ? 'pending' : null,
  }

  // ── Documents ──
  const contractDocs = documents.filter(d =>
    d.category === 'contract' ||
    d.name?.toLowerCase().includes('contract') ||
    d.name?.toLowerCase().includes('far/bar') ||
    d.name?.toLowerCase().includes('purchase agreement')
  )
  const hasContract = contractDocs.length > 0
  const contractSigned = contractDocs.some(d =>
    ['signed', 'executed', 'completed'].includes(d.status?.toLowerCase() ?? '')
  )
  const pendingSignature = contractDocs.some(d =>
    ['pending_signature', 'sent', 'awaiting'].includes(d.status?.toLowerCase() ?? '')
  )
  const documentStatus: DocumentStatus = {
    hasContract,
    contractSigned,
    pendingSignature,
    contractDoc: contractDocs[0] ?? null,
  }

  // ── Deals ──
  const activeDeal = deals.find(d => !['dead', 'Dead', 'lost'].includes(d.status))
  const dealStatus: DealStatus = {
    hasDeal: !!activeDeal,
    dealId:     activeDeal?.id,
    dealStatus: activeDeal?.status,
  }

  // ── Analysis ──
  const isAnalyzed = !!aiSummary || (typeof lead.lead_score === 'number' && lead.lead_score > 0)
  const hasARV = typeof lead.ai_score === 'number'

  // ── Current phase ──
  let currentPhase: ProgressPhase = 'lead_added'
  if (isAnalyzed)         currentPhase = 'property_analyzed'
  if (hasAnyContact)      currentPhase = 'owner_contacted'
  if (hasOffer)           currentPhase = 'offer_made'
  if (contractSigned)     currentPhase = 'under_contract'
  if (activeDeal)         currentPhase = 'deal_opened'
  if (activeDeal?.status?.toLowerCase() === 'inspection')  currentPhase = 'inspection'
  if (activeDeal?.status?.toLowerCase() === 'closing')     currentPhase = 'closing'
  if (['closed', 'won'].includes(activeDeal?.status?.toLowerCase() ?? '')) currentPhase = 'closed'

  // ── Progress steps ──
  const phaseOrder = PHASES.map(p => p.phase)
  const currentIdx = phaseOrder.indexOf(currentPhase)

  const progress: ProgressStep[] = PHASES.map((p, i) => {
    const status: ProgressStatus =
      i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'future'

    let sublabel: string | undefined
    if (p.phase === 'lead_added')        sublabel = lead.lead_added_at ? fmtDate(lead.lead_added_at) : undefined
    if (p.phase === 'owner_contacted' && hasTalked) sublabel = 'Called · Talked'
    if (p.phase === 'offer_made' && lead.offer_amount) sublabel = `$${fmtMoney(lead.offer_amount)}`
    if (p.phase === 'deal_opened' && activeDeal) sublabel = activeDeal.status
    if (p.phase === 'property_analyzed' && lead.lead_score) sublabel = `Score ${lead.lead_score}`

    return { ...p, status, sublabel }
  })

  // ── Next actions (state-driven) ──
  const raw: NextAction[] = []

  // Priority 1 — blocking: what must happen next
  if (!isAnalyzed) {
    raw.push({ id: 'analyze', priority: 1, label: 'Analyze this property', sublabel: 'Run comps and score the deal', tab: 'analyze', actionType: 'analyze' })
  }

  if (!hasAnyContact) {
    raw.push({ id: 'contact_owner', priority: 1, label: 'Contact the owner', sublabel: lead.owner_name ? `Call ${lead.owner_name}` : 'No contact made yet', tab: 'comms', actionType: 'call' })
  }

  if (hasAnyContact && !hasOffer) {
    raw.push({ id: 'make_offer', priority: 1, label: 'Make an offer', sublabel: 'Owner contacted — time to present a number', tab: 'offer', actionType: 'create_offer' })
  }

  if (hasOffer && !offerSent) {
    raw.push({ id: 'send_offer', priority: 1, label: 'Send offer to seller', sublabel: 'Offer created but not sent yet', tab: 'offer', actionType: 'navigate' })
  }

  if (hasOffer && offerSent && !hasContract) {
    raw.push({ id: 'generate_contract', priority: 1, label: 'Generate the contract', sublabel: `Offer sent · $${fmtMoney(lead.offer_amount!)}`, tab: 'documents', actionType: 'generate_contract' })
  }

  if (pendingSignature && !contractSigned) {
    raw.push({ id: 'sign_contract', priority: 1, label: 'Get contract signed', sublabel: 'Awaiting seller signature', tab: 'documents', actionType: 'sign_contract' })
  }

  if (contractSigned && !activeDeal) {
    raw.push({ id: 'open_deal', priority: 1, label: 'Open a deal', sublabel: 'Contract signed — move to pipeline', tab: 'close', actionType: 'create_deal' })
  }

  // Priority 2 — important but not blocking
  if (hasOffer && offerSent && !contractSigned) {
    raw.push({ id: 'followup', priority: 2, label: 'Follow up on the offer', sublabel: 'Check in with seller', tab: 'comms', actionType: 'call' })
  }

  if (contacts.length === 0 && lead.owner_name) {
    raw.push({ id: 'import_contact', priority: 3, label: 'Import owner as contact', sublabel: lead.owner_name, tab: 'people', actionType: 'add_contact' })
  }

  // Sort + take top 3
  const nextActions = raw
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)

  return {
    progress,
    nextActions,
    currentPhase,
    offerStatus,
    communicationStatus,
    documentStatus,
    dealStatus,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return Math.round(n / 1_000) + 'k'
  return n.toLocaleString()
}

export function fmtMoneyFull(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fullAddress(lead: WorkspaceLead): string {
  const parts = [lead.property_address, lead.city, lead.state].filter(Boolean)
  if (lead.zip && lead.city) parts.push(lead.zip)
  return parts.join(', ')
}

export function offerPctCalc(baseValue: number, pct: number): number {
  return Math.round(baseValue * (pct / 100))
}

export const CALL_STATUS_LABELS: Record<string, string> = {
  not_called:   'Not Called',
  called:       'Called',
  no_answer:    'No Answer',
  voicemail:    'Voicemail',
  wrong_number: 'Wrong Number',
  talked:       'Talked',
}

export const SMS_STATUS_LABELS: Record<string, string> = {
  not_sent:  'Not Sent',
  sent:      'Sent',
  delivered: 'Delivered',
  replied:   'Replied',
}

export const EMAIL_STATUS_LABELS: Record<string, string> = {
  not_sent: 'Not Sent',
  sent:     'Sent',
  opened:   'Opened',
  replied:  'Replied',
}

export const STAGE_META: Record<string, { label: string; color: string; bg: string }> = {
  reviewing: { label: 'Reviewing',  color: '#60a5fa', bg: '#1e3a5f' },
  contacted: { label: 'Contacted',  color: '#a78bfa', bg: '#2d1b69' },
  offer:     { label: 'Offer',      color: '#f59e0b', bg: '#3d2800' },
  dead:      { label: 'Dead',       color: '#6b7280', bg: '#1f2937' },
  blocked:   { label: 'Blocked',    color: '#ef4444', bg: '#3a0f0f' },
}
