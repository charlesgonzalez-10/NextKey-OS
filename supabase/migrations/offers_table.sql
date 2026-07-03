-- ─── Offers Table ─────────────────────────────────────────────────────────────
--
-- Canonical offer object — single source of truth for all offer terms.
-- Every contract merge field reads from here first.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS offers (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lead_id             uuid REFERENCES leads(id) ON DELETE SET NULL,
  deal_id             uuid REFERENCES deals(id) ON DELETE SET NULL,
  parent_offer_id     uuid REFERENCES offers(id) ON DELETE SET NULL,

  -- Versioning & status
  version             integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','sent','accepted','rejected','countered','expired','withdrawn')),

  -- Pricing
  purchase_price      numeric NOT NULL,
  earnest_money       numeric DEFAULT 1000,
  additional_deposit  numeric,
  seller_concessions  numeric,
  assignment_fee      numeric,

  -- Terms
  financing_type      text DEFAULT 'Cash',
  loan_amount         numeric,
  closing_days        integer DEFAULT 30,
  closing_date        date,
  inspection_days     integer DEFAULT 10,
  deposit_days        integer DEFAULT 3,
  expiration_date     date,

  -- Calculator provenance
  offer_type          text DEFAULT 'wholesale',
  base_value_type     text DEFAULT 'market',
  base_value          numeric,
  offer_pct           numeric,

  -- Notes
  notes               text,

  -- Audit
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Index for fast lookup by property
CREATE INDEX IF NOT EXISTS offers_property_id_idx ON offers (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS offers_lead_id_idx     ON offers (lead_id)     WHERE lead_id IS NOT NULL;

-- RLS
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'offers' AND policyname = 'users manage own offers'
  ) THEN
    CREATE POLICY "users manage own offers" ON offers
      FOR ALL USING (created_by = auth.uid());
  END IF;
END $$;
