-- ─── Lead Workspace Extensions ────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

ALTER TABLE scraper_leads
  ADD COLUMN IF NOT EXISTS pipeline_stage text
    CHECK (pipeline_stage IN ('reviewing', 'contacted', 'offer', 'dead')),
  ADD COLUMN IF NOT EXISTS starred        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_score     smallint;

-- AI-generated property analysis (one per lead, upserted on generate)
CREATE TABLE IF NOT EXISTS lead_ai_summaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        uuid NOT NULL REFERENCES scraper_leads(id) ON DELETE CASCADE,
  model          text NOT NULL DEFAULT 'claude-haiku-4-5',
  distress_score smallint,
  motivation     text,
  strategy       text,
  urgency        text,
  lead_quality   smallint,
  summary        text,
  highlights     text[],
  created_at     timestamptz DEFAULT now(),
  UNIQUE(lead_id)
);

-- Comp cache — populated from Rentcast or manual entry
CREATE TABLE IF NOT EXISTS lead_comps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES scraper_leads(id) ON DELETE CASCADE,
  address         text NOT NULL,
  sale_price      bigint,
  list_price      bigint,
  status          text,
  beds            smallint,
  baths           numeric(4,1),
  sqft            int,
  year_built      smallint,
  distance_miles  numeric(4,2),
  price_per_sqft  numeric(8,2),
  sale_date       date,
  source          text DEFAULT 'rentcast',
  fetched_at      timestamptz DEFAULT now(),
  raw             jsonb
);
CREATE INDEX IF NOT EXISTS lead_comps_lead_id ON lead_comps(lead_id);

-- Operator notes (pre-import, before a contact is created)
CREATE TABLE IF NOT EXISTS lead_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid NOT NULL REFERENCES scraper_leads(id) ON DELETE CASCADE,
  author     text,
  body       text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead_id ON lead_notes(lead_id);
