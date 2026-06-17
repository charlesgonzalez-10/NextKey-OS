-- user_role enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('owner', 'admin', 'user', 'viewer');
  END IF;
END$$;

-- user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role             user_role NOT NULL DEFAULT 'user',
  show_admin_tools boolean NOT NULL DEFAULT false,
  display_name     text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own" ON user_profiles;
CREATE POLICY "users_read_own" ON user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "users_update_own" ON user_profiles;
CREATE POLICY "users_update_own" ON user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Auto-create profile on new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, role, show_admin_tools)
  VALUES (NEW.id, 'user', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Ensure all existing users have a profile row
INSERT INTO user_profiles (id, role, show_admin_tools)
SELECT id, 'user'::user_role, false
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Seed owner accounts — Charles gets owner role + admin tools enabled
INSERT INTO user_profiles (id, role, show_admin_tools)
SELECT id, 'owner'::user_role, true
FROM auth.users
WHERE lower(email) IN ('crgonz10@gmail.com', 'charlesgonzalez@nextkeyps.com')
ON CONFLICT (id) DO UPDATE SET
  role             = 'owner',
  show_admin_tools = true,
  updated_at       = now();
