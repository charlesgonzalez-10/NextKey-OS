-- ─── Phase 1.2 Document Table RLS ────────────────────────────────────────────
--
-- AUDIT FINDINGS:
--
-- documents (NEEDS FIX):
--   Current: "authenticated_full" FOR ALL TO authenticated USING (true)
--   Any authenticated user can SELECT / UPDATE / DELETE any other user's rows.
--   Ownership column: created_by (uuid, nullable, REFERENCES auth.users(id))
--
-- signing_sessions (ALREADY CORRECT — no change):
--   "signing_sessions_auth" USING (user_id = auth.uid()) — properly scoped.
--
-- session_signers (ALREADY CORRECT — no change):
--   "session_signers_auth" derives ownership via signing_sessions.user_id.
--   Anon "session_signers_public_token" dropped by phase1_doc_security.sql.
--
-- signing_role_assignments (ALREADY CORRECT — no change):
--   "sra_auth" derives ownership via signing_sessions.user_id.
--   Anon "sra_public_token" dropped by phase1_doc_security.sql.
--
-- This migration contains ONLY the documents table fix.
-- All server-side API routes use serviceClient (service role) which bypasses
-- RLS unconditionally — no application breakage.
-- Signing portal never queries documents directly — goes through server routes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── documents — replace open policy with per-owner policies ─────────────────

DROP POLICY IF EXISTS "authenticated_full" ON documents;

-- SELECT: user can only read their own document rows.
-- created_by = NULL rows are invisible to all authenticated users and are only
-- accessible via the service role (used by all server API routes).
CREATE POLICY "doc_select" ON documents
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- INSERT: user can only insert rows they own.
-- Prevents an authenticated client from inserting with a foreign created_by.
CREATE POLICY "doc_insert" ON documents
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- UPDATE: user can only update their own rows.
CREATE POLICY "doc_update" ON documents
  FOR UPDATE TO authenticated
  USING  (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- DELETE: user can only delete their own rows.
CREATE POLICY "doc_delete" ON documents
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());
