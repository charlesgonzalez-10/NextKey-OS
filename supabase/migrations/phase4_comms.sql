-- ─── Phase 4: Communications Hub ─────────────────────────────────────────────
-- Run in Supabase SQL Editor

-- ── messages table (SMS inbox) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id      uuid,
  direction    text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'sent'
               CHECK (status IN ('sent','delivered','failed','read','mock','received')),
  twilio_sid   text,
  from_number  text,
  to_number    text,
  media_url    text,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_contact    ON messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_lead       ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_created    ON messages(created_at DESC);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_auth_full" ON messages;
CREATE POLICY "messages_auth_full" ON messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Add note_type column to lead_notes if missing ─────────────────────────────
ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS note_type text DEFAULT 'note';
CREATE INDEX IF NOT EXISTS idx_lead_notes_type ON lead_notes(note_type);

-- ── lead_tasks: tasks linked to leads ─────────────────────────────────────────
-- (tasks table already exists with lead_id; this adds an index if missing)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lead_id uuid;
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);

-- ── lead_scheduled: scheduled follow-ups ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_scheduled (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL,
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('email','sms','call','task')),
  title         text NOT NULL,
  body          text,
  subject       text,
  scheduled_at  timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','cancelled','failed')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_scheduled_lead ON lead_scheduled(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_scheduled_at   ON lead_scheduled(scheduled_at);
ALTER TABLE lead_scheduled ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduled_auth_full" ON lead_scheduled;
CREATE POLICY "scheduled_auth_full" ON lead_scheduled FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── lead_automations: saved workflow rules ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_automations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  trigger     text NOT NULL,
  steps       jsonb NOT NULL DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE lead_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automations_auth_full" ON lead_automations;
CREATE POLICY "automations_auth_full" ON lead_automations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Add lead_id to messages if not already there ──────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS lead_id uuid;
