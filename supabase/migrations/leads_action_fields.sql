-- Leads Action Fields
-- Adds communication-tracking and offer columns to the leads table.
-- Run in Supabase SQL Editor.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS call_status  text DEFAULT 'not_called'
    CHECK (call_status  IN ('not_called','called','no_answer','voicemail','wrong_number','talked')),
  ADD COLUMN IF NOT EXISTS sms_status   text DEFAULT 'not_sent'
    CHECK (sms_status   IN ('not_sent','sent','delivered','replied','opted_out')),
  ADD COLUMN IF NOT EXISTS email_status text DEFAULT 'not_sent'
    CHECK (email_status IN ('not_sent','sent','opened','replied','bounced')),
  ADD COLUMN IF NOT EXISTS offer_sent   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS offer_pct    numeric(4,1),
  ADD COLUMN IF NOT EXISTS offer_amount bigint,
  ADD COLUMN IF NOT EXISTS blocked      boolean DEFAULT false;

-- Extend pipeline_stage to allow 'blocked'
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_pipeline_stage_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_pipeline_stage_check
  CHECK (pipeline_stage IN ('reviewing','contacted','offer','dead','blocked'));

-- Indexes for common filter queries
CREATE INDEX IF NOT EXISTS leads_call_status  ON leads (call_status);
CREATE INDEX IF NOT EXISTS leads_sms_status   ON leads (sms_status);
CREATE INDEX IF NOT EXISTS leads_blocked      ON leads (blocked) WHERE blocked = true;
