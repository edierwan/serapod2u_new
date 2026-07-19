-- ============================================================================
-- Inventory Stock Configurations — Phase 17 (forward-only)
-- Safe Stock Count draft discard (Manage Drafts)
-- ----------------------------------------------------------------------------
-- Soft-archives draft Stock Count sessions so users can clear testing drafts
-- without touching inventory. Posted / posting / verified / completed sessions
-- are never removed. Inventory balances, allocations, movements, product
-- classifications, posted counts, and completed-transaction audit history are
-- never modified by this path.
--
-- Approach:
--   * Prefer soft-delete: status draft -> archived (existing terminal status)
--   * Record archived_by / archived_at (plus updated_by / updated_at)
--   * Re-check draft status under row lock before update
--   * Refuse discard when any stock_movements reference the session
--   * Invalidate open verification requests for the session only
--   * Bulk discard loops session ids one-by-one (no warehouse-wide deletes)
--   * Already-archived sessions are idempotent successes (double-click safe)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Audit columns for who discarded / when
-- ----------------------------------------------------------------------------

ALTER TABLE public.stock_count_sessions
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.stock_count_sessions.archived_by IS
  'User who discarded/archived a draft Stock Count. Null for sessions that were never archived.';
COMMENT ON COLUMN public.stock_count_sessions.archived_at IS
  'When a draft Stock Count was discarded/archived. Null for draft/posted sessions.';

COMMENT ON COLUMN public.stock_count_sessions.status IS
  'draft -> posted is the normal flow. archived retires a discarded draft; it is a dead end, never reactivated or posted. Discard never mutates inventory.';

-- ----------------------------------------------------------------------------
-- 2. Single-draft discard (enhances archive_stock_count_draft)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.archive_stock_count_draft(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.stock_count_sessions%ROWTYPE;
  v_movement_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_session_id IS NULL THEN RAISE EXCEPTION 'stock_count_not_found'; END IF;

  SELECT * INTO v_session
  FROM public.stock_count_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock_count_not_found'; END IF;

  -- Org/warehouse access (matches session RLS). Never cross-organization.
  IF NOT (public.can_access_org(v_session.warehouse_organization_id) OR public.is_hq_admin()) THEN
    RAISE EXCEPTION 'permission_lost';
  END IF;

  -- Idempotent: already discarded drafts succeed without further mutation.
  IF v_session.status = 'archived' THEN
    RETURN jsonb_build_object(
      'status', 'archived',
      'session_id', p_session_id,
      'already_archived', true
    );
  END IF;

  -- Only true drafts may be discarded. Posted (and any future non-draft) are blocked.
  IF v_session.status <> 'draft' OR v_session.posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock_count_not_discardable';
  END IF;

  -- Defense in depth: a draft must never have created inventory movements.
  SELECT count(*)::integer INTO v_movement_count
  FROM public.stock_movements
  WHERE reference_id = p_session_id
    AND reference_type IN ('adjustment', 'stock_classification');

  IF coalesce(v_movement_count, 0) > 0 THEN
    RAISE EXCEPTION 'stock_count_not_discardable';
  END IF;

  UPDATE public.stock_count_sessions
  SET
    status = 'archived',
    archived_by = v_user_id,
    archived_at = now(),
    updated_by = v_user_id,
    updated_at = now()
  WHERE id = p_session_id
    AND status = 'draft'
    AND posted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_count_not_discardable';
  END IF;

  -- Session-scoped only: close open verification codes for this draft.
  UPDATE public.stock_count_verification_requests
  SET status = 'invalidated', invalidated_at = now()
  WHERE session_id = p_session_id
    AND status IN ('pending_delivery', 'active');

  RETURN jsonb_build_object(
    'status', 'archived',
    'session_id', p_session_id,
    'already_archived', false
  );
END;
$$;

COMMENT ON FUNCTION public.archive_stock_count_draft(uuid) IS
  'Soft-discards a Stock Count draft (status -> archived). Draft-only, org-scoped, blocks sessions that already have inventory movements, and never mutates balances/allocations/classifications/posted counts. Idempotent for already-archived drafts.';

REVOKE ALL ON FUNCTION public.archive_stock_count_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_stock_count_draft(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Bulk discard — one session at a time, no warehouse-wide deletes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.discard_stock_count_drafts(p_session_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_discarded uuid[] := ARRAY[]::uuid[];
  v_already_archived uuid[] := ARRAY[]::uuid[];
  v_failed jsonb := '[]'::jsonb;
  v_result jsonb;
  v_error text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_session_ids IS NULL OR cardinality(p_session_ids) = 0 THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'discarded_ids', '[]'::jsonb,
      'already_archived_ids', '[]'::jsonb,
      'failed', '[]'::jsonb
    );
  END IF;

  FOREACH v_session_id IN ARRAY p_session_ids LOOP
    IF v_session_id IS NULL THEN CONTINUE; END IF;
    -- Deduplicate so double-selected ids cannot amplify work.
    IF v_session_id = ANY (v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_session_id);

    BEGIN
      v_result := public.archive_stock_count_draft(v_session_id);
      IF coalesce((v_result->>'already_archived')::boolean, false) THEN
        v_already_archived := array_append(v_already_archived, v_session_id);
      ELSE
        v_discarded := array_append(v_discarded, v_session_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'session_id', v_session_id,
        'error', v_error
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', CASE WHEN jsonb_array_length(v_failed) = 0 THEN 'ok' ELSE 'partial' END,
    'discarded_ids', to_jsonb(v_discarded),
    'already_archived_ids', to_jsonb(v_already_archived),
    'failed', v_failed
  );
END;
$$;

COMMENT ON FUNCTION public.discard_stock_count_drafts(uuid[]) IS
  'Soft-discards multiple Stock Count drafts one id at a time. Never runs warehouse-wide deletes. Per-id failures are returned without aborting siblings. Inventory is never mutated.';

REVOKE ALL ON FUNCTION public.discard_stock_count_drafts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_stock_count_drafts(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
