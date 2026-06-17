-- ─── Signature on user_profiles ──────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS signature_data text, -- base64 PNG data URL
  ADD COLUMN IF NOT EXISTS my_name        text,
  ADD COLUMN IF NOT EXISTS my_phone       text,
  ADD COLUMN IF NOT EXISTS my_email       text,
  ADD COLUMN IF NOT EXISTS company_name   text;

-- ─── Supabase Storage bucket ──────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,
  ARRAY['application/pdf','image/png','image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
DROP POLICY IF EXISTS "documents_insert" ON storage.objects;
CREATE POLICY "documents_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents_select" ON storage.objects;
CREATE POLICY "documents_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents_delete" ON storage.objects;
CREATE POLICY "documents_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'documents');

-- ─── document_templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'other'
              CHECK (category IN ('offer','loi','assignment','contract','disclosure','letter','other')),
  description text,
  content     text NOT NULL,           -- plain text with {{variables}} and ## headings
  variables   jsonb DEFAULT '[]',      -- list of known variable names
  is_active   boolean NOT NULL DEFAULT true,
  is_builtin  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full" ON document_templates;
CREATE POLICY "authenticated_full" ON document_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── documents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  name             text NOT NULL,
  category         text NOT NULL DEFAULT 'other',
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','generated','signed_by_me','sent','fully_signed','expired','cancelled')),
  filled_data      jsonb DEFAULT '{}',       -- variable values used to generate
  pdf_path         text,                     -- Supabase storage path (unsigned)
  signed_pdf_path  text,                     -- Supabase storage path (with signature)
  -- Linked records (no FK constraints — tables may not exist yet in all environments)
  property_id      uuid,
  lead_id          uuid,
  contact_id       uuid,
  deal_id          uuid,
  -- Offer/contract tracking
  offer_amount     numeric,
  recipient_name   text,
  recipient_email  text,
  sent_at          timestamptz,
  expires_at       timestamptz,
  -- Meta
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_lead     ON documents(lead_id);
CREATE INDEX IF NOT EXISTS idx_docs_deal     ON documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_docs_property ON documents(property_id);
CREATE INDEX IF NOT EXISTS idx_docs_contact  ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_docs_status   ON documents(status);
CREATE INDEX IF NOT EXISTS idx_docs_created  ON documents(created_at DESC);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full" ON documents;
CREATE POLICY "authenticated_full" ON documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── Seed built-in templates ──────────────────────────────────────────────────
INSERT INTO document_templates (name, category, description, is_builtin, content, variables) VALUES

(
  'Cash Offer to Purchase',
  'offer',
  'All-cash investor offer for residential properties',
  true,
  E'## CASH OFFER TO PURCHASE REAL ESTATE\n\nDate: {{date}}\n\nPrepared by:\n{{my_name}}\n{{company_name}}\n{{my_email}} | {{my_phone}}\n\n---\n\n## PARTIES\n\nBUYER: {{buyer_name}}\n{{company_name}}\n\nSELLER: {{seller_name}}\n\n## SUBJECT PROPERTY\n\nProperty Address: {{property_address}}\nParcel ID: {{parcel_id}}\n\n---\n\n## PURCHASE PRICE AND TERMS\n\nPURCHASE PRICE: ${{offer_amount}}\n\nThis is an ALL CASH offer, not contingent upon financing or appraisal.\n\nEARNEST MONEY DEPOSIT: ${{earnest_money}} to be deposited within {{earnest_days}} business days of acceptance with the closing agent.\n\nCLOSING DATE: {{closing_date}}\n\nINSPECTION PERIOD: {{inspection_period}} days from acceptance, for informational purposes only. No inspection contingency.\n\n---\n\n## CONDITIONS OF OFFER\n\n1. Property shall be conveyed in AS-IS condition with no repairs required of Seller.\n\n2. Seller to provide clear, marketable title free of all liens and encumbrances, conveyed by Special or General Warranty Deed.\n\n3. Seller to provide a Seller''s Disclosure and all applicable county disclosures.\n\n4. Closing to take place through a licensed Florida title company or real estate attorney.\n\n5. Seller to remove all personal property and debris prior to closing, unless otherwise agreed in writing.\n\n6. This offer expires on {{expiration_date}} at 5:00 PM Eastern Time.\n\n7. Time is of the essence with respect to all dates and deadlines in this offer.\n\n---\n\n## BUYER SIGNATURE\n\n\n\n_______________________________________________\n{{buyer_name}}                              Date: ___________\n{{company_name}}\n{{my_phone}} | {{my_email}}\n\n\n## SELLER ACCEPTANCE\n\n\n\n_______________________________________________\n{{seller_name}}                             Date: ___________\n',
  '["date","my_name","company_name","my_email","my_phone","buyer_name","seller_name","property_address","parcel_id","offer_amount","earnest_money","earnest_days","closing_date","inspection_period","expiration_date"]'
),

(
  'Letter of Intent (LOI)',
  'loi',
  'Non-binding letter of intent to purchase',
  true,
  E'## LETTER OF INTENT TO PURCHASE\n\nDate: {{date}}\n\nTo: {{seller_name}}\nRe: {{property_address}}\n\nDear {{seller_name}},\n\nThis Letter of Intent ("LOI") is submitted by {{buyer_name}} ("Buyer") and sets forth the proposed terms under which Buyer would be willing to purchase the above-referenced property from you ("Seller").\n\nThis Letter of Intent is NON-BINDING and is intended only to outline the basic terms of a potential transaction. Neither party shall be obligated to proceed unless and until a formal, fully-executed Purchase and Sale Agreement is in place.\n\n---\n\n## PROPOSED TERMS\n\nPURCHASE PRICE: ${{offer_amount}}\n\nTERMS: All cash. No financing contingency.\n\nEARNEST MONEY: ${{earnest_money}} upon execution of formal agreement.\n\nDUE DILIGENCE PERIOD: {{inspection_period}} days from execution of formal agreement.\n\nCLOSING DATE: On or before {{closing_date}}.\n\nCONDITION: Property to be purchased in AS-IS condition.\n\n---\n\n## NEXT STEPS\n\nIf these terms are acceptable, please indicate your agreement below. Buyer will then prepare a formal Purchase and Sale Agreement within 3 business days.\n\nEither party may withdraw from this LOI at any time prior to execution of a formal Purchase and Sale Agreement without liability.\n\nWe look forward to working with you.\n\nRespectfully,\n\n\n\n_______________________________________________\n{{my_name}}\n{{company_name}}\n{{my_phone}} | {{my_email}}\nDate: {{date}}\n\n\nAGREED AND ACCEPTED:\n\n\n\n_______________________________________________\n{{seller_name}}                             Date: ___________\n',
  '["date","buyer_name","seller_name","property_address","offer_amount","earnest_money","inspection_period","closing_date","my_name","company_name","my_phone","my_email"]'
),

(
  'Assignment Agreement',
  'assignment',
  'Assigns equitable interest in a purchase contract to a new buyer',
  true,
  E'## ASSIGNMENT OF PURCHASE AGREEMENT\n\nDate: {{date}}\n\n---\n\n## PARTIES\n\nASSIGNOR: {{my_name}}, {{company_name}} ("Assignor")\n\nASSIGNEE: {{assignee_name}} ("Assignee")\n\n## SUBJECT PROPERTY\n\nProperty Address: {{property_address}}\n\nOriginal Contract Date: {{contract_date}}\nOriginal Purchase Price: ${{offer_amount}}\n\n---\n\n## TERMS OF ASSIGNMENT\n\n1. ASSIGNMENT: Assignor hereby assigns, transfers, and conveys all of Assignor''s right, title, and interest in and to the above-referenced Purchase Agreement to Assignee.\n\n2. ASSIGNMENT FEE: In consideration for this assignment, Assignee agrees to pay Assignor an Assignment Fee of ${{assignment_fee}}, to be paid at closing via wire transfer or cashier''s check.\n\n3. ASSUMPTION OF OBLIGATIONS: Assignee accepts this assignment and agrees to assume all obligations of the Assignor under the original Purchase Agreement from and after the date of this Assignment.\n\n4. CLOSING: Assignee shall close on the property on or before {{closing_date}}.\n\n5. NON-DISCLOSURE: Assignee agrees not to contact the Seller directly or disclose the terms of this Assignment without Assignor''s prior written consent.\n\n6. ENTIRE AGREEMENT: This Agreement constitutes the entire agreement between the parties and supersedes all prior negotiations and representations.\n\n---\n\n## SIGNATURES\n\n\n\nASSIGNOR:\n\n_______________________________________________\n{{my_name}}\n{{company_name}}\n{{my_phone}} | {{my_email}}\nDate: ___________\n\n\nASSIGNEE:\n\n_______________________________________________\n{{assignee_name}}\nDate: ___________\n',
  '["date","my_name","company_name","my_phone","my_email","assignee_name","property_address","contract_date","offer_amount","assignment_fee","closing_date"]'
),

(
  'Follow-Up Letter',
  'letter',
  'Follow-up letter to a seller after initial contact',
  true,
  E'## FOLLOW-UP LETTER\n\nDate: {{date}}\n\n{{seller_name}}\nRe: {{property_address}}\n\nDear {{seller_name}},\n\nI wanted to follow up on our recent conversation regarding your property at {{property_address}}.\n\nAs I mentioned, I am a real estate investor in the area and I am actively looking to purchase properties in your neighborhood. I am prepared to make a fair all-cash offer that can close on YOUR timeline.\n\nHere is what I can offer you:\n\n- All cash — no bank financing delays\n- Close in as little as 7-21 days, or on a date that works for you\n- Purchase in AS-IS condition — no repairs, no clean-up required\n- No real estate agent commissions\n- Simple, straightforward transaction\n\nI understand that selling a home is a major decision. I am happy to answer any questions you may have and there is absolutely no obligation on your part.\n\nPlease feel free to call or text me at {{my_phone}}, or reply to this letter.\n\nI look forward to hearing from you.\n\nWarm regards,\n\n\n\n_______________________________________________\n{{my_name}}\n{{company_name}}\n{{my_phone}}\n{{my_email}}\n',
  '["date","seller_name","property_address","my_name","company_name","my_phone","my_email"]'
)

ON CONFLICT DO NOTHING;
