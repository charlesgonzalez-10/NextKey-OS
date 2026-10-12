import { describe, it, expect } from 'vitest'
import {
  normCity, propertyKind, fitsBuyBox, scrubWindow, isScrubSaturday,
  foreclosureStatus, estimateValue, equityFraction,
} from '@/lib/scrubber/config'

const base = { city: 'Hollywood', property_type: 'Single Family Residence', units: 1, market_value: 450_000, is_pre_foreclosure: true }

describe('buy box', () => {
  it('normalises city spellings', () => {
    expect(normCity('FT. LAUDERDALE')).toBe('fort lauderdale')
    expect(normCity('  Davie ')).toBe('davie')
  })
  it('classifies property types', () => {
    expect(propertyKind('Single Family Residence', 1)).toBe('single_family')
    expect(propertyKind('Duplex', 2)).toBe('multifamily')
    expect(propertyKind('Condominium', 1)).toBe('other')
    expect(propertyKind(null, 4)).toBe('multifamily')
  })
  it('keeps a single-family pre-foreclosure in the area under $800k', () => {
    expect(fitsBuyBox(base)).toEqual({ keep: true })
  })
  it('rejects outside the area, condos, 10+ units and over $800k', () => {
    expect(fitsBuyBox({ ...base, city: 'Miramar' })).toEqual({ keep: false, reason: 'outside_area' })
    expect(fitsBuyBox({ ...base, property_type: 'Condominium' })).toEqual({ keep: false, reason: 'property_type' })
    expect(fitsBuyBox({ ...base, property_type: 'Multi-Family', units: 12 })).toEqual({ keep: false, reason: 'too_many_units' })
    expect(fitsBuyBox({ ...base, market_value: 900_000 })).toEqual({ keep: false, reason: 'over_value' })
    expect(fitsBuyBox({ ...base, is_pre_foreclosure: false })).toEqual({ keep: false, reason: 'not_pre_foreclosure' })
  })
  it('keeps 9-unit multifamily and unknown values', () => {
    expect(fitsBuyBox({ ...base, property_type: 'Multi-Family', units: 9 })).toEqual({ keep: true })
    expect(fitsBuyBox({ ...base, market_value: null })).toEqual({ keep: true })
  })
})

describe('window and schedule', () => {
  it('starts at Sept 1 the first time, then the day after the last window', () => {
    const today = new Date('2026-10-17T12:00:00Z')
    expect(scrubWindow(null, today)).toEqual({ from: '2026-09-01', to: '2026-10-17' })
    expect(scrubWindow('2026-10-17', new Date('2026-10-31T12:00:00Z'))).toEqual({ from: '2026-10-18', to: '2026-10-31' })
  })
  it('runs every other Saturday from the anchor', () => {
    expect(isScrubSaturday(new Date('2026-10-17T11:00:00Z'))).toBe(true)
    expect(isScrubSaturday(new Date('2026-10-24T11:00:00Z'))).toBe(false)
    expect(isScrubSaturday(new Date('2026-10-31T11:00:00Z'))).toBe(true)
    expect(isScrubSaturday(new Date('2026-10-30T11:00:00Z'))).toBe(false)
  })
})

describe('status and equity', () => {
  it('reads foreclosure status from history', () => {
    expect(foreclosureStatus([])).toBe('unknown')
    expect(foreclosureStatus([{ active: false }, { active: true }])).toBe('active')
    expect(foreclosureStatus([{ active: false }])).toBe('closed')
  })
  it('estimates value from comps, then AVM, then REAPI', () => {
    expect(estimateValue({ soldPricesPerSqft: [300, 320, 340], livingArea: 1500, avm: null, reapiValue: null }))
      .toEqual({ value: 480_000, basis: 'comps' })
    expect(estimateValue({ soldPricesPerSqft: [300], livingArea: 1500, avm: 410_000, reapiValue: null }))
      .toEqual({ value: 410_000, basis: 'avm' })
    expect(estimateValue({ soldPricesPerSqft: [], livingArea: null, avm: null, reapiValue: null }))
      .toEqual({ value: null, basis: 'none' })
  })
  it('computes equity fraction', () => {
    expect(equityFraction(500_000, 300_000)).toBe(0.4)
    expect(equityFraction(null, 300_000)).toBeNull()
  })
})
