-- ─── Contract Settings (one row per user) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Company Defaults
  company_name     text,
  entity_name      text,
  mailing_address  text,
  phone            text,
  email            text,
  website          text,
  broker_name      text,
  broker_license   text,
  license_number   text,
  -- Transaction Defaults
  buyer_name            text,
  acceptance_days       int  DEFAULT 3,
  inspection_days       int  DEFAULT 10,
  closing_days          int  DEFAULT 30,
  earnest_money_amount  numeric DEFAULT 1000,
  closing_location      text,
  escrow_instructions   text,
  -- Timestamps
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE contract_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cs_full" ON contract_settings;
CREATE POLICY "cs_full" ON contract_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Title Companies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS title_companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  address      text,
  notes        text,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE title_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tc_full" ON title_companies;
CREATE POLICY "tc_full" ON title_companies
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Offer Profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offer_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  buyer_name      text,
  closing_days    int,
  inspection_days int,
  earnest_money   numeric,
  default_clauses text,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE offer_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "op_full" ON offer_profiles;
CREATE POLICY "op_full" ON offer_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Seed default offer profiles for existing users ──────────────────────────
-- (Runs once via DO block, skips if already present)
-- No seed needed — users create their own profiles.
