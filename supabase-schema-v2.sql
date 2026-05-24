-- NextKey OS — Schema v2: County Records Scraper
-- Run this in your Supabase SQL Editor AFTER running supabase-schema.sql

-- ─────────────────────────────────────────────
-- SCRAPER RUNS — log each automated pull
-- ─────────────────────────────────────────────
create table if not exists scraper_runs (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz default now(),
  triggered_by    text default 'cron',      -- 'cron' or 'manual'
  status          text default 'running',   -- running / completed / failed
  completed_at    timestamptz,
  miami_dade_new  integer default 0,
  miami_dade_skip integer default 0,
  miami_dade_err  integer default 0,
  broward_new     integer default 0,
  broward_skip    integer default 0,
  broward_err     integer default 0,
  palm_beach_new  integer default 0,
  palm_beach_skip integer default 0,
  palm_beach_err  integer default 0,
  total_new       integer default 0,
  total_skipped   integer default 0,
  total_errors    integer default 0,
  error_log       jsonb default '[]',
  skip_log        jsonb default '[]',
  notes           text
);

-- ─────────────────────────────────────────────
-- SCRAPER LEADS — staging table before import to contacts
-- ─────────────────────────────────────────────
create table if not exists scraper_leads (
  id                  uuid primary key default uuid_generate_v4(),
  created_at          timestamptz default now(),
  scraper_run_id      uuid references scraper_runs(id) on delete set null,
  imported_to_contact uuid references contacts(id) on delete set null,

  -- Status
  status              text default 'pending',  -- pending / imported / skipped / error
  skip_reason         text,

  -- County
  county              text not null,   -- miami-dade / broward / palm-beach

  -- Foreclosure Data (from clerk)
  case_number         text,
  file_date           date,
  plaintiff           text,
  mortgagor           text,
  foreclosure_amount  numeric,
  lender_name         text,
  mortgage_date       date,
  foreclosure_type    text,   -- P = Pre-foreclosure / A = Auction
  auction_date        date,
  auction_amount      numeric,
  multiple_liens      boolean default false,

  -- Property Data (from property appraiser)
  folio_number        text unique,
  owner_name          text,
  property_address    text,
  city                text,
  state               text default 'FL',
  zip                 text,
  beds                numeric,
  baths               numeric,
  pool                boolean,
  waterfront          boolean,
  gross_area          numeric,
  living_area         numeric,
  stories             numeric,
  lot_size            numeric,
  zoning              text,
  subdivision_name    text,
  legal_description   text,
  property_type       text,
  year_built          integer,
  homestead           boolean default false,
  vacant              boolean default false,
  last_sale_date      date,
  sold_price          numeric,
  assessed_value      numeric,
  land_value          numeric,
  build_value         numeric,
  tax_value           numeric,

  -- Valuation (calculated)
  market_value        numeric,
  active_value        numeric,
  price_per_sqft      numeric,

  -- Equity Analysis (calculated)
  known_debt          numeric,
  equity_percentage   numeric,
  equity_dollar_amount numeric,
  equity_tier         text,   -- High / Medium / Low / None

  -- Entity Detection
  entity_type         text,   -- Individual / LLC / Corporation / Trust / Investment Company

  -- Violation Data (optional, from building dept)
  violation_case_number text,
  violation_type      text,
  violation_open_date date,
  violation_description text,
  violation_status    text,

  -- Phone fields (manual entry)
  phone_1             text,
  phone_2             text,
  phone_3             text,
  phone_4             text,
  phone_5             text
);

-- ─────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────
alter table scraper_runs  enable row level security;
alter table scraper_leads enable row level security;

create policy "auth users full access" on scraper_runs
  for all using (auth.role() = 'authenticated');

create policy "auth users full access" on scraper_leads
  for all using (auth.role() = 'authenticated');

-- Service role bypasses RLS — needed for webhook/cron imports
-- (Already handled by using service role key in scraper API routes)

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index if not exists scraper_leads_county_idx    on scraper_leads(county);
create index if not exists scraper_leads_status_idx    on scraper_leads(status);
create index if not exists scraper_leads_folio_idx     on scraper_leads(folio_number);
create index if not exists scraper_leads_case_idx      on scraper_leads(case_number);
create index if not exists scraper_leads_run_idx       on scraper_leads(scraper_run_id);
create index if not exists scraper_leads_equity_idx    on scraper_leads(equity_tier);
create index if not exists scraper_runs_status_idx     on scraper_runs(status);
