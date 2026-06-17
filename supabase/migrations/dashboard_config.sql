ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS dashboard_config jsonb DEFAULT '{}';
