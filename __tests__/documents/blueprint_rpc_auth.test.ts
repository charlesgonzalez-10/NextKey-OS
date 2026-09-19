/**
 * Phase 1.3 — sync_blueprint_draft_fields authorization.
 *
 * Authorization model: GRANT-level restriction (service_role only).
 * auth.uid()-based guard is intentionally absent because all production
 * callers use serviceClient (service-role), where auth.uid() = NULL.
 *
 * Ownership is enforced at the API-route layer (verifyOwner) before the RPC
 * is ever called. This is confirmed in:
 *   app/api/contract-templates/[id]/fields/route.ts — verifyOwner()
 *   lib/documents/blueprintService.ts:152 — serviceClient.rpc()
 *
 * Tests:
 *  1.  Migration contains REVOKE from authenticated
 *  2.  Migration contains REVOKE from anon
 *  3.  Migration GRANTS only to service_role
 *  4.  Migration does NOT grant to authenticated
 *  5.  Migration does NOT contain auth.uid() ownership check (would break prod)
 *  6.  Authorization guard is at the GRANT level, not in function body
 *  7.  API route performs ownership check before calling RPC
 *  8.  API route uses serviceClient (service-role) for the RPC call
 *  9.  API route rejects non-owner with 404 before RPC is invoked
 *  10. Migration is blast-radius safe (only touches one function)
 *  11. Signature preserved: (uuid, jsonb) RETURNS jsonb
 *  12. SECURITY DEFINER preserved
 *  13. SET search_path = public preserved
 *  14. Atomic DELETE + INSERT preserved
 *  15. COALESCE empty-array return preserved
 *  16. jsonb_array_length guard preserved
 *  17. blueprint_version_id IS NULL draft filter preserved
 *  18. ORDER BY sort_order, created_at preserved
 *  19. CREATE OR REPLACE (safe in-place replacement)
 *  20. Route owner-check uses serviceClient for the SELECT (bypasses RLS)
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/phase1_3_fix_blueprint_rpc_auth.sql',
)
const ROUTE_PATH = path.resolve(
  __dirname,
  '../../app/api/contract-templates/[id]/fields/route.ts',
)
const SERVICE_PATH = path.resolve(
  __dirname,
  '../../lib/documents/blueprintService.ts',
)

const sql   = fs.readFileSync(MIGRATION_PATH, 'utf-8')
const route = fs.readFileSync(ROUTE_PATH, 'utf-8')
const svc   = fs.readFileSync(SERVICE_PATH, 'utf-8')

// ─── 1–6. GRANT-level authorization in migration ──────────────────────────────

describe('phase1_3 migration — GRANT-level authorization', () => {
  it('REVOKEs EXECUTE from authenticated', () => {
    expect(sql).toMatch(/REVOKE EXECUTE[\s\S]{0,80}FROM authenticated/)
  })

  it('REVOKEs EXECUTE from anon', () => {
    expect(sql).toMatch(/REVOKE EXECUTE[\s\S]{0,80}FROM anon/)
  })

  it('GRANTs EXECUTE only to service_role', () => {
    expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]{0,80}TO service_role/)
  })

  it('does NOT GRANT to authenticated', () => {
    // GRANT lines only — REVOKE lines mentioning authenticated are fine
    const grantLines = sql.split('\n').filter(l => /^\s*GRANT/.test(l))
    for (const line of grantLines) {
      expect(line).not.toMatch(/\bauthenticated\b/)
    }
  })

  it('does NOT contain auth.uid() in executable SQL inside the function body — would break service-role callers', () => {
    const fnBody = sql.slice(sql.indexOf('AS $$'), sql.indexOf('$$;') + 3)
    // Strip single-line comments before checking for executable auth.uid() usage
    const executableLines = fnBody.split('\n')
      .filter(l => !l.trimStart().startsWith('--'))
      .join('\n')
    expect(executableLines).not.toMatch(/auth\.uid\(\)/)
  })

  it('authorization model comment is documented in migration', () => {
    expect(sql).toMatch(/service.role[\s\S]{0,100}only permitted|service.role[\s\S]{0,100}legitimate production/i)
  })
})

// ─── 7–9. API route ownership enforcement ────────────────────────────────────

describe('API route — ownership enforcement before RPC', () => {
  it('route calls verifyOwner() before syncDraftFields()', () => {
    const postSection = route.slice(route.indexOf('export async function POST'))
    const verifyPos = postSection.indexOf('verifyOwner')
    const syncPos   = postSection.indexOf('syncDraftFields')
    expect(verifyPos).toBeGreaterThan(0)
    expect(syncPos).toBeGreaterThan(verifyPos)
  })

  it('route returns 404 when verifyOwner fails (not 403 — avoids leaking existence)', () => {
    expect(route).toMatch(/verifyOwner[\s\S]{0,80}status:\s*404/)
  })

  it('route uses serviceClient for the ownership SELECT query', () => {
    expect(route).toMatch(/serviceClient[\s\S]{0,100}contract_templates/)
  })
})

// ─── 8. blueprintService uses serviceClient for the RPC call ──────────────────

describe('blueprintService — service-role RPC caller', () => {
  it('syncDraftFields calls serviceClient.rpc (not a user-JWT client)', () => {
    expect(svc).toMatch(/serviceClient\.rpc\(\s*['"]sync_blueprint_draft_fields['"]/)
  })

  it('blueprintService imports serviceClient, not createClient', () => {
    expect(svc).toMatch(/import\s*\{[^}]*serviceClient[^}]*\}\s*from/)
    // Should NOT import createClient (which is the user-JWT client)
    expect(svc).not.toMatch(/import.*createClient.*from.*supabase\/server/)
  })
})

// ─── 10. Blast-radius safety ──────────────────────────────────────────────────

describe('phase1_3 migration — blast radius', () => {
  it('does not contain ALTER TABLE', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE/)
  })

  it('does not contain CREATE/DROP POLICY', () => {
    expect(sql).not.toMatch(/CREATE\s+POLICY|DROP\s+POLICY/)
  })

  it('does not contain CREATE TABLE or DROP TABLE', () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE|DROP\s+TABLE/)
  })

  it('only defines one function: sync_blueprint_draft_fields', () => {
    // Strip comment lines before counting function definitions
    const executableLines = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
    const fns = executableLines.match(/CREATE OR REPLACE FUNCTION\s+\S+/gi) ?? []
    expect(fns).toHaveLength(1)
    expect(fns[0]).toMatch(/sync_blueprint_draft_fields/i)
  })

  it('does not reference storage.objects or bucket policies', () => {
    expect(sql).not.toMatch(/storage\.objects|bucket_id/)
  })

  it('does not contain DELETE FROM that targets user data directly', () => {
    // Only DELETE should be within the function body targeting template_fields
    const deleteStatements = sql.match(/DELETE FROM \w+/gi) ?? []
    for (const stmt of deleteStatements) {
      expect(stmt).toMatch(/template_fields/i)
    }
  })
})

// ─── 11–13. Function signature integrity ─────────────────────────────────────

describe('phase1_3 migration — function signature integrity', () => {
  it('parameters are (p_blueprint_id uuid, p_fields jsonb)', () => {
    expect(sql).toMatch(/p_blueprint_id\s+uuid/)
    expect(sql).toMatch(/p_fields\s+jsonb/)
  })

  it('RETURNS jsonb', () => {
    expect(sql).toMatch(/RETURNS\s+jsonb/)
  })

  it('LANGUAGE plpgsql', () => {
    expect(sql).toMatch(/LANGUAGE\s+plpgsql/)
  })

  it('SECURITY DEFINER', () => {
    expect(sql).toMatch(/SECURITY DEFINER/)
  })

  it('SET search_path = public', () => {
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/)
  })

  it('uses CREATE OR REPLACE FUNCTION for safe in-place replacement', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/)
  })
})

// ─── 14–18. DML body preserved ───────────────────────────────────────────────

describe('phase1_3 migration — DML body preserved', () => {
  it('DELETE only removes draft fields (blueprint_version_id IS NULL filter)', () => {
    expect(sql).toMatch(/DELETE FROM template_fields[\s\S]{0,100}blueprint_version_id IS NULL/)
  })

  it('INSERT respects empty-array guard (jsonb_array_length check)', () => {
    expect(sql).toMatch(/jsonb_array_length\(p_fields\)\s*>\s*0/)
  })

  it('returns COALESCE(v_result, empty jsonb array)', () => {
    expect(sql).toMatch(/COALESCE\(v_result,\s*'\[\]'::jsonb\)/)
  })

  it('result is ordered by sort_order then created_at', () => {
    expect(sql).toMatch(/ORDER BY tf\.sort_order, tf\.created_at/)
  })

  it('selects only draft fields in the RETURN query (blueprint_version_id IS NULL)', () => {
    expect(sql).toMatch(/tf\.blueprint_version_id\s+IS NULL/)
  })
})
