-- ─── Phase 1 Blueprint RPC — Atomic Draft Field Sync ─────────────────────────
--
-- Problem: syncDraftFields() does DELETE-then-INSERT with no transaction.
-- A failure between the two operations leaves the template with 0 fields.
--
-- Fix: Postgres function that executes DELETE + INSERT in a single implicit
-- transaction. Called from blueprintService via serviceClient.rpc().
--
-- The field JSONB array matches the template_fields insert shape (snake_case).

CREATE OR REPLACE FUNCTION sync_blueprint_draft_fields(
  p_blueprint_id  uuid,
  p_fields        jsonb   -- array of field objects
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Delete all existing draft fields for this blueprint
  DELETE FROM template_fields
  WHERE blueprint_id = p_blueprint_id
    AND blueprint_version_id IS NULL;

  -- Insert new fields (no-op if array is empty)
  IF jsonb_array_length(p_fields) > 0 THEN
    INSERT INTO template_fields (
      blueprint_id,
      blueprint_version_id,
      field_key,
      field_type,
      page,
      x, y, width, height,
      merge_key,
      label,
      font_size,
      sort_order,
      signer_role_id,
      required,
      ai_source,
      created_by,
      last_modified_by
    )
    SELECT
      p_blueprint_id,
      NULL,                                                 -- draft
      COALESCE((f->>'field_key')::uuid, gen_random_uuid()),
      COALESCE(f->>'field_type', 'merge_text'),
      COALESCE((f->>'page')::int, 1),
      COALESCE((f->>'x')::numeric, 0),
      COALESCE((f->>'y')::numeric, 0),
      COALESCE((f->>'width')::numeric, 0.15),
      COALESCE((f->>'height')::numeric, 0.04),
      NULLIF(f->>'merge_key', ''),
      NULLIF(f->>'label', ''),
      COALESCE((f->>'font_size')::int, 11),
      COALESCE((f->>'sort_order')::int, 0),
      NULLIF(f->>'signer_role_id', '')::uuid,
      COALESCE((f->>'required')::boolean, false),
      COALESCE(f->>'ai_source', 'manual'),
      NULLIF(f->>'created_by', '')::uuid,
      NULLIF(f->>'last_modified_by', '')::uuid
    FROM jsonb_array_elements(p_fields) AS f;
  END IF;

  -- Return the newly inserted draft fields
  SELECT jsonb_agg(row_to_json(tf)::jsonb ORDER BY tf.sort_order, tf.created_at)
  INTO v_result
  FROM template_fields tf
  WHERE tf.blueprint_id = p_blueprint_id
    AND tf.blueprint_version_id IS NULL;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION sync_blueprint_draft_fields(uuid, jsonb) TO authenticated, service_role;
