-- ─── Contact table: new fields ───────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score        text CHECK (lead_score IN ('Hot', 'Warm', 'Cold')),
  ADD COLUMN IF NOT EXISTS last_contact_date date,
  ADD COLUMN IF NOT EXISTS motivation        text,
  ADD COLUMN IF NOT EXISTS timeline          text,
  ADD COLUMN IF NOT EXISTS asking_price      numeric;

-- ─── Tasks table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id      uuid,
  lead_id      uuid,
  title        text NOT NULL,
  description  text,
  due_date     date,
  priority     text NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  assigned_to  text,
  completed_at timestamptz,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(due_date);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_auth_full" ON tasks;
CREATE POLICY "tasks_auth_full" ON tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
