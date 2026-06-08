-- ─── Lead category columns on properties table ───────────────────────────────
--
-- Extends the properties table with boolean flags for each distress category
-- ingested by the OR pipeline. This mirrors the existing is_pre_foreclosure
-- and is_auction patterns already in the schema.
--
-- Run this once. All columns default to false so existing rows are unaffected.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS is_probate   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_tax_deed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_divorce   BOOLEAN NOT NULL DEFAULT false;

-- Indexes for the leads page tab filters
CREATE INDEX IF NOT EXISTS properties_is_probate_idx
  ON properties (is_probate) WHERE is_probate = true;

CREATE INDEX IF NOT EXISTS properties_is_tax_deed_idx
  ON properties (is_tax_deed) WHERE is_tax_deed = true;

CREATE INDEX IF NOT EXISTS properties_is_divorce_idx
  ON properties (is_divorce) WHERE is_divorce = true;

-- Also widen the distress_filings.doc_type CHECK to allow new categories
-- (the existing constraint only allows 'LIS_PENDENS' as a default value,
--  but the column itself is unconstrained TEXT so no change is needed)
