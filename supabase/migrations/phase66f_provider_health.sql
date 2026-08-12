-- Phase 66f: Provider Health Tracking
-- Records health events when external providers return error responses.
-- Enables admin billing dashboard to surface provider-side issues
-- (e.g. REAPI wallet depleted) separately from platform billing failures.

CREATE TABLE IF NOT EXISTS api_provider_health (
  id             uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_key   text         NOT NULL,
  status         text         NOT NULL CHECK (status IN (
                               'healthy', 'low_balance', 'depleted',
                               'rate_limited', 'auth_failed', 'server_error', 'unknown'
                             )),
  error_category text         CHECK (error_category IN (
                               'provider_wallet_depleted', 'provider_rate_limited',
                               'provider_auth_failed', 'provider_timeout',
                               'provider_server_error', 'provider_disabled',
                               'platform_budget_exhausted', 'customer_credit_exhausted'
                             )),
  http_status    integer,
  detail         text,
  recorded_at    timestamptz  NOT NULL DEFAULT now(),
  recorded_by    text         NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_provider_health_key_time
  ON api_provider_health (provider_key, recorded_at DESC);

-- RLS: service role only — no customer can see provider health data
ALTER TABLE api_provider_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON api_provider_health
  USING (false)
  WITH CHECK (false);

-- Seed an initial 'unknown' baseline for known providers so the dashboard
-- always has a row to display even before the first event fires.
INSERT INTO api_provider_health (provider_key, status, recorded_by)
  VALUES
    ('reapi',       'unknown', 'seed'),
    ('rentcast',    'unknown', 'seed'),
    ('google_maps', 'unknown', 'seed')
  ON CONFLICT DO NOTHING;
