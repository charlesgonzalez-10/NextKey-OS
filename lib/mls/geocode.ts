/**
 * Server-side address geocoding via Google Maps Geocoding API.
 * Used by the MLS comps endpoint to convert an address to lat/lng
 * before querying Beaches MLS for nearby properties.
 */

export interface GeoPoint { lat: number; lng: number }

export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return null

  const url = `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(address)}` +
    `&components=country:US` +
    `&key=${key}`

  try {
    const res = await fetch(url, { next: { revalidate: 86400 } }) // cache 24h
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.[0]) return null
    const { lat, lng } = data.results[0].geometry.location
    return { lat: Number(lat), lng: Number(lng) }
  } catch {
    return null
  }
}
