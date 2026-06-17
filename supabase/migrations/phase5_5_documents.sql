-- ─── Phase 5.5 — Document Service Architecture ────────────────────────────────
--
-- Goals:
--   1. Unify document_templates + contract_templates into one table
--   2. Enhance documents table with lifecycle, signing link, AI/OCR fields
--   3. Link signing_sessions back to their source document
--   4. Create merge_field_definitions registry (replaces hard-coded buildAutoFill)
--   5. Expand status + action enums
--
-- Permanent rule: idempotent (IF NOT EXISTS / IF EXISTS everywhere).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Unify document_templates ───────────────────────────────────────────────
-- Add PDF-template columns alongside existing text-template columns.
-- template_type: 'text' ({{variable}} content) | 'pdf' (uploaded PDF with field overlays)

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS template_type  text    NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS file_key       text,              -- Supabase storage path for PDF
  ADD COLUMN IF NOT EXISTS file_name      text,
  ADD COLUMN IF NOT EXISTS file_size      bigint,
  ADD COLUMN IF NOT EXISTS page_count     smallint,
  ADD COLUMN IF NOT EXISTS field_mappings jsonb,             -- [{id,type,page,x,y,w,h,signer_id,required,label}]
  ADD COLUMN IF NOT EXISTS thumbnail_key  text;

-- Migrate existing contract_templates rows into document_templates as type='pdf'
INSERT INTO document_templates (
  name, category, description, template_type,
  file_key, file_name, page_count, field_mappings,
  is_active, is_builtin,
  created_by, created_at, updated_at,
  content, variables
)
SELECT
  ct.name,
  ct.category,
  ct.description,
  'pdf'                   AS template_type,
  ct.file_path            AS file_key,
  ct.name || '.pdf'       AS file_name,
  ct.page_count,
  ct.field_mappings,
  true                    AS is_active,
  false                   AS is_builtin,
  ct.user_id              AS created_by,
  ct.created_at,
  ct.updated_at,
  ''                      AS content,   -- text templates only
  '[]'::jsonb             AS variables
FROM contract_templates ct
WHERE NOT EXISTS (
  SELECT 1 FROM document_templates dt
  WHERE dt.name = ct.name AND dt.template_type = 'pdf'
);

-- ── 2. Enhance documents table ────────────────────────────────────────────────

-- Drop old status constraint so we can expand it
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;

-- Add new columns
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS document_type      text       NOT NULL DEFAULT 'generated',
  -- 'generated' (from template) | 'uploaded' (raw file) | 'received' (inbound)
  ADD COLUMN IF NOT EXISTS signing_session_id uuid       REFERENCES signing_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version            integer    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_executed        boolean    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS executed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_status         text       NOT NULL DEFAULT 'none',
  -- 'none' | 'pending' | 'processing' | 'complete' | 'failed'
  ADD COLUMN IF NOT EXISTS ocr_text           text,
  ADD COLUMN IF NOT EXISTS ai_summary         text,
  ADD COLUMN IF NOT EXISTS ai_extracted       jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at         timestamptz;

-- Re-apply status constraint with expanded values
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check CHECK (status IN (
    'draft',
    'generated',
    'signed_by_me',
    'pending_signature',   -- NEW: sent to signers, waiting
    'partially_signed',    -- NEW: some signers done
    'sent',
    'viewed',
    'fully_signed',        -- NEW: all signers complete (was 'signed' in old sessions)
    'accepted',
    'rejected',
    'executed',            -- NEW: fully signed + countersigned + dated
    'expired',
    'cancelled',
    'voided',              -- NEW: voided signing
    'archived'
  ));

-- Backfill document_type for existing rows
UPDATE documents SET document_type = 'uploaded'  WHERE file_path  IS NOT NULL AND pdf_path IS NULL AND document_type = 'generated';
UPDATE documents SET document_type = 'generated' WHERE template_id IS NOT NULL AND document_type = 'generated';

-- ── 3. Link signing_sessions → documents ─────────────────────────────────────
-- When a signing session is created FROM a document, store the reverse pointer.

ALTER TABLE signing_sessions
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signing_sessions_document ON signing_sessions(document_id) WHERE document_id IS NOT NULL;

-- ── 4. Expand document_activity actions ───────────────────────────────────────

ALTER TABLE document_activity DROP CONSTRAINT IF EXISTS document_activity_action_check;
ALTER TABLE document_activity
  ADD CONSTRAINT document_activity_action_check CHECK (action IN (
    'created',
    'generated',
    'uploaded',
    'signed',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'version_saved',
    'signature_requested',   -- NEW
    'signature_viewed',      -- NEW
    'signature_signed',      -- NEW
    'signature_declined',    -- NEW
    'fully_signed',          -- NEW
    'executed',              -- NEW
    'voided',                -- NEW
    'status_changed',        -- NEW
    'downloaded',            -- NEW
    'shared'                 -- NEW
  ));

-- ── 5. Merge field definitions registry ───────────────────────────────────────
-- Central registry mapping template {{variables}} to DB source columns.
-- Replaces the hard-coded buildAutoFill() in lib/documents/template-utils.ts.

CREATE TABLE IF NOT EXISTS merge_field_definitions (
  id            uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key     text      UNIQUE NOT NULL,      -- matches {{field_key}} in templates
  label         text      NOT NULL,              -- human-readable name
  category      text      NOT NULL DEFAULT 'other',
  -- 'buyer' | 'seller' | 'property' | 'deal' | 'dates' | 'financial' | 'broker' | 'title' | 'other'
  source_table  text,                            -- DB table (null = manual entry)
  source_column text,                            -- DB column (null = computed)
  data_type     text      NOT NULL DEFAULT 'text',
  -- 'text' | 'number' | 'currency' | 'date' | 'boolean'
  description   text,
  is_auto_fill  boolean   NOT NULL DEFAULT true, -- false = user must enter manually
  sort_order    smallint  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

-- Seed standard merge fields (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO merge_field_definitions
  (field_key, label, category, source_table, source_column, data_type, is_auto_fill, sort_order)
VALUES
  -- Buyer / Company
  ('buyer_name',        'Buyer Name',          'buyer',    'contract_settings', 'buyer_name',          'text',     true,  10),
  ('company_name',      'Company Name',        'buyer',    'contract_settings', 'company_name',        'text',     true,  11),
  ('entity_name',       'Entity / LLC Name',   'buyer',    'contract_settings', 'entity_name',         'text',     true,  12),
  ('my_name',           'Your Full Name',      'buyer',    'user_profiles',     'my_name',             'text',     true,  13),
  ('my_email',          'Your Email',          'buyer',    'user_profiles',     'my_email',            'text',     true,  14),
  ('my_phone',          'Your Phone',          'buyer',    'user_profiles',     'my_phone',            'text',     true,  15),
  -- Property
  ('property_address',  'Property Address',    'property', 'properties',        'property_address',    'text',     true,  20),
  ('city',              'City',                'property', 'properties',        'city',                'text',     true,  21),
  ('state',             'State',               'property', 'properties',        'state',               'text',     true,  22),
  ('zip',               'Zip Code',            'property', 'properties',        'zip',                 'text',     true,  23),
  ('county',            'County',              'property', 'properties',        'county',              'text',     true,  24),
  ('folio_number',      'Folio / APN',         'property', 'properties',        'folio_number',        'text',     true,  25),
  ('legal_description', 'Legal Description',   'property', 'properties',        'legal_description',   'text',     true,  26),
  ('property_type',     'Property Type',       'property', 'properties',        'property_type',       'text',     true,  27),
  -- Seller
  ('owner_name',        'Seller / Owner Name', 'seller',   'properties',        'owner_name',          'text',     true,  30),
  ('seller_address',    'Seller Mailing Addr', 'seller',   'properties',        'mailing_address',     'text',     true,  31),
  -- Deal / Financial
  ('offer_amount',      'Purchase Price',      'deal',     null,                null,                  'currency', false, 40),
  ('earnest_money',     'Earnest Money',       'deal',     'contract_settings', 'earnest_money_amount','currency', true,  41),
  ('closing_days',      'Closing Days',        'deal',     'contract_settings', 'closing_days',        'number',   true,  42),
  ('inspection_days',   'Inspection Days',     'deal',     'contract_settings', 'inspection_days',     'number',   true,  43),
  ('acceptance_days',   'Acceptance Days',     'deal',     'contract_settings', 'acceptance_days',     'number',   true,  44),
  ('market_value',      'Market Value',        'deal',     'properties',        'market_value',        'currency', true,  45),
  -- Dates
  ('today',             'Today''s Date',       'dates',    null,                null,                  'date',     true,  50),
  ('contract_date',     'Contract Date',       'dates',    null,                null,                  'date',     false, 51),
  ('closing_date',      'Closing Date',        'dates',    null,                null,                  'date',     false, 52),
  ('expiration_date',   'Expiration Date',     'dates',    null,                null,                  'date',     false, 53),
  -- Broker
  ('broker_name',       'Broker Name',         'broker',   'contract_settings', 'broker_name',         'text',     true,  60),
  ('broker_license',    'Broker License',      'broker',   'contract_settings', 'broker_license',      'text',     true,  61),
  ('license_number',    'Agent License #',     'broker',   'contract_settings', 'license_number',      'text',     true,  62),
  -- Title Company
  ('title_company',     'Title Company Name',  'title',    'title_companies',   'company_name',        'text',     true,  70),
  ('title_contact',     'Title Contact',       'title',    'title_companies',   'contact_name',        'text',     true,  71),
  ('title_email',       'Title Email',         'title',    'title_companies',   'email',               'text',     true,  72),
  ('title_phone',       'Title Phone',         'title',    'title_companies',   'phone',               'text',     true,  73),
  ('title_address',     'Title Address',       'title',    'title_companies',   'address',             'text',     true,  74),
  -- Closing Location
  ('closing_location',  'Closing Location',    'other',    'contract_settings', 'closing_location',    'text',     true,  80),
  ('escrow_instructions','Escrow Instructions','other',    'contract_settings', 'escrow_instructions', 'text',     true,  81)
ON CONFLICT (field_key) DO NOTHING;

-- ── 6. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_documents_signing_session ON documents(signing_session_id) WHERE signing_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_deleted         ON documents(deleted_at)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_status          ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_property        ON documents(property_id)        WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_templates_type        ON document_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_merge_fields_category     ON merge_field_definitions(category, sort_order);
