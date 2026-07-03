-- ── Phase 6.1: Skip Trace Engine ─────────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Creates four tables that store provider requests, normalized contacts,
-- phone numbers, and email addresses — one row per request, never overwritten.

-- One row per provider API call
CREATE TABLE IF NOT EXISTS skiptrace_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lead_id          uuid,
  provider         text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'failed', 'cached')),
  credits_used     integer,
  cost_cents       integer,
  request_payload  jsonb,
  response_time_ms integer,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS skiptrace_requests_property_idx ON skiptrace_requests(property_id);
CREATE INDEX IF NOT EXISTS skiptrace_requests_status_idx   ON skiptrace_requests(status);
CREATE INDEX IF NOT EXISTS skiptrace_requests_time_idx     ON skiptrace_requests(requested_at DESC);

-- One row per normalized contact found in a request
CREATE TABLE IF NOT EXISTS skiptrace_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid NOT NULL REFERENCES skiptrace_requests(id) ON DELETE CASCADE,
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  full_name           text,
  confidence_score    numeric(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
  provider_contact_id text,
  age                 integer,
  relatives           jsonb,
  address_history     jsonb,
  raw_response        jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skiptrace_results_property_idx ON skiptrace_results(property_id);
CREATE INDEX IF NOT EXISTS skiptrace_results_request_idx  ON skiptrace_results(request_id);

-- Phone numbers — one row per number per result
CREATE TABLE IF NOT EXISTS skiptrace_phones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skiptrace_result_id uuid NOT NULL REFERENCES skiptrace_results(id) ON DELETE CASCADE,
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  phone_number        text NOT NULL,
  phone_type          text,
  is_mobile           boolean NOT NULL DEFAULT false,
  is_landline         boolean NOT NULL DEFAULT false,
  is_voip             boolean NOT NULL DEFAULT false,
  is_dnc              boolean NOT NULL DEFAULT false,
  carrier             text,
  priority            integer NOT NULL DEFAULT 1,
  confidence          numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  last_verified       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skiptrace_phones_result_idx   ON skiptrace_phones(skiptrace_result_id);
CREATE INDEX IF NOT EXISTS skiptrace_phones_property_idx ON skiptrace_phones(property_id);

-- Email addresses — one row per email per result
CREATE TABLE IF NOT EXISTS skiptrace_emails (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skiptrace_result_id uuid NOT NULL REFERENCES skiptrace_results(id) ON DELETE CASCADE,
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  email               text NOT NULL,
  confidence          numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  is_primary          boolean NOT NULL DEFAULT false,
  last_verified       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skiptrace_emails_result_idx   ON skiptrace_emails(skiptrace_result_id);
CREATE INDEX IF NOT EXISTS skiptrace_emails_property_idx ON skiptrace_emails(property_id);
