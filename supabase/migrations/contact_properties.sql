-- Contact ↔ Property/Lead relationship table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS contact_properties (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id       uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lead_id           uuid        REFERENCES leads(id) ON DELETE SET NULL,
  relationship_type text        NOT NULL DEFAULT 'Owner',
  is_primary        boolean     NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contact_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_cp_contact  ON contact_properties(contact_id);
CREATE INDEX IF NOT EXISTS idx_cp_property ON contact_properties(property_id);
CREATE INDEX IF NOT EXISTS idx_cp_lead     ON contact_properties(lead_id);

ALTER TABLE contact_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users full access" ON contact_properties
  FOR ALL USING (auth.role() = 'authenticated');
