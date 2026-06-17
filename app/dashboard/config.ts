export type WidgetSize = 'full' | 'lg' | 'md' | 'sm'
export type LayoutMode = 'acquisition' | 'operations' | 'executive' | 'focus' | 'custom'

export interface WidgetConfig {
  id: string
  size: WidgetSize
  visible: boolean
  order: number
}

export interface DashboardConfig {
  mode: LayoutMode
  widgets: WidgetConfig[]
}

// Column spans for CSS grid (12-col)
export const sizeToSpan: Record<WidgetSize, string> = {
  full: 'col-span-12',
  lg:   'col-span-12 xl:col-span-8',
  md:   'col-span-12 md:col-span-6',
  sm:   'col-span-12 md:col-span-6 xl:col-span-4',
}

export const WIDGET_IDS = [
  'morning_briefing',
  'business_snapshot',
  'priorities',
  'follow_ups',
  'opportunity_leads',
  'pipeline_funnel',
  'active_deals',
  'offers_contracts',
  'recent_activity',
  'monthly_kpis',
  'lead_type_breakdown',
  'quick_actions',
] as const

export type WidgetId = typeof WIDGET_IDS[number]

export const WIDGET_LABELS: Record<WidgetId, string> = {
  morning_briefing:     'Morning Briefing',
  business_snapshot:    'Business Snapshot',
  priorities:           "Today's Priorities",
  follow_ups:           'Follow-Ups',
  opportunity_leads:    'Opportunity Leads',
  pipeline_funnel:      'Pipeline Funnel',
  active_deals:         'Active Deals',
  offers_contracts:     'Offers & Contracts',
  recent_activity:      'Recent Activity',
  monthly_kpis:         'Monthly KPIs',
  lead_type_breakdown:  'Lead Type Breakdown',
  quick_actions:        'Quick Actions',
}

// Default layout presets
const ACQUISITION_LAYOUT: WidgetConfig[] = [
  { id: 'morning_briefing',    size: 'full', visible: true,  order: 0 },
  { id: 'business_snapshot',   size: 'full', visible: true,  order: 1 },
  { id: 'priorities',          size: 'md',   visible: true,  order: 2 },
  { id: 'follow_ups',          size: 'md',   visible: true,  order: 3 },
  { id: 'opportunity_leads',   size: 'lg',   visible: true,  order: 4 },
  { id: 'quick_actions',       size: 'sm',   visible: true,  order: 5 },
  { id: 'lead_type_breakdown', size: 'md',   visible: true,  order: 6 },
  { id: 'pipeline_funnel',     size: 'md',   visible: true,  order: 7 },
  { id: 'active_deals',        size: 'md',   visible: true,  order: 8 },
  { id: 'offers_contracts',    size: 'md',   visible: true,  order: 9 },
  { id: 'recent_activity',     size: 'md',   visible: true,  order: 10 },
  { id: 'monthly_kpis',        size: 'full', visible: true,  order: 11 },
]

const OPERATIONS_LAYOUT: WidgetConfig[] = [
  { id: 'morning_briefing',    size: 'full', visible: true,  order: 0 },
  { id: 'priorities',          size: 'md',   visible: true,  order: 1 },
  { id: 'follow_ups',          size: 'md',   visible: true,  order: 2 },
  { id: 'offers_contracts',    size: 'md',   visible: true,  order: 3 },
  { id: 'active_deals',        size: 'md',   visible: true,  order: 4 },
  { id: 'recent_activity',     size: 'md',   visible: true,  order: 5 },
  { id: 'monthly_kpis',        size: 'md',   visible: true,  order: 6 },
  { id: 'business_snapshot',   size: 'full', visible: false, order: 7 },
  { id: 'opportunity_leads',   size: 'lg',   visible: false, order: 8 },
  { id: 'pipeline_funnel',     size: 'md',   visible: false, order: 9 },
  { id: 'lead_type_breakdown', size: 'md',   visible: false, order: 10 },
  { id: 'quick_actions',       size: 'sm',   visible: false, order: 11 },
]

const EXECUTIVE_LAYOUT: WidgetConfig[] = [
  { id: 'business_snapshot',   size: 'full', visible: true,  order: 0 },
  { id: 'pipeline_funnel',     size: 'md',   visible: true,  order: 1 },
  { id: 'lead_type_breakdown', size: 'md',   visible: true,  order: 2 },
  { id: 'monthly_kpis',        size: 'md',   visible: true,  order: 3 },
  { id: 'active_deals',        size: 'md',   visible: true,  order: 4 },
  { id: 'offers_contracts',    size: 'md',   visible: true,  order: 5 },
  { id: 'morning_briefing',    size: 'full', visible: false, order: 6 },
  { id: 'priorities',          size: 'md',   visible: false, order: 7 },
  { id: 'follow_ups',          size: 'md',   visible: false, order: 8 },
  { id: 'opportunity_leads',   size: 'lg',   visible: false, order: 9 },
  { id: 'recent_activity',     size: 'md',   visible: false, order: 10 },
  { id: 'quick_actions',       size: 'sm',   visible: false, order: 11 },
]

const FOCUS_LAYOUT: WidgetConfig[] = [
  { id: 'priorities',          size: 'full', visible: true,  order: 0 },
  { id: 'follow_ups',          size: 'md',   visible: true,  order: 1 },
  { id: 'active_deals',        size: 'md',   visible: true,  order: 2 },
  { id: 'morning_briefing',    size: 'full', visible: false, order: 3 },
  { id: 'business_snapshot',   size: 'full', visible: false, order: 4 },
  { id: 'opportunity_leads',   size: 'lg',   visible: false, order: 5 },
  { id: 'pipeline_funnel',     size: 'md',   visible: false, order: 6 },
  { id: 'lead_type_breakdown', size: 'md',   visible: false, order: 7 },
  { id: 'offers_contracts',    size: 'md',   visible: false, order: 8 },
  { id: 'recent_activity',     size: 'md',   visible: false, order: 9 },
  { id: 'monthly_kpis',        size: 'full', visible: false, order: 10 },
  { id: 'quick_actions',       size: 'sm',   visible: false, order: 11 },
]

export const DEFAULT_LAYOUTS: Record<LayoutMode, WidgetConfig[]> = {
  acquisition: ACQUISITION_LAYOUT,
  operations:  OPERATIONS_LAYOUT,
  executive:   EXECUTIVE_LAYOUT,
  focus:       FOCUS_LAYOUT,
  custom:      ACQUISITION_LAYOUT,
}

export function getDefaultConfig(mode: LayoutMode = 'acquisition'): DashboardConfig {
  return { mode, widgets: DEFAULT_LAYOUTS[mode] }
}

export function mergeConfig(saved: Partial<DashboardConfig> | null): DashboardConfig {
  if (!saved?.widgets?.length) return getDefaultConfig(saved?.mode ?? 'acquisition')
  const base = DEFAULT_LAYOUTS[saved.mode ?? 'acquisition']
  // Ensure any new widget IDs are added
  const savedIds = new Set(saved.widgets.map(w => w.id))
  const missing = base.filter(w => !savedIds.has(w.id))
  return {
    mode: saved.mode ?? 'acquisition',
    widgets: [...saved.widgets, ...missing].sort((a, b) => a.order - b.order),
  }
}
