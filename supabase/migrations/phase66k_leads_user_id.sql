-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ NEXTKEY OS — leads.user_id (idempotent)                                │
-- │ Adds per-user ownership to the leads table and hardens RLS.            │
-- │ Backfills existing leads to Charles's account by email lookup.         │
-- └─────────────────────────────────────────────────────────────────────────┘

-- 1. Add user_id column (nullable so backfill can run first)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- 2. Index for the per-user query in /api/properties
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);

-- 3. Backfill existing leads to Charles's production account
UPDATE leads
SET user_id = u.id
FROM auth.users u
WHERE u.email IN ('crgonz10@gmail.com', 'charlesgonzalez@nextkeyps.com')
  AND leads.user_id IS NULL;

-- 4. Drop the overbroad "any authenticated user sees all leads" policy
DROP POLICY IF EXISTS "auth users full access" ON leads;

-- 5. Per-user RLS policies (belt+suspenders for direct Supabase client access;
--    service-role queries in the API bypass RLS but the API now filters by
--    user_id at the application layer)
DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_insert" ON leads;
CREATE POLICY "leads_insert" ON leads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_update" ON leads;
CREATE POLICY "leads_update" ON leads
  FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_delete" ON leads;
CREATE POLICY "leads_delete" ON leads
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
