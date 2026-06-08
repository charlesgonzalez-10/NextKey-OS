-- ─── Miami-Dade PA Enrichment Extensions ──────────────────────────────────────
-- Run this in Supabase SQL Editor (safe to re-run — all use IF NOT EXISTS)

-- Add enrichment tracking + mailing address columns to scraper_leads
ALTER TABLE scraper_leads
  ADD COLUMN IF NOT EXISTS enriched_at      timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_src   text,
  ADD COLUMN IF NOT EXISTS mailing_address  text,
  ADD COLUMN IF NOT EXISTS owner_state      text,
  ADD COLUMN IF NOT EXISTS owner_zip        text,
  ADD COLUMN IF NOT EXISTS tax_year         integer;

-- Note: legal_description, zoning, subdivision_name, lot_size, owner_name,
--       sold_price, build_value, assessed_value, land_value, market_value,
--       last_sale_date, beds, baths, living_area, year_built, folio_number
--       all already exist in supabase-schema-v2.sql

-- Index for fast enrichment lookups
CREATE INDEX IF NOT EXISTS scraper_leads_enriched_idx ON scraper_leads(enriched_at)
  WHERE enriched_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS scraper_leads_county_idx ON scraper_leads(county);

-- ─── Lead Enrichments table ────────────────────────────────────────────────────
-- Stores raw enrichment results per lead per source (one row per lead+source pair)

CREATE TABLE IF NOT EXISTS lead_enrichments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES scraper_leads(id) ON DELETE CASCADE,
  source       text NOT NULL,          -- e.g. 'miami-dade-pa'
  fields_added text[],                 -- list of field names that were populated
  raw          jsonb,                  -- full raw API response
  enriched_at  timestamptz DEFAULT now(),
  UNIQUE(lead_id, source)
);

CREATE INDEX IF NOT EXISTS lead_enrichments_lead_id_idx ON lead_enrichments(lead_id);

-- RLS: authenticated users can read/write their own enrichments
ALTER TABLE lead_enrichments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lead_enrichments' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON lead_enrichments
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ─── Lead Saved Searches table ─────────────────────────────────────────────────
-- Stores saved filter presets per user

CREATE TABLE IF NOT EXISTS lead_saved_searches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  emoji      text DEFAULT '🔍',
  filters    jsonb NOT NULL DEFAULT '{}',
  owner      text NOT NULL,           -- user email
  is_shared  boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_saved_searches_owner_idx ON lead_saved_searches(owner);

ALTER TABLE lead_saved_searches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lead_saved_searches' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON lead_saved_searches
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;
