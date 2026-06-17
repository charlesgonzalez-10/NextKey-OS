'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import {
  type WidgetId,
  type WidgetConfig,
  type LayoutMode,
  type DashboardConfig,
  WIDGET_LABELS,
  sizeToSpan,
  DEFAULT_LAYOUTS,
  mergeConfig,
} from './config'

import MorningBriefing    from './widgets/MorningBriefing'
import BusinessSnapshot   from './widgets/BusinessSnapshot'
import TodaysPriorities   from './widgets/TodaysPriorities'
import FollowUps          from './widgets/FollowUps'
import OpportunityLeads   from './widgets/OpportunityLeads'
import PipelineFunnel     from './widgets/PipelineFunnel'
import ActiveDeals        from './widgets/ActiveDeals'
import OffersContracts    from './widgets/OffersContracts'
import RecentActivity     from './widgets/RecentActivity'
import MonthlyKPIs        from './widgets/MonthlyKPIs'
import LeadTypeBreakdown  from './widgets/LeadTypeBreakdown'
import QuickActions       from './widgets/QuickActions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SummaryData {
  user_name: string
  morning_briefing: Record<string, number>
  kpis: Record<string, number>
  priorities: Array<{ id: string; type: string; label: string; href: string; urgency: string }>
  follow_ups: Array<Record<string, unknown>>
  pipeline_funnel: Record<string, number>
  opportunity_leads: Array<Record<string, unknown>>
  active_deals: Array<Record<string, unknown>>
  offers_contracts: Record<string, number>
  recent_activity: Array<Record<string, unknown>>
  monthly_kpis: Record<string, number>
  lead_type_breakdown: Array<{ id: string; name: string; color: string; count: number }>
  dashboard_config: Partial<DashboardConfig> | null
}

const MODE_LABELS: Record<LayoutMode, string> = {
  acquisition: 'Acquisition',
  operations:  'Operations',
  executive:   'Executive',
  focus:       'Focus',
  custom:      'Custom',
}

// ── Sortable widget wrapper ────────────────────────────────────────────────────

function SortableWidget({
  widget,
  editMode,
  onToggleVisible,
  onSizeChange,
  children,
}: {
  widget: WidgetConfig
  editMode: boolean
  onToggleVisible: (id: string) => void
  onSizeChange: (id: string, size: WidgetConfig['size']) => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id, disabled: !editMode })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${sizeToSpan[widget.size]} ${!widget.visible && !editMode ? 'hidden' : ''}`}
    >
      <div className={`bg-white border rounded-xl shadow-sm overflow-hidden h-full ${
        isDragging ? 'shadow-lg border-blue-300' : 'border-gray-200'
      } ${!widget.visible && editMode ? 'opacity-50' : ''}`}>
        {editMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 p-1 -ml-1"
              title="Drag to reorder"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <circle cx="4" cy="3" r="1.2"/><circle cx="10" cy="3" r="1.2"/>
                <circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/>
                <circle cx="4" cy="11" r="1.2"/><circle cx="10" cy="11" r="1.2"/>
              </svg>
            </div>
            <span className="text-xs font-medium text-gray-600 flex-1">{WIDGET_LABELS[widget.id as WidgetId]}</span>
            <select
              value={widget.size}
              onChange={e => onSizeChange(widget.id, e.target.value as WidgetConfig['size'])}
              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
            >
              <option value="full">Full</option>
              <option value="lg">Large</option>
              <option value="md">Medium</option>
              <option value="sm">Small</option>
            </select>
            <button
              onClick={() => onToggleVisible(widget.id)}
              className={`text-xs px-2 py-0.5 rounded ${
                widget.visible
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
              }`}
            >
              {widget.visible ? 'Visible' : 'Hidden'}
            </button>
          </div>
        )}
        <div className={`${editMode ? 'p-4' : 'p-5'}`}>
          {!editMode && (
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {WIDGET_LABELS[widget.id as WidgetId]}
            </h3>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Main dashboard client ─────────────────────────────────────────────────────

export default function DashboardClient() {
  const searchParams = useSearchParams()
  const [data, setData]         = useState<SummaryData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [editMode, setEditMode] = useState(() => searchParams.get('edit') === '1')
  const [config, setConfig]     = useState<DashboardConfig>({ mode: 'acquisition', widgets: [] })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // ── Fetch data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/dashboard/summary')
      .then(r => r.json())
      .then((d: SummaryData) => {
        setData(d)
        setConfig(mergeConfig(d.dashboard_config))
      })
      .catch(() => { setData(null); setFetchError(true) })
      .finally(() => setLoading(false))
  }, [])

  // ── Persist config ─────────────────────────────────────────────────────────
  const persistConfig = useCallback((cfg: DashboardConfig) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboard_config: cfg }),
      }).catch(() => {})
    }, 800)
  }, [])

  const updateConfig = useCallback((next: DashboardConfig) => {
    setConfig(next)
    persistConfig(next)
  }, [persistConfig])

  // ── Drag end ───────────────────────────────────────────────────────────────
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = config.widgets.map(w => w.id)
    const oldIdx = ids.indexOf(String(active.id))
    const newIdx = ids.indexOf(String(over.id))
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(config.widgets, oldIdx, newIdx).map((w, i) => ({ ...w, order: i }))
    updateConfig({ ...config, widgets: reordered })
  }

  // ── Edit handlers ──────────────────────────────────────────────────────────
  const toggleVisible = (id: string) => {
    updateConfig({
      ...config,
      widgets: config.widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w),
    })
  }

  const changeSize = (id: string, size: WidgetConfig['size']) => {
    updateConfig({
      ...config,
      widgets: config.widgets.map(w => w.id === id ? { ...w, size } : w),
    })
  }

  const switchMode = (mode: LayoutMode) => {
    const next: DashboardConfig = {
      mode,
      widgets: DEFAULT_LAYOUTS[mode].map((w, i) => ({ ...w, order: i })),
    }
    updateConfig(next)
  }

  // ── Render widget content ──────────────────────────────────────────────────
  const renderWidget = (id: string) => {
    if (!data) return (
      <div className="text-sm text-gray-400 flex items-center gap-2">
        <span>⚠️</span>
        <span>Failed to load — <button onClick={() => window.location.reload()} className="underline hover:text-gray-600">refresh</button></span>
      </div>
    )
    switch (id as WidgetId) {
      case 'morning_briefing':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <MorningBriefing data={data.morning_briefing as any} userName={data.user_name} />
      case 'business_snapshot':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <BusinessSnapshot data={data.kpis as any} />
      case 'priorities':
        return <TodaysPriorities priorities={data.priorities} />
      case 'follow_ups':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <FollowUps followUps={data.follow_ups as any} />
      case 'opportunity_leads':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <OpportunityLeads leads={data.opportunity_leads as any} />
      case 'pipeline_funnel':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <PipelineFunnel data={data.pipeline_funnel as any} />
      case 'active_deals':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <ActiveDeals deals={data.active_deals as any} />
      case 'offers_contracts':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <OffersContracts data={data.offers_contracts as any} />
      case 'recent_activity':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <RecentActivity items={data.recent_activity as any} />
      case 'monthly_kpis':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <MonthlyKPIs data={data.monthly_kpis as any} goals={(data as any).goals} />
      case 'lead_type_breakdown':
        return <LeadTypeBreakdown items={data.lead_type_breakdown ?? []} />
      case 'quick_actions':
        return <QuickActions />
      default:
        return null
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl h-32 animate-pulse" />
        ))}
      </div>
    )
  }

  const visibleWidgets = config.widgets.filter(w => w.visible || editMode)

  return (
    <div className="flex flex-col gap-4">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(MODE_LABELS) as LayoutMode[]).filter(m => m !== 'custom').map(mode => (
            <button
              key={mode}
              onClick={() => switchMode(mode)}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                config.mode === mode
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {editMode && (
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
              Drag to reorder · changes saved automatically
            </span>
          )}
          <button
            onClick={() => setEditMode(e => !e)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium border transition-colors ${
              editMode
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {editMode ? 'Done Editing' : 'Customize'}
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={config.widgets.map(w => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-12 gap-4 items-start">
            {visibleWidgets.map(widget => (
              <SortableWidget
                key={widget.id}
                widget={widget}
                editMode={editMode}
                onToggleVisible={toggleVisible}
                onSizeChange={changeSize}
              >
                {renderWidget(widget.id)}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
