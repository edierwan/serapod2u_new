-- ============================================================================
-- Inventory Stock Configurations — Phase 13:
-- Atomic bulk Manual Stock Addition (Add Stock)
-- ----------------------------------------------------------------------------
-- Migrations 01-12 are immutable. This forward-only migration changes no
-- existing inventory balances or historical movements.
--
-- Behaviour:
--   * Direct authorized inbound posting (no draft / approval lifecycle).
--   * Every line requires an exact active stock_config_id (never variant-only).
--   * Legacy/Unclassified configurations are rejected.
--   * All lines share one MSA-* batch reference and one client request UUID.
--   * Forced failure on any line rolls back the whole batch.
--   * Retries with the same client request UUID are idempotent.
--   * Weighted-average cost continues through record_stock_movement.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.manual_stock_addition_user_can_post(
  p_user_id uuid,
  p_warehouse_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_level integer;
  v_role_permissions jsonb;
  v_overrides jsonb;
BEGIN
  SELECT r.role_level,
         coalesce(r.permissions::jsonb, '{}'::jsonb),
         coalesce(d.permission_overrides::jsonb, '{}'::jsonb)
    INTO v_role_level, v_role_permissions, v_overrides
  FROM public.users u
  LEFT JOIN public.roles r ON r.role_code = u.role_code
  LEFT JOIN public.departments d ON d.id = u.department_id
  WHERE u.id = p_user_id
    AND coalesce(u.is_active, true) = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT (public.can_access_org(p_warehouse_id) OR public.is_hq_admin()) THEN
    RETURN false;
  END IF;

  IF coalesce(v_overrides->'deny', '[]'::jsonb) ? 'adjust_stock' THEN
    RETURN false;
  END IF;

  RETURN public.is_hq_admin()
    OR v_role_level = 1
    OR coalesce(v_overrides->'allow', '[]'::jsonb) ? 'adjust_stock'
    OR coalesce(v_role_permissions->>'adjust_stock', 'false')::boolean
    OR coalesce(v_role_permissions, '[]'::jsonb) ? 'adjust_stock';
END;
$$;

COMMENT ON FUNCTION public.manual_stock_addition_user_can_post(uuid, uuid) IS
  'True when the user may post Manual Stock Addition to the warehouse: org access (or HQ admin) plus adjust_stock (or HQ admin / Super Admin).';

CREATE OR REPLACE FUNCTION public.post_manual_stock_addition(
  p_request_id uuid,
  p_organization_id uuid,
  p_items jsonb,
  p_reason text,
  p_external_reference text DEFAULT NULL,
  p_manufacturer_id uuid DEFAULT NULL,
  p_warehouse_location text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_batch_no text;
  v_existing_count integer;
  v_item jsonb;
  v_stock_config_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_unit_cost numeric;
  v_row_note text;
  v_config public.inventory_stock_configurations%ROWTYPE;
  v_movement_id uuid;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_total_units integer := 0;
  v_total_value numeric := 0;
  v_seen_keys text[] := ARRAY[]::text[];
  v_line_key text;
  v_notes text;
  v_reason text;
  v_external_reference text;
  v_line_index integer := 0;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Manual stock addition request id is required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Addition reason/source type is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one stock configuration line is required';
  END IF;

  IF auth.role() = 'authenticated' THEN
    IF v_user_id IS NULL OR p_created_by IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'created_by must match the authenticated user';
    END IF;
  ELSIF p_created_by IS NULL THEN
    RAISE EXCEPTION 'created_by is required';
  ELSE
    v_user_id := p_created_by;
  END IF;

  IF NOT public.manual_stock_addition_user_can_post(v_user_id, p_organization_id) THEN
    RAISE EXCEPTION 'User is not authorized to post manual stock additions for organization %', p_organization_id;
  END IF;

  v_company_id := public.get_company_id(p_organization_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve company for organization %', p_organization_id;
  END IF;
  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Company % does not own organization %', p_company_id, p_organization_id;
  END IF;

  -- Serialise retries for the same client request before checking committed rows.
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-stock-addition:' || p_request_id::text, 0));

  SELECT count(*), min(reference_no)
    INTO v_existing_count, v_batch_no
    FROM public.stock_movements
   WHERE reference_type = 'manual'
     AND reference_id = p_request_id
     AND movement_type = 'manual_in';

  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'batch_no', v_batch_no,
      'request_id', p_request_id,
      'movement_count', v_existing_count,
      'total_units', (
        SELECT coalesce(sum(quantity_change), 0)
        FROM public.stock_movements
        WHERE reference_type = 'manual'
          AND reference_id = p_request_id
          AND movement_type = 'manual_in'
      ),
      'warehouse_id', p_organization_id,
      'reason', v_reason
    );
  END IF;

  v_batch_no := public.generate_display_doc_number(v_company_id, 'MSA');
  v_external_reference := nullif(btrim(coalesce(p_external_reference, '')), '');

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_line_index := v_line_index + 1;
    v_stock_config_id := nullif(v_item->>'stock_config_id', '')::uuid;
    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    v_row_note := nullif(btrim(coalesce(v_item->>'row_note', '')), '');

    IF v_stock_config_id IS NULL THEN
      RAISE EXCEPTION 'Line %: stock_config_id is required (variant-only posting is not allowed)', v_line_index;
    END IF;
    IF v_variant_id IS NULL THEN
      RAISE EXCEPTION 'Line %: variant_id is required', v_line_index;
    END IF;

    BEGIN
      v_quantity := (v_item->>'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Line %: quantity must be a positive whole number', v_line_index;
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: quantity must be a positive whole number', v_line_index;
    END IF;

    IF (v_item ? 'unit_cost') AND nullif(v_item->>'unit_cost', '') IS NOT NULL THEN
      BEGIN
        v_unit_cost := (v_item->>'unit_cost')::numeric;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Line %: unit cost is invalid', v_line_index;
      END;
      IF v_unit_cost < 0 THEN
        RAISE EXCEPTION 'Line %: unit cost cannot be negative', v_line_index;
      END IF;
    ELSE
      v_unit_cost := NULL;
    END IF;

    SELECT * INTO v_config
    FROM public.inventory_stock_configurations
    WHERE id = v_stock_config_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line %: stock configuration % was not found', v_line_index, v_stock_config_id;
    END IF;

    IF v_config.variant_id IS DISTINCT FROM v_variant_id THEN
      RAISE EXCEPTION 'Line %: stock configuration % does not belong to variant %',
        v_line_index, v_stock_config_id, v_variant_id;
    END IF;

    IF upper(coalesce(v_config.config_code, '')) = 'UNCLASSIFIED'
       OR position('LEGACY' in upper(coalesce(v_config.config_code, ''))) > 0
       OR position('LEGACY' in upper(coalesce(v_config.config_label, ''))) > 0
       OR position('UNCLASSIFIED' in upper(coalesce(v_config.config_label, ''))) > 0 THEN
      RAISE EXCEPTION 'Line %: Legacy/Unclassified stock cannot be selected for manual addition', v_line_index;
    END IF;

    IF coalesce(v_config.status, '') <> 'active' THEN
      RAISE EXCEPTION 'Line %: stock configuration % is not active', v_line_index, v_stock_config_id;
    END IF;

    v_line_key := v_variant_id::text || ':' || v_stock_config_id::text;
    IF v_line_key = ANY (v_seen_keys) THEN
      RAISE EXCEPTION 'Line %: duplicate stock configuration % in the same batch', v_line_index, v_stock_config_id;
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_line_key);

    v_notes := nullif(btrim(concat_ws(
      E'\n',
      nullif(btrim(coalesce(p_notes, '')), ''),
      CASE WHEN v_external_reference IS NOT NULL
        THEN 'External reference: ' || v_external_reference
        ELSE NULL
      END,
      CASE WHEN v_row_note IS NOT NULL
        THEN 'Row note: ' || v_row_note
        ELSE NULL
      END
    )), '');

    BEGIN
      v_movement_id := public.record_stock_movement(
        p_movement_type   => 'manual_in',
        p_variant_id      => v_variant_id,
        p_organization_id => p_organization_id,
        p_quantity_change => v_quantity,
        p_unit_cost       => v_unit_cost,
        p_manufacturer_id => p_manufacturer_id,
        p_warehouse_location => nullif(btrim(coalesce(p_warehouse_location, '')), ''),
        p_reason          => v_reason,
        p_notes           => v_notes,
        p_reference_type  => 'manual',
        p_reference_id    => p_request_id,
        p_reference_no    => v_batch_no,
        p_company_id      => v_company_id,
        p_created_by      => v_user_id,
        p_stock_config_id => v_stock_config_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Line % (config %): %', v_line_index, v_stock_config_id, SQLERRM;
    END;

    v_movement_ids := array_append(v_movement_ids, v_movement_id);
    v_total_units := v_total_units + v_quantity;
    IF v_unit_cost IS NOT NULL THEN
      v_total_value := v_total_value + (v_quantity * v_unit_cost);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'batch_no', v_batch_no,
    'request_id', p_request_id,
    'movement_ids', to_jsonb(v_movement_ids),
    'movement_count', coalesce(array_length(v_movement_ids, 1), 0),
    'total_units', v_total_units,
    'total_value', v_total_value,
    'warehouse_id', p_organization_id,
    'reason', v_reason,
    'external_reference', v_external_reference
  );
END;
$$;

COMMENT ON FUNCTION public.post_manual_stock_addition(uuid, uuid, jsonb, text, text, uuid, text, text, uuid, uuid) IS
  'Atomically posts a bulk Manual Stock Addition batch as manual_in movements with one MSA reference. Idempotent on p_request_id.';

REVOKE ALL ON FUNCTION public.manual_stock_addition_user_can_post(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_stock_addition_user_can_post(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.post_manual_stock_addition(uuid, uuid, jsonb, text, text, uuid, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_manual_stock_addition(uuid, uuid, jsonb, text, text, uuid, text, text, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
