'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PriceHistoryItem { date: string; price: number; event: string }
interface OpenHouseItem    { date: string; start: string; end: string }
interface MlsFeatures      { [key: string]: string | string[] | boolean | number }

interface ListingData {
  has_listing: boolean
  mls_status: string | null
  mls_number: string | null
  mls_listing_price: number | null
  mls_original_price: number | null
  mls_active: boolean
  mls_dom: number | null
  mls_cdom: number | null
  mls_price_reductions: number | null
  mls_agent_name: string | null
  mls_agent_phone: string | null
  mls_agent_email: string | null
  mls_broker_name: string | null
  mls_photos: string[]
  mls_remarks_public: string | null
  mls_remarks_private: string | null
  mls_showing_instructions: string | null
  mls_hoa_amount: number | null
  mls_price_history: PriceHistoryItem[]
  mls_open_houses: OpenHouseItem[]
  mls_features: MlsFeatures | null
  tax_amount: number | null
  tax_year: number | null
  realtor_url: string
  data_source: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '—'
  return `$${n.toLocaleString()}`
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function priceDeltaPct(current: number | null, original: number | null): string | null {
  if (!current || !original || original === current) return null
  const delta = ((current - original) / original) * 100
  return delta > 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '12px 14px', ...style }}>
      {children}
    </div>
  )
}

function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a' }}>
        {children}
      </div>
      {action}
    </div>
  )
}

function KV({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '3px 0', gap: 8 }}>
      <span style={{ color: '#4a6a9a', fontSize: 11, flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: vColor ?? '#e2e8f0', textAlign: 'right' as const, wordBreak: 'break-word' }}>{v}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ borderTop: '1px solid #1a3050', margin: '8px 0' }} />
}

// ─── Photo Gallery ─────────────────────────────────────────────────────────────

function PhotoGallery({ photos }: { photos: string[] }) {
  const [selected, setSelected] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  if (!photos.length) return (
    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a1729', borderRadius: 7, border: '1px solid #1a3050' }}>
      <span style={{ color: '#4a6a9a', fontSize: 12 }}>No photos available</span>
    </div>
  )

  const handleKey = (e: React.KeyboardEvent) => {
    if (!fullscreen) return
    if (e.key === 'ArrowRight') setSelected(i => (i + 1) % photos.length)
    if (e.key === 'ArrowLeft')  setSelected(i => (i - 1 + photos.length) % photos.length)
    if (e.key === 'Escape')     setFullscreen(false)
  }

  return (
    <>
      {/* Primary photo */}
      <div
        onClick={() => setFullscreen(true)}
        style={{ position: 'relative', height: 220, borderRadius: 7, overflow: 'hidden', cursor: 'zoom-in', marginBottom: 6, border: '1px solid #1a3050' }}
      >
        <img
          src={photos[selected]}
          alt={`Property photo ${selected + 1}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div style={{ position: 'absolute', bottom: 6, right: 8, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>
          {selected + 1} / {photos.length}
        </div>
        <div style={{ position: 'absolute', bottom: 6, left: 8, background: 'rgba(0,0,0,0.5)', color: '#e2e8f0', fontSize: 9, padding: '2px 8px', borderRadius: 20 }}>
          Click to expand
        </div>
      </div>

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
          {photos.slice(0, 20).map((url, i) => (
            <div
              key={i}
              onClick={() => setSelected(i)}
              style={{ flexShrink: 0, width: 56, height: 40, borderRadius: 4, overflow: 'hidden', cursor: 'pointer', border: i === selected ? '2px solid #C9A84C' : '2px solid transparent', opacity: i === selected ? 1 : 0.6, transition: 'opacity .15s' }}
            >
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
              />
            </div>
          ))}
          {photos.length > 20 && (
            <div style={{ flexShrink: 0, width: 56, height: 40, borderRadius: 4, background: '#1a3050', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#4a6a9a', fontSize: 10 }}>+{photos.length - 20}</span>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen modal */}
      {fullscreen && (
        <div
          onKeyDown={handleKey}
          tabIndex={0}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          autoFocus
        >
          <button onClick={() => setFullscreen(false)}
            style={{ position: 'absolute', top: 16, right: 20, color: '#e2e8f0', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 36, height: 36, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>

          <button onClick={() => setSelected(i => (i - 1 + photos.length) % photos.length)}
            style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: '#e2e8f0', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer' }}>
            ‹
          </button>

          <img
            src={photos[selected]}
            alt={`Photo ${selected + 1}`}
            style={{ maxWidth: '85vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 6 }}
          />

          <button onClick={() => setSelected(i => (i + 1) % photos.length)}
            style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', color: '#e2e8f0', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer' }}>
            ›
          </button>

          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: '#e2e8f0', fontSize: 12, background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: 20 }}>
            {selected + 1} / {photos.length}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Main ListingTab ───────────────────────────────────────────────────────────

export default function ListingTab() {
  const { lead } = useWorkspace()

  const [listing,   setListing]   = useState<ListingData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [fetching,  setFetching]  = useState(false)
  const [fetchMsg,  setFetchMsg]  = useState('')

  const loadListing = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${lead.id}/listing`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setListing(data.listing)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load listing')
    }
    setLoading(false)
  }, [lead.id])

  useEffect(() => { loadListing() }, [loadListing])

  const fetchFresh = useCallback(async () => {
    setFetching(true)
    setFetchMsg('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fetch_fresh: true }),
      })
      if (res.ok) {
        setFetchMsg('✓ Updated from REAPI')
        await loadListing()
      } else {
        setFetchMsg('Update failed')
      }
    } catch {
      setFetchMsg('Request failed')
    }
    setFetching(false)
    setTimeout(() => setFetchMsg(''), 5000)
  }, [lead.id, loadListing])

  // ── Loading / error states ──

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#4a6a9a', fontSize: 13 }}>
      Loading listing data…
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
      <div style={{ color: '#E07B6A', fontSize: 13 }}>Failed to load listing: {error}</div>
      <button onClick={loadListing} style={{ color: '#4CAF9A', background: 'rgba(76,175,154,0.1)', border: '1px solid rgba(76,175,154,0.3)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>
        Retry
      </button>
    </div>
  )

  if (!listing || !listing.has_listing) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 14 }}>
      <div style={{ fontSize: 24 }}>🏷️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>No MLS Listing Found</div>
      <div style={{ fontSize: 12, color: '#4a6a9a', maxWidth: 320, textAlign: 'center' }}>
        This property doesn't have an active or recent MLS listing on record. Fetch fresh data from REAPI to check for current listing status.
      </div>
      <button onClick={fetchFresh} disabled={fetching}
        style={{ padding: '7px 16px', borderRadius: 6, background: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)', cursor: fetching ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: fetching ? 0.6 : 1 }}>
        {fetching ? 'Fetching…' : '↻ Fetch Fresh Data'}
      </button>
      {fetchMsg && <div style={{ fontSize: 11, color: fetchMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>{fetchMsg}</div>}
    </div>
  )

  const { mls_price_history, mls_open_houses, mls_features, mls_photos } = listing
  const priceDelta = priceDeltaPct(listing.mls_listing_price, listing.mls_original_price)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Status header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
            background: listing.mls_active ? 'rgba(76,175,154,0.12)' : 'rgba(74,106,154,0.12)',
            color: listing.mls_active ? '#4CAF9A' : '#94a3b8',
            border: `1px solid ${listing.mls_active ? 'rgba(76,175,154,0.35)' : '#1a3050'}` }}>
            {listing.mls_status ?? 'Unknown Status'}
          </span>
          {listing.mls_number && (
            <span style={{ fontSize: 11, color: '#4a6a9a', fontFamily: 'monospace' }}>
              MLS# {listing.mls_number}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {fetchMsg && <span style={{ fontSize: 11, color: fetchMsg.startsWith('✓') ? '#4CAF9A' : '#E07B6A' }}>{fetchMsg}</span>}
          <button onClick={fetchFresh} disabled={fetching}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(107,189,224,0.1)', color: '#6ABDE0', border: '1px solid rgba(107,189,224,0.25)', cursor: fetching ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: fetching ? 0.6 : 1 }}>
            {fetching ? '…' : '↻ Fetch Fresh'}
          </button>
          {listing.realtor_url && (
            <a href={listing.realtor_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(231,76,60,0.1)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.25)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>🏠</span> Realtor.com ↗
            </a>
          )}
        </div>
      </div>

      {/* ── Main 2-col layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, alignItems: 'start' }}>

        {/* ── Left: Photos + Details ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Photos */}
          {(mls_photos?.length ?? 0) > 0 && (
            <Card>
              <CardTitle>{mls_photos!.length} Photos</CardTitle>
              <PhotoGallery photos={mls_photos!} />
            </Card>
          )}

          {/* Remarks */}
          {listing.mls_remarks_public && (
            <Card>
              <CardTitle>Public Remarks</CardTitle>
              <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>{listing.mls_remarks_public}</p>
            </Card>
          )}
          {listing.mls_remarks_private && (
            <Card style={{ border: '1px solid rgba(201,168,76,0.2)' }}>
              <CardTitle>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}>Private</span>
                  Agent Remarks
                </span>
              </CardTitle>
              <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>{listing.mls_remarks_private}</p>
            </Card>
          )}

          {/* Showing Instructions */}
          {listing.mls_showing_instructions && (
            <Card>
              <CardTitle>Showing Instructions</CardTitle>
              <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>{listing.mls_showing_instructions}</p>
            </Card>
          )}

          {/* Property Features */}
          {mls_features && Object.keys(mls_features).length > 0 && (
            <Card>
              <CardTitle>Property Features</CardTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 14px' }}>
                {Object.entries(mls_features).map(([k, v]) => {
                  if (v === null || v === undefined || v === false) return null
                  const displayVal = Array.isArray(v) ? v.join(', ') : String(v)
                  return (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid rgba(26,48,80,0.4)' }}>
                      <span style={{ fontSize: 10, color: '#4a6a9a', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: 10, fontWeight: 500, color: '#e2e8f0', textAlign: 'right', maxWidth: '55%' }}>{displayVal === 'true' ? '✓' : displayVal}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Open Houses */}
          {mls_open_houses && mls_open_houses.length > 0 && (
            <Card>
              <CardTitle>Open Houses</CardTitle>
              {mls_open_houses.map((oh, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < mls_open_houses.length - 1 ? '1px solid #1a3050' : 'none' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{fmtDate(oh.date)}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{oh.start} – {oh.end}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Price History / Listing Timeline */}
          {mls_price_history && mls_price_history.length > 0 && (
            <Card>
              <CardTitle>Listing Timeline</CardTitle>
              <div style={{ position: 'relative' }}>
                {mls_price_history.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: i < mls_price_history.length - 1 ? '1px solid #1a3050' : 'none', alignItems: 'flex-start' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: h.event?.includes('Price') ? '#C9A84C' : '#4CAF9A', flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{h.event || 'Price Change'}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C' }}>{fmtMoney(h.price)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 1 }}>{fmtDate(h.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── Right: Pricing + Agent + Details ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Pricing */}
          <Card>
            <CardTitle>Listing Price</CardTitle>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#C9A84C', lineHeight: 1 }}>
                {fmtMoney(listing.mls_listing_price)}
              </div>
              {listing.mls_original_price && listing.mls_original_price !== listing.mls_listing_price && (
                <div style={{ fontSize: 11, color: '#4a6a9a', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Original: {fmtMoney(listing.mls_original_price)}</span>
                  {priceDelta && (
                    <span style={{ color: priceDelta.startsWith('+') ? '#4CAF9A' : '#ef4444', fontWeight: 600 }}>
                      {priceDelta}
                    </span>
                  )}
                </div>
              )}
            </div>
            <Divider />
            {listing.mls_dom != null && <KV k="Days on Market" v={String(listing.mls_dom)} vColor={listing.mls_dom > 120 ? '#ef4444' : listing.mls_dom > 60 ? '#C9A84C' : '#e2e8f0'} />}
            {listing.mls_cdom != null && listing.mls_cdom !== listing.mls_dom && <KV k="Cumulative DOM" v={String(listing.mls_cdom)} />}
            {listing.mls_price_reductions != null && listing.mls_price_reductions > 0 && (
              <KV k="Price Reductions" v={String(listing.mls_price_reductions)} vColor="#ef4444" />
            )}
          </Card>

          {/* Listing Agent / Broker */}
          {(listing.mls_agent_name || listing.mls_broker_name) && (
            <Card>
              <CardTitle>Listing Details</CardTitle>
              {listing.mls_broker_name && <KV k="Brokerage" v={listing.mls_broker_name} />}
              {listing.mls_agent_name && (
                <KV k="Listing Agent" v={
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 11 }}>{listing.mls_agent_name}</div>
                    {listing.mls_agent_phone && (
                      <a href={`tel:${listing.mls_agent_phone}`}
                        style={{ color: '#7B8FD4', fontSize: 10, fontFamily: 'monospace', textDecoration: 'none', display: 'block', marginTop: 1 }}>
                        {listing.mls_agent_phone}
                      </a>
                    )}
                    {listing.mls_agent_email && (
                      <a href={`mailto:${listing.mls_agent_email}`}
                        style={{ color: '#60a5fa', fontSize: 10, textDecoration: 'none', display: 'block', marginTop: 1 }}>
                        {listing.mls_agent_email}
                      </a>
                    )}
                  </div>
                } />
              )}
            </Card>
          )}

          {/* HOA + Tax */}
          {(listing.mls_hoa_amount || listing.tax_amount) && (
            <Card>
              <CardTitle>Fees &amp; Taxes</CardTitle>
              {listing.mls_hoa_amount && (
                <KV k="HOA" v={`${fmtMoney(listing.mls_hoa_amount)}/mo`} vColor="#C9A84C" />
              )}
              {listing.tax_amount && (
                <KV k={`Annual Taxes${listing.tax_year ? ` (${listing.tax_year})` : ''}`} v={fmtMoney(listing.tax_amount)} vColor="#4a6a9a" />
              )}
              {listing.tax_amount && (
                <KV k="Monthly Tax Est." v={fmtMoney(Math.round(listing.tax_amount / 12))} vColor="#4a6a9a" />
              )}
            </Card>
          )}

          {/* Data source note */}
          {listing.data_source && (
            <div style={{ fontSize: 10, color: '#4a6a9a', textAlign: 'center', padding: '6px 10px', background: '#0d1b2e', borderRadius: 6, border: '1px solid #1a3050' }}>
              Data via {listing.data_source === 'reapi' ? 'RealEstateAPI.com' : listing.data_source}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
