'use client'

/**
 * CompsMap — shows subject property + sold comps + active listings on a map.
 * Used in the Comps tab of the lead detail page.
 *
 * Subject property = gold star pin (center)
 * Sold comps       = green circle pins
 * Active listings  = amber circle pins
 * Dashed lines     = drawn from subject to each comp
 */

import { useState, useCallback } from 'react'
import { GoogleMap, useLoadScript, OverlayView, Polyline } from '@react-google-maps/api'
import type { PropertyComp } from '@/lib/enrichment/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompsMapProps {
  subjectLat:  number
  subjectLng:  number
  subjectAddr: string
  sold:        PropertyComp[]
  active:      PropertyComp[]
  pending?:    PropertyComp[]
}

type PinComp = PropertyComp & { lat: number; lng: number }

// ─── Config ───────────────────────────────────────────────────────────────────

const LIBRARIES: ('geometry' | 'places')[] = ['geometry']

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'all',         elementType: 'labels.text.fill',   stylers: [{ color: '#d1d5db' }] },
  { featureType: 'all',         elementType: 'labels.text.stroke', stylers: [{ color: '#0a1f44' }, { weight: 3 }] },
  { featureType: 'landscape',   elementType: 'geometry',           stylers: [{ color: '#0f2744' }] },
  { featureType: 'poi',         elementType: 'labels',             stylers: [{ visibility: 'off' }] },
  { featureType: 'poi',         elementType: 'geometry',           stylers: [{ color: '#0d2240' }] },
  { featureType: 'road',        elementType: 'geometry',           stylers: [{ color: '#1e4a7a' }] },
  { featureType: 'road',        elementType: 'geometry.stroke',    stylers: [{ color: '#0f2f5c' }] },
  { featureType: 'road',        elementType: 'labels.text.fill',   stylers: [{ color: '#94a3b8' }] },
  { featureType: 'road',        elementType: 'labels.text.stroke', stylers: [{ color: '#0a1f44' }, { weight: 3 }] },
  { featureType: 'road.highway',elementType: 'labels.text.fill',   stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'transit',     elementType: 'geometry',           stylers: [{ color: '#0d2240' }] },
  { featureType: 'water',       elementType: 'geometry',           stylers: [{ color: '#071829' }] },
  { featureType: 'water',       elementType: 'labels.text.fill',   stylers: [{ color: '#3b6ea5' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2d5a8e' }, { weight: 1.5 }] },
]

const MAP_OPTIONS: google.maps.MapOptions = {
  styles:           MAP_STYLES,
  disableDefaultUI: true,
  zoomControl:      true,
  gestureHandling:  'cooperative',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined) {
  if (!n) return '—'
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${n.toLocaleString()}`
}

function compsWithCoords(comps: PropertyComp[]): PinComp[] {
  return comps.filter(c => c.lat && c.lng) as PinComp[]
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function CompTooltip({
  comp,
  color,
  onClose,
}: {
  comp:    PinComp
  color:   string
  onClose: () => void
}) {
  const price  = comp.sold_price ?? comp.list_price
  const label  = comp.status === 'sold' ? 'Sold' : comp.status === 'active' ? 'Active' : 'Pending'
  const date   = comp.sold_date ?? comp.list_date

  return (
    <div
      className="absolute z-10 rounded-xl shadow-2xl p-3 w-52"
      style={{
        backgroundColor: 'var(--c-card)',
        border:          `1px solid ${color}40`,
        transform:       'translate(-50%, -120%)',
        pointerEvents:   'none',
      }}
    >
      <button
        onPointerDown={e => { e.stopPropagation(); onClose() }}
        className="absolute top-1.5 right-1.5 text-[10px] leading-none px-1 py-0.5 rounded hover:opacity-60"
        style={{ color: 'var(--c-text-3)', pointerEvents: 'all' }}
      >✕</button>

      <p className="text-[10px] font-bold pr-4 leading-tight" style={{ color: 'var(--c-primary)' }}>
        {comp.address}
      </p>
      <p className="text-[9px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
        {comp.city}{comp.zip ? `, ${comp.zip}` : ''}
      </p>

      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}40` }}>
          {label}
        </span>
        <span className="text-[11px] font-bold" style={{ color }}>{fmt$(price)}</span>
      </div>

      <p className="text-[9px] mt-1" style={{ color: 'var(--c-text-3)' }}>
        {[
          comp.beds  && `${comp.beds}bd`,
          comp.baths && `${comp.baths}ba`,
          comp.living_area && `${comp.living_area.toLocaleString()}sf`,
        ].filter(Boolean).join(' · ')}
        {comp.price_per_sqft ? ` · $${comp.price_per_sqft}/sf` : ''}
      </p>
      {date && (
        <p className="text-[9px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
          {comp.status === 'sold' ? 'Sold ' : 'Listed '}
          {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      )}
      {comp.distance_miles != null && (
        <p className="text-[9px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
          {comp.distance_miles} mi from subject
        </p>
      )}
    </div>
  )
}

// ─── Pin components ───────────────────────────────────────────────────────────

function SubjectPin({ addr }: { addr: string }) {
  return (
    <div style={{ transform: 'translate(-50%, -50%)', textAlign: 'center', cursor: 'default' }}>
      <div
        className="flex items-center justify-center font-bold text-[11px] rounded-full shadow-lg"
        style={{
          width: 30, height: 30,
          backgroundColor: '#C9A84C',
          color: '#0A1F44',
          border: '2px solid #fff',
          boxShadow: '0 0 0 3px rgba(201,168,76,0.4)',
        }}
        title={addr}
      >★</div>
      <div className="text-[8px] font-bold mt-0.5 px-1.5 py-0.5 rounded-full whitespace-nowrap"
        style={{ backgroundColor: 'rgba(201,168,76,0.9)', color: '#0A1F44' }}>
        Subject
      </div>
    </div>
  )
}

function CompPin({
  color,
  label,
  onClick,
}: {
  color:   string
  label:   string
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{ transform: 'translate(-50%, -50%)', cursor: 'pointer' }}
    >
      <div
        className="flex items-center justify-center rounded-full text-[9px] font-bold shadow-md hover:scale-110 transition-transform"
        style={{
          width: 22, height: 22,
          backgroundColor: color,
          color: '#0A1F44',
          border: '2px solid rgba(255,255,255,0.6)',
        }}
      >
        {label}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CompsMap({
  subjectLat,
  subjectLng,
  subjectAddr,
  sold,
  active,
  pending = [],
}: CompsMapProps) {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    libraries:        LIBRARIES,
  })

  const [activeComp, setActiveComp] = useState<PinComp | null>(null)
  const [map, setMap]               = useState<google.maps.Map | null>(null)

  const onLoad    = useCallback((m: google.maps.Map) => setMap(m), [])
  const onUnmount = useCallback(() => setMap(null), [])

  const soldPins    = compsWithCoords(sold)
  const activePins  = compsWithCoords(active)
  const pendingPins = compsWithCoords(pending)

  const subject = { lat: subjectLat, lng: subjectLng }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center rounded-2xl" style={{ height: 300, backgroundColor: '#071829' }}>
        <div className="text-center">
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2"
            style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading map…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ height: 340, border: '1px solid var(--c-border)' }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={subject}
        zoom={14}
        options={MAP_OPTIONS}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onClick={() => setActiveComp(null)}
      >
        {/* Dashed lines from subject to each comp */}
        {[...soldPins, ...activePins, ...pendingPins].map((c, i) => (
          <Polyline
            key={`line-${i}`}
            path={[subject, { lat: c.lat, lng: c.lng }]}
            options={{
              strokeColor:   c.status === 'sold' ? '#4CAF9A' : c.status === 'active' ? '#C9A84C' : '#7B8FD4',
              strokeOpacity: 0.4,
              strokeWeight:  1.5,
              icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
                offset: '0',
                repeat: '12px',
              }],
            }}
          />
        ))}

        {/* Sold comp pins */}
        {soldPins.map((c, i) => (
          <OverlayView
            key={`sold-${i}`}
            position={{ lat: c.lat, lng: c.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div style={{ position: 'relative' }}>
              <CompPin color="#4CAF9A" label="S" onClick={() => setActiveComp(activeComp?.mls_number === c.mls_number ? null : c)} />
              {activeComp?.mls_number === c.mls_number && (
                <CompTooltip comp={c} color="#4CAF9A" onClose={() => setActiveComp(null)} />
              )}
            </div>
          </OverlayView>
        ))}

        {/* Active listing pins */}
        {activePins.map((c, i) => (
          <OverlayView
            key={`active-${i}`}
            position={{ lat: c.lat, lng: c.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div style={{ position: 'relative' }}>
              <CompPin color="#C9A84C" label="A" onClick={() => setActiveComp(activeComp?.mls_number === c.mls_number ? null : c)} />
              {activeComp?.mls_number === c.mls_number && (
                <CompTooltip comp={c} color="#C9A84C" onClose={() => setActiveComp(null)} />
              )}
            </div>
          </OverlayView>
        ))}

        {/* Pending pins */}
        {pendingPins.map((c, i) => (
          <OverlayView
            key={`pending-${i}`}
            position={{ lat: c.lat, lng: c.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div style={{ position: 'relative' }}>
              <CompPin color="#7B8FD4" label="P" onClick={() => setActiveComp(activeComp?.mls_number === c.mls_number ? null : c)} />
              {activeComp?.mls_number === c.mls_number && (
                <CompTooltip comp={c} color="#7B8FD4" onClose={() => setActiveComp(null)} />
              )}
            </div>
          </OverlayView>
        ))}

        {/* Subject property pin */}
        <OverlayView
          position={subject}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
        >
          <SubjectPin addr={subjectAddr} />
        </OverlayView>
      </GoogleMap>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2" style={{ backgroundColor: 'var(--c-card-alt)', borderTop: '1px solid var(--c-border)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#C9A84C' }} />
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Subject</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#4CAF9A' }} />
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Sold ({soldPins.length})</span>
        </div>
        {activePins.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#C9A84C', opacity: 0.6 }} />
            <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Active ({activePins.length})</span>
          </div>
        )}
        {pendingPins.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#7B8FD4' }} />
            <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Pending ({pendingPins.length})</span>
          </div>
        )}
        <span className="ml-auto text-[9px]" style={{ color: 'var(--c-text-3)' }}>Click a pin for details</span>
      </div>
    </div>
  )
}
