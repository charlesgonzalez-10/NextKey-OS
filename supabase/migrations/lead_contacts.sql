-- Lead ↔ Contact junction table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS lead_contacts (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid    NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_id        uuid    NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type text    NOT NULL DEFAULT 'Owner',
  is_primary        boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead    ON lead_contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_contact ON lead_contacts(contact_id);

-- RLS: authenticated users full access
ALTER TABLE lead_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users full access" ON lead_contacts
  FOR ALL USING (auth.role() = 'authenticated');
