-- communications: provider-agnostic email/sms/call records
CREATE TABLE IF NOT EXISTS communications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                text NOT NULL CHECK (type IN ('email','sms','call','note','contract','task')),
  provider            text NOT NULL DEFAULT 'manual' CHECK (provider IN ('gmail','twilio','manual','other')),
  provider_message_id text,
  thread_id           text,
  direction           text CHECK (direction IN ('inbound','outbound')),
  subject             text,
  body_preview        text,
  body_full           text,
  from_email          text,
  to_email            text,
  cc                  text,
  bcc                 text,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  property_id         uuid REFERENCES properties(id) ON DELETE SET NULL,
  lead_id             uuid REFERENCES leads(id) ON DELETE SET NULL,
  deal_id             uuid REFERENCES deals(id) ON DELETE SET NULL,
  attachment_urls     jsonb DEFAULT '[]',
  status              text DEFAULT 'sent' CHECK (status IN (
    'draft','sent','delivered','failed','read',
    'countered','accepted','rejected','expired','dead'
  )),
  sent_at             timestamptz,
  received_at         timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_contact  ON communications(contact_id);
CREATE INDEX IF NOT EXISTS idx_comm_lead     ON communications(lead_id);
CREATE INDEX IF NOT EXISTS idx_comm_deal     ON communications(deal_id);
CREATE INDEX IF NOT EXISTS idx_comm_provider ON communications(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_comm_thread   ON communications(thread_id);
CREATE INDEX IF NOT EXISTS idx_comm_created  ON communications(created_at DESC);

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full" ON communications;
CREATE POLICY "authenticated_full" ON communications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- oauth_tokens: encrypted OAuth tokens, server-side only
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  email         text,
  scope         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can touch oauth_tokens (never exposed to frontend)
DROP POLICY IF EXISTS "service_only" ON oauth_tokens;
CREATE POLICY "service_only" ON oauth_tokens FOR ALL USING (false);

-- email_templates
CREATE TABLE IF NOT EXISTS email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  variables  jsonb DEFAULT '[]',
  category   text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full" ON email_templates;
CREATE POLICY "authenticated_full" ON email_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default templates
INSERT INTO email_templates (name, subject, body, category, variables) VALUES
(
  'Initial Outreach',
  'Quick Question About Your Property at {{property_address}}',
  'Hi {{contact_name}},

My name is {{my_name}} with {{company_name}}. I came across your property at {{property_address}} and wanted to reach out.

If you''re open to discussing options for your property, I''d love to schedule a quick call at your convenience.

Best regards,
{{my_name}}
{{company_name}}',
  'outreach',
  '["contact_name","property_address","my_name","company_name"]'
),
(
  'Cash Offer Submission',
  'Cash Offer for {{property_address}}',
  'Hi {{contact_name}},

Thank you for taking the time to speak with me. As discussed, here is our cash offer for the property at {{property_address}}:

Offer Amount: {{offer_amount}}
Proposed Closing Date: {{closing_date}}

This is an as-is, all-cash offer with no financing contingencies. Please review the attached contract and don''t hesitate to call or reply if you have any questions.

Best regards,
{{my_name}}
{{company_name}}',
  'offer',
  '["contact_name","property_address","offer_amount","closing_date","my_name","company_name"]'
),
(
  'Follow-Up',
  'Following Up — {{property_address}}',
  'Hi {{contact_name}},

I wanted to follow up on our previous conversation regarding {{property_address}}.

Are you still open to discussing options? I''m happy to answer any questions or adjust terms.

Best regards,
{{my_name}}
{{company_name}}',
  'follow_up',
  '["contact_name","property_address","my_name","company_name"]'
)
ON CONFLICT DO NOTHING;
