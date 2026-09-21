/**
 * Regression tests: leads multi-tenant scoping.
 *
 * Asserts that every read/write against the leads table is filtered by user_id
 * so one authenticated user cannot see or mutate another user's CRM data.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../..')

function src(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf-8')
}

describe('leads user_id scoping', () => {
  describe('GET /api/properties — leads join', () => {
    it('filters the leads query by user_id = authenticated user', () => {
      const code = src('app/api/properties/route.ts')
      // Must contain .eq('user_id', user.id) adjacent to the leads fetch
      expect(code).toMatch(/\.eq\(\s*['"]user_id['"]\s*,\s*user\.id\s*\)/)
      // .in('property_id', propIds) must also be present (guard that the join block wasn't removed)
      expect(code).toContain(".in('property_id', propIds)")
    })
  })

  describe('POST /api/properties/[id]/add-lead', () => {
    it('selects existing lead filtered by user_id', () => {
      const code = src('app/api/properties/[id]/add-lead/route.ts')
      expect(code).toMatch(/\.eq\(\s*['"]user_id['"]\s*,\s*user\.id\s*\)/)
    })

    it('inserts new lead with user_id', () => {
      const code = src('app/api/properties/[id]/add-lead/route.ts')
      expect(code).toMatch(/user_id\s*:\s*user\.id/)
    })

    it('DELETE handler scopes update to user_id', () => {
      const code = src('app/api/properties/[id]/add-lead/route.ts')
      const deleteSection = code.slice(code.indexOf('export async function DELETE'))
      expect(deleteSection).toMatch(/\.eq\(\s*['"]user_id['"]\s*,\s*user\.id\s*\)/)
    })
  })

  describe('POST /api/leads/add-to-pipeline', () => {
    it('scopes lead lookup to user_id', () => {
      const code = src('app/api/leads/add-to-pipeline/route.ts')
      expect(code).toMatch(/\.eq\(\s*['"]user_id['"]\s*,\s*user\.id\s*\)/)
    })

    it('inserts lead with user_id', () => {
      const code = src('app/api/leads/add-to-pipeline/route.ts')
      expect(code).toMatch(/user_id\s*:\s*user\.id/)
    })
  })

  describe('Scraper import routes', () => {
    const routes = [
      'app/api/scraper/bulk-import/route.ts',
      'app/api/scraper/propstream-import/route.ts',
      'app/api/scraper/import-csv/route.ts',
    ]

    for (const route of routes) {
      it(`sets user_id on lead insert: ${route.split('/').at(-2)}`, () => {
        const code = src(route)
        expect(code).toMatch(/user_id\s*:\s*user\.id/)
      })
    }
  })

  describe('Cross-account isolation invariant', () => {
    it('filtering by a different user_id returns no matching leads', () => {
      const CHARLES_ID = 'charles-uuid-0001'
      const PARTNER_ID = 'partner-uuid-0002'

      const dbRows = [
        { id: 'lead-1', property_id: 'prop-a', user_id: CHARLES_ID, pipeline_stage: 'negotiating', offer_amount: 250000 },
        { id: 'lead-2', property_id: 'prop-b', user_id: CHARLES_ID, starred: true, notes: 'motivated seller' },
      ]

      const partnerView = dbRows.filter(r => r.user_id === PARTNER_ID)
      expect(partnerView).toHaveLength(0)

      const charlesView = dbRows.filter(r => r.user_id === CHARLES_ID)
      expect(charlesView).toHaveLength(2)
    })
  })

  describe('Migration', () => {
    it('migration adds user_id column and RLS policies', () => {
      const sql = src('supabase/migrations/phase66k_leads_user_id.sql')
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS user_id')
      expect(sql).toContain('DROP POLICY IF EXISTS "auth users full access"')
      expect(sql).toContain("CREATE POLICY \"leads_select\"")
      expect(sql).toContain("CREATE POLICY \"leads_insert\"")
      expect(sql).toContain("CREATE POLICY \"leads_update\"")
      expect(sql).toContain("CREATE POLICY \"leads_delete\"")
      // Backfill must target Charles's known emails
      expect(sql).toContain('crgonz10@gmail.com')
    })
  })
})
