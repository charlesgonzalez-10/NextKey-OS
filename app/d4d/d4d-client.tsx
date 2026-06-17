'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleMap, Polyline, Marker, useJsApiLoader } from '@react-google-maps/api'
import type { LiveProperty } from '@/lib/search/reapi-search'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutePoint { lat: number; lng: number; ts: number }

interface D4DSession {
  id: string; name: string | null; started_at: string
  ended_at: string | null; lead_count: number; route: RoutePoint[]
}

interface AddedProperty {
  id: string; address: string; condition: string | null
  lat: number | null; lng: number | null
}

// DB property (subset of columns we select)
interface DBProperty {
  id: string; property_address: string | null; city: string | null
  zip: string | null; county: string | null; owner_name: string | null
  beds: number | null; baths: number | null; living_area: number | null
  year_built: number | null; property_type: string | null
  market_value: number | null; assessed_value: number | null
  equity_percentage: number | null; equity_tier: string | null
  known_debt: number | null; homestead: boolean | null
  absentee_owner: boolean | null; free_clear: boolean | null
  is_pre_foreclosure: boolean; is_foreclosure: boolean; is_auction: boolean
  folio_number: string | null; latitude: number | null; longitude: number | null
  d4d_condition: string | null
}

interface LookupResult {
  property: DBProperty | LiveProperty | null
  pao_url: string; county: string; from_db: boolean
  tap_lat: number; tap_lng: number; tap_address: string
}

const CONDITIONS = [
  { key: 'vacant',     label: 'Vacant' },
  { key: 'overgrown',  label: 'Overgrown' },
  { key: 'boarded',    label: 'Boarded Up' },
  { key: 'fire',       label: 'Fire Damage' },
  { key: 'distressed', label: 'Distressed' },
  { key: 'other',      label: 'Other' },
]

const GOLD  = '#C9A84C'
const NAVY  = '#0A1F44'
const GREEN = '#22c55e'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string, endedAt?: string | null): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const secs = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000))
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmt$(n: number | null | undefined): string {
  if (!n) return '—'
  return '$' + n.toLocaleString()
}

function getProp(p: DBProperty | LiveProperty | null | undefined, key: string): unknown {
  if (!p) return null
  return (p as unknown as Record<string, unknown>)[key] ?? null
}

async function reverseGeocode(lat: number, lng: number): Promise<{ address: string; city: string; zip: string }> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const res  = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`)
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.length) return { address: '', city: '', zip: '' }
  const comps = data.results[0].address_components as { long_name: string; short_name: string; types: string[] }[]
  const get   = (t: string) => comps.find(c => c.types.includes(t))
  return {
    address: [get('street_number')?.short_name, get('route')?.short_name].filter(Boolean).join(' '),
    city:    get('locality')?.long_name ?? get('sublocality')?.long_name ?? '',
    zip:     get('postal_code')?.short_name ?? '',
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function D4DClient() {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY! })

  const mapRef = useRef<google.maps.Map | null>(null)

  // Location
  const [userPos, setUserPos]             = useState<{ lat: number; lng: number } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const watchIdRef = useRef<number | null>(null)

  // Session
  const [activeSession, setActiveSession] = useState<D4DSession | null>(null)
  const [pastSessions, setPastSessions]   = useState<D4DSession[]>([])
  const [sessionRoute, setSessionRoute]   = useState<RoutePoint[]>([])
  const [timer, setTimer]                 = useState('')
  const routeFlushRef    = useRef<RoutePoint[]>([])
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Lookup
  const [lookupMode, setLookupMode]       = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupResult, setLookupResult]   = useState<LookupResult | null>(null)
  const [reapiLoading, setReapiLoading]   = useState(false)

  // Add property sheet
  const [showAddSheet, setShowAddSheet]           = useState(false)
  const [detectedAddress, setDetectedAddress]     = useState('')
  const [detectedCity, setDetectedCity]           = useState('')
  const [detectedZip, setDetectedZip]             = useState('')
  const [geocoding, setGeocoding]                 = useState(false)
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null)
  const [propertyNotes, setPropertyNotes]         = useState('')
  const [saving, setSaving]                       = useState(false)
  const [saveError, setSaveError]                 = useState<string | null>(null)
  const [addLat, setAddLat]                       = useState<number | null>(null)
  const [addLng, setAddLng]                       = useState<number | null>(null)

  // Added markers
  const [addedProperties, setAddedProperties] = useState<AddedProperty[]>([])
  const [showHistory, setShowHistory]         = useState(false)

  // ── Load past sessions ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/d4d/sessions').then(r => r.json()).then(d => setPastSessions(d.sessions ?? [])).catch(() => {})
  }, [])

  // ── GPS tracking ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setLocationError('Geolocation not supported'); return }
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        setUserPos({ lat, lng })
        if (activeSession) {
          const pt: RoutePoint = { lat, lng, ts: Date.now() }
          setSessionRoute(prev => [...prev, pt])
          routeFlushRef.current = [...routeFlushRef.current, pt]
        }
      },
      err => setLocationError(err.code === 1 ? 'Location access denied — enable in browser settings' : 'Unable to get location'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    )
    return () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current) }
  }, [activeSession])

  // ── Route flush every 15s ─────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSession) { if (flushIntervalRef.current) clearInterval(flushIntervalRef.current); return }
    flushIntervalRef.current = setInterval(async () => {
      const pts = routeFlushRef.current
      if (!pts.length) return
      routeFlushRef.current = []
      await fetch(`/api/d4d/sessions/${activeSession.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_points: pts }),
      }).catch(() => {})
    }, 15000)
    return () => { if (flushIntervalRef.current) clearInterval(flushIntervalRef.current) }
  }, [activeSession])

  // ── Session timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSession) return
    const iv = setInterval(() => setTimer(formatDuration(activeSession.started_at)), 1000)
    setTimer(formatDuration(activeSession.started_at))
    return () => clearInterval(iv)
  }, [activeSession])

  // ── Start / End session ───────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const res = await fetch('/api/d4d/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Session · ${today}` }),
    })
    const data = await res.json()
    if (data.session) { setActiveSession(data.session); setSessionRoute([]); routeFlushRef.current = [] }
  }, [])

  const endSession = useCallback(async () => {
    if (!activeSession) return
    const pts = routeFlushRef.current; routeFlushRef.current = []
    await fetch(`/api/d4d/sessions/${activeSession.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_points: pts.length ? pts : undefined, end: true }),
    }).catch(() => {})
    setPastSessions(prev => [{ ...activeSession, ended_at: new Date().toISOString() }, ...prev])
    setActiveSession(null); setSessionRoute([])
  }, [activeSession])

  // ── Locate me ─────────────────────────────────────────────────────────────
  const locateMe = useCallback(() => {
    if (!userPos || !mapRef.current) return
    mapRef.current.panTo(userPos)
    mapRef.current.setZoom(17)
  }, [userPos])

  // ── Map tap → DB-first lookup ─────────────────────────────────────────────
  const handleMapClick = useCallback(async (e: google.maps.MapMouseEvent) => {
    if (!lookupMode) return
    const lat = e.latLng?.lat(), lng = e.latLng?.lng()
    if (!lat || !lng) return

    setLookupLoading(true); setLookupResult(null)
    const { address, city, zip } = await reverseGeocode(lat, lng)
    const fullAddress = [address, city, 'FL', zip].filter(Boolean).join(', ')

    try {
      const res  = await fetch('/api/d4d/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: fullAddress, lat, lng }),
      })
      const data = await res.json()
      setLookupResult({
        property:    data.property ?? null,
        pao_url:     data.pao_url  ?? '',
        county:      data.county   ?? 'broward',
        from_db:     data.from_db  ?? false,
        tap_lat:     lat, tap_lng: lng,
        tap_address: address || (data.property as DBProperty)?.property_address || '',
      })
    } catch {
      setLookupResult({
        property: null, pao_url: '', county: 'broward', from_db: false,
        tap_lat: lat, tap_lng: lng, tap_address: address,
      })
    } finally {
      setLookupLoading(false)
    }
  }, [lookupMode])

  // ── Pull REAPI on demand ──────────────────────────────────────────────────
  const pullReapi = useCallback(async () => {
    if (!lookupResult) return
    setReapiLoading(true)
    const res  = await fetch('/api/d4d/reapi-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: lookupResult.tap_address,
        lat: lookupResult.tap_lat, lng: lookupResult.tap_lng,
      }),
    })
    const data = await res.json()
    setReapiLoading(false)
    if (data.property) {
      setLookupResult(prev => prev ? {
        ...prev, property: data.property, pao_url: data.pao_url || prev.pao_url, from_db: false,
      } : prev)
    }
  }, [lookupResult])

  // ── Open add-property sheet ───────────────────────────────────────────────
  const openAddSheet = useCallback(async (
    prefillAddress?: string, prefillCity?: string, prefillZip?: string,
    lat?: number, lng?: number,
  ) => {
    setShowAddSheet(true); setSelectedCondition(null); setPropertyNotes(''); setSaveError(null)
    setAddLat(lat ?? userPos?.lat ?? null); setAddLng(lng ?? userPos?.lng ?? null)
    if (prefillAddress) {
      setDetectedAddress(prefillAddress); setDetectedCity(prefillCity ?? ''); setDetectedZip(prefillZip ?? ''); setGeocoding(false)
    } else if (userPos) {
      setDetectedAddress(''); setDetectedCity(''); setDetectedZip(''); setGeocoding(true)
      const { address, city, zip } = await reverseGeocode(userPos.lat, userPos.lng)
      setDetectedAddress(address); setDetectedCity(city); setDetectedZip(zip)
      setAddLat(userPos.lat); setAddLng(userPos.lng); setGeocoding(false)
    }
  }, [userPos])

  // ── Save property ─────────────────────────────────────────────────────────
  const saveProperty = useCallback(async () => {
    if (!detectedAddress.trim()) { setSaveError('Address is required'); return }
    setSaving(true); setSaveError(null)
    try {
      const res  = await fetch('/api/d4d/add-property', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: detectedAddress.trim(), city: detectedCity, zip: detectedZip,
          lat: addLat, lng: addLng, condition: selectedCondition,
          notes: propertyNotes.trim() || null, session_id: activeSession?.id ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error ?? 'Failed to save'); return }
      if (addLat && addLng) {
        setAddedProperties(prev => [...prev, {
          id: data.property_id, address: detectedAddress,
          condition: selectedCondition, lat: addLat, lng: addLng,
        }])
      }
      if (activeSession) setActiveSession(prev => prev ? { ...prev, lead_count: (prev.lead_count ?? 0) + 1 } : prev)
      setShowAddSheet(false); setLookupResult(null)
    } catch { setSaveError('Network error — try again') }
    finally { setSaving(false) }
  }, [detectedAddress, detectedCity, detectedZip, addLat, addLng, selectedCondition, propertyNotes, activeSession])

  const mapCenter = userPos ?? { lat: 26.0, lng: -80.2 }

  const prop = lookupResult?.property ?? null
  const propAddr  = (getProp(prop, 'property_address') ?? lookupResult?.tap_address ?? '') as string
  const propCity  = (getProp(prop, 'city')   ?? '') as string
  const propZip   = (getProp(prop, 'zip')    ?? '') as string
  const propOwner = getProp(prop, 'owner_name') as string | null
  const propMkt   = getProp(prop, 'market_value') as number | null
  const propAss   = getProp(prop, 'assessed_value') as number | null
  const propBeds  = getProp(prop, 'beds') as number | null
  const propBaths = getProp(prop, 'baths') as number | null
  const propSqft  = getProp(prop, 'living_area') as number | null
  const propYear  = getProp(prop, 'year_built') as number | null
  const propEqPct = getProp(prop, 'equity_percentage') as number | null
  const propHome  = getProp(prop, 'homestead') as boolean | null
  const propAbs   = getProp(prop, 'absentee_owner') as boolean | null
  const propFC    = getProp(prop, 'free_clear') as boolean | null
  const propPreFC = getProp(prop, 'is_pre_foreclosure') as boolean
  const propForec = getProp(prop, 'is_foreclosure') as boolean
  const propAuct  = getProp(prop, 'is_auction') as boolean

  return (
    <div className="relative flex flex-col" style={{ height: '100%', backgroundColor: '#0f172a' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ backgroundColor: NAVY, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div>
          <h1 className="text-white font-bold text-base">Driving for Dollars</h1>
          {locationError
            ? <p className="text-red-400 text-xs mt-0.5">{locationError}</p>
            : activeSession
              ? <p className="text-xs mt-0.5" style={{ color: GREEN }}>Session active · {timer} · {activeSession.lead_count} {activeSession.lead_count === 1 ? 'property' : 'properties'}</p>
              : userPos
                ? <p className="text-white/40 text-xs mt-0.5">Location active</p>
                : <p className="text-white/40 text-xs mt-0.5">Getting location…</p>}
        </div>
        <button onClick={() => setShowHistory(v => !v)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>
          History
        </button>
      </div>

      {/* ── Lookup mode banner ──────────────────────────────────────────────── */}
      {lookupMode && (
        <div className="flex items-center justify-between px-4 py-2 shrink-0"
          style={{ backgroundColor: 'rgba(201,168,76,0.12)', borderBottom: '1px solid rgba(201,168,76,0.2)' }}>
          <p className="text-xs font-semibold" style={{ color: GOLD }}>
            {lookupLoading ? 'Looking up property…' : 'Tap any property on the map'}
          </p>
          <button onClick={() => { setLookupMode(false); setLookupResult(null) }}
            className="text-xs px-2 py-1 rounded-lg" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={mapCenter}
            zoom={16}
            onLoad={map => { mapRef.current = map }}
            onClick={handleMapClick}
            options={{
              disableDefaultUI: true,
              zoomControl: false,
              styles: [
                { featureType: 'water',     elementType: 'geometry',         stylers: [{ color: '#1a3a5c' }] },
                { featureType: 'landscape', elementType: 'geometry',         stylers: [{ color: '#1e293b' }] },
                { featureType: 'road',      elementType: 'geometry',         stylers: [{ color: '#334155' }] },
                { featureType: 'road',      elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
                { featureType: 'poi',       elementType: 'geometry',         stylers: [{ color: '#1e293b' }] },
                { featureType: 'transit',   elementType: 'geometry',         stylers: [{ color: '#1e293b' }] },
              ],
            }}
          >
            {pastSessions.map(s => s.route?.length > 1 ? (
              <Polyline key={s.id} path={s.route}
                options={{ strokeColor: '#64748b', strokeOpacity: 0.4, strokeWeight: 3 }} />
            ) : null)}

            {sessionRoute.length > 1 && (
              <Polyline path={sessionRoute}
                options={{ strokeColor: GOLD, strokeOpacity: 0.9, strokeWeight: 4 }} />
            )}

            {userPos && (
              <Marker position={userPos} icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 9, fillColor: '#3b82f6', fillOpacity: 1,
                strokeColor: '#ffffff', strokeWeight: 2,
              }} />
            )}

            {addedProperties.map(p => p.lat && p.lng ? (
              <Marker key={p.id} position={{ lat: p.lat, lng: p.lng }} title={p.address}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 7, fillColor: GOLD, fillOpacity: 1,
                  strokeColor: '#ffffff', strokeWeight: 2,
                }} />
            ) : null)}

            {lookupResult && (
              <Marker position={{ lat: lookupResult.tap_lat, lng: lookupResult.tap_lng }}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8, fillColor: '#a78bfa', fillOpacity: 1,
                  strokeColor: '#ffffff', strokeWeight: 2,
                }} />
            )}
          </GoogleMap>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-white/40 text-sm">Loading map…</p>
          </div>
        )}

        {/* ── Locate Me button (map overlay) ─────────────────────────────── */}
        {isLoaded && (
          <button
            onClick={locateMe}
            disabled={!userPos}
            className="absolute bottom-4 right-4 w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-opacity disabled:opacity-40"
            style={{ backgroundColor: NAVY, border: '1px solid rgba(255,255,255,0.2)' }}
            title="Center on my location"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ color: userPos ? GOLD : 'rgba(255,255,255,0.4)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Bottom controls ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-4 flex gap-3"
        style={{ backgroundColor: NAVY, borderTop: '1px solid rgba(255,255,255,0.1)' }}>

        <button
          onClick={() => { setLookupMode(v => !v); setLookupResult(null) }}
          className="flex items-center justify-center gap-1.5 px-3 py-3.5 rounded-xl text-xs font-bold transition-all"
          style={{
            backgroundColor: lookupMode ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.07)',
            color:           lookupMode ? '#a78bfa'                : 'rgba(255,255,255,0.5)',
            border:          lookupMode ? '1px solid rgba(167,139,250,0.4)' : '1px solid transparent',
          }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Lookup
        </button>

        {!activeSession ? (
          <button onClick={startSession}
            className="flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: GREEN, border: '1px solid rgba(34,197,94,0.3)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Start Session
          </button>
        ) : (
          <button onClick={endSession}
            className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold"
            style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
            </svg>
            End
          </button>
        )}

        <button onClick={() => openAddSheet()}
          className="flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          style={{ backgroundColor: GOLD, color: NAVY }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Property
        </button>
      </div>

      {/* ── Lookup Result Card ───────────────────────────────────────────────── */}
      {lookupResult && !lookupLoading && (
        <>
          <div className="fixed inset-0 bg-black/40" style={{ zIndex: 100 }} onClick={() => setLookupResult(null)} />
          <div className="fixed bottom-0 left-0 right-0 rounded-t-3xl px-5 pt-5 pb-6"
            style={{ zIndex: 101, backgroundColor: '#1e293b', maxHeight: '75vh', overflowY: 'auto' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />

            {/* Address + owner */}
            <div className="mb-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-white font-bold text-base leading-snug flex-1">
                  {propAddr || lookupResult.tap_address || 'Unknown address'}
                </h2>
                {lookupResult.from_db && (
                  <span className="text-xs px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                    style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: GREEN }}>In DB</span>
                )}
              </div>
              {(propCity || propZip) && (
                <p className="text-white/40 text-sm mt-0.5">{[propCity, 'FL', propZip].filter(Boolean).join(', ')}</p>
              )}
              {propOwner && (
                <p className="text-sm mt-2 font-semibold" style={{ color: GOLD }}>
                  {propOwner}
                  {propHome  && <span className="ml-2 text-xs font-normal text-white/40">Owner-Occupied</span>}
                  {propAbs   && <span className="ml-2 text-xs font-normal text-white/40">Absentee</span>}
                </p>
              )}
            </div>

            {prop ? (
              <>
                {/* Data grid */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { label: 'Est. Value',  value: fmt$(propMkt) },
                    { label: 'Assessed',    value: fmt$(propAss) },
                    { label: 'Beds / Baths', value: propBeds != null ? `${propBeds}bd / ${propBaths ?? '?'}ba` : '—' },
                    { label: 'Sqft',        value: propSqft ? propSqft.toLocaleString() : '—' },
                    { label: 'Year Built',  value: propYear ? String(propYear) : '—' },
                    { label: 'Equity',      value: propEqPct != null ? `${Math.round(propEqPct)}%` : '—' },
                  ].map(row => (
                    <div key={row.label} className="rounded-xl px-3 py-2.5"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                      <p className="text-white/40 text-xs mb-0.5">{row.label}</p>
                      <p className="text-white text-sm font-semibold">{row.value}</p>
                    </div>
                  ))}
                </div>

                {/* Distress / flags */}
                {(propPreFC || propForec || propAuct || propFC) && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {propPreFC && <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(224,123,106,0.2)', color: '#E07B6A' }}>Pre-Foreclosure</span>}
                    {propForec && <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>Foreclosure</span>}
                    {propAuct  && <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(251,191,36,0.2)', color: '#fbbf24' }}>Auction</span>}
                    {propFC    && <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(34,197,94,0.2)', color: GREEN }}>Free &amp; Clear</span>}
                  </div>
                )}
              </>
            ) : (
              <p className="text-white/40 text-sm mb-4">Not in your database yet.</p>
            )}

            {/* Pull REAPI button (only if not already REAPI data) */}
            {(!prop || lookupResult.from_db) && (
              <button onClick={pullReapi} disabled={reapiLoading}
                className="w-full mb-3 py-2.5 rounded-xl text-xs font-bold transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {reapiLoading
                  ? 'Pulling REAPI data…'
                  : <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Pull full data from REAPI
                    </>}
              </button>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <a href={lookupResult.pao_url} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-3 rounded-xl text-sm font-bold text-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)' }}>
                Open in PAO ↗
              </a>
              <button
                onClick={() => openAddSheet(
                  propAddr || lookupResult.tap_address,
                  propCity, propZip,
                  lookupResult.tap_lat, lookupResult.tap_lng,
                )}
                className="flex-1 py-3 rounded-xl text-sm font-bold"
                style={{ backgroundColor: GOLD, color: NAVY }}>
                Add to Pipeline
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Add Property Sheet ───────────────────────────────────────────────── */}
      {showAddSheet && (
        <>
          <div className="fixed inset-0 bg-black/60" style={{ zIndex: 110 }} onClick={() => setShowAddSheet(false)} />
          <div className="fixed bottom-0 left-0 right-0 rounded-t-3xl px-5 pt-5 pb-8"
            style={{ zIndex: 111, backgroundColor: '#1e293b', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <h2 className="text-white font-bold text-lg mb-4">Add to Pipeline</h2>

            <div className="mb-4">
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.5)' }}>ADDRESS</label>
              {geocoding ? (
                <p className="text-white/40 text-sm py-3">Detecting address…</p>
              ) : (
                <input value={detectedAddress} onChange={e => setDetectedAddress(e.target.value)}
                  placeholder="Street address"
                  className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none"
                  style={{ backgroundColor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }} />
              )}
              {(detectedCity || detectedZip) && (
                <p className="text-white/40 text-xs mt-1.5">{[detectedCity, detectedZip].filter(Boolean).join(', ')}</p>
              )}
            </div>

            <div className="mb-4">
              <label className="text-xs font-semibold mb-2 block" style={{ color: 'rgba(255,255,255,0.5)' }}>
                CONDITION <span className="font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map(c => (
                  <button key={c.key}
                    onClick={() => setSelectedCondition(prev => prev === c.key ? null : c.key)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      backgroundColor: selectedCondition === c.key ? GOLD : 'rgba(255,255,255,0.08)',
                      color:           selectedCondition === c.key ? NAVY : 'rgba(255,255,255,0.6)',
                    }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.5)' }}>
                NOTES <span className="font-normal">(optional)</span>
              </label>
              <textarea value={propertyNotes} onChange={e => setPropertyNotes(e.target.value)}
                rows={2} placeholder="Quick note…"
                className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none resize-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }} />
            </div>

            {saveError && <p className="text-red-400 text-sm mb-3">{saveError}</p>}
            <button onClick={saveProperty} disabled={saving || geocoding}
              className="w-full py-4 rounded-xl font-bold text-sm disabled:opacity-50"
              style={{ backgroundColor: GOLD, color: NAVY }}>
              {saving ? 'Saving…' : 'Save to Pipeline'}
            </button>
          </div>
        </>
      )}

      {/* ── History Panel ────────────────────────────────────────────────────── */}
      {showHistory && (
        <>
          <div className="fixed inset-0 bg-black/60" style={{ zIndex: 100 }} onClick={() => setShowHistory(false)} />
          <div className="fixed bottom-0 left-0 right-0 rounded-t-3xl px-5 pt-5 pb-8"
            style={{ zIndex: 101, backgroundColor: '#1e293b', maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <h2 className="text-white font-bold text-lg mb-4">Session History</h2>
            {pastSessions.length === 0 ? (
              <p className="text-white/40 text-sm">No past sessions yet.</p>
            ) : (
              <div className="space-y-3">
                {pastSessions.map(s => (
                  <div key={s.id} className="rounded-xl px-4 py-3" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-white text-sm font-semibold">{s.name ?? 'Unnamed session'}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: GOLD }}>
                        {s.lead_count} {s.lead_count === 1 ? 'property' : 'properties'}
                      </span>
                    </div>
                    <p className="text-white/40 text-xs mt-1">
                      {new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {s.ended_at && ` · ${formatDuration(s.started_at, s.ended_at)} driven`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
