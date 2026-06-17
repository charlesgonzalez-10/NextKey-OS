-- ─── Document Versions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version       int  NOT NULL DEFAULT 1,
  file_path     text,
  notes         text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, version DESC);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "doc_versions_auth" ON document_versions;
CREATE POLICY "doc_versions_auth" ON document_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── Document Activity Log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  action        text NOT NULL, -- 'created','generated','signed','sent','viewed','accepted','rejected','version_saved'
  notes         text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_activity_doc ON document_activity(document_id, created_at DESC);

ALTER TABLE document_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "doc_activity_auth" ON document_activity;
CREATE POLICY "doc_activity_auth" ON document_activity
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── Expand documents.status ───────────────────────────────────────────────────
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check CHECK (status IN (
    'draft','generated','signed_by_me','sent','viewed','accepted','rejected','expired','cancelled','archived'
  ));
