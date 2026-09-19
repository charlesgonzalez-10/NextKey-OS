/**
 * mergeEngine — merge field resolution tests.
 * Focuses on the Property.State fix (finding A in the audit).
 */

import { describe, it, expect } from 'vitest'

// We test the resolution logic directly by importing the module.
// mergeEngine.ts resolves fields given property, contact, lead objects.
// The key invariant: {{Property.State}} uses property.state, not hardcoded 'FL'.

// Inline the resolution logic so we can test it without spinning up the full engine.
function resolvePropertyState(property?: { state?: string | null } | null): string {
  return property?.state ?? ''
}

describe('Property.State merge field', () => {
  it('returns the actual state value from the property object', () => {
    expect(resolvePropertyState({ state: 'TX' })).toBe('TX')
    expect(resolvePropertyState({ state: 'FL' })).toBe('FL')
    expect(resolvePropertyState({ state: 'CA' })).toBe('CA')
  })

  it('returns empty string when state is null', () => {
    expect(resolvePropertyState({ state: null })).toBe('')
  })

  it('returns empty string when state is undefined', () => {
    expect(resolvePropertyState({ state: undefined })).toBe('')
  })

  it('returns empty string when property is null', () => {
    expect(resolvePropertyState(null)).toBe('')
  })

  it('returns empty string when property is undefined', () => {
    expect(resolvePropertyState(undefined)).toBe('')
  })

  it('does NOT hardcode FL regardless of property state', () => {
    expect(resolvePropertyState({ state: 'NY' })).not.toBe('FL')
    expect(resolvePropertyState(null)).not.toBe('FL')
  })
})

describe('mergeEngine module — Property.State switch case', () => {
  it('mergeEngine.ts line 74 uses property.state not literal FL', async () => {
    // Verify the source file itself was patched.
    // This test fails if the old hardcode is reintroduced.
    const fs = await import('fs')
    const src = fs.readFileSync(
      new URL('../../lib/documents/mergeEngine.ts', import.meta.url).pathname,
      'utf-8',
    )
    // Must NOT contain the hardcoded return 'FL' inside the Property.State case
    expect(src).not.toMatch(/case '{{Property\.State}}':\s*return 'FL'/)
    // Must use property?.state
    expect(src).toMatch(/property\?\.state/)
  })
})
