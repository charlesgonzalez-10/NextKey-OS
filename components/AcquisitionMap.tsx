'use client'

/**
 * AcquisitionMap — interactive map for the Property Search criteria builder.
 *
 * Features:
 *  - Google Maps centered on South Florida
 *  - Drawing Manager: polygon, rectangle, circle (Draw Zone mode)
 *  - Layer toggles: Pre-Foreclosure, Probate, Tax Deed, Vacant, High Equity, My Leads
 *  - Saved territories (stored in localStorage; DB persistence is Phase 2)
 *  - Emits drawn zone geometry to parent via onZoneDrawn callback
 */

import { useCallback, useRef, useState } from 'react'
import {
  GoogleMap,
  useLoadScript,
  DrawingManager,
  Polygon,
  Rectangle,
  Circle,
  OverlayView,
} from '@react-google-maps/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const LIBRARIES: ('drawing' | 'places' | 'geometry')[] = ['drawing', 'geometry']

const SOUTH_FLORIDA_CENTER = { lat: 26.12, lng: -80.14 }
const DEFAULT_ZOOM = 10

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'all',              elementType: 'labels.text.fill',   stylers: [{ color: '#9ca3af' }] },
  { featureType: 'administrative',   elementType: 'geometry.stroke',    stylers: [{ color: '#1e3a5f' }] },
  { featureType: 'landscape',        elementType: 'geometry',           stylers: [{ color: '#0f2744' }] },
  { featureType: 'poi',              elementType: 'geometry',           stylers: [{ color: '#0d2240' }] },
  { featureType: 'poi',              elementType: 'labels',             stylers: [{ visibility: 'off' }] },
  { featureType: 'road',             elementType: 'geometry',           stylers: [{ color: '#1a3a5c' }] },
  { featureType: 'road',             elementType: 'geometry.stroke',    stylers: [{ color: '#1a3a5c' }] },
  { featureType: 'road',             elementType: 'labels.text.fill',   stylers: [{ color: '#6b7280' }] },
  { featureType: 'transit',          elementType: 'geometry',           stylers: [{ color: '#0d2240' }] },
  { featureType: 'water',            elementType: 'geometry',           stylers: [{ color: '#071829' }] },
  { featureType: 'water',            elementType: 'labels.text.fill',   stylers: [{ color: '#1e3a5f' }] },
]

const MAP_OPTIONS: google.maps.MapOptions = {
  styles:           MAP_STYLES,
  disableDefaultUI: false,
  zoomControl:      true,
  mapTypeControl:   false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons:   false,
}

export type LayerKey =
  | 'pre_foreclosure'
  | 'probate'
  | 'tax_deed'
  | 'vacant'
  | 'high_equity'
  | 'my_leads'

const LAYER_META: Record<LayerKey, { label: string; color: string; emoji: string }> = {
  pre_foreclosure: { label: 'Pre-Foreclosure', color: '#f59e0b', emoji: '⚡' },
  probate:         { label: 'Probate',          color: '#a78bfa', emoji: '⚖️' },
  tax_deed:        { label: 'Tax Deed',         color: '#f97316', emoji: '🏛️' },
  vacant:          { label: 'Vacant',           color: '#6ABDE0', emoji: '🏚️' },
  high_equity:     { label: 'High Equity',      color: '#4CAF9A', emoji: '💰' },
  my_leads:        { label: 'My Leads',         color: '#C9A84C', emoji: '⭐' },
}

export interface DrawnZone {
  type:    'polygon' | 'rectangle' | 'circle'
  // polygon: array of lat/lng pairs
  path?:   { lat: number; lng: number }[]
  // rectangle: bounds
  bounds?: { north: number; south: number; east: number; west: number }
  // circle: center + radius
  center?: { lat: number; lng: number }
  radius?: number   // metres
  // human-readable label derived from reverse geocode
  label?:  string
}

export interface SavedTerritory {
  id:    string
  name:  string
  zone:  DrawnZone
}

interface Props {
  onZoneDrawn?: (zone: DrawnZone | null) => void
  activeLayers?: Set<LayerKey>
  className?: string
}

// ─── Saved territories (localStorage) ────────────────────────────────────────

function loadTerritories(): SavedTerritory[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('nk_territories') ?? '[]') } catch { return [] }
}
function saveTerritories(t: SavedTerritory[]): void {
  localStorage.setItem('nk_territories', JSON.stringify(t))
}

// ─── Drawing colour palette ───────────────────────────────────────────────────

const DRAW_COLOR     = '#C9A84C'
const DRAW_FILL      = 'rgba(201,168,76,0.15)'
const DRAW_FILL_DARK = 'rgba(201,168,76,0.08)'

// ─── Component ────────────────────────────────────────────────────────────────

export default function AcquisitionMap({ onZoneDrawn, activeLayers, className }: Props) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    libraries: LIBRARIES,
  })

  const mapRef   = useRef<google.maps.Map | null>(null)
  const onMapLoad = useCallback((map: google.maps.Map) => { mapRef.current = map }, [])

  // Drawing mode
  const [drawMode, setDrawMode]       = useState<'idle' | 'polygon' | 'rectangle' | 'circle'>('idle')
  const [currentZone, setCurrentZone] = useState<DrawnZone | null>(null)
  const [overlayRef, setOverlayRef]   = useState<google.maps.MVCObject | null>(null)

  // Territories
  const [territories, setTerritories]   = useState<SavedTerritory[]>(() => loadTerritories())
  const [savingName, setSavingName]     = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  // Active layers
  const [localLayers, setLocalLayers] = useState<Set<LayerKey>>(activeLayers ?? new Set())

  const toggleLayer = (k: LayerKey) => {
    setLocalLayers(prev => {
      const n = new Set(prev)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }

  // ── Drawing callbacks ──────────────────────────────────────────────────────

  const clearZone = useCallback(() => {
    // Remove existing overlay from map
    if (overlayRef && 'setMap' in overlayRef) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(overlayRef as any).setMap(null)
    }
    setOverlayRef(null)
    setCurrentZone(null)
    setDrawMode('idle')
    onZoneDrawn?.(null)
  }, [overlayRef, onZoneDrawn])

  const handlePolygonComplete = useCallback((poly: google.maps.Polygon) => {
    poly.setOptions({ fillColor: DRAW_FILL, strokeColor: DRAW_COLOR, strokeWeight: 2 })
    setOverlayRef(poly)
    const path = poly.getPath().getArray().map(ll => ({ lat: ll.lat(), lng: ll.lng() }))
    const zone: DrawnZone = { type: 'polygon', path }
    setCurrentZone(zone)
    setDrawMode('idle')
    onZoneDrawn?.(zone)
  }, [onZoneDrawn])

  const handleRectangleComplete = useCallback((rect: google.maps.Rectangle) => {
    rect.setOptions({ fillColor: DRAW_FILL, strokeColor: DRAW_COLOR, strokeWeight: 2 })
    setOverlayRef(rect)
    const b = rect.getBounds()!
    const zone: DrawnZone = {
      type: 'rectangle',
      bounds: { north: b.getNorthEast().lat(), south: b.getSouthWest().lat(),
                east:  b.getNorthEast().lng(), west:  b.getSouthWest().lng() },
    }
    setCurrentZone(zone)
    setDrawMode('idle')
    onZoneDrawn?.(zone)
  }, [onZoneDrawn])

  const handleCircleComplete = useCallback((circle: google.maps.Circle) => {
    circle.setOptions({ fillColor: DRAW_FILL_DARK, strokeColor: DRAW_COLOR, strokeWeight: 2 })
    setOverlayRef(circle)
    const center = circle.getCenter()!
    const zone: DrawnZone = {
      type: 'circle',
      center: { lat: center.lat(), lng: center.lng() },
      radius: circle.getRadius(),
    }
    setCurrentZone(zone)
    setDrawMode('idle')
    onZoneDrawn?.(zone)
  }, [onZoneDrawn])

  // ── Save / load territory ─────────────────────────────────────────────────

  const saveTerritory = () => {
    if (!currentZone || !savingName.trim()) return
    const t: SavedTerritory = { id: crypto.randomUUID(), name: savingName.trim(), zone: currentZone }
    const next = [...territories, t]
    setTerritories(next)
    saveTerritories(next)
    setSavingName('')
    setShowSaveInput(false)
  }

  const loadTerritory = (t: SavedTerritory) => {
    clearZone()
    setCurrentZone(t.zone)
    onZoneDrawn?.(t.zone)
    // Fit map to zone
    if (!mapRef.current) return
    if (t.zone.type === 'rectangle' && t.zone.bounds) {
      mapRef.current.fitBounds(t.zone.bounds)
    } else if (t.zone.type === 'circle' && t.zone.center) {
      mapRef.current.setCenter(t.zone.center)
      mapRef.current.setZoom(13)
    } else if (t.zone.type === 'polygon' && t.zone.path?.length) {
      const bounds = new window.google.maps.LatLngBounds()
      t.zone.path.forEach(p => bounds.extend(p))
      mapRef.current.fitBounds(bounds)
    }
  }

  const deleteTerritory = (id: string) => {
    const next = territories.filter(t => t.id !== id)
    setTerritories(next)
    saveTerritories(next)
  }

  // ── Drawing manager options ────────────────────────────────────────────────

  const drawingManagerOptions: google.maps.drawing.DrawingManagerOptions = {
    drawingMode: drawMode === 'idle' ? null
      : drawMode === 'polygon'   ? google.maps.drawing.OverlayType.POLYGON
      : drawMode === 'rectangle' ? google.maps.drawing.OverlayType.RECTANGLE
      : google.maps.drawing.OverlayType.CIRCLE,
    drawingControl: false,
    polygonOptions:   { fillColor: DRAW_FILL,      strokeColor: DRAW_COLOR, strokeWeight: 2, clickable: false, editable: true },
    rectangleOptions: { fillColor: DRAW_FILL,      strokeColor: DRAW_COLOR, strokeWeight: 2, clickable: false, editable: true },
    circleOptions:    { fillColor: DRAW_FILL_DARK, strokeColor: DRAW_COLOR, strokeWeight: 2, clickable: false, editable: true },
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className={`flex items-center justify-center bg-[#071829] rounded-2xl ${className ?? ''}`}>
        <p className="text-sm text-white/40">Map failed to load</p>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className={`flex items-center justify-center bg-[#071829] rounded-2xl ${className ?? ''}`}>
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2"
            style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
          <p className="text-xs text-white/30">Loading map…</p>
        </div>
      </div>
    )
  }

  const zoneLabel = currentZone
    ? currentZone.type === 'circle'
      ? `${currentZone.type} · ${((currentZone.radius ?? 0) / 1609).toFixed(1)} mi radius`
      : `${currentZone.type} zone drawn`
    : null

  return (
    <div className={`relative flex flex-col ${className ?? ''}`}>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-2xl overflow-hidden">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={SOUTH_FLORIDA_CENTER}
          zoom={DEFAULT_ZOOM}
          options={MAP_OPTIONS}
          onLoad={onMapLoad}
        >
          <DrawingManager
            options={drawingManagerOptions}
            onPolygonComplete={handlePolygonComplete}
            onRectangleComplete={handleRectangleComplete}
            onCircleComplete={handleCircleComplete}
          />

          {/* Render saved territory zones as ghost overlays */}
          {territories.map(t => {
            if (t.zone.type === 'polygon' && t.zone.path) {
              return (
                <Polygon key={t.id}
                  paths={t.zone.path}
                  options={{ fillColor: 'rgba(255,255,255,0.03)', strokeColor: 'rgba(255,255,255,0.2)', strokeWeight: 1 }} />
              )
            }
            if (t.zone.type === 'rectangle' && t.zone.bounds) {
              return (
                <Rectangle key={t.id}
                  bounds={t.zone.bounds}
                  options={{ fillColor: 'rgba(255,255,255,0.03)', strokeColor: 'rgba(255,255,255,0.2)', strokeWeight: 1 }} />
              )
            }
            if (t.zone.type === 'circle' && t.zone.center) {
              return (
                <Circle key={t.id}
                  center={t.zone.center}
                  radius={t.zone.radius ?? 1000}
                  options={{ fillColor: 'rgba(255,255,255,0.03)', strokeColor: 'rgba(255,255,255,0.2)', strokeWeight: 1 }} />
              )
            }
            return null
          })}

          {/* Territory labels */}
          {territories.map(t => {
            let pos: google.maps.LatLngLiteral | null = null
            if (t.zone.type === 'polygon' && t.zone.path?.length) {
              const lats = t.zone.path.map(p => p.lat), lngs = t.zone.path.map(p => p.lng)
              pos = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 }
            } else if (t.zone.type === 'rectangle' && t.zone.bounds) {
              pos = { lat: (t.zone.bounds.north + t.zone.bounds.south) / 2, lng: (t.zone.bounds.east + t.zone.bounds.west) / 2 }
            } else if (t.zone.type === 'circle' && t.zone.center) {
              pos = t.zone.center
            }
            if (!pos) return null
            return (
              <OverlayView key={`label-${t.id}`} position={pos} mapPaneName="overlayLayer">
                <div className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap select-none"
                  style={{ backgroundColor: 'rgba(10,31,68,0.85)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.15)', transform: 'translate(-50%, -50%)' }}>
                  {t.name}
                </div>
              </OverlayView>
            )
          })}
        </GoogleMap>
      </div>

      {/* ── Controls overlay ─────────────────────────────────────────────── */}
      <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 pointer-events-none">

        {/* Draw zone toolbar */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* Draw mode buttons */}
          {(['polygon', 'rectangle', 'circle'] as const).map(mode => (
            <button key={mode}
              onClick={() => setDrawMode(prev => prev === mode ? 'idle' : mode)}
              className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
              style={{
                backgroundColor: drawMode === mode ? '#C9A84C' : 'rgba(10,31,68,0.9)',
                color: drawMode === mode ? '#0A1F44' : 'rgba(255,255,255,0.7)',
                border: `1px solid ${drawMode === mode ? '#C9A84C' : 'rgba(255,255,255,0.15)'}`,
                backdropFilter: 'blur(8px)',
              }}>
              {mode === 'polygon' ? '⬡' : mode === 'rectangle' ? '▭' : '◯'}
              <span className="hidden sm:inline capitalize">{mode}</span>
            </button>
          ))}

          {currentZone && (
            <button onClick={clearZone}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all ml-1"
              style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', backdropFilter: 'blur(8px)' }}>
              ✕ Clear Zone
            </button>
          )}

          {currentZone && (
            <button onClick={() => setShowSaveInput(v => !v)}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
              style={{ backgroundColor: 'rgba(10,31,68,0.9)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)', backdropFilter: 'blur(8px)' }}>
              + Save Territory
            </button>
          )}
        </div>

        {/* Zone drawn notice */}
        {zoneLabel && (
          <div className="self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg pointer-events-none"
            style={{ backgroundColor: 'rgba(10,31,68,0.9)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.2)', backdropFilter: 'blur(8px)' }}>
            ✓ {zoneLabel}
          </div>
        )}

        {/* Save territory input */}
        {showSaveInput && (
          <div className="flex items-center gap-2 pointer-events-auto"
            style={{ backgroundColor: 'rgba(10,31,68,0.95)', border: '1px solid rgba(201,168,76,0.3)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 10px' }}>
            <input
              autoFocus
              value={savingName}
              onChange={e => setSavingName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTerritory(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder="Territory name (e.g. East Boca)"
              className="flex-1 bg-transparent text-sm focus:outline-none text-white placeholder-white/30"
            />
            <button onClick={saveTerritory}
              className="text-xs font-bold px-2.5 py-1 rounded-lg"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              Save
            </button>
            <button onClick={() => setShowSaveInput(false)}
              className="text-xs px-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>✕</button>
          </div>
        )}
      </div>

      {/* ── Layer toggles (bottom-left) ───────────────────────────────────── */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5">
        <p className="text-[9px] font-bold tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>LAYERS</p>
        <div className="flex flex-col gap-1">
          {(Object.keys(LAYER_META) as LayerKey[]).map(k => {
            const { label, color, emoji } = LAYER_META[k]
            const on = localLayers.has(k)
            return (
              <button key={k} onClick={() => toggleLayer(k)}
                className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                style={{
                  backgroundColor: on ? `${color}25` : 'rgba(10,31,68,0.85)',
                  color:            on ? color : 'rgba(255,255,255,0.4)',
                  border:           `1px solid ${on ? color + '50' : 'rgba(255,255,255,0.1)'}`,
                  backdropFilter:   'blur(8px)',
                }}>
                <span>{emoji}</span> {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Saved territories (bottom-right) ─────────────────────────────── */}
      {territories.length > 0 && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 max-w-[180px]">
          <p className="text-[9px] font-bold tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>TERRITORIES</p>
          {territories.map(t => (
            <div key={t.id} className="flex items-center gap-1">
              <button onClick={() => loadTerritory(t)}
                className="flex-1 text-left text-[10px] font-semibold px-2.5 py-1 rounded-lg truncate"
                style={{ backgroundColor: 'rgba(10,31,68,0.85)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}>
                📍 {t.name}
              </button>
              <button onClick={() => deleteTerritory(t.id)}
                className="text-[10px] px-1.5 py-1 rounded-lg"
                style={{ backgroundColor: 'rgba(10,31,68,0.85)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
