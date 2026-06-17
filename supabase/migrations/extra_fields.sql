-- ─── Extra Fields: owner_city, auction_date, lead quick_note ──────────────────
-- Run in Supabase SQL Editor (safe to re-run — all use IF NOT EXISTS)

-- Owner mailing city (companion to owner_state / owner_zip already in DB)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS owner_city text;

-- Auction date (relevant for is_auction leads)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS auction_date date;

-- Unit number / apt in address (e.g. "Apt 4B")
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS unit_number text;

-- Number of units in the building (multi-family)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS num_units smallint;

-- Quick note on the lead record — a single-line note visible in the list view.
-- Full notes (multi-entry, timestamped) stay in lead_notes table.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS notes text;

-- Index for searching notes
CREATE INDEX IF NOT EXISTS leads_notes_idx ON leads(notes)
  WHERE notes IS NOT NULL;
