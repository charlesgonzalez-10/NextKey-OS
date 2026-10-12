-- Deal Scrubber: batches of Broward pre-foreclosures scrubbed every other Saturday.
-- Only the service role reads or writes these tables (RLS on, no policies).

create table if not exists deal_scrub_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  window_from  date not null,
  window_to    date not null,
  status       text not null default 'running' check (status in ('running','completed','partial','failed')),
  filters      jsonb,
  summary      jsonb
);
create index if not exists deal_scrub_runs_status_window on deal_scrub_runs (status, window_to desc);

create table if not exists deal_scrub_items (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references deal_scrub_runs(id) on delete cascade,
  property_id           uuid,
  folio_number          text not null unique,
  address               text,
  city                  text,
  zip                   text,
  owner_name            text,
  mail_address          jsonb,
  property_type         text,
  units                 integer,
  beds                  numeric,
  baths                 numeric,
  living_area           numeric,
  year_built            integer,
  foreclosure_status    text check (foreclosure_status in ('active','closed','unknown')),
  case_number           text,
  lender_name           text,
  recording_date        text,
  default_amount        text,
  judgment_amount       text,
  document_type         text,
  foreclosure_history   jsonb,
  open_mortgage_balance numeric,
  estimated_value       numeric,
  value_basis           text,
  equity_fraction       numeric,
  comps                 jsonb,
  status                text not null default 'ready_for_review'
                        check (status in ('ready_for_review','archived_closed','qualified','disqualified','called')),
  agent_notes           text,
  created_at            timestamptz not null default now()
);
create index if not exists deal_scrub_items_run on deal_scrub_items (run_id);

alter table deal_scrub_runs  enable row level security;
alter table deal_scrub_items enable row level security;
