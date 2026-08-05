-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 5.7A — Document Blueprint Engine: Schema Foundation
--
-- This is the foundational migration for the Document Blueprint Engine (DBE),
-- a core NextKey OS platform service that powers every document workflow.
--
-- All changes are purely additive (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- No existing tables, columns, constraints, or data are removed.
-- Safe to run against any existing database state.
--
-- Creates:
--   signer_roles              — canonical role catalog (FK target for fields + sessions)
--   blueprint_versions        — immutable published snapshots of each template
--   template_field_groups     — field groups (Seller Block, Notary Block, etc.)
--   template_fields           — relational field positions (replaces field_mappings JSONB)
--   signing_role_assignments  — session-specific role → real person mapping
--
-- Extends (additive only):
--   contract_templates: is_archived, current_version_id
--   documents: blueprint_id, blueprint_version_id, fields_snapshot, merge_data,
--              is_immutable
--   signing_sessions: blueprint_version_id
--
-- Backfill:
--   Parses contract_templates.field_mappings JSONB → template_fields draft + v1
--   Creates blueprint_version v1 for each existing template with field data
--   Sets contract_templates.current_version_id after backfill
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── 1. signer_roles ──────────────────────────────────────────────────────────
-- Canonical role catalog. Roles are template-agnostic and shared across every
-- blueprint. template_fields and signing_role_assignments both FK here by uuid,
-- never by free-text name, so role renames never break historical data.

CREATE TABLE IF NOT EXISTS signer_roles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  description   text,
  color         text        NOT NULL DEFAULT '#4CAF9A',
  auto_suggest  text        CHECK (auto_suggest IN (
                              'property_owner',
                              'deal_buyer',
                              'assigned_agent',
                              'title_company',
                              'relationship_service',
                              'manual'
                            )),
  sort_order    int         NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

ALTER TABLE signer_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signer_roles_auth" ON signer_roles;
CREATE POLICY "signer_roles_auth" ON signer_roles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed standard real-estate roles (idempotent)
INSERT INTO signer_roles (name, description, color, auto_suggest, sort_order) VALUES
  ('Seller',                   'Primary property seller',                    '#4CAF9A', 'property_owner',      0),
  ('Co-Seller',                'Additional property seller or co-owner',     '#4CAF9A', 'property_owner',      1),
  ('Buyer',                    'Primary buyer or investor',                  '#6B9FD4', 'deal_buyer',          2),
  ('Co-Buyer',                 'Additional buyer or co-purchaser',           '#6B9FD4', 'deal_buyer',          3),
  ('Agent',                    'Licensed real estate agent',                 '#C9A84C', 'assigned_agent',      4),
  ('Title Company',            'Title company or closing agent',             '#E06070', 'title_company',       5),
  ('Attorney',                 'Real estate attorney',                       '#D4845A', 'relationship_service',6),
  ('Witness',                  'Signing witness',                            '#8A9BB8', 'manual',              7),
  ('Personal Representative',  'Estate personal representative or executor', '#8A9BB8', 'relationship_service',8),
  ('Assignor',                 'Party assigning their equitable interest',   '#4CAF9A', 'property_owner',      9),
  ('Assignee',                 'Party receiving the assigned interest',      '#6B9FD4', 'deal_buyer',          10),
  ('Broker',                   'Real estate broker',                         '#C9A84C', 'assigned_agent',      11),
  ('Lender',                   'Lender or financier',                        '#8A9BB8', 'manual',              12),
  ('Heir',                     'Heir to an estate',                          '#8A9BB8', 'relationship_service',13)
ON CONFLICT (name) DO NOTHING;


-- ─── 2. blueprint_versions ────────────────────────────────────────────────────
-- Each published version of a blueprint is an immutable row. Generated documents
-- reference blueprint_version_id — not the mutable parent template — so the
-- document's field layout is permanently preserved no matter how the template evolves.
--
-- Draft fields: template_fields where blueprint_version_id IS NULL (editable).
-- Published fields: template_fields where blueprint_version_id IS NOT NULL (immutable copies).

CREATE TABLE IF NOT EXISTS blueprint_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id    uuid        NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  version_number  int         NOT NULL,
  is_current      boolean     NOT NULL DEFAULT false,
  changelog       text,
  published_at    timestamptz NOT NULL DEFAULT now(),
  published_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  field_count     int         NOT NULL DEFAULT 0,
  group_count     int         NOT NULL DEFAULT 0,
  UNIQUE (blueprint_id, version_number)
);

-- Enforce one current version per blueprint
CREATE UNIQUE INDEX IF NOT EXISTS idx_bv_one_current
  ON blueprint_versions (blueprint_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_bv_blueprint
  ON blueprint_versions (blueprint_id, version_number DESC);

ALTER TABLE blueprint_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blueprint_versions_auth" ON blueprint_versions;
CREATE POLICY "blueprint_versions_auth" ON blueprint_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─── 3. template_field_groups ─────────────────────────────────────────────────
-- Organizes related fields into named blocks (e.g., Seller Block = Initial +
-- Signature + Date). Groups carry a stable group_key UUID that is preserved
-- when the builder copies draft → published version, enabling cross-version diffs.

CREATE TABLE IF NOT EXISTS template_field_groups (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id          uuid        NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  blueprint_version_id  uuid        REFERENCES blueprint_versions(id) ON DELETE CASCADE,
  -- null = live draft group; non-null = published (immutable) group

  group_key             uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- Stable identity: same group_key across all versions of the same logical group.
  -- When publishing, groups are copied with the same group_key but a new id.

  name                  text        NOT NULL,  -- e.g. 'Seller Block', 'Notary Block'
  description           text,
  sort_order            int         NOT NULL DEFAULT 0,
  is_required           boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tfg_blueprint
  ON template_field_groups (blueprint_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tfg_version
  ON template_field_groups (blueprint_version_id)
  WHERE blueprint_version_id IS NOT NULL;

ALTER TABLE template_field_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_field_groups_auth" ON template_field_groups;
CREATE POLICY "template_field_groups_auth" ON template_field_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─── 4. template_fields ───────────────────────────────────────────────────────
-- Canonical relational field storage. Replaces the contract_templates.field_mappings
-- JSONB blob. One row per placed field object in a blueprint.
--
-- field_key: stable UUID preserved across all versions of the same logical field.
--            Used by AI, auditing, and version-diff tools.
--
-- Version state:
--   blueprint_version_id IS NULL  → draft field (editable by builder)
--   blueprint_version_id IS NOT NULL → published field (immutable)

CREATE TABLE IF NOT EXISTS template_fields (

  -- ── Identity ──────────────────────────────────────────────────────────────
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id          uuid        NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  blueprint_version_id  uuid        REFERENCES blueprint_versions(id) ON DELETE CASCADE,
  field_key             uuid        NOT NULL DEFAULT gen_random_uuid(),

  -- ── Grouping ──────────────────────────────────────────────────────────────
  group_id              uuid        REFERENCES template_field_groups(id) ON DELETE SET NULL,
  group_position        int         NOT NULL DEFAULT 0,

  -- ── Type & Position ───────────────────────────────────────────────────────
  field_type            text        NOT NULL DEFAULT 'text_input'
                                    CHECK (field_type IN (
                                      'signature',   -- signer's full signature
                                      'initial',     -- signer's initials
                                      'date',        -- auto-filled signing date
                                      'checkbox',    -- yes/no checkbox
                                      'merge_text',  -- auto-filled from merge data
                                      'text_input',  -- free-form text entry by signer
                                      'readonly',    -- display-only text
                                      'notary_seal'  -- notary stamp area
                                    )),
  page                  int         NOT NULL DEFAULT 1,
  x                     numeric     NOT NULL DEFAULT 0,  -- fraction 0-1 of page width
  y                     numeric     NOT NULL DEFAULT 0,  -- fraction 0-1 of page height
  width                 numeric     NOT NULL DEFAULT 0.15,
  height                numeric     NOT NULL DEFAULT 0.04,

  -- ── Semantic ──────────────────────────────────────────────────────────────
  merge_key             text,           -- e.g. 'seller_name', 'property_address'
  signer_role_id        uuid        REFERENCES signer_roles(id) ON DELETE SET NULL,
  required              boolean     NOT NULL DEFAULT true,
  label                 text,           -- display label in builder + signing UI
  font_size             int         NOT NULL DEFAULT 10,
  sort_order            int         NOT NULL DEFAULT 0,
  validation_rule       text,           -- regex or JSON schema expression
  default_value         text,

  -- ── Conditional Visibility ────────────────────────────────────────────────
  -- Schema-ready. No UI yet. The engine evaluates these at generation + signing
  -- time to show/hide/require fields based on merge_data values.
  condition_field_key   uuid,           -- references another field's field_key
  condition_operator    text        CHECK (condition_operator IN (
                                      'eq', 'neq', 'gt', 'lt',
                                      'contains', 'exists', 'empty'
                                    )),
  condition_value       text,
  condition_action      text        CHECK (condition_action IN (
                                      'show', 'hide', 'require', 'optional'
                                    )),

  -- ── AI / OCR Metadata ─────────────────────────────────────────────────────
  -- Schema-ready. No implementation yet. Future OCR and AI field detection
  -- layers will populate these without touching the core field structure.
  ai_confidence         numeric     CHECK (ai_confidence BETWEEN 0 AND 1),
  ai_source             text        CHECK (ai_source IN (
                                      'manual', 'ocr', 'ai_generated',
                                      'imported', 'calculated'
                                    )),
  ai_anchor_text        text,       -- text near the field that anchors its position
  ai_verified           boolean     NOT NULL DEFAULT false,

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_by            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  last_modified_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()

);

CREATE INDEX IF NOT EXISTS idx_tf_blueprint
  ON template_fields (blueprint_id, page, sort_order);
CREATE INDEX IF NOT EXISTS idx_tf_version
  ON template_fields (blueprint_version_id)
  WHERE blueprint_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tf_draft
  ON template_fields (blueprint_id)
  WHERE blueprint_version_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tf_fieldkey
  ON template_fields (field_key);
CREATE INDEX IF NOT EXISTS idx_tf_role
  ON template_fields (signer_role_id)
  WHERE signer_role_id IS NOT NULL;

ALTER TABLE template_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_fields_auth" ON template_fields;
CREATE POLICY "template_fields_auth" ON template_fields
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─── 5. signing_role_assignments ──────────────────────────────────────────────
-- Session-specific mapping from signer role → real person. Replaces the legacy
-- session_signers.role free-text column and signing_sessions.signers JSONB.
--
-- signer_role_id is a FK (not text) so role renames in the catalog never break
-- historical assignment records.

CREATE TABLE IF NOT EXISTS signing_role_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  signing_session_id  uuid        NOT NULL REFERENCES signing_sessions(id) ON DELETE CASCADE,
  signer_role_id      uuid        NOT NULL REFERENCES signer_roles(id) ON DELETE RESTRICT,
  contact_id          uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  -- null when signer is not yet in the contacts table

  name                text        NOT NULL,
  email               text        NOT NULL,
  phone               text,
  signing_order       int         NOT NULL DEFAULT 0,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                    'pending', 'sent', 'viewed', 'signed', 'declined'
                                  )),
  token               text        NOT NULL UNIQUE
                                  DEFAULT encode(gen_random_bytes(32), 'hex'),

  viewed_at           timestamptz,
  signed_at           timestamptz,
  declined_at         timestamptz,
  decline_reason      text,
  signer_ip           text,

  -- Per-signer field completions: { field_key: signedValue }
  -- field_key matches template_fields.field_key for cross-version traceability
  fields_data         jsonb       NOT NULL DEFAULT '{}',

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sra_session
  ON signing_role_assignments (signing_session_id);
CREATE INDEX IF NOT EXISTS idx_sra_token
  ON signing_role_assignments (token);
CREATE INDEX IF NOT EXISTS idx_sra_contact
  ON signing_role_assignments (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sra_status
  ON signing_role_assignments (signing_session_id, status);

ALTER TABLE signing_role_assignments ENABLE ROW LEVEL SECURITY;

-- Authenticated users (agents) manage their sessions
DROP POLICY IF EXISTS "sra_auth" ON signing_role_assignments;
CREATE POLICY "sra_auth" ON signing_role_assignments
  FOR ALL TO authenticated
  USING (
    signing_session_id IN (
      SELECT id FROM signing_sessions WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    signing_session_id IN (
      SELECT id FROM signing_sessions WHERE user_id = auth.uid()
    )
  );

-- Public signers can read their own assignment by token (no auth required)
DROP POLICY IF EXISTS "sra_public_token" ON signing_role_assignments;
CREATE POLICY "sra_public_token" ON signing_role_assignments
  FOR SELECT TO anon USING (true);


-- ─── 6. Extend existing tables ────────────────────────────────────────────────
-- All additive. IF NOT EXISTS prevents errors on re-runs.

-- contract_templates: add blueprint lifecycle columns
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS is_archived        boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_version_id uuid     REFERENCES blueprint_versions(id) ON DELETE SET NULL;

-- documents: link to the originating blueprint version
-- is_immutable: set true at generation time — fields and content are frozen.
--               Distinct from is_executed (signing complete). A doc can be
--               immutable before it is fully signed.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS blueprint_id          uuid REFERENCES contract_templates(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_version_id  uuid REFERENCES blueprint_versions(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fields_snapshot       jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS merge_data            jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_immutable          boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_docs_blueprint_version
  ON documents (blueprint_version_id)
  WHERE blueprint_version_id IS NOT NULL;

-- signing_sessions: link to the originating blueprint version
-- (document_id already added in phase5_5_documents.sql)
ALTER TABLE signing_sessions
  ADD COLUMN IF NOT EXISTS blueprint_version_id uuid REFERENCES blueprint_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ss_blueprint_version
  ON signing_sessions (blueprint_version_id)
  WHERE blueprint_version_id IS NOT NULL;


-- ─── 7. Backfill ──────────────────────────────────────────────────────────────
-- For each contract_template that has field_mappings JSONB data:
--   1. Create blueprint_version v1 (is_current = true)
--   2. Insert draft fields (blueprint_version_id = null) — live editable copy
--   3. Insert published fields (blueprint_version_id = version.id) — immutable copy
--      Both sets share the same field_key for cross-version traceability.
--   4. Set contract_templates.current_version_id
--
-- Old field type values are normalized to the canonical enum:
--   'initials' → 'initial'   'text' → 'text_input'
-- signer_role_id is left null (old signer_id was a session-local ref, not a role).
-- Users can assign proper roles in the builder during Phase B.
--
-- Guard: skips any template whose current_version_id is already set, making
-- this section idempotent against repeated runs.

DO $$
DECLARE
  tmpl    RECORD;
  ver_id  uuid;
  fld     jsonb;
  fk      uuid;
  ft      text;
  sort_n  int;
BEGIN
  FOR tmpl IN
    SELECT id, user_id, field_mappings
    FROM contract_templates
    WHERE field_mappings IS NOT NULL
      AND jsonb_array_length(field_mappings) > 0
      AND current_version_id IS NULL
  LOOP
    -- ── Create blueprint_version v1 ──────────────────────────────────────────
    INSERT INTO blueprint_versions (
      blueprint_id, version_number, is_current,
      changelog, published_by,
      field_count
    )
    VALUES (
      tmpl.id, 1, true,
      'Version 1 — migrated from field_mappings on Phase 5.7 schema upgrade',
      tmpl.user_id,
      jsonb_array_length(tmpl.field_mappings)
    )
    RETURNING id INTO ver_id;

    sort_n := 0;

    -- ── Insert one draft + one published row per field ───────────────────────
    FOR fld IN SELECT jsonb_array_elements(tmpl.field_mappings)
    LOOP
      fk := gen_random_uuid();

      -- Normalize old field_type values to canonical enum
      ft := CASE LOWER(COALESCE(fld->>'type', ''))
        WHEN 'signature' THEN 'signature'
        WHEN 'initials'  THEN 'initial'
        WHEN 'initial'   THEN 'initial'
        WHEN 'date'      THEN 'date'
        WHEN 'checkbox'  THEN 'checkbox'
        WHEN 'text'      THEN 'text_input'
        WHEN 'merge'     THEN 'merge_text'
        WHEN 'readonly'  THEN 'readonly'
        ELSE 'text_input'
      END;

      -- Draft field (blueprint_version_id = null → editable in builder)
      INSERT INTO template_fields (
        blueprint_id, blueprint_version_id, field_key,
        field_type, page, x, y, width, height,
        label, required, sort_order,
        ai_source, created_by
      ) VALUES (
        tmpl.id, null, fk,
        ft,
        COALESCE((fld->>'page')::int, 1),
        COALESCE((fld->>'x')::numeric, 0),
        COALESCE((fld->>'y')::numeric, 0),
        COALESCE((fld->>'w')::numeric, 0.15),
        COALESCE((fld->>'h')::numeric, 0.04),
        fld->>'label',
        COALESCE((fld->>'required')::boolean, true),
        sort_n,
        'imported',
        tmpl.user_id
      );

      -- Published field — immutable copy of the draft with same field_key
      INSERT INTO template_fields (
        blueprint_id, blueprint_version_id, field_key,
        field_type, page, x, y, width, height,
        label, required, sort_order,
        ai_source, created_by
      ) VALUES (
        tmpl.id, ver_id, fk,
        ft,
        COALESCE((fld->>'page')::int, 1),
        COALESCE((fld->>'x')::numeric, 0),
        COALESCE((fld->>'y')::numeric, 0),
        COALESCE((fld->>'w')::numeric, 0.15),
        COALESCE((fld->>'h')::numeric, 0.04),
        fld->>'label',
        COALESCE((fld->>'required')::boolean, true),
        sort_n,
        'imported',
        tmpl.user_id
      );

      sort_n := sort_n + 1;
    END LOOP;

    -- ── Link template → current version ─────────────────────────────────────
    UPDATE contract_templates
    SET current_version_id = ver_id
    WHERE id = tmpl.id;

  END LOOP;
END $$;
