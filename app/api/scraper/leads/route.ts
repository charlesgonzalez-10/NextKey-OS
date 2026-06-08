/**
 * GET /api/scraper/leads
 *
 * Backward-compat alias for /api/properties.
 * This route is kept so the scraper dashboard and any existing references
 * continue to work. New code should use /api/properties instead.
 */
import { NextRequest } from 'next/server'
import { GET as propertiesGET } from '@/app/api/properties/route'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  return propertiesGET(req)
}
