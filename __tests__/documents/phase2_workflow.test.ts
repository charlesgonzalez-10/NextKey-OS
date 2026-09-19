/**
 * Phase 2 — Document Workflow UX tests.
 *
 * Covers:
 *  1.  Blueprint field hydration: from-document route (field mapping logic)
 *  2.  Role resolution: source field added to suggestion
 *  3.  Role resolution: deal_id added to ResolutionContext
 *  4.  RoleAssignmentPanel: dealId prop accepted
 *  5.  RoleAssignmentPanel: deal_id forwarded to resolve-roles API call
 *  6.  resolve-roles route: deal_id forwarded to resolveRoles()
 *  7.  from-document: fields_snapshot now included in document select
 *  8.  from-document: blueprint signing fields hydrated (not '[]')
 *  9.  from-document: role-to-signer mapping is deterministic
 *  10. Merge engine: merge_text fields excluded from signing fields
 *  11. roleResolutionService: deal_buyer only from explicit contactId (D-2 fix)
 *  12. Blast radius: no new tables, no dropped columns
 *  13. D-2 regression: deals.contact_id never auto-labeled as Buyer
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../..')

function read(rel: string) { return fs.readFileSync(path.join(ROOT, rel), 'utf-8') }

const fromDoc    = read('app/api/signing-sessions/from-document/route.ts')
const roleRes    = read('lib/documents/roleResolutionService.ts')
const resolveRoute = read('app/api/documents/[id]/resolve-roles/route.ts')
const panel      = read('components/documents/RoleAssignmentPanel.tsx')
const detailClient = read('app/documents/[id]/detail-client.tsx')

// ─── 1–4. Blueprint field hydration in from-document ─────────────────────────

describe('from-document route — blueprint field hydration', () => {
  it('selects fields_snapshot from the document', () => {
    expect(fromDoc).toMatch(/fields_snapshot/)
  })

  it('uses hydratedFields instead of literal empty array', () => {
    expect(fromDoc).not.toMatch(/fields:\s*'\[\]'/)
    expect(fromDoc).toMatch(/hydratedFields/)
  })

  it('builds a roleIdToSignerRef map from role_assignments', () => {
    expect(fromDoc).toMatch(/roleIdToSignerRef/)
    expect(fromDoc).toMatch(/signer_role_id.*signer_ref_id|signer_\${idx}/)
  })

  it('filters snapshot to signing field types only', () => {
    expect(fromDoc).toMatch(/SIGNING_TYPES/)
    expect(fromDoc).toMatch(/signature/)
    expect(fromDoc).toMatch(/initial/)
    expect(fromDoc).toMatch(/date/)
  })

  it('maps initial → initials for signing session field type compatibility', () => {
    expect(fromDoc).toMatch(/initial.*initials|initials.*initial/)
  })

  it('stores signer_id from the roleIdToSignerRef map, not bare roleId', () => {
    expect(fromDoc).toMatch(/roleIdToSignerRef\[/)
  })

  it('does not include merge_text fields in signing session', () => {
    // SIGNING_TYPES set does not contain merge_text
    expect(fromDoc).not.toMatch(/SIGNING_TYPES\.add.*merge_text|merge_text.*SIGNING_TYPES/)
  })
})

// ─── 5–7. roleResolutionService — source field + deal context ─────────────────

describe('roleResolutionService — source field on suggestion', () => {
  it('suggestion type includes source field', () => {
    expect(roleRes).toMatch(/source:\s*['"`]property_owner['"`]/)
    expect(roleRes).toMatch(/source:\s*['"`]deal_buyer['"`]/)
    expect(roleRes).toMatch(/source:\s*['"`]assigned_agent['"`]/)
    expect(roleRes).toMatch(/source:\s*['"`]title_company['"`]/)
    expect(roleRes).toMatch(/source:\s*['"`]relationship_service['"`]/)
  })

  it('ResolvedRole suggestion interface includes source', () => {
    expect(roleRes).toMatch(/source:\s*string/)
  })

  it('ResolutionContext includes dealId', () => {
    expect(roleRes).toMatch(/dealId\?/)
  })

  it('suggestDealBuyer only accepts contactId and userId — not dealId (D-2 fix)', () => {
    // After D-2 fix: suggestDealBuyer signature must NOT include dealId parameter
    // deals.contact_id has no buyer/seller semantics so it cannot be used to infer buyer
    const fnMatch = roleRes.match(/async function suggestDealBuyer\([^)]+\)/)
    expect(fnMatch).not.toBeNull()
    expect(fnMatch![0]).not.toContain('dealId')
  })

  it('deal_buyer case does NOT pass ctx.dealId to suggestDealBuyer', () => {
    // The call site must not forward dealId into the buyer suggestion path
    const caseBlock = roleRes.match(/case 'deal_buyer'[\s\S]*?break/)
    expect(caseBlock).not.toBeNull()
    expect(caseBlock![0]).not.toContain('ctx.dealId')
  })

  it('deals table is NOT queried inside suggestDealBuyer', () => {
    // After D-2 fix: no .from('deals') inside suggestDealBuyer
    const fn = roleRes.match(/async function suggestDealBuyer[\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    expect(fn![0]).not.toContain("from('deals')")
  })
})

// ─── 8. resolve-roles route — deal_id forwarded ───────────────────────────────

describe('resolve-roles route — deal_id context', () => {
  it('selects deal_id from the document row', () => {
    expect(resolveRoute).toMatch(/deal_id/)
  })

  it('reads deal_id from request body with fallback to doc.deal_id', () => {
    expect(resolveRoute).toMatch(/body\.deal_id.*doc\.deal_id|dealId/)
  })

  it('passes dealId to resolveRoles()', () => {
    expect(resolveRoute).toMatch(/resolveRoles.*dealId|dealId.*resolveRoles/)
  })
})

// ─── 9–10. RoleAssignmentPanel — dealId prop + API forwarding ─────────────────

describe('RoleAssignmentPanel — dealId prop and source badge', () => {
  it('accepts dealId as a prop', () => {
    expect(panel).toMatch(/dealId\??\s*:\s*string/)
  })

  it('forwards deal_id to the resolve-roles API call', () => {
    expect(panel).toMatch(/deal_id.*dealId|dealId.*deal_id/)
  })

  it('displays SOURCE_LABELS for resolved suggestions', () => {
    expect(panel).toMatch(/SOURCE_LABELS/)
    expect(panel).toMatch(/Property Owner|property_owner/)
  })

  it('shows "Needs Info" badge for unresolved roles', () => {
    expect(panel).toMatch(/Needs Info/)
  })
})

// ─── 11. detail-client — dealId wired to RoleAssignmentPanel ─────────────────

describe('detail-client — dealId wired to RoleAssignmentPanel', () => {
  it('RoleAssignmentPanel dynamic import type includes dealId', () => {
    expect(detailClient).toMatch(/dealId\?.*string/)
  })

  it('RoleAssignmentPanel receives doc.deal_id', () => {
    expect(detailClient).toMatch(/dealId=\{doc\.deal_id\}/)
  })
})

// ─── 12. Blast radius ─────────────────────────────────────────────────────────

describe('Phase 2 — blast radius', () => {
  it('from-document route does not ALTER TABLE or CREATE TABLE', () => {
    expect(fromDoc).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP TABLE/)
  })

  it('roleResolutionService does not mutate any table', () => {
    expect(roleRes).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  })

  it('resolve-roles route does not mutate any table', () => {
    expect(resolveRoute).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  })
})

// ─── 13. D-2 regression: deals.contact_id must never be auto-labeled Buyer ───

describe('D-2 regression — deals.contact_id not auto-classified as Buyer', () => {
  it('ResolutionContext.dealId has a comment marking it as NOT used for buyer inference', () => {
    // The interface comment must indicate deals.contact_id is excluded
    expect(roleRes).toMatch(/NOT used.*infer buyer|no.*role semantics|no buyer.*seller semantics/)
  })

  it('suggestDealBuyer function body contains no reference to deals table', () => {
    const fn = roleRes.match(/async function suggestDealBuyer[\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    const body = fn![0]
    expect(body).not.toContain("from('deals')")
    expect(body).not.toContain('dealId')
  })

  it('the only source value returned as deal_buyer is from an explicit contactId lookup', () => {
    // After D-2 fix: deal_buyer source only emitted in the if(contactId) branch
    const fn = roleRes.match(/async function suggestDealBuyer[\s\S]*?\n\}/)
    const body = fn![0]
    // deal_buyer source appears exactly once (from explicit contactId path)
    const matches = body.match(/source:\s*['"]deal_buyer['"]/g)
    expect(matches).toHaveLength(1)
  })

  it('no lookup of deals table occurs in the deal_buyer resolution path', () => {
    // Confirm .from('deals') does not appear anywhere in suggestDealBuyer
    const fn = roleRes.match(/async function suggestDealBuyer[\s\S]*?\n\}/)
    expect(fn![0]).not.toMatch(/\.from\(['"]deals['"]\)/)
  })
})
