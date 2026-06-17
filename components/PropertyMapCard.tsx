'use client'

/**
 * PropertyMapCard
 *
 * Compact map preview card + expandable modal for property detail pages.
 * Handles Google Maps API failures gracefully — no raw errors shown to the user.
 *
 * APIs used (all need to be enabled in Google Cloud Console):
 *   - Maps Static API       → compact card image
 *   - Street View Static API → street view image
 *   - Maps Embed API         → interactive map in modal
 *
 * Always-working fallback: "Open in Google Maps" link (no API key required).
 *
 * PA Map links:
 *   - Broward:    bcpa.net
 *   - Miami-Dade: miamidade.gov
 *   - Palm Beach: pbcpao.gov
 */

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropertyMapCardProps {
  address:     string
  city?:       string | null
  zip?:        string | null
  county?:     string | null
  folio?:      string | null
  latitude?:   number | null
  longitude?:  number | null
  /** If true shows a pill on the card — used in lead detail header */
  compact?: boolean
}

type MapTab = 'map' | 'street'

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTY_LABELS: Record<string, string> = {
  'broward':    'Broward',
  'miami-dade': 'Miami-Dade',
  'palm-beach': 'Palm Beach',
}

// Returns Property Appraiser page URL (for Folio clicks)
export function getPAUrl(county: string | null | undefined, folio: string | null | undefined, address: string): string | null {
  if (!county) return null
  const c = county.toLowerCase()
  if (c === 'broward' && folio)
    return `https://www.bcpa.net/RecInfo.asp?URL_Folio=${encodeURIComponent(folio)}`
  if (c === 'miami-dade' && folio)
    return `https://www.miamidade.gov/Apps/PA/propertysearch/#/?folio=${encodeURIComponent(folio)}`
  if (c === 'palm-beach' && folio)
    return `https://www.pbcpao.gov/property-details/${encodeURIComponent(folio)}`
  if (c === 'broward')
    return `https://www.bcpa.net/RecInfo.asp?URL_Parcel_Count=&URL_Address=${encodeURIComponent(address)}`
  if (c === 'miami-dade')
    return `https://www.miamidade.gov/Apps/PA/propertysearch/#/?addr=${encodeURIComponent(address)}`
  if (c === 'palm-beach')
    return `https://www.pbcpao.gov/search?q=${encodeURIComponent(address)}`
  return null
}

// Returns Pictometry aerial imagery URL (opens directly to aerial view)
function getPictometryUrl(county: string | null | undefined, folio: string | null | undefined, address: string): string | null {
  if (!county) return null
  const c = county.toLowerCase()
  if (c === 'miami-dade' && folio)
    return `https://gisweb.miamidade.gov/addressSearch/index.html?folioNum=${encodeURIComponent(folio)}`
  if (c === 'miami-dade')
    return `https://gisweb.miamidade.gov/addressSearch/index.html?addr=${encodeURIComponent(address)}`
  if (c === 'broward' && folio)
    return `https://bcpa.net/RecInfo.asp?URL_Folio=${encodeURIComponent(folio)}&showAerial=true`
  if (c === 'broward')
    return `https://bcpa.net/RecInfo.asp?URL_Parcel_Count=&URL_Address=${encodeURIComponent(address)}`
  if (c === 'palm-beach' && folio)
    return `https://pbcpao.gov/property-details/${encodeURIComponent(folio)}`
  if (c === 'palm-beach')
    return `https://pbcpao.gov/search?q=${encodeURIComponent(address)}`
  return null
}

// ─── Map URL builders ─────────────────────────────────────────────────────────

function staticMapUrl(encoded: string, apiKey: string, size = '600x320', zoom = 17): string {
  const loc = encoded
  // Light roadmap theme — shows streets, businesses, neighborhood labels clearly
  return `https://maps.googleapis.com/maps/api/staticmap?center=${loc}&zoom=${zoom}&size=${size}&maptype=roadmap&markers=color:0xE07B6A|${loc}&key=${apiKey}`
}

function streetViewEmbedUrl(encoded: string, apiKey: string): string {
  // Maps Embed API — streetview mode: fully interactive panorama (click-drag, zoom, walk)
  return `https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${encoded}&fov=80&pitch=0&heading=0`
}

function embedMapUrl(encoded: string, apiKey: string): string {
  return `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encoded}&zoom=17`
}

function googleMapsLink(encoded: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`
}

// ─── Compact Card ─────────────────────────────────────────────────────────────

export default function PropertyMapCard({
  address, city, zip, county, folio, latitude, longitude, compact = false,
}: PropertyMapCardProps) {
  const apiKey  = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  const [open,  setOpen]  = useState(false)
  const [imgOk, setImgOk] = useState<boolean | null>(null) // null = loading

  const fullAddress = [address, city, zip ? `FL ${zip}` : 'FL'].filter(Boolean).join(', ')
  const encoded     = encodeURIComponent(fullAddress)
  const mapsLink      = googleMapsLink(encoded)
  const pictometryUrl = getPictometryUrl(county, folio, address)
  const countyLabel   = COUNTY_LABELS[county?.toLowerCase() ?? ''] ?? county

  // Derive map URL — prefer lat/lng for precision
  const mapCenter   = latitude && longitude
    ? `${latitude},${longitude}`
    : encoded
  const staticUrl   = apiKey ? staticMapUrl(mapCenter, apiKey) : null

  // Preflight check: does the static map API respond?
  useEffect(() => {
    if (!staticUrl) { setImgOk(false); return }
    // Reset whenever address changes
    setImgOk(null)
  }, [staticUrl])

  return (
    <>
      {/* ── Compact Card ── */}
      <div
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{
          border: '1px solid var(--c-border)',
          backgroundColor: 'var(--c-card)',
          minWidth: compact ? 220 : undefined,
        }}
      >
        {/* Map thumbnail */}
        <div
          className="relative cursor-pointer group"
          style={{ height: 160, backgroundColor: '#0d2347' }}
          onClick={() => setOpen(true)}
        >
          {staticUrl && imgOk !== false ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={staticUrl}
              alt={`Map of ${address}`}
              className="w-full h-full object-cover transition-opacity group-hover:opacity-90"
              onLoad={() => setImgOk(true)}
              onError={() => setImgOk(false)}
            />
          ) : (
            /* Fallback when API blocked or no key */
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-4">
              {/* Grid lines — decorative map feel */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: 'linear-gradient(var(--c-border) 1px, transparent 1px), linear-gradient(90deg, var(--c-border) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }} />
              <div className="relative z-10 flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(201,168,76,0.2)', border: '2px solid rgba(201,168,76,0.5)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#C9A84C" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {address}
                </p>
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {city}{zip ? `, FL ${zip}` : ''}
                </p>
              </div>
            </div>
          )}

          {/* Expand overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.35)' }}>
            <span className="text-xs font-bold px-3 py-1.5 rounded-xl"
              style={{ backgroundColor: 'rgba(201,168,76,0.9)', color: '#0A1F44' }}>
              View Map
            </span>
          </div>

          {/* County badge */}
          {countyLabel && (
            <div className="absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.8)' }}>
              {countyLabel}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-3 py-2.5 flex items-center gap-2 flex-wrap"
          style={{ borderTop: '1px solid var(--c-border)' }}>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Map
          </button>

          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.2)' }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Google Maps
          </a>

          {pictometryUrl && (
            <a
              href={pictometryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
              style={{ backgroundColor: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.2)' }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Pictometry
            </a>
          )}
        </div>
      </div>

      {/* ── Expanded Modal ── */}
      {open && (
        <MapModal
          address={address}
          fullAddress={fullAddress}
          encoded={encoded}
          apiKey={apiKey}
          mapsLink={mapsLink}
          pictometryUrl={pictometryUrl}
          countyLabel={countyLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// ─── Expanded Modal ───────────────────────────────────────────────────────────

function MapModal({
  address, fullAddress, encoded, apiKey,
  mapsLink, pictometryUrl, countyLabel, onClose,
}: {
  address:        string
  fullAddress:    string
  encoded:        string
  apiKey:         string
  mapsLink:       string
  pictometryUrl:  string | null
  countyLabel:    string | null
  onClose:        () => void
}) {
  const [tab, setTab]           = useState<MapTab>('map')
  const [svOk, setSvOk]         = useState<boolean | null>(null)   // null=loading
  const [embedOk, setEmbedOk]   = useState<boolean | null>(null)

  // Check street view availability via metadata (FREE API call)
  useEffect(() => {
    if (!apiKey) { setSvOk(false); return }
    fetch(`/api/maps/streetview-check?location=${encoded}`)
      .then(r => r.json())
      .then(d => setSvOk(d.available === true))
      .catch(() => setSvOk(false))
  }, [encoded, apiKey])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden w-full"
        style={{
          maxWidth: 860,
          maxHeight: '90vh',
          backgroundColor: 'var(--c-bg)',
          border: '1px solid var(--c-border)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between gap-3 shrink-0"
          style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>{address}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{fullAddress}{countyLabel ? ` · ${countyLabel} County` : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none hover:opacity-60 transition-opacity shrink-0"
            style={{ color: 'var(--c-text-3)' }}
          >✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0"
          style={{ backgroundColor: 'var(--c-card)', borderBottom: '1px solid var(--c-border)' }}>
          {([
            ['map',    '🗺️', 'Map'],
            ['street', '🏠', 'Street View'],
          ] as [MapTab, string, string][]).map(([k, icon, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition-colors"
              style={{
                color:        tab === k ? '#C9A84C' : 'rgba(255,255,255,0.45)',
                borderBottom: `2px solid ${tab === k ? '#C9A84C' : 'transparent'}`,
                backgroundColor: tab === k ? 'rgba(201,168,76,0.06)' : 'transparent',
              }}
            >
              <span>{icon}</span>
              <span>{label}</span>
              {k === 'street' && svOk === false && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-1"
                  style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                  N/A
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 relative" style={{ minHeight: 420 }}>

          {/* ── MAP TAB ── */}
          {tab === 'map' && (
            <>
              {apiKey ? (
                <>
                  {embedOk !== false ? (
                    <iframe
                      title="Property map"
                      src={embedMapUrl(encoded, apiKey)}
                      className="w-full h-full"
                      style={{ border: 'none', minHeight: 420 }}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      onError={() => setEmbedOk(false)}
                      onLoad={e => {
                        // Can't detect iframe 403 easily — trust it
                        setEmbedOk(true)
                      }}
                    />
                  ) : (
                    <MapFallback address={fullAddress} mapsLink={mapsLink} pictometryUrl={pictometryUrl} />
                  )}
                </>
              ) : (
                <MapFallback address={fullAddress} mapsLink={mapsLink} pictometryUrl={pictometryUrl} />
              )}
            </>
          )}

          {/* ── STREET VIEW TAB ── */}
          {tab === 'street' && (
            <StreetViewPanel
              encoded={encoded}
              apiKey={apiKey}
              available={svOk}
              mapsLink={mapsLink}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap shrink-0"
          style={{ backgroundColor: 'var(--c-card)', borderTop: '1px solid var(--c-border)' }}>
          <a href={mapsLink} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.2)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open in Google Maps
          </a>
          {pictometryUrl && (
            <a href={pictometryUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ backgroundColor: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.2)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Open Pictometry
            </a>
          )}
          <button onClick={onClose}
            className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Street View Panel ────────────────────────────────────────────────────────

function StreetViewPanel({
  encoded, apiKey, available, mapsLink,
}: {
  encoded: string
  apiKey:  string
  available: boolean | null
  mapsLink: string
}) {
  if (available === null) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: 420 }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Checking street view…</p>
        </div>
      </div>
    )
  }

  if (available === false) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-8 text-center" style={{ minHeight: 420 }}>
        <p className="text-4xl">🏠</p>
        <p className="font-semibold" style={{ color: 'var(--c-primary)' }}>Street View not available</p>
        <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
          No street-level imagery is available for this property location.
        </p>
        <a href={`${mapsLink}&layer=s`} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-80"
          style={{ backgroundColor: 'rgba(107,189,224,0.12)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)' }}>
          Try in Google Maps →
        </a>
      </div>
    )
  }

  // Available — interactive panorama via Maps Embed API (click-drag to look around, zoom, walk)
  return (
    <div className="relative w-full" style={{ minHeight: 420 }}>
      <iframe
        title="Street view"
        src={streetViewEmbedUrl(encoded, apiKey)}
        className="w-full"
        style={{ border: 'none', minHeight: 420, height: 480 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      {/* Hint overlay — fades out after a moment so user knows it's interactive */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-full"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)' }}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
          Drag to look around · Scroll to zoom
        </div>
      </div>
    </div>
  )
}

// ─── Map Fallback ─────────────────────────────────────────────────────────────

function MapFallback({ address, mapsLink, pictometryUrl }: { address: string; mapsLink: string; pictometryUrl: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 px-8 text-center" style={{ minHeight: 420 }}>
      {/* Decorative grid */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(var(--c-border) 1px, transparent 1px), linear-gradient(90deg, var(--c-border) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'rgba(201,168,76,0.12)', border: '2px solid rgba(201,168,76,0.3)' }}>
          <svg className="w-7 h-7" fill="none" stroke="#C9A84C" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <div>
          <p className="font-semibold mb-1" style={{ color: 'var(--c-primary)' }}>{address}</p>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            Interactive map requires Maps API to be enabled in Google Cloud Console.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap justify-center">
          <a href={mapsLink} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-80"
            style={{ backgroundColor: 'rgba(107,189,224,0.12)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open in Google Maps
          </a>
          {pictometryUrl && (
            <a href={pictometryUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.2)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Open Pictometry
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
