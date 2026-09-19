-- ─── Phase 1.3 — Fix Blueprint RPC Authorization ─────────────────────────────
--
-- Problem:
--   sync_blueprint_draft_fields is SECURITY DEFINER (runs as DB owner, bypasses
--   RLS) and was GRANTed EXECUTE to `authenticated`. Any authenticated user can
--   therefore POST to /rest/v1/rpc/sync_blueprint_draft_fields with any
--   blueprint_id and overwrite another user's draft fields — bypassing the
--   ownership check that lives in the API route.
--
-- Root cause of the earlier incorrect fix attempt (phase1_1_storage_security):
--   The auth.uid() guard approach assumes the function is called with a user JWT
--   so that auth.uid() resolves to the caller's user id. In the actual
--   architecture (confirmed in blueprintService.ts:152 and
--   app/api/contract-templates/[id]/fields/route.ts), ALL production callers use
--   serviceClient (service-role credential). auth.uid() returns NULL for service-
--   role requests, so the guard would block EVERY production call.
--
-- Correct fix — least privilege at the GRANT level:
--   The function body needs no auth check because only server-side code using
--   the service role can reach it after this migration. The API route already
--   enforces ownership before calling BlueprintService.syncDraftFields():
--     verifyOwner() → serviceClient.from('contract_templates')
--                       .select('user_id').eq('id', templateId)
--     → user.id === data.user_id → reject with 404 if false
--   The function body is left unchanged (DELETE + INSERT + RETURN).
--
-- Migration is idempotent:
--   CREATE OR REPLACE FUNCTION is safe to re-run.
--   REVOKE IF EXISTS is handled by Postgres (no error if not granted).
--
-- Security result after applying this migration:
--   anon              → cannot call (no grant)
--   authenticated     → cannot call (grant REVOKED)
--   service_role      → can call   (only legitimate production path)
--
-- Ownership enforcement path:
--   POST /api/contract-templates/[id]/fields
--     → createClient() auth.getUser()          [identity]
--     → verifyOwner(id, user.id)               [ownership, server-side]
--     → BlueprintService.syncDraftFields()      [calls RPC via service role]
--     → sync_blueprint_draft_fields RPC         [service-role only]
--
-- DO NOT apply this migration manually. Apply it in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Replace the function body (identical to live — no auth.uid() guard
-- needed because service-role is the only permitted caller after step 2).

CREATE OR REPLACE FUNCTION public.sync_blueprint_draft_fields(
  p_blueprint_id  uuid,
  p_fields        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Atomic DELETE + INSERT ───────────────────────────────────────────────
  -- Runs inside an implicit plpgsql transaction: if INSERT fails, DELETE is
  -- rolled back and the caller's fields are preserved.
  -- Authorization is enforced at the GRANT level (service_role only) and at
  -- the API-route layer (verifyOwner) — no auth.uid() check here because
  -- service-role requests have auth.uid() = NULL.
  DELETE FROM template_fields
  WHERE  blueprint_id         = p_blueprint_id
    AND  blueprint_version_id IS NULL;

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
      NULL,
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

  SELECT jsonb_agg(row_to_json(tf)::jsonb ORDER BY tf.sort_order, tf.created_at)
  INTO   v_result
  FROM   template_fields tf
  WHERE  tf.blueprint_id         = p_blueprint_id
    AND  tf.blueprint_version_id IS NULL;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Step 2: Restrict EXECUTE to service_role only.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default when a function is created.
-- REVOKE from named roles (authenticated, anon) leaves the PUBLIC grant intact.
-- REVOKE FROM PUBLIC is required to close access for all non-service_role callers.
-- After REVOKE FROM PUBLIC, the explicit GRANT TO service_role is the only grant.
REVOKE EXECUTE ON FUNCTION public.sync_blueprint_draft_fields(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_blueprint_draft_fields(uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_blueprint_draft_fields(uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.sync_blueprint_draft_fields(uuid, jsonb) TO service_role;
