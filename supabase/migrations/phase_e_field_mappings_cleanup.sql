-- Phase E: field_mappings deprecation
-- All templates that have a current_version_id have been fully migrated to
-- template_fields. NULL out the legacy JSONB column for those rows to free
-- storage. The column is kept (NOT dropped) for a 30-day soak period.
-- Phase F will run: ALTER TABLE contract_templates DROP COLUMN field_mappings;

UPDATE contract_templates
SET field_mappings = NULL
WHERE current_version_id IS NOT NULL
  AND field_mappings IS NOT NULL;

-- Mark the column deprecated in the catalog so future tooling can flag it.
COMMENT ON COLUMN contract_templates.field_mappings IS
  'DEPRECATED (Phase E, 2026-07): replaced by template_fields relational table. '
  'Will be dropped in Phase F after 30-day soak. Do not write to this column.';

-- The legacy signing_sessions columns (fields, signers JSONB) are still active
-- for manually-created sessions without a blueprint. Do NOT deprecate those here.
