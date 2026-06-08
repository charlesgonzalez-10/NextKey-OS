-- ═══════════════════════════════════════════════════════════════════════════════
-- NextKey OS — Unified Property Architecture Migration
-- Run this ONCE in the Supabase SQL Editor.
-- Safe to re-run: all operations use IF NOT EXISTS / DO blocks.
--
-- What this does:
--   1. Renames scraper_leads → properties  (same data, same UUIDs)
--   2. Adds new columns to properties
--   3. Creates leads table (relationship: "properties I choose to pursue")
--   4. Seeds leads from existing properties (all records become leads)
--   5. Drops lead-workflow columns from properties (they live in leads now)
--   6. Updates deals + contacts to reference properties
--   7. Creates property_search view (properties LEFT JOIN leads)
--   8. Adds proper indexes and RLS
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── STEP 1: Rename scraper_leads → properties ───────────────────────────────
-- Postgres automatically updates all FK constraints that reference this table.
-- Child tables (lead_enrichments, lead_ai_summaries, lead_comps, lead_notes)
-- will still work — their lead_id column now references properties(id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'scraper_leads'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'properties'
  ) THEN
    ALTER TABLE scraper_leads RENAME TO properties;
    RAISE NOTICE 'Renamed scraper_leads → properties';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'properties'
  ) THEN
    RAISE NOTICE 'properties table already exists — skipping rename';
  END IF;
END $$;


-- ─── STEP 2: Add new columns to properties ───────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS source             text    DEFAULT 'scraper',
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS absentee_owner     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pre_foreclosure boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_foreclosure     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_auction         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reo             boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_tax_lien        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_clear         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS high_equity        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_rent     numeric,
  ADD COLUMN IF NOT EXISTS latitude           numeric,
  ADD COLUMN IF NOT EXISTS longitude          numeric,
  ADD COLUMN IF NOT EXISTS raw_pa             jsonb,
  ADD COLUMN IF NOT EXISTS raw_reapi          jsonb;


-- ─── STEP 3: Backfill new columns from existing data ─────────────────────────
UPDATE properties SET
  source = CASE
    WHEN data_source ILIKE '%csv%'
      OR data_source ILIKE '%reifax%'
      OR data_source ILIKE '%propstream%' THEN 'csv_import'
    ELSE 'scraper'
  END,
  is_pre_foreclosure = (foreclosure_type = 'P' OR (foreclosure_type IS NOT NULL AND foreclosure_type != 'A')),
  is_auction         = (foreclosure_type = 'A'),
  absentee_owner     = (homestead = false)
WHERE source IS NULL OR source = '';


-- ─── STEP 4: Rename indexes (old scraper_leads_* → properties_*) ─────────────
DO $$
DECLARE
  pairs TEXT[][] := ARRAY[
    ARRAY['scraper_leads_county_idx',   'properties_county_idx'],
    ARRAY['scraper_leads_status_idx',   'properties_status_idx'],
    ARRAY['scraper_leads_folio_idx',    'properties_folio_idx'],
    ARRAY['scraper_leads_case_idx',     'properties_case_idx'],
    ARRAY['scraper_leads_run_idx',      'properties_run_idx'],
    ARRAY['scraper_leads_equity_idx',   'properties_equity_idx'],
    ARRAY['scraper_leads_enriched_idx', 'properties_enriched_idx']
  ];
  pair TEXT[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = pair[1]) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', pair[1], pair[2]);
      RAISE NOTICE 'Renamed index % → %', pair[1], pair[2];
    END IF;
  END LOOP;
END $$;


-- ─── STEP 5: Add new indexes on properties ───────────────────────────────────
CREATE INDEX IF NOT EXISTS properties_source_idx     ON properties(source);
CREATE INDEX IF NOT EXISTS properties_address_idx    ON properties(property_address);
CREATE INDEX IF NOT EXISTS properties_city_idx       ON properties(city);
CREATE INDEX IF NOT EXISTS properties_zip_idx        ON properties(zip);
CREATE INDEX IF NOT EXISTS properties_owner_idx      ON properties(owner_name);
CREATE INDEX IF NOT EXISTS properties_file_date_idx  ON properties(file_date);
CREATE INDEX IF NOT EXISTS properties_county_idx2    ON properties(county);


-- ─── STEP 6: Create leads table ──────────────────────────────────────────────
-- This is a RELATIONSHIP table.
-- A lead = a property that Charles has chosen to actively pursue.
-- Properties live independently — leads are the "I want to work this" flag.
-- One lead per property (enforced by UNIQUE constraint).
CREATE TABLE IF NOT EXISTS leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),

  -- The property being pursued
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Workflow
  status         text DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'contacted', 'offer', 'dead')),
  pipeline_stage text
    CHECK (pipeline_stage IN ('reviewing', 'contacted', 'offer', 'dead')),
  priority       text DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  starred        boolean DEFAULT false,

  -- Scoring
  lead_score smallint,
  ai_score   smallint,

  -- Source: how this became a lead
  source text,  -- 'scraper' | 'csv_import' | 'manual' | 'reapi'
  tags   text[] DEFAULT '{}',

  -- Legacy: link to contact (from "Add to Pipeline" flow)
  imported_to_contact uuid REFERENCES contacts(id) ON DELETE SET NULL,

  -- Enforce one lead per property
  UNIQUE (property_id)
);


-- ─── STEP 7: Seed leads — basic fields (always safe) ─────────────────────────
INSERT INTO leads (
  property_id,
  status,
  source,
  created_at
)
SELECT
  id AS property_id,
  CASE
    WHEN status = 'imported' THEN 'reviewing'
    WHEN status = 'pending'  THEN 'new'
    ELSE                          'new'
  END AS status,
  CASE
    WHEN data_source ILIKE '%csv%'
      OR data_source ILIKE '%reifax%'
      OR data_source ILIKE '%propstream%' THEN 'csv_import'
    ELSE 'scraper'
  END AS source,
  created_at
FROM properties
ON CONFLICT (property_id) DO NOTHING;


-- ─── STEP 7B: Copy lead-workflow values from properties → leads ───────────────
-- These columns may or may not exist on properties depending on which
-- prior migrations ran. We check each one before updating.
DO $$
BEGIN
  -- pipeline_stage
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'properties'
      AND column_name = 'pipeline_stage'
  ) THEN
    UPDATE leads l
    SET pipeline_stage = p.pipeline_stage
    FROM properties p
    WHERE l.property_id = p.id AND p.pipeline_stage IS NOT NULL;
    RAISE NOTICE 'Copied pipeline_stage → leads';
  END IF;

  -- starred
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'properties'
      AND column_name = 'starred'
  ) THEN
    UPDATE leads l
    SET starred = COALESCE(p.starred, false)
    FROM properties p
    WHERE l.property_id = p.id;
    RAISE NOTICE 'Copied starred → leads';
  END IF;

  -- lead_score
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'properties'
      AND column_name = 'lead_score'
  ) THEN
    UPDATE leads l
    SET lead_score = p.lead_score
    FROM properties p
    WHERE l.property_id = p.id AND p.lead_score IS NOT NULL;
    RAISE NOTICE 'Copied lead_score → leads';
  END IF;

  -- ai_score
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'properties'
      AND column_name = 'ai_score'
  ) THEN
    UPDATE leads l
    SET ai_score = p.ai_score
    FROM properties p
    WHERE l.property_id = p.id AND p.ai_score IS NOT NULL;
    RAISE NOTICE 'Copied ai_score → leads';
  END IF;

  -- imported_to_contact
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'properties'
      AND column_name = 'imported_to_contact'
  ) THEN
    UPDATE leads l
    SET imported_to_contact = p.imported_to_contact
    FROM properties p
    WHERE l.property_id = p.id AND p.imported_to_contact IS NOT NULL;
    RAISE NOTICE 'Copied imported_to_contact → leads';
  END IF;
END $$;


-- ─── STEP 7C: Drop lead-workflow columns from properties ──────────────────────
-- These columns now live in the leads table.
-- Dropping them keeps properties clean and prevents conflicts in the view.
ALTER TABLE properties
  DROP COLUMN IF EXISTS pipeline_stage,
  DROP COLUMN IF EXISTS starred,
  DROP COLUMN IF EXISTS lead_score,
  DROP COLUMN IF EXISTS ai_score,
  DROP COLUMN IF EXISTS imported_to_contact;


-- ─── STEP 8: Indexes and RLS on leads ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS leads_property_id_idx ON leads(property_id);
CREATE INDEX IF NOT EXISTS leads_status_idx      ON leads(status);
CREATE INDEX IF NOT EXISTS leads_starred_idx     ON leads(starred);
CREATE INDEX IF NOT EXISTS leads_pipeline_idx    ON leads(pipeline_stage);
CREATE INDEX IF NOT EXISTS leads_created_at_idx  ON leads(created_at);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'leads' AND policyname = 'auth users full access'
  ) THEN
    CREATE POLICY "auth users full access" ON leads
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;


-- ─── STEP 9: Update deals table ──────────────────────────────────────────────
-- Deals now link directly to properties + optionally to a lead.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id     uuid REFERENCES leads(id)      ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS deals_property_id_idx ON deals(property_id);
CREATE INDEX IF NOT EXISTS deals_lead_id_idx     ON deals(lead_id);


-- ─── STEP 10: Update contacts table ──────────────────────────────────────────
-- Contacts are people — but they can be linked to a property.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_property_id_idx ON contacts(property_id);


-- ─── STEP 11: Convenience view ───────────────────────────────────────────────
-- property_search: properties LEFT JOIN leads — everything in one row.
-- Used by fetchDistressData() in property-search.ts and the main search API.
-- NOTE: p.* is safe here because Step 7C dropped the conflicting lead-workflow
-- columns (pipeline_stage, starred, lead_score, ai_score, imported_to_contact)
-- from properties — they now come exclusively from the leads table.
CREATE OR REPLACE VIEW property_search AS
SELECT
  p.*,
  l.id              AS lead_id,
  l.status          AS lead_status,
  l.pipeline_stage,
  l.starred,
  l.lead_score,
  l.ai_score,
  l.source          AS lead_source,
  l.imported_to_contact,
  (l.id IS NOT NULL) AS is_lead
FROM properties p
LEFT JOIN leads l ON l.property_id = p.id;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration complete.
--
-- Summary of what changed:
--   • scraper_leads → properties  (all records, same UUIDs, no data lost)
--   • leads table created + seeded (all existing records become leads)
--   • pipeline_stage, starred, lead_score, ai_score, imported_to_contact
--     moved from properties → leads (clean separation of concerns)
--   • property_search view (properties LEFT JOIN leads)
--   • deals.property_id + deals.lead_id added
--   • contacts.property_id added
--   • All child tables still work (lead_enrichments, lead_ai_summaries,
--     lead_comps, lead_notes — their lead_id FK now points to properties)
-- ═══════════════════════════════════════════════════════════════════════════════
