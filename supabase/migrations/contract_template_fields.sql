-- Add field_mappings column to contract_templates for PDF template builder
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS field_mappings jsonb DEFAULT NULL;
