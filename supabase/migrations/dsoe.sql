-- Phase 6.2: Data Source Optimization Engine (DSOE)
-- Two tables:
--   property_field_sources  — field-level provenance (upsert on conflict)
--   dsoe_request_log        — every DSOE resolution call, drives metrics

-- ── Field-level provenance ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_field_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field_name   text NOT NULL,
  field_value  text,
  source       text NOT NULL,
  source_type  text NOT NULL CHECK (source_type IN ('internal', 'public', 'paid')),
  source_label text,
  confidence   numeric(5,4),
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_pfs_property_id
  ON property_field_sources(property_id);

CREATE INDEX IF NOT EXISTS idx_pfs_source_type
  ON property_field_sources(source_type, collected_at DESC);

-- ── DSOE request log (metrics) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dsoe_request_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid REFERENCES properties(id) ON DELETE SET NULL,
  tier_used       integer NOT NULL CHECK (tier_used IN (1, 2, 3)),
  source          text,
  fields_resolved integer DEFAULT 0,
  cache_hits      integer DEFAULT 0,
  county_hits     integer DEFAULT 0,
  premium_hits    integer DEFAULT 0,
  cost_cents      integer DEFAULT 0,
  duration_ms     integer,
  requested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsoe_log_property_id
  ON dsoe_request_log(property_id);

CREATE INDEX IF NOT EXISTS idx_dsoe_log_requested_at
  ON dsoe_request_log(requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_dsoe_log_tier_used
  ON dsoe_request_log(tier_used);
