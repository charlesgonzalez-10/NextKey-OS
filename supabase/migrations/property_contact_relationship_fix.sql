-- ═══════════════════════════════════════════════════════════════════════════════
-- Property ↔ Contact relationship architecture fix
--
-- Problem: three independent, unsynchronized mechanisms grew up to represent the
-- same real-world relationship (a Contact's association with a Property):
--   1. contacts.property_id        — single FK, one property per contact (unified_properties.sql)
--   2. contact_properties          — junction keyed by property_id (contact_properties.sql)
--   3. lead_contacts               — junction keyed by lead_id      (lead_contacts.sql)
--
-- The active "People" tab (property/lead workspace) wrote only to lead_contacts.
-- The Contact workspace's "Linked Properties" tab and contract-template merge
-- fields read only from contact_properties. The "+ Pipeline" lead-conversion
-- flow wrote only to contacts.property_id. None of the three were kept in sync,
-- so a homeowner added from one screen silently failed to appear on another.
--
-- Fix: contact_properties becomes the single canonical PropertyContact junction
-- table. This migration (a) widens its uniqueness so a contact can hold more
-- than one role on the same property, and (b) backfills it from the other two
-- legacy mechanisms so no existing relationship is lost. lead_contacts and
-- contacts.property_id are left in place (not dropped) for audit/history, but
-- application code no longer reads or writes them.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── STEP 1: allow multiple roles per (contact, property) pair ─────────────────
-- Old constraint UNIQUE(contact_id, property_id) meant a contact could only ever
-- have ONE role on a given property (e.g. couldn't be both "Owner" and "Attorney").
ALTER TABLE contact_properties
  DROP CONSTRAINT IF EXISTS contact_properties_contact_id_property_id_key;

ALTER TABLE contact_properties
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_properties_contact_property_role_key'
  ) THEN
    ALTER TABLE contact_properties
      ADD CONSTRAINT contact_properties_contact_property_role_key
      UNIQUE (contact_id, property_id, relationship_type);
  END IF;
END $$;

-- ─── STEP 2: backfill from lead_contacts (lead_id ↔ contact_id) ────────────────
-- Resolve each lead_contacts row's lead_id → properties.id via leads.property_id.
INSERT INTO contact_properties (contact_id, property_id, lead_id, relationship_type, is_primary, notes, created_at)
SELECT
  lc.contact_id,
  l.property_id,
  lc.lead_id,
  lc.relationship_type,
  lc.is_primary,
  lc.notes,
  lc.created_at
FROM lead_contacts lc
JOIN leads l ON l.id = lc.lead_id
WHERE l.property_id IS NOT NULL
ON CONFLICT (contact_id, property_id, relationship_type) DO UPDATE SET
  lead_id    = EXCLUDED.lead_id,
  is_primary = EXCLUDED.is_primary,
  notes      = COALESCE(EXCLUDED.notes, contact_properties.notes);

-- ─── STEP 3: backfill from contacts.property_id (legacy single-FK link) ────────
-- These came from the "+ Pipeline" lead-conversion flow, which never wrote a
-- junction row at all — always as an Owner/Seller relationship, primary by
-- default since it was the contact's only recorded property link.
INSERT INTO contact_properties (contact_id, property_id, relationship_type, is_primary)
SELECT c.id, c.property_id, 'Owner', true
FROM contacts c
WHERE c.property_id IS NOT NULL
ON CONFLICT (contact_id, property_id, relationship_type) DO NOTHING;

-- ─── STEP 4: helpful index for role-scoped primary lookups ─────────────────────
CREATE INDEX IF NOT EXISTS idx_cp_property_role ON contact_properties(property_id, relationship_type);

-- NOTE: lead_contacts and contacts.property_id are intentionally NOT dropped by
-- this migration — they're left as historical/audit data. Once the application
-- has run against contact_properties in production for a safe period, a
-- follow-up migration can drop lead_contacts and the contacts.property_id
-- column/index.
