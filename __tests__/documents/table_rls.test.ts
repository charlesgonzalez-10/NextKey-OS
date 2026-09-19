/**
 * Phase 1.2 — Document & signing table RLS invariants.
 *
 * Tests (all structural/logic — no live DB calls, no external providers):
 *  1.  User A cannot SELECT User B document row
 *  2.  User A cannot UPDATE User B document row
 *  3.  User A cannot DELETE User B document row
 *  4.  Owner can SELECT own document row
 *  5.  Owner can UPDATE own document row
 *  6.  Owner can DELETE own document row
 *  7.  INSERT with foreign created_by is rejected
 *  8.  NULL created_by rows are invisible to authenticated users
 *  9.  User A cannot SELECT User B signing session
 *  10. User A cannot UPDATE User B signing session
 *  11. User A cannot DELETE User B signing session
 *  12. Owner can SELECT own signing session
 *  13. User A cannot access User B session_signers (auth policy blocks)
 *  14. Anonymous direct table enumeration is unavailable
 *  15. Migration contains correct policy names
 *  16. Migration drops the original "authenticated_full" policy
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

// ─── Inline RLS-policy simulation helpers ────────────────────────────────────
// Mirror the exact SQL USING / WITH CHECK expressions in TypeScript so we can
// unit-test the policy logic without a live database.

/** documents — SELECT / UPDATE / DELETE: USING (created_by = auth.uid()) */
function docUsing(row: { created_by: string | null }, userId: string): boolean {
  return row.created_by === userId
}

/** documents — INSERT: WITH CHECK (created_by = auth.uid()) */
function docWithCheck(row: { created_by: string | null }, userId: string): boolean {
  return row.created_by === userId
}

/** signing_sessions — FOR ALL: USING (user_id = auth.uid()) */
function sessionUsing(row: { user_id: string }, userId: string): boolean {
  return row.user_id === userId
}

/** session_signers — FOR ALL AUTHENTICATED:
 *  USING (session_id IN (SELECT id FROM signing_sessions WHERE user_id = auth.uid()))
 */
function signerUsing(
  row: { session_id: string },
  ownedSessionIds: string[],
): boolean {
  return ownedSessionIds.includes(row.session_id)
}

// ─── 1–8. documents table ────────────────────────────────────────────────────

describe('documents table — SELECT policy (USING created_by = auth.uid())', () => {
  it('User A CANNOT SELECT User B document (created_by=B)', () => {
    const row = { created_by: USER_B }
    expect(docUsing(row, USER_A)).toBe(false)
  })

  it('User A CAN SELECT their own document (created_by=A)', () => {
    const row = { created_by: USER_A }
    expect(docUsing(row, USER_A)).toBe(true)
  })

  it('NULL created_by is invisible to authenticated user A', () => {
    const row = { created_by: null }
    expect(docUsing(row, USER_A)).toBe(false)
  })
})

describe('documents table — UPDATE policy (USING + WITH CHECK = auth.uid())', () => {
  it('User A CANNOT UPDATE User B document (USING fails)', () => {
    const row = { created_by: USER_B }
    expect(docUsing(row, USER_A)).toBe(false)
  })

  it('User A CAN UPDATE own document (USING passes)', () => {
    const row = { created_by: USER_A }
    expect(docUsing(row, USER_A)).toBe(true)
  })

  it('Cannot change created_by away from self (WITH CHECK fails)', () => {
    // Attempting to update created_by to USER_B while authenticated as USER_A
    const proposed = { created_by: USER_B }
    expect(docWithCheck(proposed, USER_A)).toBe(false)
  })
})

describe('documents table — DELETE policy (USING created_by = auth.uid())', () => {
  it('User A CANNOT DELETE User B document', () => {
    const row = { created_by: USER_B }
    expect(docUsing(row, USER_A)).toBe(false)
  })

  it('User A CAN DELETE own document', () => {
    const row = { created_by: USER_A }
    expect(docUsing(row, USER_A)).toBe(true)
  })
})

describe('documents table — INSERT policy (WITH CHECK created_by = auth.uid())', () => {
  it('User A CANNOT INSERT row with created_by=B', () => {
    const row = { created_by: USER_B }
    expect(docWithCheck(row, USER_A)).toBe(false)
  })

  it('User A CAN INSERT row with created_by=A', () => {
    const row = { created_by: USER_A }
    expect(docWithCheck(row, USER_A)).toBe(true)
  })

  it('User A CANNOT INSERT row with created_by=NULL', () => {
    const row = { created_by: null }
    expect(docWithCheck(row, USER_A)).toBe(false)
  })
})

// ─── 9–12. signing_sessions table ────────────────────────────────────────────

describe('signing_sessions table — existing policy (USING user_id = auth.uid())', () => {
  it('User A CANNOT SELECT User B session (user_id=B)', () => {
    const row = { user_id: USER_B }
    expect(sessionUsing(row, USER_A)).toBe(false)
  })

  it('User A CANNOT UPDATE User B session', () => {
    const row = { user_id: USER_B }
    expect(sessionUsing(row, USER_A)).toBe(false)
  })

  it('User A CANNOT DELETE User B session', () => {
    const row = { user_id: USER_B }
    expect(sessionUsing(row, USER_A)).toBe(false)
  })

  it('User A CAN SELECT own session (user_id=A)', () => {
    const row = { user_id: USER_A }
    expect(sessionUsing(row, USER_A)).toBe(true)
  })

  it('signing_sessions already has correct policy — confirmed in migration audit', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/signing_sessions.sql'),
      'utf-8',
    )
    expect(sql).toMatch(/USING \(user_id = auth\.uid\(\)\)/)
    expect(sql).toMatch(/WITH CHECK \(user_id = auth\.uid\(\)\)/)
  })
})

// ─── 13. session_signers — authenticated access via session ownership ─────────

describe('session_signers table — authenticated policy derives from session ownership', () => {
  it('User A CANNOT access User B session_signers (session not in A owned set)', () => {
    const signerRow = { session_id: 'session-owned-by-b' }
    const userAOwnedSessions = ['session-owned-by-a']
    expect(signerUsing(signerRow, userAOwnedSessions)).toBe(false)
  })

  it('User A CAN access session_signers for own session', () => {
    const signerRow = { session_id: 'session-owned-by-a' }
    const userAOwnedSessions = ['session-owned-by-a']
    expect(signerUsing(signerRow, userAOwnedSessions)).toBe(true)
  })

  it('session_signers auth policy confirmed in signing_sessions.sql migration', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/signing_sessions.sql'),
      'utf-8',
    )
    // The policy derives ownership through the signing_sessions parent
    expect(sql).toMatch(/session_id IN \(SELECT id FROM signing_sessions WHERE user_id = auth\.uid\(\)\)/)
  })
})

// ─── 14. Anonymous access ─────────────────────────────────────────────────────

describe('Anonymous direct table enumeration', () => {
  it('documents table has no anon policies (all are TO authenticated)', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/documents.sql'),
      'utf-8',
    )
    // No policy targets "TO anon" on documents
    const anonPolicies = sql.match(/FOR .* TO anon/g)
    expect(anonPolicies).toBeNull()
  })

  it('session_signers public token policy is dropped by phase1_doc_security.sql', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/phase1_doc_security.sql'),
      'utf-8',
    )
    expect(sql).toMatch(/DROP POLICY IF EXISTS "session_signers_public_token" ON session_signers/)
    expect(sql).toMatch(/DROP POLICY IF EXISTS "sra_public_token" ON signing_role_assignments/)
  })
})

// ─── 15–16. Migration correctness ────────────────────────────────────────────

describe('phase1_2_document_table_rls.sql — migration correctness', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/phase1_2_document_table_rls.sql'),
    'utf-8',
  )

  it('drops the original authenticated_full policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "authenticated_full" ON documents/)
  })

  it('creates per-operation policies scoped to created_by = auth.uid()', () => {
    expect(sql).toMatch(/CREATE POLICY "doc_select"/)
    expect(sql).toMatch(/CREATE POLICY "doc_insert"/)
    expect(sql).toMatch(/CREATE POLICY "doc_update"/)
    expect(sql).toMatch(/CREATE POLICY "doc_delete"/)
    expect(sql).toMatch(/created_by = auth\.uid\(\)/)
  })

  it('does not contain CREATE/DROP POLICY on signing_sessions (already correct)', () => {
    // The comment block mentions signing_sessions for audit context;
    // no DML statements should target it.
    expect(sql).not.toMatch(/CREATE POLICY.*ON signing_sessions/)
    expect(sql).not.toMatch(/DROP POLICY.*ON signing_sessions/)
  })

  it('does not contain CREATE/DROP POLICY on session_signers (already correct)', () => {
    expect(sql).not.toMatch(/CREATE POLICY.*ON session_signers/)
    expect(sql).not.toMatch(/DROP POLICY.*ON session_signers/)
  })

  it('does not reintroduce anonymous SELECT', () => {
    expect(sql).not.toMatch(/TO anon/)
  })

  it('is idempotent — uses DROP IF EXISTS', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS/)
  })
})
