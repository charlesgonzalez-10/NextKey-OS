-- ─── Expand documents table for file uploads ──────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS file_path  text,       -- raw uploaded file path (non-generated)
  ADD COLUMN IF NOT EXISTS file_type  text;        -- pdf, docx, xlsx, jpg, png, txt

-- Drop and recreate the category constraint with expanded values
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_category_check CHECK (category IN (
    'offer','loi','assignment','contract','disclosure','letter',
    'photo','closing','probate','foreclosure','title','seller','buyer','marketing','other'
  ));

-- Expand storage bucket allowed MIME types to include all upload types
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/msword',
  'application/vnd.ms-excel',
  'application/octet-stream'
]
WHERE id = 'documents';

-- Also allow update (for saving annotated PDFs back to the same path)
DROP POLICY IF EXISTS "documents_update" ON storage.objects;
CREATE POLICY "documents_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'documents') WITH CHECK (bucket_id = 'documents');
