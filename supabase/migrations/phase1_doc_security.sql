-- ─── Phase 1 Document Security — RLS Hardening ───────────────────────────────
--
-- Problem: Two anon SELECT policies allow any unauthenticated request to read
-- ALL session_signers and signing_role_assignments rows (names, emails, tokens,
-- IPs, decline reasons). The /sign/{token} route runs server-side with the
-- service role key, which bypasses RLS entirely. Anonymous client DB access is
-- therefore never needed and these policies are pure exposure.
--
-- Also: contract_templates and document_templates had no per-user scoping.
--
-- Safe to re-run (all DROP … IF EXISTS, CREATE … IF NOT EXISTS pattern).

-- ─── 1. session_signers — remove overbroad anonymous read ────────────────────
DROP POLICY IF EXISTS "session_signers_public_token" ON session_signers;
-- /sign/{token} goes through the Next.js API route which uses the service role
-- key (bypasses RLS). No anonymous direct-DB access is needed.

-- ─── 2. signing_role_assignments — same ──────────────────────────────────────
DROP POLICY IF EXISTS "sra_public_token" ON signing_role_assignments;

-- ─── 3. contract_templates — scope to owner ──────────────────────────────────
DROP POLICY IF EXISTS "contract_templates_auth" ON contract_templates;

CREATE POLICY "ct_select" ON contract_templates
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "ct_insert" ON contract_templates
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "ct_update" ON contract_templates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ct_delete" ON contract_templates
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ─── 4. blueprint_versions — scope via parent template ownership ──────────────
DROP POLICY IF EXISTS "blueprint_versions_auth" ON blueprint_versions;

CREATE POLICY "bv_select" ON blueprint_versions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid())
  );

CREATE POLICY "bv_insert" ON blueprint_versions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid())
  );

CREATE POLICY "bv_update" ON blueprint_versions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid()));

CREATE POLICY "bv_delete" ON blueprint_versions
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid())
  );

-- ─── 5. template_fields — scope via parent template ownership ─────────────────
DROP POLICY IF EXISTS "template_fields_auth" ON template_fields;

CREATE POLICY "tf_select" ON template_fields
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid())
  );

CREATE POLICY "tf_insert" ON template_fields
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid())
  );

CREATE POLICY "tf_update" ON template_fields
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid()));

CREATE POLICY "tf_delete" ON template_fields
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM contract_templates t WHERE t.id = blueprint_id AND t.user_id = auth.uid())
  );

-- ─── 6. document_templates — built-ins readable by all, customs owned ─────────
DROP POLICY IF EXISTS "authenticated_full" ON document_templates;

CREATE POLICY "dt_select" ON document_templates
  FOR SELECT TO authenticated USING (is_builtin = true OR created_by = auth.uid());

CREATE POLICY "dt_insert" ON document_templates
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "dt_update" ON document_templates
  FOR UPDATE TO authenticated
  USING (is_builtin = false AND created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "dt_delete" ON document_templates
  FOR DELETE TO authenticated USING (is_builtin = false AND created_by = auth.uid());

-- ─── 7. Add expires_at to session_signers ────────────────────────────────────
-- Signing links must not be valid forever. Default 30 days from creation.
ALTER TABLE session_signers
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing rows: 30 days from their created_at
UPDATE session_signers
  SET expires_at = created_at + interval '30 days'
  WHERE expires_at IS NULL;

-- Set a default for new rows
ALTER TABLE session_signers
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');
