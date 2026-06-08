'use client'

/**
 * AcquisitionMap — interactive map for the Property Search criteria builder.
 *
 * Drawing is implemented WITHOUT google.maps.drawing.DrawingManager
 * (deprecated and removed in Maps API v3.65). All shapes are drawn via
 * click events on the GoogleMap component + Polygon/Rectangle/Circle overlays.
 *
 * Supported draw tools:
 *   Polygon   — click to place vertices; click near first vertex (or press
 *               "Complete") to close the shape.
 *   Rectangle — first click sets one corner; second click sets the opposite.
 *   Circle    — first click sets center; second click sets radius point.
 */

import { useCallback, useRef, useState } from 'react'
import {
  GoogleMap,
  useLoadScript,
  Polygon,
  Polyline,
  Rectangle,
  Circle,
  OverlayView,
} from '@react-google-maps/api'

// ─── Constants ────────────────────────────────────────────────────────────────

// geometry only — no 'drawing' library needed
const LIBRARIES: ('geometry' | 'places')[] = ['geometry']

const SOUTH_FLORIDA_CENTER = { lat: 26.12, lng: -80.14 }
const DEFAULT_ZOOM = 10

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  // ── Base text — bright enough to read ──────────────────────────────────────
  { featureType: 'all',                    elementType: 'labels.text.fill',   stylers: [{ color: '#d1d5db' }] },
  { featureType: 'all',                    elementType: 'labels.text.stroke', stylers: [{ color: '#0a1f44' }, { weight: 3 }] },

  // ── City / locality names — white & bold ───────────────────────────────────
  { featureType: 'locality',               elementType: 'labels.text.fill',   stylers: [{ color: '#ffffff' }] },
  { featureType: 'locality',               elementType: 'labels.text.stroke', stylers: [{ color: '#071829' }, { weight: 4 }] },
  { featureType: 'administrative.locality',elementType: 'labels.text.fill',   stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative.locality',elementType: 'labels.text.stroke', stylers: [{ color: '#071829' }, { weight: 4 }] },

  // ── Neighbourhood / sublocality ────────────────────────────────────────────
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill',   stylers: [{ color: '#c9c9c9' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.stroke', stylers: [{ color: '#071829' }, { weight: 3 }] },

  // ── County / state borders ─────────────────────────────────────────────────
  { featureType: 'administrative', elementType: 'geometry.stroke',   stylers: [{ color: '#2d5a8e' }, { weight: 1.5 }] },
  { featureType: 'administrative', elementType: 'labels.text.fill',  stylers: [{ color: '#a0aec0' }] },

  // ── Landscape / land ───────────────────────────────────────────────────────
  { featureType: 'landscape',      elementType: 'geometry',          stylers: [{ color: '#0f2744' }] },

  // ── POI — hide clutter ─────────────────────────────────────────────────────
  { featureType: 'poi',            elementType: 'geometry',          stylers: [{ color: '#0d2240' }] },
  { featureType: 'poi',            elementType: 'labels',            stylers: [{ visibility: 'off' }] },

  // ── Roads ──────────────────────────────────────────────────────────────────
  { featureType: 'road',           elementType: 'geometry',          stylers: [{ color: '#1e4a7a' }] },
  { featureType: 'road',           elementType: 'geometry.stroke',   stylers: [{ color: '#0f2f5c' }] },
  { featureType: 'road',           elementType: 'labels.text.fill',  stylers: [{ color: '#94a3b8' }] },
  { featureType: 'road',           elementType: 'labels.text.stroke',stylers: [{ color: '#0a1f44' }, { weight: 3 }] },
  { featureType: 'road.highway',   elementType: 'labels.text.fill',  stylers: [{ color: '#e2e8f0' }] },

  // ── Transit ────────────────────────────────────────────────────────────────
  { featureType: 'transit',        elementType: 'geometry',          stylers: [{ color: '#0d2240' }] },

  // ── Water ──────────────────────────────────────────────────────────────────
  { featureType: 'water',          elementType: 'geometry',          stylers: [{ color: '#071829' }] },
  { featureType: 'water',          elementType: 'labels.text.fill',  stylers: [{ color: '#3b6ea5' }] },
  { featureType: 'water',          elementType: 'labels.text.stroke',stylers: [{ color: '#071829' }, { weight: 2 }] },
]

const MAP_OPTIONS: google.maps.MapOptions = {
  styles:            MAP_STYLES,
  disableDefaultUI:  false,
  zoomControl:       true,
  mapTypeControl:    false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons:    false,
  // Disable all default gestures that conflict with draw mode
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
  probate:         { label: 'Probate',          color: '#a78bfa', emoji: '⚖' },
  tax_deed:        { label: 'Tax Deed',         color: '#f97316', emoji: '🏛' },
  vacant:          { label: 'Vacant',           color: '#6ABDE0', emoji: '🏚' },
  high_equity:     { label: 'High Equity',      color: '#4CAF9A', emoji: '💰' },
  my_leads:        { label: 'My Leads',         color: '#C9A84C', emoji: '★' },
}

export interface DrawnZone {
  type:    'polygon' | 'rectangle' | 'circle'
  path?:   { lat: number; lng: number }[]
  bounds?: { north: number; south: number; east: number; west: number }
  center?: { lat: number; lng: number }
  radius?: number
  label?:  string
}

export interface SavedTerritory {
  id:   string
  name: string
  zone: DrawnZone
}

interface Props {
  onZoneDrawn?: (zone: DrawnZone | null) => void
  activeLayers?: Set<LayerKey>
  className?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type LatLng = { lat: number; lng: number }

function latlngDist(a: LatLng, b: LatLng) {
  return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2)
}

function latLngRadiusMetres(center: LatLng, edge: LatLng) {
  // Rough conversion: 1 degree lat ≈ 111_000 m
  const dLat = (edge.lat - center.lat) * 111_000
  const dLng = (edge.lng - center.lng) * 111_000 * Math.cos(center.lat * Math.PI / 180)
  return Math.sqrt(dLat ** 2 + dLng ** 2)
}

function rectBounds(a: LatLng, b: LatLng) {
  return {
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
    east:  Math.max(a.lng, b.lng),
    west:  Math.min(a.lng, b.lng),
  }
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadTerritories(): SavedTerritory[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('nk_territories') ?? '[]') } catch { return [] }
}
function saveTerritories(t: SavedTerritory[]): void {
  localStorage.setItem('nk_territories', JSON.stringify(t))
}

// ─── Draw colour palette ───────────────────────────────────────────────────────

const DRAW_COLOR     = '#C9A84C'
const DRAW_FILL      = 'rgba(201,168,76,0.15)'
const DRAW_FILL_DARK = 'rgba(201,168,76,0.08)'
const POLY_OPTS  = { fillColor: DRAW_FILL,      strokeColor: DRAW_COLOR, strokeWeight: 2, clickable: false }
const CIRC_OPTS  = { fillColor: DRAW_FILL_DARK, strokeColor: DRAW_COLOR, strokeWeight: 2, clickable: false }
const GHOST_OPTS = { fillColor: 'rgba(255,255,255,0.03)', strokeColor: 'rgba(255,255,255,0.2)', strokeWeight: 1, clickable: false }

// ─── Component ────────────────────────────────────────────────────────────────

export default function AcquisitionMap({ onZoneDrawn, activeLayers, className }: Props) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    libraries: LIBRARIES,
  })

  const mapRef = useRef<google.maps.Map | null>(null)
  const onMapLoad = useCallback((map: google.maps.Map) => { mapRef.current = map }, [])

  // ── Draw state ────────────────────────────────────────────────────────────
  type DrawMode = 'idle' | 'polygon' | 'rectangle' | 'circle'
  const [drawMode, setDrawMode]         = useState<DrawMode>('idle')
  const [polyVerts, setPolyVerts]       = useState<LatLng[]>([])   // polygon vertices in progress
  const [drawStart, setDrawStart]       = useState<LatLng | null>(null)   // rect/circle first click
  const [mousePos,  setMousePos]        = useState<LatLng | null>(null)   // mouse for previews
  const [currentZone, setCurrentZone]   = useState<DrawnZone | null>(null)

  // ── Territories ───────────────────────────────────────────────────────────
  const [territories,   setTerritories]   = useState<SavedTerritory[]>(() => loadTerritories())
  const [savingName,    setSavingName]     = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  // ── Layers ────────────────────────────────────────────────────────────────
  const [localLayers, setLocalLayers] = useState<Set<LayerKey>>(activeLayers ?? new Set())
  const toggleLayer = (k: LayerKey) => setLocalLayers(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n
  })

  // ── Commit a completed zone ───────────────────────────────────────────────
  const commitZone = useCallback((zone: DrawnZone) => {
    setCurrentZone(zone)
    setDrawMode('idle')
    setPolyVerts([])
    setDrawStart(null)
    setMousePos(null)
    onZoneDrawn?.(zone)
  }, [onZoneDrawn])

  const clearZone = useCallback(() => {
    setCurrentZone(null)
    setDrawMode('idle')
    setPolyVerts([])
    setDrawStart(null)
    setMousePos(null)
    onZoneDrawn?.(null)
  }, [onZoneDrawn])

  // ── Map click handler (drives all draw modes) ─────────────────────────────
  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (drawMode === 'idle' || !e.latLng) return
    const pt: LatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() }

    if (drawMode === 'polygon') {
      // Close if clicking near first vertex (≤ 0.002° / ~200m) and have ≥3 verts
      if (polyVerts.length >= 3 && latlngDist(pt, polyVerts[0]) < 0.002) {
        commitZone({ type: 'polygon', path: polyVerts })
        return
      }
      setPolyVerts(prev => [...prev, pt])

    } else if (drawMode === 'rectangle') {
      if (!drawStart) {
        setDrawStart(pt)
      } else {
        commitZone({ type: 'rectangle', bounds: rectBounds(drawStart, pt) })
      }

    } else if (drawMode === 'circle') {
      if (!drawStart) {
        setDrawStart(pt)
      } else {
        commitZone({
          type:   'circle',
          center: drawStart,
          radius: latLngRadiusMetres(drawStart, pt),
        })
      }
    }
  }, [drawMode, polyVerts, drawStart, commitZone])

  // ── Mouse-move for draw preview ───────────────────────────────────────────
  const handleMouseMove = useCallback((e: google.maps.MapMouseEvent) => {
    if (drawMode === 'idle' || !e.latLng) return
    setMousePos({ lat: e.latLng.lat(), lng: e.latLng.lng() })
  }, [drawMode])

  // ── Complete polygon via button ───────────────────────────────────────────
  const completePoly = () => {
    if (polyVerts.length >= 3) commitZone({ type: 'polygon', path: polyVerts })
  }

  // ── Territory actions ─────────────────────────────────────────────────────
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

  // ── Preview shape helpers ─────────────────────────────────────────────────

  // Rectangle preview: stretch between drawStart and current mouse
  const previewRectBounds = drawStart && mousePos ? rectBounds(drawStart, mousePos) : null

  // Circle preview: expand from drawStart to current mouse
  const previewCircleRadius = drawStart && mousePos ? latLngRadiusMetres(drawStart, mousePos) : 0

  // Polygon preview: current verts + line to mouse
  const previewPolyPath = mousePos && polyVerts.length > 0
    ? [...polyVerts, mousePos]
    : polyVerts

  // ── Cursors ───────────────────────────────────────────────────────────────
  const cursor = drawMode === 'idle' ? 'default' : 'crosshair'

  // ── Zone label ────────────────────────────────────────────────────────────
  const zoneLabel = currentZone
    ? currentZone.type === 'circle'
      ? `circle · ${((currentZone.radius ?? 0) / 1609).toFixed(1)} mi radius`
      : `${currentZone.type} zone drawn`
    : null

  // ── Render guards ─────────────────────────────────────────────────────────

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

  // ── Full render ────────────────────────────────────────────────────────────

  return (
    <div className={`relative flex flex-col ${className ?? ''}`}>

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-2xl overflow-hidden" style={{ cursor }}>
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={SOUTH_FLORIDA_CENTER}
          zoom={DEFAULT_ZOOM}
          options={MAP_OPTIONS}
          onLoad={onMapLoad}
          onClick={handleMapClick}
          onMouseMove={handleMouseMove}
        >
          {/* ── Completed zone overlays ─── */}
          {currentZone?.type === 'polygon' && currentZone.path && (
            <Polygon paths={currentZone.path} options={POLY_OPTS} />
          )}
          {currentZone?.type === 'rectangle' && currentZone.bounds && (
            <Rectangle bounds={currentZone.bounds} options={POLY_OPTS} />
          )}
          {currentZone?.type === 'circle' && currentZone.center && (
            <Circle center={currentZone.center} radius={currentZone.radius ?? 1000} options={CIRC_OPTS} />
          )}

          {/* ── In-progress polygon preview ─── */}
          {drawMode === 'polygon' && previewPolyPath.length > 1 && (
            <Polyline
              path={previewPolyPath}
              options={{ strokeColor: DRAW_COLOR, strokeWeight: 2, strokeOpacity: 0.8, geodesic: false }}
            />
          )}

          {/* ── Polygon vertex dots ─── */}
          {drawMode === 'polygon' && polyVerts.map((v, i) => (
            <OverlayView key={i} position={v} mapPaneName="overlayLayer">
              <div
                title={i === 0 && polyVerts.length >= 3 ? 'Click to close polygon' : undefined}
                style={{
                  width: 10, height: 10,
                  borderRadius: '50%',
                  backgroundColor: i === 0 && polyVerts.length >= 3 ? '#C9A84C' : '#ffffff',
                  border: `2px solid ${DRAW_COLOR}`,
                  transform: 'translate(-50%, -50%)',
                  cursor: i === 0 && polyVerts.length >= 3 ? 'pointer' : 'default',
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                }}
              />
            </OverlayView>
          ))}

          {/* ── Rectangle preview (while drawing) ─── */}
          {drawMode === 'rectangle' && previewRectBounds && (
            <Rectangle bounds={previewRectBounds} options={{ ...POLY_OPTS, strokeOpacity: 0.6, fillOpacity: 0.08 }} />
          )}

          {/* ── Circle preview (while drawing) ─── */}
          {drawMode === 'circle' && drawStart && mousePos && (
            <Circle
              center={drawStart}
              radius={previewCircleRadius}
              options={{ ...CIRC_OPTS, strokeOpacity: 0.6, fillOpacity: 0.05 }}
            />
          )}

          {/* ── Rectangle/circle first-click marker ─── */}
          {(drawMode === 'rectangle' || drawMode === 'circle') && drawStart && (
            <OverlayView position={drawStart} mapPaneName="overlayLayer">
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                backgroundColor: '#C9A84C', border: '2px solid #C9A84C',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 4px rgba(0,0,0,0.5)',
              }} />
            </OverlayView>
          )}

          {/* ── Saved territory ghost overlays ─── */}
          {territories.map(t => {
            if (t.zone.type === 'polygon' && t.zone.path)
              return <Polygon key={t.id} paths={t.zone.path} options={GHOST_OPTS} />
            if (t.zone.type === 'rectangle' && t.zone.bounds)
              return <Rectangle key={t.id} bounds={t.zone.bounds} options={GHOST_OPTS} />
            if (t.zone.type === 'circle' && t.zone.center)
              return <Circle key={t.id} center={t.zone.center} radius={t.zone.radius ?? 1000} options={{ ...GHOST_OPTS }} />
            return null
          })}

          {/* ── Territory name labels ─── */}
          {territories.map(t => {
            let pos: LatLng | null = null
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
              <OverlayView key={`lbl-${t.id}`} position={pos} mapPaneName="overlayLayer">
                <div className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap select-none"
                  style={{ backgroundColor: 'rgba(10,31,68,0.85)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.15)', transform: 'translate(-50%,-50%)' }}>
                  {t.name}
                </div>
              </OverlayView>
            )
          })}
        </GoogleMap>
      </div>

      {/* ── Controls overlay ────────────────────────────────────────────────── */}
      <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 pointer-events-none">

        {/* Draw toolbar */}
        <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto">

          {/* Tool buttons */}
          {(['polygon', 'rectangle', 'circle'] as const).map(mode => (
            <button key={mode}
              onClick={() => {
                setDrawMode(prev => prev === mode ? 'idle' : mode)
                setPolyVerts([])
                setDrawStart(null)
                setMousePos(null)
              }}
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

          {/* Complete polygon button */}
          {drawMode === 'polygon' && polyVerts.length >= 3 && (
            <button onClick={completePoly}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg ml-1"
              style={{ backgroundColor: '#4CAF9A', color: '#0A1F44', backdropFilter: 'blur(8px)' }}>
              ✓ Complete
            </button>
          )}

          {/* Clear zone */}
          {(currentZone || polyVerts.length > 0 || drawStart) && (
            <button onClick={clearZone}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg ml-1"
              style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', backdropFilter: 'blur(8px)' }}>
              ✕ Clear
            </button>
          )}

          {/* Save zone as territory */}
          {currentZone && !showSaveInput && (
            <button onClick={() => setShowSaveInput(true)}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg ml-auto"
              style={{ backgroundColor: 'rgba(10,31,68,0.9)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)', backdropFilter: 'blur(8px)' }}>
              + Save Territory
            </button>
          )}
        </div>

        {/* Save territory input */}
        {showSaveInput && (
          <div className="flex items-center gap-2 pointer-events-auto">
            <input
              autoFocus
              value={savingName}
              onChange={e => setSavingName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTerritory(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder='Territory name (e.g. "Weston")'
              className="flex-1 text-[11px] px-2.5 py-1.5 rounded-lg focus:outline-none"
              style={{ backgroundColor: 'rgba(10,31,68,0.95)', border: '1px solid rgba(201,168,76,0.5)', color: '#ffffff', backdropFilter: 'blur(8px)' }}
            />
            <button onClick={saveTerritory}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: '#C9A84C', color: '#0A1F44' }}>
              Save
            </button>
            <button onClick={() => setShowSaveInput(false)}
              className="text-[11px] px-2 py-1.5 rounded-lg"
              style={{ backgroundColor: 'rgba(10,31,68,0.9)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
              ✕
            </button>
          </div>
        )}

        {/* Zone label + draw hint */}
        {(zoneLabel || (drawMode !== 'idle')) && (
          <div className="pointer-events-none">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(10,31,68,0.85)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)', backdropFilter: 'blur(8px)' }}>
              {zoneLabel ?? (
                drawMode === 'polygon'
                  ? polyVerts.length === 0
                    ? 'Click to place first vertex'
                    : polyVerts.length < 3
                      ? `${polyVerts.length} vertex${polyVerts.length > 1 ? 'es' : ''} — keep clicking`
                      : 'Click near first vertex to close, or press Complete'
                  : drawMode === 'rectangle'
                    ? drawStart ? 'Click opposite corner to complete' : 'Click first corner'
                    : drawStart ? 'Click any point to set radius' : 'Click to set center'
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── Layer toggles (bottom-left) ──────────────────────────────────────── */}
      <div className="absolute bottom-14 left-3 flex flex-col gap-1 pointer-events-auto">
        {(Object.entries(LAYER_META) as [LayerKey, typeof LAYER_META[LayerKey]][]).map(([key, meta]) => (
          <button key={key} onClick={() => toggleLayer(key)}
            className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
            style={{
              backgroundColor: localLayers.has(key) ? `${meta.color}25` : 'rgba(10,31,68,0.85)',
              color: localLayers.has(key) ? meta.color : 'rgba(255,255,255,0.4)',
              border: `1px solid ${localLayers.has(key) ? meta.color + '60' : 'rgba(255,255,255,0.1)'}`,
              backdropFilter: 'blur(8px)',
            }}>
            <span>{meta.emoji}</span> {meta.label}
          </button>
        ))}
      </div>

      {/* ── Saved territories list (bottom-right) ───────────────────────────── */}
      {territories.length > 0 && (
        <div className="absolute bottom-14 right-3 flex flex-col gap-1 pointer-events-auto max-w-[180px]">
          <p className="text-[9px] font-bold uppercase tracking-widest px-1 mb-0.5"
            style={{ color: 'rgba(255,255,255,0.3)' }}>Saved Territories</p>
          {territories.map(t => (
            <div key={t.id} className="flex items-center gap-1">
              <button onClick={() => loadTerritory(t)}
                className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-left truncate transition-all"
                style={{ backgroundColor: 'rgba(10,31,68,0.9)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}>
                📍 {t.name}
              </button>
              <button onClick={() => deleteTerritory(t.id)}
                className="text-[10px] px-1.5 py-1 rounded-lg"
                style={{ backgroundColor: 'rgba(10,31,68,0.9)', color: 'rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
