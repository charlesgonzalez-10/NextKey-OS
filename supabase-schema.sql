-- NextKey OS — Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────────
create table if not exists contacts (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz default now(),
  name        text not null,
  phone       text,
  email       text,
  address     text,
  category    text default 'Seller',
  status      text default 'Active',
  tags        text[] default '{}',
  notes       text,
  source      text default 'Manual'
);

-- ─────────────────────────────────────────────
-- DEALS
-- ─────────────────────────────────────────────
create table if not exists deals (
  id             uuid primary key default uuid_generate_v4(),
  created_at     timestamptz default now(),
  address        text not null,
  contact_id     uuid references contacts(id) on delete set null,
  status         text default 'Lead',
  arv            numeric,
  repair_cost    numeric,
  closing_cost   numeric,
  desired_profit numeric,
  offer_price    numeric,
  notes          text,
  source         text default 'Manual'
);

-- ─────────────────────────────────────────────
-- ACTIVITIES
-- ─────────────────────────────────────────────
create table if not exists activities (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz default now(),
  contact_id  uuid references contacts(id) on delete cascade,
  deal_id     uuid references deals(id) on delete cascade,
  type        text default 'note',  -- call, text, email, meeting, note, offer, follow_up, other
  notes       text
);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
-- Enable RLS on all tables
alter table contacts  enable row level security;
alter table deals     enable row level security;
alter table activities enable row level security;

-- Authenticated users can do everything
create policy "auth users full access" on contacts
  for all using (auth.role() = 'authenticated');

create policy "auth users full access" on deals
  for all using (auth.role() = 'authenticated');

create policy "auth users full access" on activities
  for all using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index if not exists contacts_phone_idx on contacts(phone);
create index if not exists contacts_category_idx on contacts(category);
create index if not exists deals_contact_id_idx on deals(contact_id);
create index if not exists deals_status_idx on deals(status);
create index if not exists activities_contact_id_idx on activities(contact_id);
