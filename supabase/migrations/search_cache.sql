-- ═══════════════════════════════════════════════════════════════════════════
-- NextKey OS — Search Cache Table
-- Run ONCE in Supabase SQL Editor.
--
-- Stores live REAPI search results temporarily (24h TTL) to avoid
-- redundant API calls when the same search is run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS search_cache (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  search_hash   text        NOT NULL UNIQUE,   -- SHA-256 of normalised query params
  query_params  jsonb       NOT NULL,           -- original query for debugging
  results       jsonb       NOT NULL,           -- array of normalised property objects
  result_count  integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,           -- created_at + 24h
  hit_count     integer     NOT NULL DEFAULT 0  -- incremented on each cache hit
);

CREATE INDEX IF NOT EXISTS search_cache_hash_idx    ON search_cache (search_hash);
CREATE INDEX IF NOT EXISTS search_cache_expires_idx ON search_cache (expires_at);

-- Auto-clean expired entries (run via cron or pg_cron extension)
-- DELETE FROM search_cache WHERE expires_at < now();

COMMENT ON TABLE search_cache IS
  'Stores live REAPI property search results for 24h to reduce API usage.';
