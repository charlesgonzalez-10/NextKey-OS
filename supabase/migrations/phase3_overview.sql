-- ─── Phase 3 Overview Enhancements ──────────────────────────────────────────
-- Adds MLS detail columns, rental estimate columns, and opportunity scoring
-- to the properties table.
-- Safe to re-run: all use ADD COLUMN IF NOT EXISTS.

ALTER TABLE properties
  -- MLS core (may already exist on some instances)
  ADD COLUMN IF NOT EXISTS mls_status          text,
  ADD COLUMN IF NOT EXISTS mls_listing_price   bigint,
  ADD COLUMN IF NOT EXISTS mls_active          boolean DEFAULT false,
  -- MLS detail (new)
  ADD COLUMN IF NOT EXISTS mls_number          text,
  ADD COLUMN IF NOT EXISTS mls_dom             smallint,
  ADD COLUMN IF NOT EXISTS mls_price_reductions smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mls_original_price  bigint,
  ADD COLUMN IF NOT EXISTS mls_cdom            smallint,
  ADD COLUMN IF NOT EXISTS mls_agent_name      text,
  ADD COLUMN IF NOT EXISTS mls_agent_phone     text,
  ADD COLUMN IF NOT EXISTS mls_agent_email     text,
  ADD COLUMN IF NOT EXISTS mls_broker_name     text,
  ADD COLUMN IF NOT EXISTS mls_photos          jsonb,
  ADD COLUMN IF NOT EXISTS mls_remarks_public  text,
  ADD COLUMN IF NOT EXISTS mls_remarks_private text,
  ADD COLUMN IF NOT EXISTS mls_showing_instructions text,
  ADD COLUMN IF NOT EXISTS mls_hoa_amount      numeric,
  ADD COLUMN IF NOT EXISTS mls_price_history   jsonb,
  ADD COLUMN IF NOT EXISTS mls_open_houses     jsonb,
  ADD COLUMN IF NOT EXISTS mls_features        jsonb,
  -- Rental estimate (Rentcast cache)
  ADD COLUMN IF NOT EXISTS rent_estimate       numeric,
  ADD COLUMN IF NOT EXISTS rent_range_low      numeric,
  ADD COLUMN IF NOT EXISTS rent_range_high     numeric,
  ADD COLUMN IF NOT EXISTS rent_fetched_at     timestamptz,
  -- AI opportunity score
  ADD COLUMN IF NOT EXISTS opportunity_score   smallint,
  ADD COLUMN IF NOT EXISTS opportunity_label   text,
  ADD COLUMN IF NOT EXISTS opportunity_summary text;

-- Backfill: copy suggested_rent into rent_estimate where not already set
UPDATE properties
  SET rent_estimate = suggested_rent
  WHERE rent_estimate IS NULL AND suggested_rent IS NOT NULL;

-- Index for Listing tab query
CREATE INDEX IF NOT EXISTS properties_mls_active_idx ON properties(mls_active)
  WHERE mls_active = true;
