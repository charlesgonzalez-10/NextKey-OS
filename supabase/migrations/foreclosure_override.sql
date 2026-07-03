-- Foreclosure Status Override
--
-- Adds operational override fields to the properties table.
-- REAPI ingestion must NEVER touch these columns.
-- Effective status = foreclosure_status_override ?? (derived from REAPI flags)
--
-- Idempotent.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS foreclosure_status_override    text
    CHECK (foreclosure_status_override IN (
      'Active','Pending','Dismissed','Cancelled','Reinstated',
      'Sold at Auction','Certificate Issued','Final Judgment',
      'Bankruptcy Stay','Unknown'
    )),
  ADD COLUMN IF NOT EXISTS foreclosure_status_source      text DEFAULT 'REAPI'
    CHECK (foreclosure_status_source IN ('Manual', 'REAPI')),
  ADD COLUMN IF NOT EXISTS foreclosure_status_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS foreclosure_status_updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS foreclosure_notes              text,
  ADD COLUMN IF NOT EXISTS foreclosure_reapi_changed      boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS properties_fc_status_override_idx
  ON properties (foreclosure_status_override)
  WHERE foreclosure_status_override IS NOT NULL;
