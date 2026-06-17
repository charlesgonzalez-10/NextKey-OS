-- ─── Contract Template Library (blank PDFs) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) NOT NULL,
  name         text NOT NULL,
  description  text,
  category     text DEFAULT 'other',
  file_path    text NOT NULL,
  page_count   int,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contract_templates_auth" ON contract_templates;
CREATE POLICY "contract_templates_auth" ON contract_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── Signing Sessions (multi-party envelopes) ─────────────────────────────────
-- fields: jsonb array of { id, type, page, x, y, w, h, signer_id, required, label }
--   x/y/w/h are fractions of page dimensions (0-1)
--   type: 'signature' | 'initials' | 'date' | 'text' | 'checkbox'
-- signers: jsonb array of { id, name, email, role, color }

CREATE TABLE IF NOT EXISTS signing_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES auth.users(id) NOT NULL,
  title              text NOT NULL,
  pdf_path           text NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','in_progress','completed','voided')),
  fields             jsonb NOT NULL DEFAULT '[]',
  signers            jsonb NOT NULL DEFAULT '[]',
  completed_pdf_path text,
  certificate_path   text,
  -- optional links
  property_id        uuid,
  lead_id            uuid,
  contact_id         uuid,
  deal_id            uuid,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  completed_at       timestamptz
);

ALTER TABLE signing_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signing_sessions_auth" ON signing_sessions;
CREATE POLICY "signing_sessions_auth" ON signing_sessions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_signing_sessions_user ON signing_sessions(user_id, created_at DESC);

-- ─── Session Signers (one row per signer per session) ─────────────────────────
CREATE TABLE IF NOT EXISTS session_signers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid REFERENCES signing_sessions(id) ON DELETE CASCADE NOT NULL,
  signer_ref_id  text NOT NULL,
  name           text NOT NULL,
  email          text NOT NULL,
  color          text DEFAULT '#4CAF9A',
  role           text,
  token          text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','viewed','signed','declined')),
  order_index    int DEFAULT 0,
  viewed_at      timestamptz,
  signed_at      timestamptz,
  declined_at    timestamptz,
  decline_reason text,
  signer_ip      text,
  signer_ua      text,
  fields_data    jsonb DEFAULT '{}',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE session_signers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "session_signers_auth" ON session_signers;
CREATE POLICY "session_signers_auth" ON session_signers
  FOR ALL TO authenticated
  USING (session_id IN (SELECT id FROM signing_sessions WHERE user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM signing_sessions WHERE user_id = auth.uid()));

-- Public read by token (for the signing page — no auth)
DROP POLICY IF EXISTS "session_signers_public_token" ON session_signers;
CREATE POLICY "session_signers_public_token" ON session_signers
  FOR SELECT TO anon USING (true);

CREATE INDEX IF NOT EXISTS idx_session_signers_session ON session_signers(session_id);
CREATE INDEX IF NOT EXISTS idx_session_signers_token   ON session_signers(token);
