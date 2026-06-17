-- ─── Upgrade email_templates ─────────────────────────────────────────────────
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS folder      text DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS variables   jsonb DEFAULT '[]';

-- ─── Email Signatures ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_signatures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  content    text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "es_full" ON email_signatures;
CREATE POLICY "es_full" ON email_signatures
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Add closing_date to deals ────────────────────────────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closing_date date;
