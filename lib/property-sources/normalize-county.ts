/**
 * County name normalization.
 *
 * Accepts any common variation of a South Florida county name and returns
 * the canonical slug used as registry keys ('miami-dade', 'broward', etc.).
 * Returns null for unrecognized input so callers can surface a clear
 * "county not supported" response instead of silently misconfiguring.
 */

const COUNTY_MAP: Record<string, string> = {
  'miami-dade':   'miami-dade',
  'miami dade':   'miami-dade',
  'miami':        'miami-dade',
  'dade':         'miami-dade',

  'broward':      'broward',

  'palm-beach':   'palm-beach',
  'palm beach':   'palm-beach',

  'martin':       'martin',

  'lee':          'lee',

  'st-lucie':     'st-lucie',
  'st. lucie':    'st-lucie',
  'st lucie':     'st-lucie',
  'saint lucie':  'st-lucie',
  'st.lucie':     'st-lucie',
}

/**
 * Normalize a raw county string to the canonical registry key.
 * Strips " County" suffix, lowercases, collapses whitespace.
 * Returns null if the county is not recognized.
 */
export function normalizeCounty(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/\s+county$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return COUNTY_MAP[s] ?? null
}

/** All county slugs that have a registered provider. */
export const SUPPORTED_COUNTIES = new Set(Object.values(COUNTY_MAP))
