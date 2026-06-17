-- ─── email_templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  category    text NOT NULL DEFAULT 'general',
  subject     text NOT NULL,
  body        text NOT NULL,
  is_builtin  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON email_templates;
CREATE POLICY "auth_full" ON email_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add is_builtin in case table was created before this column existed
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS is_builtin boolean NOT NULL DEFAULT false;

-- ─── Extra columns on communications ────────────────────────────────────────
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS tags              text[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes             text,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS gmail_message_id  text,
  ADD COLUMN IF NOT EXISTS thread_id         text;

CREATE INDEX IF NOT EXISTS idx_comms_gmail_msg ON communications(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_comms_thread    ON communications(thread_id);

-- ─── Seed built-in email templates ──────────────────────────────────────────
INSERT INTO email_templates (name, category, subject, body) VALUES

(
  'Cash Offer Follow-Up',
  'follow_up',
  'Re: Cash Offer for {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I wanted to follow up on the all-cash offer I submitted for {{property_address}}. My offer of <strong>{{offer_amount}}</strong> remains open and I can close on <strong>your timeline</strong>.</p><p>If you have any questions or would like to negotiate, please reply — I am flexible and motivated to make this work for you.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>'
),
(
  'Initial Seller Outreach',
  'outreach',
  'Interested in Purchasing Your Property at {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>My name is {{my_name}} and I am a real estate investor in your area. I noticed your property at {{property_address}} and would love to discuss a potential purchase.</p><p>I buy homes for <strong>cash</strong>, close quickly, and purchase in <strong>AS-IS condition</strong> — no repairs or clean-up needed.</p><p>Would you be open to a brief conversation? There is absolutely no obligation.</p><p>Best,<br>{{my_name}}<br>{{company_name}}<br>{{my_phone}}</p>'
),
(
  'Offer Expiration Notice',
  'follow_up',
  'Your Offer Expires Soon — {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>This is a friendly reminder that my cash offer for {{property_address}} expires on <strong>{{expiration_date}}</strong>.</p><p>If you would like to accept, counter, or simply talk through the details, please contact me at {{my_phone}} or reply to this email.</p><p>Best,<br>{{my_name}}</p>'
),
(
  'Contract Follow-Up',
  'contract',
  'Contract Update — {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I am following up regarding the purchase contract for {{property_address}}. Please let me know if you have any questions or if there is anything needed from my end to move forward.</p><p>Looking forward to a smooth closing.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>'
),
(
  'Appointment Confirmation',
  'logistics',
  'Confirmed: Property Visit — {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I am confirming our appointment to view <strong>{{property_address}}</strong>. Please let me know if anything changes or if you need to reschedule.</p><p>Looking forward to seeing the property.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>'
),
(
  'Title Company Request',
  'closing',
  'Title Order — {{property_address}}',
  '<p>Hi,</p><p>I am requesting a title search and preliminary title report for <strong>{{property_address}}</strong>. The seller is {{seller_name}}.</p><p>Please let me know the estimated timeline and any information you need from my side.</p><p>Thank you,<br>{{my_name}}<br>{{my_phone}}</p>'
),
(
  'Attorney Follow-Up',
  'closing',
  'Re: {{property_address}} — Closing Update',
  '<p>Hi,</p><p>I wanted to follow up on the status of the closing for <strong>{{property_address}}</strong>. Please let me know if there are any outstanding items needed from my end.</p><p>Thank you,<br>{{my_name}}<br>{{my_phone}}</p>'
),
(
  'Probate Introduction',
  'outreach',
  'Interested in Purchasing Probate Property',
  '<p>Dear {{seller_name}},</p><p>My name is {{my_name}} and I specialize in working with families navigating probate and estate situations.</p><p>If the estate includes real property that needs to be sold, I can offer a straightforward, all-cash purchase with minimal disruption during what I know is a difficult time.</p><p>There is no obligation — please reach out at your convenience.</p><p>Respectfully,<br>{{my_name}}<br>{{company_name}}<br>{{my_phone}}</p>'
),
(
  'Request for Property Photos',
  'logistics',
  'Quick Request — Photos for {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>Would you mind sending over a few photos of the property at {{property_address}}? Interior and exterior shots would be very helpful as I put together my offer.</p><p>You can reply to this email with the photos attached.</p><p>Thank you,<br>{{my_name}}<br>{{my_phone}}</p>'
)

ON CONFLICT (name) DO NOTHING;
