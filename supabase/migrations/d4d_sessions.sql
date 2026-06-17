-- D4D (Driving for Dollars) sessions table
-- Stores optional route-tracking sessions; properties added without a session get d4d_session_id = null

CREATE TABLE IF NOT EXISTS d4d_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text,                                        -- e.g. "Miramar North - June 10"
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  route         jsonb       NOT NULL DEFAULT '[]'::jsonb,    -- [{lat, lng, ts}]
  lead_count    int         NOT NULL DEFAULT 0,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS d4d_sessions_user_idx ON d4d_sessions(user_id);
CREATE INDEX IF NOT EXISTS d4d_sessions_started_idx ON d4d_sessions(started_at DESC);

ALTER TABLE d4d_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own d4d sessions"
  ON d4d_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add d4d tracking columns to properties
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS d4d_session_id  uuid REFERENCES d4d_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS d4d_condition   text,   -- 'vacant','overgrown','boarded','fire_damage','other'
  ADD COLUMN IF NOT EXISTS d4d_notes       text;
