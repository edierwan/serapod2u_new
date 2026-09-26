-- ============================================================================
-- Phase 0B / Commit A — privileged RPC containment
-- ----------------------------------------------------------------------------
-- Purpose
--   Contain SECURITY DEFINER functions exposed through PostgREST.
--
-- Before (verified 2026-09-27 against serapod-prd-db on KVM8 and
-- serapod-stg-db on KVM2, read-only catalog queries)
--   * 304 (prod) / 328 (staging) SECURITY DEFINER functions in public.
--   * 222 (prod) / 226 (staging) executable by anon (the public anon key),
--     including destructive/financial ones: delete_all_transactions_with_
--     inventory_v3 (TRUNCATE ... CASCADE of every transaction table),
--     hard_delete_organization, adjust_inventory_quantity, wms_ship_*,
--     approve_payment_request, post_payroll_*_to_gl, consumer_collect_points.
--   * 259 (prod) / 283 (staging) executable by authenticated, i.e. by any of
--     the ~2,000 GUEST consumer/shop accounts.
--   * 167 (prod) / 166 (staging) with no fixed search_path.
--
-- After
--   * Every SECURITY DEFINER function in public has an explicit tier below:
--       PUBLIC  - anon + authenticated + service_role. Only anonymous
--                 consumer/login journeys and RLS/storage policy helpers.
--       USER    - authenticated + service_role (anon revoked).
--       SERVER  - service_role only (legacy/unused, admin-client-only, or
--                 only reached from other SECURITY DEFINER functions).
--       TRIGGER - no API role (trigger execution does not check EXECUTE).
--   * Destructive/privileged entry points gain internal actor checks
--     (sa_assert_* helpers) so direct PostgREST calls cannot bypass the
--     route-level checks; actor identity is always auth.uid(), never an
--     argument.
--   * Every SECURITY DEFINER function in public gets a fixed search_path that
--     ends with pg_temp.
--   * Catch-all: any other SECURITY DEFINER function in public (for example
--     environment-specific ones) loses anon/PUBLIC EXECUTE.
--
-- Inventory evidence: docs/security/phase0b-rpc-inventory.md
--
-- Rollback guidance (do not apply automatically)
--   * Grants: re-run the tier table with the previous grants from the
--     inventory document (Before columns), e.g.
--       GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon, authenticated;
--   * Guarded functions: re-create them from the definitions captured in
--     docs/security/phase0b-rpc-inventory.md (unchanged except for the single
--     "Phase 0B containment guard" line) or from the previous migration.
--   * search_path: ALTER FUNCTION ... RESET search_path restores inheritance.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Containment guard helpers
--    Called only from SECURITY DEFINER functions (which execute as the owner),
--    so no API role needs EXECUTE on them.
--    auth.role()/auth.uid() come from the verified request JWT, never from
--    caller-supplied arguments.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sa_assert_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'This operation is restricted to trusted server processes'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sa_assert_actor(p_claimed_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_claimed_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Actor does not match the authenticated user' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Staff guard: active user, role_level <= p_max_role_level, optional HQ org,
-- and (when provided) the claimed actor argument must be the caller.
CREATE OR REPLACE FUNCTION public.sa_assert_staff_actor(
  p_max_role_level integer,
  p_require_hq boolean DEFAULT false,
  p_claimed_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_active boolean;
  v_role_level integer;
  v_org_type text;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_claimed_actor IS NOT NULL AND p_claimed_actor IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Actor does not match the authenticated user' USING ERRCODE = '42501';
  END IF;

  SELECT u.is_active, r.role_level, upper(coalesce(o.org_type_code, ''))
    INTO v_is_active, v_role_level, v_org_type
    FROM public.users u
    LEFT JOIN public.roles r ON r.role_code = u.role_code
    LEFT JOIN public.organizations o ON o.id = u.organization_id
   WHERE u.id = v_uid;

  IF NOT FOUND OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
  END IF;

  IF v_role_level IS NULL OR v_role_level > p_max_role_level THEN
    RAISE EXCEPTION 'Insufficient role for this operation' USING ERRCODE = '42501';
  END IF;

  IF p_require_hq AND v_org_type <> 'HQ' THEN
    RAISE EXCEPTION 'HQ organization required for this operation' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Mirrors app/src/lib/warehouse/shipment-authorization.ts (Phase 0A):
-- active, role_level <= 40, WH user of that warehouse, or HQ user of the
-- warehouse's company.
CREATE OR REPLACE FUNCTION public.sa_assert_warehouse_shipment_actor(p_warehouse_org_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_active boolean;
  v_role_level integer;
  v_org_id uuid;
  v_org_type text;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT u.is_active, r.role_level, u.organization_id, upper(coalesce(o.org_type_code, ''))
    INTO v_is_active, v_role_level, v_org_id, v_org_type
    FROM public.users u
    LEFT JOIN public.roles r ON r.role_code = u.role_code
    LEFT JOIN public.organizations o ON o.id = u.organization_id
   WHERE u.id = v_uid;

  IF NOT FOUND OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Inactive users cannot ship stock' USING ERRCODE = '42501';
  END IF;

  IF v_org_id IS NULL OR p_warehouse_org_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse scope is missing' USING ERRCODE = '42501';
  END IF;

  IF v_role_level IS NULL OR v_role_level > 40 THEN
    RAISE EXCEPTION 'Warehouse shipping permission is required' USING ERRCODE = '42501';
  END IF;

  IF v_org_type IN ('WH', 'WAREHOUSE') THEN
    IF v_org_id = p_warehouse_org_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Shipment belongs to another warehouse' USING ERRCODE = '42501';
  END IF;

  IF v_org_type = 'HQ' THEN
    IF v_org_id = p_warehouse_org_id OR v_org_id = public.get_company_id(p_warehouse_org_id) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Shipment belongs to another organization' USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION 'Only authorized HQ or warehouse users may ship stock' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.sa_assert_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sa_assert_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sa_assert_staff_actor(integer, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sa_assert_warehouse_shipment_actor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sa_assert_service_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.sa_assert_actor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sa_assert_staff_actor(integer, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sa_assert_warehouse_shipment_actor(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 2. Guarded entry points
--    Definitions are the verbatim production definitions (identical on
--    staging) with one inserted "Phase 0B containment guard" statement.
--    Guards were only added to entry points that are not reached from
--    triggers or other functions, so trigger/background paths are unchanged.
-- ---------------------------------------------------------------------------

-- delete_all_transactions_with_inventory_v3(): PERFORM public.sa_assert_service_role();
CREATE OR REPLACE FUNCTION public.delete_all_transactions_with_inventory_v3()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_storage_files_deleted bigint := 0;
  v_count bigint;
  v_start_time timestamp;
  v_end_time timestamp;
  v_table_name text;
  v_tables_deleted text[] := ARRAY[]::text[];

  -- List of tables to delete (we'll check which ones exist)
  v_tables_to_check text[] := ARRAY[
    'consumer_activations',
    'points_transactions',
    'lucky_draw_entries',
    'lucky_draw_order_links',
    'lucky_draw_campaigns',
    'redemption_orders',
    'journey_configurations',
    'qr_validation_reports',
    'stock_movements',
    'product_inventory',
    'qr_codes',
    'qr_master_codes',
    'qr_batches',
    'payments',
    'invoices',
    'shipments',
    'order_items',
    'orders',
    'doc_counters',
    'document_signatures',
    'documents',
    'gl_document_postings',
    'gl_journal_lines',
    'gl_journals'
  ];
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_service_role();
  v_start_time := clock_timestamp();

  RAISE NOTICE 'Starting smart deletion - checking which tables exist...';

  -- Set timeouts
  SET LOCAL statement_timeout = '5min';
  SET LOCAL lock_timeout = '10s';

  -- Truncate each table individually if it exists
  FOREACH v_table_name IN ARRAY v_tables_to_check
  LOOP
    BEGIN
      -- Check if table exists
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = v_table_name
      ) THEN
        -- Table exists, truncate it
        EXECUTE format('TRUNCATE TABLE public.%I CASCADE', v_table_name);
        v_tables_deleted := array_append(v_tables_deleted, v_table_name);
        RAISE NOTICE 'Truncated table: %', v_table_name;
      ELSE
        RAISE NOTICE 'Table % does not exist, skipping', v_table_name;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Could not truncate table %: %', v_table_name, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Truncation complete. Deleted % tables', array_length(v_tables_deleted, 1);

  -- Clean up storage files
  BEGIN
    WITH deleted_files AS (
        SELECT array_agg(name) as paths FROM storage.objects WHERE bucket_id = 'qr-codes'
    )
    SELECT INTO v_count array_length(paths, 1) FROM deleted_files;
    IF v_count > 0 THEN
        v_storage_files_deleted := v_storage_files_deleted + COALESCE(v_count, 0);
        RAISE NOTICE 'Marked % files from qr-codes bucket for deletion', v_count;
    END IF;

    WITH deleted_files AS (
        SELECT array_agg(name) as paths FROM storage.objects WHERE bucket_id = 'documents'
    )
    SELECT INTO v_count array_length(paths, 1) FROM deleted_files;
    IF v_count > 0 THEN
        v_storage_files_deleted := v_storage_files_deleted + COALESCE(v_count, 0);
        RAISE NOTICE 'Marked % files from documents bucket for deletion', v_count;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Could not count storage files: %', SQLERRM;
  END;

  v_end_time := clock_timestamp();

  RETURN jsonb_build_object(
    'success', true,
    'total_records_deleted', 'all',
    'tables_deleted', v_tables_deleted,
    'table_count', array_length(v_tables_deleted, 1),
    'storage_files_deleted', v_storage_files_deleted,
    'method', 'SMART TRUNCATE (checks table existence)',
    'duration_seconds', EXTRACT(EPOCH FROM (v_end_time - v_start_time)),
    'message', format('Deleted data from %s tables successfully', array_length(v_tables_deleted, 1))
  );

END;
$function$;

-- delete_all_transactions_with_inventory(): PERFORM public.sa_assert_service_role();
CREATE OR REPLACE FUNCTION public.delete_all_transactions_with_inventory()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_deleted_counts jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_service_role();
  -- Start transaction (implicit in function)

  -- ==================================================
  -- PHASE 1: DELETE TRANSACTION-RELATED DATA
  -- ==================================================

  -- 1. Delete points transactions (consumer engagement) - if table exists
  BEGIN
    DELETE FROM public.points_transactions
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('points_transactions', v_count);
    RAISE NOTICE 'Deleted % points transactions', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table points_transactions does not exist, skipping';
  END;

  -- ==================================================
  -- PHASE 2: DELETE QR TRACKING DATA
  -- ==================================================

  -- 2. Delete QR codes (individual unit codes)
  BEGIN
    DELETE FROM public.qr_codes
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('qr_codes', v_count);
    RAISE NOTICE 'Deleted % QR codes', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table qr_codes does not exist, skipping';
  END;

  -- 3. Delete QR master codes (case/box codes)
  BEGIN
    DELETE FROM public.qr_master_codes
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('qr_master_codes', v_count);
    RAISE NOTICE 'Deleted % QR master codes', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table qr_master_codes does not exist, skipping';
  END;

  -- 4. Delete QR batches
  BEGIN
    DELETE FROM public.qr_batches
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('qr_batches', v_count);
    RAISE NOTICE 'Deleted % QR batches', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table qr_batches does not exist, skipping';
  END;

  -- ==================================================
  -- PHASE 3: DELETE INVENTORY DATA
  -- ==================================================

  -- 5. Delete all stock movements (audit trail)
  BEGIN
    DELETE FROM public.stock_movements
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('stock_movements', v_count);
    RAISE NOTICE 'Deleted % stock movements', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table stock_movements does not exist, skipping';
  END;

  -- 6. Delete all product inventory records
  -- This resets all inventory counts to zero across all warehouses
  BEGIN
    DELETE FROM public.product_inventory
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('product_inventory', v_count);
    RAISE NOTICE 'Deleted % product inventory records', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table product_inventory does not exist, skipping';
  END;

  -- ==================================================
  -- PHASE 4: DELETE FINANCIAL DATA
  -- ==================================================

  -- 7. Delete payments
  BEGIN
    DELETE FROM public.payments
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('payments', v_count);
    RAISE NOTICE 'Deleted % payments', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table payments does not exist, skipping';
  END;

  -- 8. Delete invoices
  BEGIN
    DELETE FROM public.invoices
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('invoices', v_count);
    RAISE NOTICE 'Deleted % invoices', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table invoices does not exist, skipping';
  END;

  -- ==================================================
  -- PHASE 5: DELETE ORDER DATA
  -- ==================================================

  -- 9. Delete shipments
  BEGIN
    DELETE FROM public.shipments
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('shipments', v_count);
    RAISE NOTICE 'Deleted % shipments', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table shipments does not exist, skipping';
  END;

  -- 10. Delete order items
  BEGIN
    DELETE FROM public.order_items
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('order_items', v_count);
    RAISE NOTICE 'Deleted % order items', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table order_items does not exist, skipping';
  END;

  -- 11. Delete orders
  BEGIN
    DELETE FROM public.orders
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('orders', v_count);
    RAISE NOTICE 'Deleted % orders', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table orders does not exist, skipping';
  END;

  -- ==================================================
  -- PHASE 6: RESET ORDER SEQUENCE COUNTERS
  -- ==================================================
  -- This ensures next order will be 01, not continue from old numbers

  -- 12. Delete all document counters (order numbering sequences)
  BEGIN
    DELETE FROM public.doc_counters
    WHERE id != '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted_counts := v_deleted_counts || jsonb_build_object('doc_counters', v_count);
    RAISE NOTICE 'Deleted % document counters (sequences reset)', v_count;
  EXCEPTION WHEN UNDEFINED_TABLE THEN
    RAISE NOTICE 'Table doc_counters does not exist, skipping';
  END;

  -- ==================================================
  -- RETURN SUMMARY
  -- ==================================================

  RETURN jsonb_build_object(
    'success', true,
    'deleted_counts', v_deleted_counts,
    'total_records', COALESCE(
      (SELECT SUM((value)::integer) FROM jsonb_each_text(v_deleted_counts) WHERE value ~ '^\d+$'),
      0
    ),
    'message', 'All transaction data, inventory, and sequences deleted successfully. Next order will start from 01.'
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Rollback happens automatically
    RAISE EXCEPTION 'Transaction deletion failed: %', SQLERRM;
END;
$function$;

-- hard_delete_organization(uuid): PERFORM public.sa_assert_service_role();
CREATE OR REPLACE FUNCTION public.hard_delete_organization(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_org_type TEXT;
  v_org_name TEXT;
  v_org_code TEXT;
  v_has_orders BOOLEAN := FALSE;
  v_order_count INTEGER := 0;
  v_child_count INTEGER := 0;
  v_user_count INTEGER := 0;
  v_deleted_shop_distributors INTEGER := 0;
  v_deleted_distributor_products INTEGER := 0;
  v_deleted_inventory INTEGER := 0;
  v_deleted_users INTEGER := 0;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_service_role();
  -- Get organization details
  SELECT org_type_code, org_name, org_code
  INTO v_org_type, v_org_name, v_org_code
  FROM public.organizations
  WHERE id = p_org_id;

  -- Check if organization exists
  IF v_org_type IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organization not found',
      'error_code', 'ORG_NOT_FOUND'
    );
  END IF;

  -- Check if organization has any orders (as buyer or seller)
  SELECT
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE buyer_org_id = p_org_id OR seller_org_id = p_org_id
    ),
    COUNT(*)
  INTO v_has_orders, v_order_count
  FROM public.orders
  WHERE buyer_org_id = p_org_id OR seller_org_id = p_org_id;

  IF v_has_orders THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s (%s) cannot be deleted because it has %s order(s) in the system',
        v_org_name, v_org_code, v_order_count),
      'error_code', 'HAS_ORDERS',
      'order_count', v_order_count,
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  END IF;

  -- Check if organization has child organizations
  SELECT COUNT(*) INTO v_child_count
  FROM public.organizations
  WHERE parent_org_id = p_org_id AND is_active = true;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s (%s) cannot be deleted because it has %s active child organization(s)',
        v_org_name, v_org_code, v_child_count),
      'error_code', 'HAS_CHILDREN',
      'child_count', v_child_count,
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  END IF;

  -- Get count of users before deletion
  SELECT COUNT(*) INTO v_user_count
  FROM public.users
  WHERE organization_id = p_org_id;

  -- Begin deletion process
  -- Note: Many tables have ON DELETE CASCADE, so they'll be auto-deleted
  -- We'll track what we explicitly delete

  -- 1. Delete shop_distributors entries (if SHOP)
  IF v_org_type = 'SHOP' THEN
    DELETE FROM public.shop_distributors
    WHERE shop_id = p_org_id;
    GET DIAGNOSTICS v_deleted_shop_distributors = ROW_COUNT;
  END IF;

  -- 2. Delete shop_distributors entries (if DIST - where this org is the distributor)
  IF v_org_type = 'DIST' THEN
    DELETE FROM public.shop_distributors
    WHERE distributor_id = p_org_id;
    GET DIAGNOSTICS v_deleted_shop_distributors = ROW_COUNT;
  END IF;

  -- 3. Delete distributor_products entries (if DIST)
  IF v_org_type = 'DIST' THEN
    DELETE FROM public.distributor_products
    WHERE distributor_id = p_org_id;
    GET DIAGNOSTICS v_deleted_distributor_products = ROW_COUNT;
  END IF;

  -- 4. Delete product inventory (CASCADE will handle this, but we count it)
  SELECT COUNT(*) INTO v_deleted_inventory
  FROM public.product_inventory
  WHERE organization_id = p_org_id;

  -- 5. Delete users (important to do before org deletion)
  DELETE FROM public.users
  WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_deleted_users = ROW_COUNT;

  -- 6. Delete notification settings
  DELETE FROM public.org_notification_settings
  WHERE org_id = p_org_id;

  -- 7. Delete message templates
  DELETE FROM public.message_templates
  WHERE org_id = p_org_id;

  -- 8. Delete journey configurations
  DELETE FROM public.journey_configurations
  WHERE org_id = p_org_id;

  -- 9. Delete points rules
  DELETE FROM public.points_rules
  WHERE org_id = p_org_id;

  -- 10. Finally, delete the organization itself
  -- This will CASCADE delete many related records:
  -- - product_inventory (ON DELETE CASCADE)
  -- - distributor_products (ON DELETE CASCADE)
  -- - shop_distributors (ON DELETE CASCADE)
  -- - child organizations (parent_org_id references)
  DELETE FROM public.organizations
  WHERE id = p_org_id;

  -- Return success with deletion summary
  RETURN jsonb_build_object(
    'success', true,
    'message', format('%s (%s) has been permanently deleted', v_org_name, v_org_code),
    'deleted_organization', jsonb_build_object(
      'id', p_org_id,
      'name', v_org_name,
      'code', v_org_code,
      'type', v_org_type
    ),
    'deleted_related_records', jsonb_build_object(
      'users', v_deleted_users,
      'shop_distributors', v_deleted_shop_distributors,
      'distributor_products', v_deleted_distributor_products,
      'inventory_records', v_deleted_inventory
    )
  );

EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete organization due to foreign key constraint. There may be related records that need to be deleted first.',
      'error_code', 'FOREIGN_KEY_VIOLATION',
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Unexpected error: %s', SQLERRM),
      'error_code', 'UNEXPECTED_ERROR',
      'org_name', v_org_name,
      'org_code', v_org_code
    );
END;
$function$;

-- adjust_inventory_quantity(uuid,uuid,integer): PERFORM public.sa_assert_service_role();
CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(p_variant_id uuid, p_organization_id uuid, p_delta integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_config_id uuid;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_service_role();
  v_config_id := public.resolve_operational_stock_config(p_variant_id);

  UPDATE public.product_inventory
  SET
    quantity_on_hand = quantity_on_hand + p_delta,
    updated_at = now()
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id
    AND stock_config_id = v_config_id;

  IF NOT FOUND THEN
    -- If record doesn't exist, create it (though it should exist if we have
    -- QR codes). The previous body referenced quantity_reserved and the
    -- generated quantity_available column, neither of which is insertable.
    INSERT INTO public.product_inventory (
      variant_id,
      organization_id,
      stock_config_id,
      quantity_on_hand,
      quantity_allocated
    ) VALUES (
      p_variant_id,
      p_organization_id,
      v_config_id,
      GREATEST(p_delta, 0),
      0
    );
  END IF;
END;
$function$;

-- approve_payment_request(uuid): PERFORM public.sa_assert_staff_actor(20, true);
CREATE OR REPLACE FUNCTION public.approve_payment_request(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_req            record;
  v_order_id       uuid;
  v_amount         numeric := 0;
  v_currency       text := 'MYR';
  v_company_id     uuid;
  v_order_type     text;
  v_payment_id     uuid := gen_random_uuid();
  v_payment_no     text;
  v_payment_base   text;
  v_now            timestamptz := now();
  v_existing_pay   uuid;
  v_order          record;
  v_order_json     jsonb;
  v_buyer_org      uuid;
  v_seller_org     uuid;
  v_created_by     uuid;
  v_requested_pct  numeric := 0;
  v_suffix_counter integer := 0;
  v_conflict       boolean := false;
  v_has_final_proof boolean := false;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20, true);
  SELECT *
  INTO v_req
  FROM public.documents d
  WHERE d.id = p_request_id
    AND d.doc_type = 'PAYMENT_REQUEST'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_payment_request(): request % not found or not a PAYMENT_REQUEST', p_request_id;
  END IF;

  BEGIN
    v_order_id := NULLIF((v_req.payload->>'order_id')::uuid, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_order_id := NULL;
  END;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'approve_payment_request(): request % has no order_id in payload', p_request_id;
  END IF;

  BEGIN
    v_amount := COALESCE((v_req.payload->>'requested_amount')::numeric, 0);
  EXCEPTION WHEN OTHERS THEN
    v_amount := 0;
  END;

  BEGIN
    v_requested_pct := COALESCE((v_req.payload->>'requested_percent')::numeric, 0);
  EXCEPTION WHEN OTHERS THEN
    v_requested_pct := 0;
  END;

  BEGIN
    v_currency := COALESCE(NULLIF(v_req.payload->>'currency', ''), 'MYR');
  EXCEPTION WHEN OTHERS THEN
    v_currency := 'MYR';
  END;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'approve_payment_request(): requested_amount must be > 0 for request %', p_request_id;
  END IF;

  SELECT d.id
  INTO v_existing_pay
  FROM public.documents d
  WHERE d.doc_type = 'PAYMENT'
    AND (d.payload ? 'source_request_id')
    AND d.payload->>'source_request_id' = p_request_id::text
  LIMIT 1;

  IF v_existing_pay IS NOT NULL THEN
    IF v_req.status <> 'acknowledged' THEN
      UPDATE public.documents
      SET status = 'acknowledged', updated_at = v_now
      WHERE id = p_request_id;
    END IF;
    RETURN v_existing_pay;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.document_files df
    WHERE df.document_id = p_request_id
  )
  INTO v_has_final_proof;

  IF NOT v_has_final_proof THEN
    RAISE EXCEPTION 'approve_payment_request(): final payment document is required before approval';
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = v_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_payment_request(): order % not found for request %', v_order_id, p_request_id;
  END IF;

  v_order_json := to_jsonb(v_order);

  v_buyer_org := COALESCE(
    NULLIF(v_order_json ->> 'buyer_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'hq_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'customer_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'distributor_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'warehouse_org_id', '')::uuid
  );

  v_seller_org := COALESCE(
    NULLIF(v_order_json ->> 'seller_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'manufacturer_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'vendor_org_id', '')::uuid,
    NULLIF(v_order_json ->> 'supplier_org_id', '')::uuid
  );

  IF v_buyer_org IS NULL OR v_seller_org IS NULL THEN
    RAISE EXCEPTION 'approve_payment_request(): order % missing buyer/seller organization context', v_order_id;
  END IF;

  BEGIN
    v_company_id := NULLIF(v_order_json ->> 'company_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;

  IF v_company_id IS NULL AND v_buyer_org IS NOT NULL THEN
    BEGIN
      v_company_id := public.get_company_id(v_buyer_org);
    EXCEPTION WHEN OTHERS THEN
      v_company_id := NULL;
    END;
  END IF;

  BEGIN
    v_order_type := public.detect_order_type(v_buyer_org, v_seller_org)::text;
  EXCEPTION WHEN OTHERS THEN
    v_order_type := NULL;
  END;

  IF v_order_type IS NULL THEN
    v_order_type := COALESCE(v_order_json ->> 'order_type', 'HM');
  END IF;

  BEGIN
    v_created_by := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_created_by := NULL;
  END;

  IF v_created_by IS NULL THEN
    BEGIN
      v_created_by := COALESCE(v_req.acknowledged_by, v_req.created_by, NULLIF(v_order_json ->> 'approved_by', '')::uuid, NULLIF(v_order_json ->> 'created_by', '')::uuid);
    EXCEPTION WHEN OTHERS THEN
      v_created_by := COALESCE(v_req.acknowledged_by, v_req.created_by);
    END;
  END IF;

  v_payment_no := NULL;
  v_payment_base := NULL;

  IF v_order.order_no IS NOT NULL THEN
    BEGIN
      v_payment_no := NULLIF(public.format_doc_no_from_order('PAY', v_order.order_no), 'PAY-');
    EXCEPTION WHEN OTHERS THEN
      v_payment_no := NULL;
    END;
  END IF;

  IF v_payment_no IS NULL AND v_req.doc_no IS NOT NULL THEN
    BEGIN
      v_payment_no := NULLIF(public.format_doc_no_from_order('PAY', v_req.doc_no), 'PAY-');
    EXCEPTION WHEN OTHERS THEN
      v_payment_no := NULL;
    END;
  END IF;

  IF v_payment_no IS NOT NULL THEN
    v_payment_no := v_payment_no || '-BAL';
  END IF;

  IF v_payment_no IS NULL THEN
    BEGIN
      IF v_company_id IS NOT NULL AND v_order_type IS NOT NULL THEN
        v_payment_no := public.generate_doc_number(v_company_id, 'PAY', v_order_type) || '-BAL';
      ELSE
        v_payment_no := 'PAY-' || to_char(v_now, 'YYMMDDHH24MISS') || '-' || right(encode(gen_random_bytes(2), 'hex'), 4) || '-BAL';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_payment_no := 'PAY-' || to_char(v_now, 'YYMMDDHH24MISS') || '-' || right(encode(gen_random_bytes(2), 'hex'), 4) || '-BAL';
    END;
  END IF;

  v_payment_base := v_payment_no;

  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM public.documents
      WHERE doc_no = v_payment_no
        AND (
          (company_id = v_company_id) OR
          (company_id IS NULL AND v_company_id IS NULL)
        )
    )
    INTO v_conflict;

    EXIT WHEN NOT v_conflict;

    v_suffix_counter := v_suffix_counter + 1;

    IF v_suffix_counter >= 20 THEN
      v_payment_no := v_payment_base || '-' || right(encode(gen_random_bytes(3), 'hex'), 6);
      EXIT;
    END IF;

    v_payment_no := v_payment_base || '-' || LPAD(v_suffix_counter::text, 2, '0');
  END LOOP;

  INSERT INTO public.documents (
    id,
    order_id,
    doc_type,
    doc_no,
    status,
    issued_by_org_id,
    issued_to_org_id,
    company_id,
    payload,
    created_by,
    created_at,
    updated_at,
    payment_percentage
  )
  VALUES (
    v_payment_id,
    v_order_id,
    'PAYMENT',
    v_payment_no,
    'pending',
    v_buyer_org,
    v_seller_org,
    v_company_id,
    jsonb_build_object(
      'order_id', v_order_id::text,
      'source_request_id', p_request_id::text,
      'amount', v_amount,
      'currency', v_currency,
      'note', 'Balance 50% created from approved PAYMENT_REQUEST'
    ),
    v_created_by,
    v_now,
    v_now,
    NULLIF(ROUND(v_requested_pct * 100)::integer, 0)
  );

  IF v_req.status <> 'acknowledged' THEN
    UPDATE public.documents
    SET status = 'acknowledged', updated_at = v_now
    WHERE id = p_request_id;
  END IF;

  BEGIN
    PERFORM public.add_document_signature(p_request_id, auth.uid(), 'HQ_APPROVER');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.notifications_outbox (id, org_id, channel, template_code, payload_json, status, created_at)
    VALUES (
      gen_random_uuid(),
      NULL,
      'inapp',
      'FIN_BALANCE_PAYMENT_CREATED',
      jsonb_build_object(
        'order_id', v_order_id::text,
        'request_id', p_request_id::text,
        'payment_id', v_payment_id::text,
        'payment_no', v_payment_no,
        'amount', v_amount,
        'currency', v_currency
      ),
      'queued',
      v_now
    );
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'notifications_outbox not present; skipping PAYMENT created notification';
  WHEN OTHERS THEN
    RAISE WARNING 'Could not enqueue PAYMENT created notification: %', SQLERRM;
  END;

  RETURN v_payment_id;
END;
$function$;

-- post_payroll_run_to_gl(uuid,date): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.post_payroll_run_to_gl(p_payroll_run_id uuid, p_posting_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_run             record;
    v_company_id      uuid;
    v_journal_id      uuid;
    v_journal_number  text;
    v_total_debit     numeric(18,2) := 0;
    v_total_credit    numeric(18,2) := 0;
    v_line_number     integer := 0;
    v_clearing_id     uuid;
    v_clearing_amount numeric(18,2) := 0;
    v_component       record;
    v_mapping         record;
    v_run_items       record;
    v_missing_maps    text[] := '{}';
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    -- ── 1. Load payroll run ──────────────────────────────────────────
    SELECT pr.*
    INTO v_run
    FROM public.hr_payroll_runs pr
    WHERE pr.id = p_payroll_run_id;

    IF v_run IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payroll run not found');
    END IF;

    -- Resolve company_id (HQ org) from the run's organization
    v_company_id := public.get_company_id(v_run.organization_id);

    IF v_company_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Could not resolve company for organization');
    END IF;

    -- ── 2. Validate status ───────────────────────────────────────────
    IF v_run.status NOT IN ('approved', 'finalized') THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Payroll run must be approved/finalized before posting. Current status: ' || v_run.status);
    END IF;

    IF v_run.gl_status = 'POSTED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payroll run is already posted to GL');
    END IF;

    -- ── 3. Validate posting date in open fiscal period ───────────────
    IF NOT public.is_posting_date_allowed(p_posting_date, v_company_id) THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Posting date ' || p_posting_date || ' is not in an open fiscal period');
    END IF;

    -- ── 4. Validate all components have GL mappings ──────────────────
    -- Check: earnings must have debit mapping, deductions must have credit mapping
    FOR v_component IN
        SELECT DISTINCT pc.id, pc.code, pc.name, pc.category
        FROM public.payroll_components pc
        WHERE pc.company_id = v_company_id AND pc.is_active = true
    LOOP
        SELECT * INTO v_mapping
        FROM public.payroll_component_gl_map m
        WHERE m.company_id = v_company_id
        AND m.component_id = v_component.id
        AND m.is_active = true
        AND (m.effective_from IS NULL OR m.effective_from <= p_posting_date)
        AND (m.effective_to IS NULL OR m.effective_to >= p_posting_date)
        ORDER BY m.effective_from DESC NULLS LAST
        LIMIT 1;

        IF v_mapping IS NULL THEN
            -- Only flag as missing if the component has amounts in this run
            -- (components with 0 amounts don't need mapping)
            v_missing_maps := array_append(v_missing_maps, v_component.name || ' (' || v_component.code || ')');
        END IF;
    END LOOP;

    -- NOTE: We don't block on missing maps — we only block if a component with
    -- actual amounts has no mapping. This is checked during journal line generation.

    -- ── 5. Get payroll clearing account ──────────────────────────────
    SELECT gl_account_id INTO v_clearing_id
    FROM public.payroll_clearing_accounts
    WHERE company_id = v_company_id
    AND account_type = 'CLEARING'
    AND is_default = true
    AND is_active = true
    LIMIT 1;

    -- ── 6. Generate journal lines from payroll run items ─────────────
    -- Clear any prior journal entries for this run (in case of retry)
    DELETE FROM public.payroll_journals WHERE payroll_run_id = p_payroll_run_id;

    -- Aggregate payroll items by component and create journal lines
    -- EARNINGS: Dr Expense, Cr Net Salary Payable
    -- DEDUCTIONS: (no separate Dr — they reduce Net from Gross), Cr Statutory Payable
    -- EMPLOYER: Dr Employer Expense, Cr Statutory Payable

    -- a) BASIC salary aggregate
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.debit_gl_account_id,
        SUM(pri.basic_salary),
        0,
        'Basic Salary - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'BASIC'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.basic_salary > 0
    AND m.debit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.debit_gl_account_id;

    -- b) Overtime aggregate
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.debit_gl_account_id,
        SUM(pri.overtime_amount),
        0,
        'Overtime - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'OT'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.overtime_amount > 0
    AND m.debit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.debit_gl_account_id;

    -- c) Allowances aggregate
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.debit_gl_account_id,
        SUM(pri.allowances_amount),
        0,
        'Allowances - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'ALLOWANCE'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.allowances_amount > 0
    AND m.debit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.debit_gl_account_id;

    -- d) Net Salary Payable (credit side — total net pay)
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.credit_gl_account_id,
        0,
        SUM(pri.net_amount),
        'Net Salary Payable - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'BASIC'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.net_amount > 0
    AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- e) EPF Employee deduction
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.credit_gl_account_id,
        0,
        SUM(pri.epf_employee),
        'EPF Employee Deduction - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'EPF_EE'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.epf_employee > 0
    AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- f) SOCSO Employee deduction
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.credit_gl_account_id,
        0,
        SUM(pri.socso_employee),
        'SOCSO Employee Deduction - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'SOCSO_EE'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.socso_employee > 0
    AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- g) EIS Employee deduction
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.credit_gl_account_id,
        0,
        SUM(pri.eis_employee),
        'EIS Employee Deduction - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'EIS_EE'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.eis_employee > 0
    AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- h) PCB deduction
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.credit_gl_account_id,
        0,
        SUM(pri.pcb_amount),
        'PCB / Income Tax - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'PCB'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.pcb_amount > 0
    AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- i) Employer EPF
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.debit_gl_account_id,
        SUM(pri.epf_employer),
        0,
        'Employer EPF Contribution - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'EPF_ER'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.epf_employer > 0
    AND m.debit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.debit_gl_account_id;

    -- EPF Employer credit (to EPF Payable)
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT
        p_payroll_run_id,
        pc.id,
        m.credit_gl_account_id,
        0,
        SUM(pri.epf_employer),
        'Employer EPF Payable - ' || to_char(v_run.period_start, 'Mon YYYY'),
        COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'EPF_ER'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id
    AND pri.epf_employer > 0
    AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- j) Employer SOCSO (debit + credit)
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT p_payroll_run_id, pc.id, m.debit_gl_account_id, SUM(pri.socso_employer), 0,
        'Employer SOCSO - ' || to_char(v_run.period_start, 'Mon YYYY'), COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'SOCSO_ER'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id AND pri.socso_employer > 0 AND m.debit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.debit_gl_account_id;

    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT p_payroll_run_id, pc.id, m.credit_gl_account_id, 0, SUM(pri.socso_employer),
        'Employer SOCSO Payable - ' || to_char(v_run.period_start, 'Mon YYYY'), COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'SOCSO_ER'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id AND pri.socso_employer > 0 AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- k) Employer EIS (debit + credit)
    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT p_payroll_run_id, pc.id, m.debit_gl_account_id, SUM(pri.eis_employer), 0,
        'Employer EIS - ' || to_char(v_run.period_start, 'Mon YYYY'), COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'EIS_ER'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id AND pri.eis_employer > 0 AND m.debit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.debit_gl_account_id;

    INSERT INTO public.payroll_journals (payroll_run_id, component_id, gl_account_id, dr_amount, cr_amount, description, employee_count)
    SELECT p_payroll_run_id, pc.id, m.credit_gl_account_id, 0, SUM(pri.eis_employer),
        'Employer EIS Payable - ' || to_char(v_run.period_start, 'Mon YYYY'), COUNT(*)
    FROM public.hr_payroll_run_items pri
    JOIN public.payroll_components pc ON pc.company_id = v_company_id AND pc.code = 'EIS_ER'
    LEFT JOIN public.payroll_component_gl_map m ON m.component_id = pc.id AND m.company_id = v_company_id AND m.is_active = true
    WHERE pri.payroll_run_id = p_payroll_run_id AND pri.eis_employer > 0 AND m.credit_gl_account_id IS NOT NULL
    GROUP BY pc.id, m.credit_gl_account_id;

    -- ── 7. Validate balance ──────────────────────────────────────────
    SELECT COALESCE(SUM(dr_amount), 0), COALESCE(SUM(cr_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM public.payroll_journals
    WHERE payroll_run_id = p_payroll_run_id;

    IF v_total_debit <> v_total_credit THEN
        -- Imbalance — use clearing account if configured
        IF v_clearing_id IS NOT NULL THEN
            v_clearing_amount := v_total_debit - v_total_credit;
            IF v_clearing_amount > 0 THEN
                INSERT INTO public.payroll_journals (payroll_run_id, gl_account_id, dr_amount, cr_amount, description)
                VALUES (p_payroll_run_id, v_clearing_id, 0, v_clearing_amount, 'Payroll Clearing (auto-balance)');
                v_total_credit := v_total_credit + v_clearing_amount;
            ELSE
                INSERT INTO public.payroll_journals (payroll_run_id, gl_account_id, dr_amount, cr_amount, description)
                VALUES (p_payroll_run_id, v_clearing_id, ABS(v_clearing_amount), 0, 'Payroll Clearing (auto-balance)');
                v_total_debit := v_total_debit + ABS(v_clearing_amount);
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'error',
                'Payroll journal is not balanced (Dr: ' || v_total_debit || ' Cr: ' || v_total_credit ||
                '). Configure a Payroll Clearing account to auto-balance.');
        END IF;
    END IF;

    -- Final balance check
    IF v_total_debit <> v_total_credit THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Journal still not balanced after clearing adjustment');
    END IF;

    IF v_total_debit = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No journal lines generated — check GL mappings');
    END IF;

    -- ── 8. Create GL Journal ─────────────────────────────────────────
    v_journal_number := public.generate_journal_number(v_company_id, 'PAYROLL');

    INSERT INTO public.gl_journals (
        company_id, journal_number, journal_date, posting_date,
        description, journal_type, status,
        total_debit, total_credit,
        created_by, posted_by, posted_at
    ) VALUES (
        v_company_id, v_journal_number, p_posting_date, p_posting_date,
        'Payroll - ' || to_char(v_run.period_start, 'Mon YYYY') ||
        ' (' || (SELECT COUNT(*) FROM hr_payroll_run_items WHERE payroll_run_id = p_payroll_run_id) || ' employees)',
        'PAYROLL', 'POSTED',
        v_total_debit, v_total_credit,
        auth.uid(), auth.uid(), now()
    ) RETURNING id INTO v_journal_id;

    -- ── 9. Create GL Journal Lines from payroll_journals ─────────────
    INSERT INTO public.gl_journal_lines (
        journal_id, account_id, line_number, description,
        debit_amount, credit_amount, entity_type, created_by
    )
    SELECT
        v_journal_id,
        pj.gl_account_id,
        ROW_NUMBER() OVER (ORDER BY pj.created_at),
        pj.description,
        pj.dr_amount,
        pj.cr_amount,
        'EMPLOYEE',
        auth.uid()
    FROM public.payroll_journals pj
    WHERE pj.payroll_run_id = p_payroll_run_id
    AND (pj.dr_amount > 0 OR pj.cr_amount > 0);

    -- ── 10. Record in document postings (for idempotency) ────────────
    INSERT INTO public.gl_document_postings (
        company_id, document_type, document_id, document_number,
        journal_id, posted_amount, posting_status, created_by
    ) VALUES (
        v_company_id, 'PAYROLL_RUN', p_payroll_run_id,
        COALESCE(v_run.run_number, 'PR-' || to_char(v_run.period_start, 'YYYYMM')),
        v_journal_id, v_total_debit, 'POSTED', auth.uid()
    );

    -- ── 11. Update payroll run GL status ─────────────────────────────
    UPDATE public.hr_payroll_runs
    SET gl_journal_id = v_journal_id,
        gl_status = 'POSTED',
        gl_posted_at = now(),
        posted_at = now(),
        posted_by = auth.uid()
    WHERE id = p_payroll_run_id;

    -- ── 12. Audit log ────────────────────────────────────────────────
    INSERT INTO public.hr_payroll_audit (organization_id, payroll_run_id, actor_user_id, action, metadata)
    VALUES (v_run.organization_id, p_payroll_run_id, auth.uid(), 'GL_POSTED', jsonb_build_object(
        'journal_id', v_journal_id,
        'journal_number', v_journal_number,
        'total_debit', v_total_debit,
        'total_credit', v_total_credit,
        'posting_date', p_posting_date
    ));

    RETURN jsonb_build_object(
        'success', true,
        'journal_id', v_journal_id,
        'journal_number', v_journal_number,
        'total_debit', v_total_debit,
        'total_credit', v_total_credit,
        'lines_created', (SELECT COUNT(*) FROM payroll_journals WHERE payroll_run_id = p_payroll_run_id),
        'posting_date', p_posting_date
    );
END;
$function$;

-- post_payroll_payment_to_gl(uuid,date): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.post_payroll_payment_to_gl(p_payment_batch_id uuid, p_posting_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_batch          record;
    v_company_id     uuid;
    v_journal_id     uuid;
    v_journal_number text;
    v_clearing_id    uuid;
    v_bank_gl_id     uuid;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    SELECT * INTO v_batch
    FROM public.payroll_payment_batches
    WHERE id = p_payment_batch_id;

    IF v_batch IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment batch not found');
    END IF;

    v_company_id := v_batch.company_id;

    IF v_batch.status <> 'COMPLETED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment must be completed before posting');
    END IF;

    IF v_batch.gl_journal_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment already posted to GL');
    END IF;

    -- Get clearing account
    SELECT gl_account_id INTO v_clearing_id
    FROM public.payroll_clearing_accounts
    WHERE company_id = v_company_id AND account_type = 'CLEARING' AND is_default = true AND is_active = true
    LIMIT 1;

    -- Get bank GL account from the payment batch's bank account
    SELECT pca.gl_account_id INTO v_bank_gl_id
    FROM public.payroll_clearing_accounts pca
    WHERE pca.id = v_batch.bank_account_id;

    -- Fallback to the default cash account
    IF v_bank_gl_id IS NULL THEN
        SELECT cash_account_id INTO v_bank_gl_id
        FROM public.gl_settings
        WHERE company_id = v_company_id;
    END IF;

    IF v_bank_gl_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bank/cash GL account configured');
    END IF;

    -- For salary payment: Dr Net Salary Payable, Cr Cash/Bank
    v_journal_number := public.generate_journal_number(v_company_id, 'PAYROLL_PAYMENT');

    INSERT INTO public.gl_journals (
        company_id, journal_number, journal_date, posting_date,
        description, journal_type, status,
        total_debit, total_credit,
        created_by, posted_by, posted_at
    ) VALUES (
        v_company_id, v_journal_number, p_posting_date, p_posting_date,
        'Payroll Payment - Batch ' || v_batch.batch_number,
        'PAYROLL_PAYMENT', 'POSTED',
        v_batch.total_amount, v_batch.total_amount,
        auth.uid(), auth.uid(), now()
    ) RETURNING id INTO v_journal_id;

    -- Dr: Net Salary Payable (clear the liability)
    INSERT INTO public.gl_journal_lines (journal_id, account_id, line_number, description, debit_amount, credit_amount, created_by)
    SELECT v_journal_id,
        (SELECT id FROM gl_accounts WHERE company_id = v_company_id AND code = '2200' LIMIT 1),
        1, 'Clear Net Salary Payable', v_batch.total_amount, 0, auth.uid();

    -- Cr: Cash/Bank
    INSERT INTO public.gl_journal_lines (journal_id, account_id, line_number, description, debit_amount, credit_amount, created_by)
    VALUES (v_journal_id, v_bank_gl_id, 2, 'Bank Payment - Salaries', 0, v_batch.total_amount, auth.uid());

    -- Update batch
    UPDATE public.payroll_payment_batches
    SET gl_journal_id = v_journal_id, updated_at = now()
    WHERE id = p_payment_batch_id;

    -- Record in document postings
    INSERT INTO public.gl_document_postings (
        company_id, document_type, document_id, document_number,
        journal_id, posted_amount, posting_status, created_by
    ) VALUES (
        v_company_id, 'PAYROLL_PAYMENT', p_payment_batch_id,
        v_batch.batch_number, v_journal_id, v_batch.total_amount, 'POSTED', auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'journal_id', v_journal_id,
        'journal_number', v_journal_number,
        'amount', v_batch.total_amount,
        'message', 'Payroll payment posted to GL'
    );
END;
$function$;

-- reverse_payroll_gl_posting(uuid,text,date): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.reverse_payroll_gl_posting(p_payroll_run_id uuid, p_reason text DEFAULT 'Payroll rerun'::text, p_reversal_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_run           record;
    v_journal_id    uuid;
    v_result        jsonb;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    SELECT * INTO v_run
    FROM public.hr_payroll_runs
    WHERE id = p_payroll_run_id;

    IF v_run IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payroll run not found');
    END IF;

    IF v_run.gl_status <> 'POSTED' OR v_run.gl_journal_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payroll run has no GL posting to reverse');
    END IF;

    -- Use the existing reverse_gl_journal function
    v_result := public.reverse_gl_journal(v_run.gl_journal_id, p_reason, p_reversal_date);

    IF NOT (v_result->>'success')::boolean THEN
        RETURN v_result;
    END IF;

    -- Update payroll run
    UPDATE public.hr_payroll_runs
    SET gl_status = 'REVERSED',
        gl_reversal_journal_id = (v_result->>'reversal_journal_id')::uuid
    WHERE id = p_payroll_run_id;

    -- Update document posting
    UPDATE public.gl_document_postings
    SET posting_status = 'REVERSED'
    WHERE document_type = 'PAYROLL_RUN' AND document_id = p_payroll_run_id;

    -- Audit
    INSERT INTO public.hr_payroll_audit (organization_id, payroll_run_id, actor_user_id, action, metadata)
    VALUES (v_run.organization_id, p_payroll_run_id, auth.uid(), 'GL_REVERSED', jsonb_build_object(
        'original_journal_id', v_run.gl_journal_id,
        'reversal_journal_id', v_result->>'reversal_journal_id',
        'reason', p_reason,
        'reversal_date', p_reversal_date
    ));

    RETURN jsonb_build_object(
        'success', true,
        'original_journal_id', v_run.gl_journal_id,
        'reversal_journal_id', v_result->>'reversal_journal_id',
        'message', 'Payroll GL posting reversed successfully'
    );
END;
$function$;

-- seed_hr_gl_accounts(uuid): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.seed_hr_gl_accounts(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_count integer := 0;
    v_accounts jsonb := '[]'::jsonb;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    -- Salary / Payroll Expense accounts
    INSERT INTO public.gl_accounts (company_id, code, name, account_type, subtype, description, normal_balance, is_system)
    VALUES
        (p_company_id, '6100', 'Salaries & Wages Expense',        'EXPENSE', 'Operating Expense',  'Basic salary and wages',                 'DEBIT',  true),
        (p_company_id, '6110', 'Overtime Expense',                 'EXPENSE', 'Operating Expense',  'Overtime payments',                      'DEBIT',  false),
        (p_company_id, '6120', 'Allowance Expense',                'EXPENSE', 'Operating Expense',  'Employee allowances (transport, meal)',   'DEBIT',  false),
        (p_company_id, '6130', 'Bonus & Incentive Expense',        'EXPENSE', 'Operating Expense',  'Performance bonuses and incentives',     'DEBIT',  false),
        (p_company_id, '6140', 'Commission Expense',               'EXPENSE', 'Operating Expense',  'Sales commissions',                      'DEBIT',  false),
        (p_company_id, '6150', 'Employer EPF Expense',             'EXPENSE', 'Operating Expense',  'Employer EPF contribution',              'DEBIT',  true),
        (p_company_id, '6160', 'Employer SOCSO Expense',           'EXPENSE', 'Operating Expense',  'Employer SOCSO contribution',            'DEBIT',  true),
        (p_company_id, '6170', 'Employer EIS Expense',             'EXPENSE', 'Operating Expense',  'Employer EIS contribution',              'DEBIT',  true),
        (p_company_id, '6180', 'Staff Claims Expense',             'EXPENSE', 'Operating Expense',  'Approved employee expense claims',       'DEBIT',  false),
        -- Payable / Liability accounts
        (p_company_id, '2200', 'Net Salary Payable',               'LIABILITY', 'Current Liability', 'Net pay owed to employees',             'CREDIT', true),
        (p_company_id, '2210', 'EPF Payable',                      'LIABILITY', 'Current Liability', 'EPF contributions payable',             'CREDIT', true),
        (p_company_id, '2220', 'SOCSO Payable',                    'LIABILITY', 'Current Liability', 'SOCSO contributions payable',           'CREDIT', true),
        (p_company_id, '2230', 'EIS Payable',                      'LIABILITY', 'Current Liability', 'EIS contributions payable',             'CREDIT', true),
        (p_company_id, '2240', 'PCB / Tax Payable',                'LIABILITY', 'Current Liability', 'Employee tax deductions payable',       'CREDIT', true),
        (p_company_id, '2250', 'Other Deductions Payable',         'LIABILITY', 'Current Liability', 'Other payroll deductions payable',      'CREDIT', false),
        (p_company_id, '2260', 'Employee Claims Payable',          'LIABILITY', 'Current Liability', 'Approved but unpaid expense claims',    'CREDIT', false),
        -- Payroll Clearing / Control account
        (p_company_id, '2300', 'Payroll Clearing',                 'LIABILITY', 'Control',           'Payroll clearing/contra account',       'CREDIT', true)
    ON CONFLICT (company_id, code) DO NOTHING;

    -- Count what was actually inserted
    SELECT count(*) INTO v_count
    FROM public.gl_accounts
    WHERE company_id = p_company_id
    AND code IN ('6100','6110','6120','6130','6140','6150','6160','6170','6180',
                 '2200','2210','2220','2230','2240','2250','2260','2300');

    RETURN jsonb_build_object(
        'success', true,
        'accounts_count', v_count,
        'message', 'HR GL accounts seeded for company'
    );
END;
$function$;

-- seed_payroll_components(uuid): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.seed_payroll_components(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_count integer;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    INSERT INTO public.payroll_components (company_id, code, name, category, is_statutory, is_taxable, sort_order, description)
    VALUES
        -- Earnings
        (p_company_id, 'BASIC',         'Basic Salary',                  'earning',    false, true,  10, 'Monthly basic salary'),
        (p_company_id, 'OT',            'Overtime',                      'earning',    false, true,  20, 'Overtime payments'),
        (p_company_id, 'ALLOWANCE',     'Fixed Allowance',               'earning',    false, true,  30, 'Recurring allowances'),
        (p_company_id, 'BONUS',         'Bonus / Incentive',             'earning',    false, true,  40, 'Performance bonus'),
        (p_company_id, 'COMMISSION',    'Commission',                    'earning',    false, true,  50, 'Sales commission'),
        -- Deductions (employee portion)
        (p_company_id, 'EPF_EE',        'EPF (Employee)',                'deduction',  true,  false, 100, 'Employee EPF contribution'),
        (p_company_id, 'SOCSO_EE',      'SOCSO (Employee)',              'deduction',  true,  false, 110, 'Employee SOCSO contribution'),
        (p_company_id, 'EIS_EE',        'EIS (Employee)',                'deduction',  true,  false, 120, 'Employee EIS contribution'),
        (p_company_id, 'PCB',           'PCB / Income Tax',              'deduction',  true,  false, 130, 'Monthly tax deduction'),
        (p_company_id, 'OTHER_DED',     'Other Deductions',              'deduction',  false, false, 200, 'Miscellaneous deductions'),
        -- Employer contributions
        (p_company_id, 'EPF_ER',        'EPF (Employer)',                'employer',   true,  false, 300, 'Employer EPF contribution'),
        (p_company_id, 'SOCSO_ER',      'SOCSO (Employer)',              'employer',   true,  false, 310, 'Employer SOCSO contribution'),
        (p_company_id, 'EIS_ER',        'EIS (Employer)',                'employer',   true,  false, 320, 'Employer EIS contribution')
    ON CONFLICT (company_id, code) DO NOTHING;

    SELECT count(*) INTO v_count
    FROM public.payroll_components
    WHERE company_id = p_company_id;

    RETURN jsonb_build_object(
        'success', true,
        'components_count', v_count,
        'message', 'Default payroll components seeded'
    );
END;
$function$;

-- seed_payroll_gl_mappings(uuid): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.seed_payroll_gl_mappings(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_count integer;
    v_component record;
    v_debit_id uuid;
    v_credit_id uuid;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    FOR v_component IN
        SELECT pc.id, pc.code, pc.category
        FROM public.payroll_components pc
        WHERE pc.company_id = p_company_id AND pc.is_active = true
    LOOP
        -- Determine default GL account IDs based on component code
        v_debit_id := NULL;
        v_credit_id := NULL;

        CASE v_component.code
            WHEN 'BASIC' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6100';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2200';
            WHEN 'OT' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6110';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2200';
            WHEN 'ALLOWANCE' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6120';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2200';
            WHEN 'BONUS' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6130';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2200';
            WHEN 'COMMISSION' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6140';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2200';
            -- Deductions: no debit (reduces net pay), credit the liability
            WHEN 'EPF_EE' THEN
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2210';
            WHEN 'SOCSO_EE' THEN
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2220';
            WHEN 'EIS_EE' THEN
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2230';
            WHEN 'PCB' THEN
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2240';
            WHEN 'OTHER_DED' THEN
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2250';
            -- Employer contributions
            WHEN 'EPF_ER' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6150';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2210';
            WHEN 'SOCSO_ER' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6160';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2220';
            WHEN 'EIS_ER' THEN
                SELECT id INTO v_debit_id  FROM gl_accounts WHERE company_id = p_company_id AND code = '6170';
                SELECT id INTO v_credit_id FROM gl_accounts WHERE company_id = p_company_id AND code = '2230';
            ELSE
                CONTINUE;
        END CASE;

        -- Only insert if at least one side is mapped
        IF v_debit_id IS NOT NULL OR v_credit_id IS NOT NULL THEN
            INSERT INTO public.payroll_component_gl_map (
                company_id, component_id, debit_gl_account_id, credit_gl_account_id,
                is_active, created_by
            ) VALUES (
                p_company_id, v_component.id, v_debit_id, v_credit_id,
                true, auth.uid()
            )
            ON CONFLICT (company_id, component_id, effective_from) DO NOTHING;
        END IF;
    END LOOP;

    SELECT count(*) INTO v_count
    FROM public.payroll_component_gl_map
    WHERE company_id = p_company_id;

    RETURN jsonb_build_object(
        'success', true,
        'mappings_count', v_count,
        'message', 'Default payroll GL mappings seeded'
    );
END;
$function$;

-- generate_fiscal_periods(uuid,text): PERFORM public.sa_assert_staff_actor(20);
CREATE OR REPLACE FUNCTION public.generate_fiscal_periods(p_fiscal_year_id uuid, p_period_type text DEFAULT 'monthly'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_fiscal_year record;
    v_period_start date;
    v_period_end date;
    v_period_number integer;
    v_period_name text;
    v_periods_created integer := 0;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20);
    -- Get fiscal year details
    SELECT * INTO v_fiscal_year
    FROM public.fiscal_years
    WHERE id = p_fiscal_year_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fiscal year not found';
    END IF;

    -- Delete existing periods for this fiscal year (if regenerating)
    DELETE FROM public.fiscal_periods WHERE fiscal_year_id = p_fiscal_year_id;

    IF p_period_type = 'monthly' THEN
        -- Generate 12 monthly periods
        v_period_start := v_fiscal_year.start_date;
        v_period_number := 1;

        WHILE v_period_start < v_fiscal_year.end_date AND v_period_number <= 12 LOOP
            v_period_end := (v_period_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

            -- Don't exceed fiscal year end
            IF v_period_end > v_fiscal_year.end_date THEN
                v_period_end := v_fiscal_year.end_date;
            END IF;

            v_period_name := TO_CHAR(v_period_start, 'Month YYYY');

            INSERT INTO public.fiscal_periods (
                company_id, fiscal_year_id, period_number, period_name,
                start_date, end_date, status, period_type
            ) VALUES (
                v_fiscal_year.company_id, p_fiscal_year_id, v_period_number, v_period_name,
                v_period_start, v_period_end,
                CASE WHEN CURRENT_DATE BETWEEN v_period_start AND v_period_end THEN 'open'
                     WHEN CURRENT_DATE < v_period_start THEN 'future'
                     ELSE 'open' END,
                'normal'
            );

            v_periods_created := v_periods_created + 1;
            v_period_start := v_period_start + INTERVAL '1 month';
            v_period_number := v_period_number + 1;
        END LOOP;

    ELSIF p_period_type = 'quarterly' THEN
        -- Generate 4 quarterly periods
        v_period_start := v_fiscal_year.start_date;
        v_period_number := 1;

        WHILE v_period_start < v_fiscal_year.end_date AND v_period_number <= 4 LOOP
            v_period_end := (v_period_start + INTERVAL '3 months' - INTERVAL '1 day')::date;

            IF v_period_end > v_fiscal_year.end_date THEN
                v_period_end := v_fiscal_year.end_date;
            END IF;

            v_period_name := 'Q' || v_period_number || ' ' || TO_CHAR(v_period_start, 'YYYY');

            INSERT INTO public.fiscal_periods (
                company_id, fiscal_year_id, period_number, period_name,
                start_date, end_date, status, period_type
            ) VALUES (
                v_fiscal_year.company_id, p_fiscal_year_id, v_period_number, v_period_name,
                v_period_start, v_period_end,
                CASE WHEN CURRENT_DATE BETWEEN v_period_start AND v_period_end THEN 'open'
                     WHEN CURRENT_DATE < v_period_start THEN 'future'
                     ELSE 'open' END,
                'normal'
            );

            v_periods_created := v_periods_created + 1;
            v_period_start := v_period_start + INTERVAL '3 months';
            v_period_number := v_period_number + 1;
        END LOOP;
    END IF;

    RETURN v_periods_created;
END;
$function$;

-- backfill_display_doc_numbers(uuid): PERFORM public.sa_assert_staff_actor(10);
CREATE OR REPLACE FUNCTION public.backfill_display_doc_numbers(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_job_id uuid;
    v_orders_processed integer := 0;
    v_docs_processed integer := 0;
    v_failed integer := 0;
    v_order_record RECORD;
    v_doc_record RECORD;
    v_display_no text;
    v_prefix text;
    v_year integer;
    v_running_job uuid;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(10);
    -- Check for running jobs
    SELECT id INTO v_running_job
    FROM public.doc_migration_jobs
    WHERE company_id = p_company_id
      AND status = 'running'
      AND started_at > NOW() - INTERVAL '1 hour';

    IF v_running_job IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Migration already in progress',
            'job_id', v_running_job
        );
    END IF;

    -- Create job record
    INSERT INTO public.doc_migration_jobs (company_id, status)
    VALUES (p_company_id, 'running')
    RETURNING id INTO v_job_id;

    BEGIN
        -- Process orders without display_doc_no
        FOR v_order_record IN
            SELECT id, order_no, created_at
            FROM public.orders
            WHERE company_id = p_company_id
              AND display_doc_no IS NULL
              AND order_no IS NOT NULL
            ORDER BY created_at ASC, id ASC
        LOOP
            BEGIN
                v_prefix := get_display_prefix_from_legacy(v_order_record.order_no, NULL);
                v_year := EXTRACT(YEAR FROM v_order_record.created_at)::integer;
                v_display_no := generate_display_doc_number(p_company_id, v_prefix, v_year);

                UPDATE public.orders
                SET display_doc_no = v_display_no
                WHERE id = v_order_record.id;

                v_orders_processed := v_orders_processed + 1;
            EXCEPTION WHEN OTHERS THEN
                v_failed := v_failed + 1;
                RAISE NOTICE 'Failed to process order %: %', v_order_record.id, SQLERRM;
            END;
        END LOOP;

        -- Process documents without display_doc_no
        -- FIX: Cast doc_type to text in the SELECT!
        FOR v_doc_record IN
            SELECT id, doc_no, doc_type::text as doc_type_text, created_at
            FROM public.documents
            WHERE company_id = p_company_id
              AND display_doc_no IS NULL
              AND doc_no IS NOT NULL
            ORDER BY created_at ASC, id ASC
        LOOP
            BEGIN
                v_prefix := get_display_prefix_from_legacy(v_doc_record.doc_no, v_doc_record.doc_type_text);
                v_year := EXTRACT(YEAR FROM v_doc_record.created_at)::integer;
                v_display_no := generate_display_doc_number(p_company_id, v_prefix, v_year);

                UPDATE public.documents
                SET display_doc_no = v_display_no
                WHERE id = v_doc_record.id;

                v_docs_processed := v_docs_processed + 1;
            EXCEPTION WHEN OTHERS THEN
                v_failed := v_failed + 1;
                RAISE NOTICE 'Failed to process document %: %', v_doc_record.id, SQLERRM;
            END;
        END LOOP;

        -- Mark job as completed
        UPDATE public.doc_migration_jobs
        SET status = 'completed',
            completed_at = NOW(),
            records_processed = v_orders_processed + v_docs_processed,
            records_failed = v_failed
        WHERE id = v_job_id;

        RETURN jsonb_build_object(
            'success', true,
            'job_id', v_job_id,
            'records_processed', v_orders_processed + v_docs_processed,
            'orders_processed', v_orders_processed,
            'documents_processed', v_docs_processed,
            'records_failed', v_failed
        );
    EXCEPTION WHEN OTHERS THEN
        -- Mark job as failed
        UPDATE public.doc_migration_jobs
        SET status = 'failed',
            completed_at = NOW(),
            error_message = SQLERRM,
            records_failed = v_failed
        WHERE id = v_job_id;

        RETURN jsonb_build_object(
            'success', false,
            'job_id', v_job_id,
            'error', SQLERRM,
            'records_failed', v_failed
        );
    END;
END;
$function$;

-- process_referral_claim(uuid,text,uuid,text,text): PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);
CREATE OR REPLACE FUNCTION public.process_referral_claim(p_claim_id uuid, p_action text, p_reviewer_id uuid, p_reason text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim record;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);
  SELECT * INTO v_claim FROM public.referral_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Claim not found');
  END IF;

  IF p_action = 'approve' THEN
    IF v_claim.status != 'pending' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Claim is not pending');
    END IF;

    UPDATE public.referral_claims
    SET status = 'approved',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        approval_notes = p_reason
    WHERE id = p_claim_id;

  ELSIF p_action = 'reject' THEN
    IF v_claim.status != 'pending' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Claim is not pending');
    END IF;

    UPDATE public.referral_claims
    SET status = 'rejected',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        rejection_reason = p_reason
    WHERE id = p_claim_id;

  ELSIF p_action = 'mark_paid' THEN
    IF v_claim.status != 'approved' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Claim must be approved before marking paid');
    END IF;

    UPDATE public.referral_claims
    SET status = 'paid',
        paid_by = p_reviewer_id,
        paid_at = now(),
        payment_reference = p_payment_reference
    WHERE id = p_claim_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid action');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'claim_id', p_claim_id,
    'action', p_action,
    'new_status', p_action
  );
END;
$function$;

-- approve_reference_change(uuid,text,uuid,text): PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);
CREATE OR REPLACE FUNCTION public.approve_reference_change(p_change_id uuid, p_action text, p_reviewer_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_change record;
  v_assignment_id uuid;
  v_new_ref_user record;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);
  SELECT * INTO v_change FROM public.reference_change_log WHERE id = p_change_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Change request not found');
  END IF;

  IF v_change.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Change request is not pending');
  END IF;

  IF p_action = 'approve' THEN
    -- Close old assignment
    UPDATE public.reference_assignments
    SET effective_to = now()
    WHERE shop_user_id = v_change.shop_user_id
      AND effective_to IS NULL;

    -- Resolve new reference user
    SELECT id, full_name INTO v_new_ref_user
    FROM public.users
    WHERE phone = (
      CASE
        WHEN v_change.new_reference_phone LIKE '+6%' THEN regexp_replace(v_change.new_reference_phone, '[^0-9+]', '', 'g')
        WHEN regexp_replace(v_change.new_reference_phone, '[^0-9]', '', 'g') LIKE '0%' THEN '+6' || regexp_replace(v_change.new_reference_phone, '[^0-9]', '', 'g')
        ELSE '+60' || regexp_replace(v_change.new_reference_phone, '[^0-9]', '', 'g')
      END
    )
    LIMIT 1;

    -- Create new assignment
    INSERT INTO public.reference_assignments (
      org_id, shop_user_id, reference_user_id, reference_phone,
      effective_from, change_source, created_by
    )
    VALUES (
      v_change.org_id, v_change.shop_user_id, v_new_ref_user.id, v_change.new_reference_phone,
      now(), 'admin', p_reviewer_id
    )
    RETURNING id INTO v_assignment_id;

    -- Update users.referral_phone
    UPDATE public.users
    SET referral_phone = v_change.new_reference_phone,
        updated_at = now()
    WHERE id = v_change.shop_user_id;

    -- Update change log
    UPDATE public.reference_change_log
    SET status = 'approved',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        effective_from = now(),
        assignment_id = v_assignment_id
    WHERE id = p_change_id;

  ELSIF p_action = 'reject' THEN
    UPDATE public.reference_change_log
    SET status = 'rejected',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        rejection_reason = p_reason
    WHERE id = p_change_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid action. Use approve or reject.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'change_id', p_change_id,
    'action', p_action,
    'assignment_id', v_assignment_id
  );
END;
$function$;

-- bulk_reassign_reference(uuid,uuid,uuid,boolean): PERFORM public.sa_assert_staff_actor(20, false, p_admin_id);
CREATE OR REPLACE FUNCTION public.bulk_reassign_reference(p_old_reference_id uuid, p_new_reference_id uuid, p_admin_id uuid, p_transfer_balance boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_assignment record;
  v_new_ref_user record;
  v_old_balance_points bigint;
  v_old_balance_rm numeric(12,2);
  v_org_id uuid;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(20, false, p_admin_id);
  -- Get new reference user
  SELECT * INTO v_new_ref_user FROM public.users WHERE id = p_new_reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'New reference user not found');
  END IF;

  -- Get org
  SELECT id INTO v_org_id FROM public.organizations WHERE org_type_code = 'HQ' LIMIT 1;

  -- Close all active assignments for old reference
  FOR v_assignment IN
    SELECT * FROM public.reference_assignments
    WHERE reference_user_id = p_old_reference_id
      AND effective_to IS NULL
  LOOP
    -- Close old
    UPDATE public.reference_assignments
    SET effective_to = now()
    WHERE id = v_assignment.id;

    -- Create new
    INSERT INTO public.reference_assignments (
      org_id, shop_user_id, reference_user_id, reference_phone,
      effective_from, change_source, created_by
    )
    VALUES (
      v_assignment.org_id, v_assignment.shop_user_id, p_new_reference_id, v_new_ref_user.phone,
      now(), 'bulk_reassign', p_admin_id
    );

    -- Update users.referral_phone
    UPDATE public.users
    SET referral_phone = v_new_ref_user.phone,
        updated_at = now()
    WHERE id = v_assignment.shop_user_id;

    -- Log the change
    INSERT INTO public.reference_change_log (
      org_id, shop_user_id,
      old_reference_id, old_reference_phone,
      new_reference_id, new_reference_phone, new_reference_name,
      changed_by, changed_by_type, policy_mode, status,
      effective_from
    )
    VALUES (
      v_assignment.org_id, v_assignment.shop_user_id,
      p_old_reference_id, v_assignment.reference_phone,
      p_new_reference_id, v_new_ref_user.phone, v_new_ref_user.full_name,
      p_admin_id, 'admin', 'auto', 'auto_approved',
      now()
    );

    v_count := v_count + 1;
  END LOOP;

  -- Optional: transfer remaining balance
  IF p_transfer_balance THEN
    -- Calculate old reference claimable balance
    SELECT
      COALESCE(sum(rac.points_amount), 0) -
      COALESCE((SELECT sum(rc.claim_points) FROM public.referral_claims rc
                WHERE rc.reference_user_id = p_old_reference_id AND rc.status IN ('approved','paid')), 0)
    INTO v_old_balance_points
    FROM public.referral_accruals rac
    WHERE rac.reference_user_id = p_old_reference_id;

    IF v_old_balance_points > 0 THEN
      -- Get settings for RM conversion
      SELECT * INTO v_assignment  -- reusing variable
      FROM public.referral_incentive_settings
      WHERE org_id = v_org_id;

      v_old_balance_rm := (v_old_balance_points::numeric / COALESCE(v_assignment.conversion_points, 1000)) * COALESCE(v_assignment.conversion_rm, 1.00);

      -- Debit old reference
      INSERT INTO public.referral_adjustments (
        org_id, reference_user_id, adjustment_type, points_amount, rm_amount,
        reason, related_user_id, created_by
      )
      VALUES (
        v_org_id, p_old_reference_id, 'transfer_out', v_old_balance_points, v_old_balance_rm,
        'Balance transfer due to resignation/replacement to ' || v_new_ref_user.full_name,
        p_new_reference_id, p_admin_id
      );

      -- Credit new reference
      INSERT INTO public.referral_adjustments (
        org_id, reference_user_id, adjustment_type, points_amount, rm_amount,
        reason, related_user_id, created_by
      )
      VALUES (
        v_org_id, p_new_reference_id, 'transfer_in', v_old_balance_points, v_old_balance_rm,
        'Balance transfer from resigned reference ' || (SELECT full_name FROM public.users WHERE id = p_old_reference_id),
        p_old_reference_id, p_admin_id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reassigned_count', v_count,
    'balance_transferred', p_transfer_balance
  );
END;
$function$;

-- propagate_warehouse_to_master_codes(uuid): PERFORM public.sa_assert_staff_actor(40);
CREATE OR REPLACE FUNCTION public.propagate_warehouse_to_master_codes(p_batch_id uuid)
 RETURNS TABLE(cases_updated integer, warehouse_org_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_warehouse_org_id UUID;
  v_cases_updated INTEGER;
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_staff_actor(40);
  -- Get the warehouse_org_id from the order
  SELECT o.warehouse_org_id INTO v_warehouse_org_id
  FROM qr_batches qb
  JOIN orders o ON o.id = qb.order_id
  WHERE qb.id = p_batch_id;

  -- Check if warehouse was found
  IF v_warehouse_org_id IS NULL THEN
    RAISE EXCEPTION 'No warehouse assigned to order for batch %', p_batch_id;
  END IF;

  -- Update all master codes in this batch with the warehouse assignment
  UPDATE qr_master_codes
  SET
    warehouse_org_id = v_warehouse_org_id,
    status = 'packed',
    updated_at = NOW()
  WHERE batch_id = p_batch_id;

  -- Get count of updated rows
  GET DIAGNOSTICS v_cases_updated = ROW_COUNT;

  -- Return results
  RETURN QUERY SELECT v_cases_updated, v_warehouse_org_id;
END;
$function$;

-- mark_batch_as_printed(uuid): PERFORM public.sa_assert_staff_actor(40);
CREATE OR REPLACE FUNCTION public.mark_batch_as_printed(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_batch_updated integer := 0;
  v_master_updated integer := 0;
  v_unique_updated integer := 0;
  v_chunk_size integer := 1000; -- Process 1000 codes at a time
  v_total_chunks integer := 0;
  v_processed_chunks integer := 0;
BEGIN
  -- Phase 0B containment guard (outside the original block so its
  -- EXCEPTION WHEN OTHERS handler cannot swallow the denial)
  PERFORM public.sa_assert_staff_actor(40);

  BEGIN
    -- Update batch status first (fast operation)
    UPDATE public.qr_batches
    SET
      status = 'printing',
      updated_at = now()
    WHERE id = p_batch_id AND status = 'generated';

    GET DIAGNOSTICS v_batch_updated = ROW_COUNT;

    -- CRITICAL: If batch was not updated (e.g. it's processing or already printed), ABORT
    IF v_batch_updated = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Batch is not in generated status. It might be processing or already printed.',
        'batch_updated', 0,
        'master_codes_updated', 0,
        'unique_codes_updated', 0
      );
    END IF;

    -- Update master codes (typically small number)
    UPDATE public.qr_master_codes
    SET
      status = 'printed',
      updated_at = now()
    WHERE batch_id = p_batch_id AND status = 'generated';

    GET DIAGNOSTICS v_master_updated = ROW_COUNT;

    -- Update unique codes in chunks to avoid timeout
    -- Use a cursor-based approach for better memory management
    LOOP
      -- Update one chunk at a time
      WITH codes_to_update AS (
        SELECT id
        FROM public.qr_codes
        WHERE batch_id = p_batch_id
          AND status = 'generated'
        LIMIT v_chunk_size
      )
      UPDATE public.qr_codes
      SET
        status = 'printed',
        updated_at = now()
      FROM codes_to_update
      WHERE qr_codes.id = codes_to_update.id;

      -- Check how many rows were updated
      GET DIAGNOSTICS v_processed_chunks = ROW_COUNT;
      v_unique_updated := v_unique_updated + v_processed_chunks;

      -- Exit loop if no more rows to update
      EXIT WHEN v_processed_chunks = 0;

      -- Optional: Add a small delay to reduce database load
      -- PERFORM pg_sleep(0.1);
    END LOOP;

    -- Return summary of updates
    RETURN jsonb_build_object(
      'success', true,
      'batch_updated', v_batch_updated,
      'master_codes_updated', v_master_updated,
      'unique_codes_updated', v_unique_updated,
      'message', format('Successfully updated batch and %s codes', v_unique_updated)
    );

  EXCEPTION
    WHEN OTHERS THEN
      -- Return error information
      RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE,
        'batch_updated', v_batch_updated,
        'master_codes_updated', v_master_updated,
        'unique_codes_updated', v_unique_updated
      );
  END;
END;
$function$;

-- update_last_login(uuid): PERFORM public.sa_assert_actor(user_id);
CREATE OR REPLACE FUNCTION public.update_last_login(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 0B containment guard
  PERFORM public.sa_assert_actor(user_id);
  UPDATE users
  SET
    last_login_at = NOW(),
    updated_at = NOW()
  WHERE id = user_id;
END;
$function$;

-- wms_ship_master_auto(uuid): PERFORM public.sa_assert_warehouse_shipment_actor(v_master.warehouse_org_id);
CREATE OR REPLACE FUNCTION public.wms_ship_master_auto(p_master_code_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_master record; v_qr_ids uuid[]; v_order uuid; v_to uuid;
BEGIN
  SELECT qmc.*,COALESCE(qmc.shipment_order_id,qb.order_id) resolved_order_id
    INTO v_master FROM public.qr_master_codes qmc
    LEFT JOIN public.qr_batches qb ON qb.id=qmc.batch_id WHERE qmc.id=p_master_code_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Master code not found'; END IF;
  v_order:=v_master.resolved_order_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'Master code is not linked to an order'; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_qr_ids FROM public.qr_codes
    WHERE master_code_id=p_master_code_id AND status<>'shipped_distributor';
  IF v_qr_ids IS NULL THEN RAISE EXCEPTION 'Master has no unshipped child QR codes'; END IF;
  SELECT COALESCE(v_master.shipped_to_distributor_id,o.buyer_org_id) INTO v_to
    FROM public.orders o WHERE o.id=v_order;
  IF v_master.warehouse_org_id IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'Master shipment organizations are incomplete'; END IF;
  -- Phase 0B containment guard (warehouse resolved from the master code)
  PERFORM public.sa_assert_warehouse_shipment_actor(v_master.warehouse_org_id);
  RETURN public.wms_ship_unique_auto(v_qr_ids,v_master.warehouse_org_id,v_to,v_order,COALESCE(v_master.shipped_at,now()));
END $function$;


-- SQL-language functions exposing PII are rewritten as plpgsql so the guard
-- runs before any row is read. Query bodies are unchanged.

-- get_user_by_email(text)
CREATE OR REPLACE FUNCTION public.get_user_by_email(p_email text)
 RETURNS TABLE(id uuid, email text, full_name text, role_code text, organization_id uuid, is_active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  -- Phase 0B containment guard: diagnostic lookup of arbitrary users by email
  -- is restricted to HQ administrators (role_level <= 10).
  PERFORM public.sa_assert_staff_actor(10);

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role_code,
    u.organization_id,
    u.is_active
  FROM public.users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
END;
$function$;

-- get_reference_assigned_shops(uuid)
CREATE OR REPLACE FUNCTION public.get_reference_assigned_shops(p_reference_user_id uuid)
 RETURNS TABLE(assignment_id uuid, shop_user_id uuid, effective_from timestamp with time zone, shop_name text, shop_phone text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  -- Phase 0B containment guard: shop phone numbers are only for referral
  -- administrators (role_level <= 20, same audience as ReferralMonitor).
  PERFORM public.sa_assert_staff_actor(20);

  RETURN QUERY
  SELECT
    ra.id AS assignment_id,
    ra.shop_user_id,
    ra.effective_from,
    COALESCE(su.full_name, 'Unknown') AS shop_name,
    COALESCE(su.phone, '') AS shop_phone
  FROM public.reference_assignments ra
  LEFT JOIN public.users su ON su.id = ra.shop_user_id
  WHERE ra.reference_user_id = p_reference_user_id
    AND ra.effective_to IS NULL
  ORDER BY ra.effective_from DESC;
END;
$function$;

-- fn_consumer_unique_list(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.fn_consumer_unique_list(p_company_id uuid, p_order_id uuid DEFAULT NULL::uuid, p_activity_type text DEFAULT NULL::text)
 RETURNS TABLE(phone text, name text, email text, scan_count bigint, last_active timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  -- Phase 0B containment guard: consumer contact list (phone/name/email) is
  -- staff-only (role_level <= 40); consumers and shop users (GUEST) are denied.
  PERFORM public.sa_assert_staff_actor(40);

  RETURN QUERY
  WITH grouped AS (
    SELECT
      q.consumer_phone                                     AS phone,
      (array_agg(q.consumer_name ORDER BY q.updated_at DESC)
        FILTER (WHERE q.consumer_name IS NOT NULL))[1]     AS qr_name,
      max(q.consumer_email)                                AS email,
      count(*)::bigint                                     AS scan_count,
      max(q.updated_at)                                    AS last_active
    FROM qr_codes q
    WHERE q.company_id = p_company_id
      AND (q.is_redeemed = true OR q.is_lucky_draw_entered = true OR q.is_points_collected = true)
      AND q.consumer_phone IS NOT NULL
      AND (p_order_id IS NULL OR q.order_id = p_order_id)
      AND (
        p_activity_type IS NULL
        OR p_activity_type = 'all'
        OR (p_activity_type = 'lucky_draw'  AND q.is_lucky_draw_entered = true)
        OR (p_activity_type = 'points'      AND q.is_points_collected = true)
        OR (p_activity_type = 'gift'        AND q.is_redeemed = true)
      )
    GROUP BY q.consumer_phone
  )
  SELECT
    g.phone,
    coalesce(u.full_name, g.qr_name, g.phone) AS name,
    coalesce(g.email, u.email)                 AS email,
    g.scan_count,
    g.last_active
  FROM grouped g
  LEFT JOIN users u ON u.phone = g.phone
  ORDER BY g.scan_count DESC;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 3. Explicit EXECUTE tiers
--    Signatures missing in an environment are skipped with a NOTICE, so the
--    same migration applies to production and staging.
-- ---------------------------------------------------------------------------
DO $phase0b_tiers$
DECLARE
  r record;
  v_fn regprocedure;
BEGIN
  FOR r IN
    SELECT t.sig, t.tier
    FROM (VALUES
    -- PUBLIC
    ('can_access_org(uuid)', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.distributor_products.dist_products_read_related[authenticated], public.d2h_order_
    ('check_serapod_user_phone(text)', 'PUBLIC'),  -- Anonymous consumer journey template (PremiumLoyaltyTemplate)
    ('current_user_org_id()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.documents.documents_select[authenticated], public.document_files.document_files_s
    ('current_user_role_level()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.orders.orders_insert[authenticated]
    ('get_auth_user_context()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.hr_attendance_audit.hr_attendance_audit_read[public], public.hr_attendance_audit.
    ('get_auth_user_info()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.users.Users can view hierarchy including independents[authenticated]
    ('get_email_by_phone(text)', 'PUBLIC'),  -- Anonymous phone login (LoginForm, LoginPageClient, public journey + RoadTour scan pages)
    ('get_public_branding()', 'PUBLIC'),  -- Anonymous login / forgot-password pages
    ('get_user_company_id()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.gl_document_postings.HQ Admins can insert document postings[authenticated], publi
    ('has_role_level(integer)', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.document_signatures.power_user_view_company_signatures[authenticated]
    ('is_admin()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.support_messages.Admins can insert messages[public], public.support_thread_reads.
    ('is_hq_admin()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.gl_document_postings.HQ Admins can insert document postings[authenticated], publi
    ('is_org_admin_or_super(uuid)', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.whatsapp_bot_settings.whatsapp_bot_settings_org_admin_select[public], public.what
    ('is_power_user()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.documents.documents_select[authenticated], public.document_files.document_files_s
    ('is_super_admin()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.gl_accounts.Super Admins can view all accounts[authenticated], public.documents.S
    ('is_support_admin()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.support_conversation_events.Admins can insert events[public], public.support_conv
    ('play_scratch_card_turn(uuid,text,uuid,uuid)', 'PUBLIC'),  -- Anonymous consumer scratch-card game (PremiumLoyaltyTemplate, /api/scratch-card/play)
    ('return_current_user_is_manager()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.return_case_items.return_case_items_all[authenticated], public.return_cases.retur
    ('return_current_user_org_id()', 'PUBLIC'),  -- RLS/storage policy helper (evaluated for anon/authenticated): public.return_case_items.return_case_items_all[authenticated], public.return_cases.retur
    ('validate_roadtour_qr_token(text)', 'PUBLIC'),  -- Anonymous RoadTour scan page (RoadtourScanPage)
    -- USER
    ('_enable_variant_stock_configurations_core(uuid,text)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('add_document_signature(uuid,uuid,text)', 'USER'),  -- Authenticated caller(s): ADMIN, SESSION
    ('allocate_inventory_for_order(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('apply_inventory_cutoff_d2h_policy(uuid,text,uuid[],text,uuid)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('apply_inventory_cutoff_h2m_bulk(uuid,text,uuid[],text,uuid)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('apply_inventory_cutoff_h2m_policy(uuid,text,uuid[],text,uuid)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('apply_inventory_cutoff_transactions_policy(uuid,text,jsonb,text,uuid)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('approve_payment_request(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('approve_reference_change(uuid,text,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('approve_stock_transfer(uuid,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('archive_product_variant(uuid)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('backfill_display_doc_numbers(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER, SESSION
    ('bind_inventory_cutoff_verification_snapshot(uuid,uuid)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('bulk_enable_variant_stock_configurations(uuid[])', 'USER'),  -- Authenticated caller(s): UNK
    ('bulk_reassign_reference(uuid,uuid,uuid,boolean)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('cancel_inventory_opening_cutoff(uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('cancel_stock_transfer(uuid,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('check_organization_dependencies(uuid)', 'USER'),  -- Authenticated caller(s): ADMIN, BROWSER
    ('check_phone_exists(text,uuid)', 'USER'),  -- Authenticated caller(s): ADMIN?, BROWSER, UNK(file-has-admin)
    ('discard_stock_count_drafts(uuid[])', 'USER'),  -- Authenticated caller(s): BROWSER
    ('dispatch_stock_transfer(uuid,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('ellbow_admin_adjust_points(uuid,text,bigint,text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('ellbow_award_roadtour_scan(uuid,uuid,uuid,uuid)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('ellbow_redeem_reward(uuid,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('ellbow_update_redemption_status(uuid,text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('enable_variant_stock_configurations(uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('enable_variant_stock_configurations_with_profile(uuid,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('finalize_stock_count_verification_delivery(uuid,boolean)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('find_or_create_whatsapp_conversation(text,text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('fn_consumer_activity_stats(uuid,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('fn_consumer_unique_list(uuid,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('fn_create_balance_payment_request(uuid)', 'USER'),  -- Session caller /api/manufacturer/complete-production (guard not added: also fired from receipt trigger)
    ('generate_display_doc_number(uuid,text,integer)', 'USER'),  -- Called by INVOKER trigger orders_before_insert
    ('generate_doc_number(uuid,text,text)', 'USER'),  -- Authenticated caller(s): BROWSER, SESSION
    ('generate_fiscal_periods(uuid,text)', 'USER'),  -- Authenticated caller(s): SESSION
    ('generate_journal_number(uuid)', 'USER'),  -- Called by INVOKER hr_post_*_to_gl functions
    ('generate_journal_number(uuid,text)', 'USER'),  -- Called by INVOKER hr_post_*_to_gl functions
    ('get_batch_variant_counts(uuid,text)', 'USER'),  -- Authenticated caller(s): ADMIN, UNK(file-has-admin)
    ('get_consumer_scan_stats(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('get_department_hierarchy(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('get_doc_migration_status(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER, SESSION
    ('get_doc_sequences(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER, SESSION
    ('get_document_gl_status(uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('get_document_signatures(uuid)', 'USER'),  -- Authenticated caller(s): SESSION, UNK
    ('get_journey_qr_count(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('get_next_approver(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('get_pending_receives_for_warehouse(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('get_posting_preview(text,uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('get_reference_assigned_shops(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('get_user_by_email(text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('get_user_org_chart(uuid,uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('get_user_support_unread_count()', 'USER'),  -- Authenticated caller(s): ADMIN, SESSION
    ('get_valid_batch_ids_for_journey(uuid[],text[])', 'USER'),  -- Authenticated caller(s): BROWSER
    ('insert_whatsapp_message(uuid,text,text,uuid,uuid,text,text,text,text,jsonb)', 'USER'),  -- Authenticated caller(s): UNK
    ('inventory_cutoff_d2h_policy_preflight(uuid,text,uuid[])', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('inventory_cutoff_h2m_bulk_preflight(uuid,text,uuid[])', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('inventory_cutoff_h2m_policy_preflight(uuid,text,uuid[])', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('inventory_cutoff_preview(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER, UNK(file-has-admin)
    ('inventory_cutoff_transactions_policy_preflight(uuid,text,jsonb)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('invoice_acknowledge(uuid,text)', 'USER'),  -- Authenticated caller(s): SESSION
    ('loyalty_program_admin_update_user_membership(uuid,text,uuid,text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('loyalty_program_admin_upsert_organization_membership(uuid,text,text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('loyalty_program_admin_upsert_user_membership(uuid,text,uuid,text,text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('manufacturer_acknowledge_adjustment(uuid,text)', 'USER'),  -- Authenticated caller(s): SESSION
    ('mark_batch_as_printed(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('orders_approve(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('payment_acknowledge(uuid)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('po_acknowledge(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('post_document_to_gl(text,uuid,date)', 'USER'),  -- Authenticated caller(s): UNK
    ('post_manual_stock_addition(uuid,uuid,jsonb,text,text,uuid,text,text,uuid,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('post_payroll_run_to_gl(uuid,date)', 'USER'),  -- Authenticated caller(s): SESSION
    ('post_return_case_inventory(uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('post_warehouse_receipt(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text)', 'USER'),  -- Authenticated caller(s): SESSION
    ('prepare_stock_count_verification(uuid,uuid,text,jsonb,jsonb)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('process_reference_change(uuid,text,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('process_referral_claim(uuid,text,uuid,text,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('propagate_warehouse_to_master_codes(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('queue_notification(uuid,text,text,text,text,text,jsonb,text,timestamp with time zone)', 'USER'),  -- Authenticated caller(s): UNK
    ('receive_stock_transfer(uuid,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('record_roadtour_reward(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('record_stock_movement(text,uuid,uuid,integer,numeric,uuid,text,text,text,text,uuid,text,uuid,uuid,text[],uuid)', 'USER'),  -- Authenticated caller(s): ADMIN, BROWSER, SESSION
    ('reject_stock_transfer(uuid,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('release_allocation_for_order(uuid)', 'USER'),  -- Authenticated caller(s): ADMIN, ADMIN?, UNK
    ('release_worker_lease(text,text)', 'USER'),  -- Authenticated caller(s): UNK
    ('resolve_inventory_cutoff_allocation(uuid,uuid,uuid,text,uuid,integer,integer,text,uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('resolve_inventory_cutoff_h2m_incoming(uuid,uuid[])', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('reverse_payroll_gl_posting(uuid,text,date)', 'USER'),  -- Authenticated caller(s): SESSION
    ('roadtour_create_participant_mission(uuid,uuid,uuid,text,uuid,uuid,uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('roadtour_record_product_qr_milestone_progress(uuid)', 'USER'),  -- Authenticated caller(s): UNK
    ('save_stock_transfer_draft(uuid,uuid,uuid,jsonb,text,date,uuid,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('seed_hr_gl_accounts(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('seed_payroll_components(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('seed_payroll_gl_mappings(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('set_inventory_cutoff_decision(uuid,uuid,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('start_inventory_opening_cutoff(uuid,timestamp with time zone)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('stock_count_snapshot_hash(uuid)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('submit_and_allocate_d2h_order(uuid,uuid,uuid,uuid,jsonb,text,uuid,text,date)', 'USER'),  -- Authenticated caller(s): BROWSER, UNK(file-has-admin)
    ('submit_stock_transfer_for_approval(uuid,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('try_acquire_worker_lease(text,text,integer)', 'USER'),  -- Authenticated caller(s): UNK
    ('update_last_login(uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('upsert_whatsapp_conversation(uuid,text,whatsapp_conversation_mode,text,text)', 'USER'),  -- Authenticated caller(s): UNK(file-has-admin)
    ('verify_and_post_inventory_opening_cutoff(uuid,text)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('verify_and_post_stock_count(uuid,text)', 'USER'),  -- Authenticated caller(s): dynamic rpc name
    ('wms_reverse_manual_movement(uuid,text,uuid)', 'USER'),  -- Authenticated caller(s): BROWSER
    ('wms_ship_master_auto(uuid)', 'USER'),  -- Authenticated caller(s): SESSION
    ('wms_ship_mixed(uuid,uuid,uuid,uuid,integer,jsonb,uuid,text,text)', 'USER'),  -- Authenticated caller(s): BROWSER
    -- SERVER
    ('_auto_post_document_to_gl_internal(text,uuid,date)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: auto_post_document_to_gl(SD), auto_post_payment_to_gl(SD)
    ('_stock_transfer_assert_reservation_integrity(stock_transfers)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: approve_stock_transfer(SD), dispatch_stock_transfer(SD)
    ('_stock_transfer_release_reservations(stock_transfers)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: cancel_stock_transfer(SD), dispatch_stock_transfer(SD), reject_stock_transfer(SD)
    ('_stock_transfer_reserve_items(stock_transfers)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: submit_stock_transfer_for_approval(SD)
    ('add_conversation_note(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('adjust_inventory_quantity(uuid,uuid,integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('admin_blast_message(text,jsonb)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('apply_inventory_ship_adjustment(uuid,uuid,integer,integer,timestamp with time zone)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: wms_deduct_and_summarize(SD)
    ('apply_inventory_ship_adjustment_deprecated_56910(uuid,uuid,integer,integer,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('archive_old_audit_logs(integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('archive_stock_count_draft(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: discard_stock_count_drafts(SD)
    ('assert_h2m_receipt_allowed_after_cutoff(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: trg_warehouse_receipt_h2m_excluded_guard(SD)
    ('assign_conversation(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('batch_post_documents(text,date,date,integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('batch_regenerate_doc_numbers(uuid,integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('can_collect_point_reward(uuid,uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: collect_point_reward(SD)
    ('check_whatsapp_admin(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('claim_point_redeem_pool(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('cleanup_old_audit_logs()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('cleanup_old_notifications(integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('clear_whatsapp_draft(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('close_fiscal_period(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('collect_point_reward(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('compute_payroll_item(uuid,uuid,date,date)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('consumer_claim_gift(text,uuid,text)', 'SERVER'),  -- Only called through service-role clients
    ('consumer_claim_gift(text,uuid,text,text,text)', 'SERVER'),  -- Only called through service-role clients
    ('consumer_collect_points(text,text,numeric)', 'SERVER'),  -- Only called through service-role clients
    ('consumer_collect_points(text,text,numeric,text)', 'SERVER'),  -- Only called through service-role clients
    ('consumer_collect_points(text,text,numeric,text,boolean)', 'SERVER'),  -- Only called through service-role clients
    ('consumer_lucky_draw_enter(text,text,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('create_new_user(text,text,text,uuid,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('create_support_conversation(text,text,jsonb)', 'SERVER'),  -- Only called through service-role clients
    ('deactivate_legacy_stock_configs(boolean)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('delete_all_transactions_with_inventory()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('delete_all_transactions_with_inventory_v3()', 'SERVER'),  -- /api/admin/delete-transactions-v2 now calls through admin client after destructive-ops guard
    ('delete_scratch_campaign(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('ellbow_apply_points_core(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb,uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: ellbow_admin_adjust_points(SD), ellbow_award_roadtour_scan(SD), ellbow_redeem_reward(SD)
    ('ellbow_has_active_user_membership(uuid,uuid,uuid,text)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: ellbow_apply_points_core(SD), ellbow_redeem_reward(SD)
    ('evaluate_user_registration_bonus(uuid,uuid)', 'SERVER'),  -- Only called through service-role clients
    ('execute_legacy_config_cutover(uuid,boolean,uuid,text[])', 'SERVER'),  -- Only called from SECURITY DEFINER functions: deactivate_legacy_stock_configs(SD), legacy_config_cutover_preflight(SD)
    ('fn_consumer_analytics_daily(uuid,timestamp with time zone,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('fn_consumer_analytics_hourly(uuid,timestamp with time zone,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('fn_consumer_analytics_products(uuid,timestamp with time zone,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('fn_consumer_analytics_summary(uuid,timestamp with time zone,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('fn_consumer_analytics_top_consumers(uuid,timestamp with time zone,timestamp with time zone,integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('fulfill_order_inventory(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: orders_approve(SD)
    ('generate_order_referenced_doc_number(uuid,uuid,text,integer)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: auto_generate_display_doc_no(SD), regenerate_order_doc_numbers(SD)
    ('generate_po_number(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('generate_signature_hash(uuid,uuid,timestamp with time zone)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: add_document_signature(SD)
    ('get_admin_support_unread_count()', 'SERVER'),  -- Only called through service-role clients
    ('get_balance_request_posting_details(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: get_posting_preview(SD)
    ('get_hq_consolidated_warehouse_inventory(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_login_hero_banners()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_my_role_level()', 'SERVER'),  -- Only called from SECURITY DEFINER functions: approve_stock_transfer(SD), is_hq_admin(SD), is_super_admin(SD)
    ('get_next_doc_sub_sequence(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_notification_stats(uuid,integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_or_create_announcement_thread(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: admin_blast_message(SD)
    ('get_payment_posting_details(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: get_posting_preview(SD)
    ('get_payroll_ready_work_minutes(uuid,date,date)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_pending_notifications(integer)', 'SERVER'),  -- Only called through service-role clients
    ('get_prepared_codes_count(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_receipt_posting_details(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_scratch_campaign_stats(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_shop_available_products(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_statutory_config(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: compute_payroll_item(SD)
    ('get_storage_url(text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('get_whatsapp_bot_settings(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('handle_social_login(uuid,text,text,text,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('hard_delete_order(uuid)', 'SERVER'),  -- Only called through service-role clients
    ('hard_delete_order_phase4_legacy(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: hard_delete_order(SD)
    ('hard_delete_organization(uuid)', 'SERVER'),  -- Only called through service-role clients
    ('inventory_cutoff_active(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('inventory_cutoff_assert_not_frozen(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_inventory_guard(SD), inventory_cutoff_movement_guard(SD), post_warehouse_receipt(SD)
    ('inventory_cutoff_d2h_scoped_orders(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: apply_inventory_cutoff_d2h_policy(SD), inventory_cutoff_d2h_policy_preflight(SD), inventory_cutoff_previe
    ('inventory_cutoff_h2m_excluded_blocks_receipt(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: assert_h2m_receipt_allowed_after_cutoff(SD)
    ('inventory_cutoff_h2m_scoped_orders(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: apply_inventory_cutoff_h2m_policy(SD), inventory_cutoff_h2m_policy_preflight(SD), inventory_cutoff_previe
    ('inventory_cutoff_is_hq_admin()', 'SERVER'),  -- Only called from SECURITY DEFINER functions: apply_inventory_cutoff_d2h_policy(SD), apply_inventory_cutoff_h2m_bulk(SD), apply_inventory_cutoff_h2m_po
    ('inventory_cutoff_preview_h2m_unscoped_legacy(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_stock_adjustment_eligibility(SD)
    ('inventory_cutoff_preview_pre_blocker_details(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview(SD)
    ('inventory_cutoff_preview_pre_d2h_policy(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_h2m_policy(SD)
    ('inventory_cutoff_preview_pre_h2m_policy(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_transactions_policy(SD)
    ('inventory_cutoff_preview_pre_stock_adjustment_detail(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_d2h_policy(SD)
    ('inventory_cutoff_preview_pre_stock_adjustment_eligibility(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_stock_adjustment_detail(SD)
    ('inventory_cutoff_preview_pre_transactions_policy(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_blocker_details(SD)
    ('inventory_cutoff_snapshot_hash(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: bind_inventory_cutoff_verification_snapshot(SD), verify_and_post_inventory_opening_cutoff_scoped_legacy(S
    ('inventory_cutoff_transactions_scoped(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_blocker_details(SD), inventory_cutoff_transactions_policy_preflight(SD), ver
    ('is_active_stock_count_warehouse(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: prepare_stock_count_verification(SD), start_inventory_opening_cutoff(SD), stock_count_unified_opening_bal
    ('is_document_posted(text,uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: _auto_post_document_to_gl_internal(SD), auto_post_document_to_gl(SD), auto_post_payment_to_gl(SD)
    ('is_platform_super_admin()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('is_product_available_for_shop(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('legacy_config_cutover_preflight(integer)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: deactivate_legacy_stock_configs(SD), execute_legacy_config_cutover(SD)
    ('log_conversation_event(uuid,text,uuid,support_event_type,jsonb,jsonb,jsonb)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: add_conversation_note(SD), assign_conversation(SD), create_support_conversation(SD)
    ('log_notification_attempt(uuid,text,text,text,jsonb)', 'SERVER'),  -- Only called through service-role clients
    ('log_qr_receive_movement(uuid,uuid,integer,numeric,uuid,text,uuid,uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('log_qr_shipment_movement(uuid,uuid,integer,numeric,uuid,text,uuid,uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('loyalty_program_current_admin_owner()', 'SERVER'),  -- Only called from SECURITY DEFINER functions: loyalty_program_admin_update_user_membership(SD), loyalty_program_admin_upsert_organization_membership(SD
    ('loyalty_program_upsert_organization_membership(text,uuid,text,uuid,uuid,uuid,uuid,text)', 'SERVER'),  -- Only called through service-role clients
    ('loyalty_program_upsert_user_membership(text,uuid,text,text,uuid,uuid,uuid,uuid,uuid,text)', 'SERVER'),  -- Only called through service-role clients
    ('manual_stock_addition_user_can_post(uuid,uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: post_manual_stock_addition(SD)
    ('mark_conversation_read(uuid,text,uuid)', 'SERVER'),  -- Only called through service-role clients
    ('orders_submit(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('post_customer_receipt_to_gl(uuid,date)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('post_payroll_payment_to_gl(uuid,date)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('post_stock_transfer_configured(text,uuid,uuid,uuid,jsonb,text,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('recycle_doc_number(uuid,text,text,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('refresh_all_materialized_views()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('refresh_product_catalog()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('refresh_shop_products()', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('regenerate_order_doc_numbers(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: batch_regenerate_doc_numbers(SD)
    ('render_template(text,uuid,jsonb)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('repack_stock(uuid,uuid,uuid,uuid,integer,text,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('repack_stock_v2(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('resolve_inventory_cutoff_d2h_carry_forward(uuid,uuid[])', 'SERVER'),  -- Only called through service-role clients
    ('reverse_gl_journal(uuid,text,date)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: reverse_payroll_gl_posting(SD)
    ('search_eligible_references(text,integer)', 'SERVER'),  -- Only caller is /api/reference/search via admin client (narrowed in commit C)
    ('search_shops(text,integer)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('send_admin_support_message(uuid,text,jsonb)', 'SERVER'),  -- Only called through service-role clients
    ('send_announcement_blast(text,text,jsonb)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('send_support_message(uuid,text,jsonb)', 'SERVER'),  -- Only called through service-role clients
    ('set_order_item_stock_config(uuid,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('set_skip_ship_trigger(boolean)', 'SERVER'),  -- Only called through service-role clients
    ('set_whatsapp_draft(uuid,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('stock_count_carry_classification_allocations(uuid,uuid,uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: verify_and_post_stock_classification(SD)
    ('stock_count_user_can_post(uuid,uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: prepare_stock_count_verification(SD), verify_and_post_stock_classification(SD), verify_and_post_stock_cou
    ('submit_referral_claim(uuid,integer,uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('sync_user_profile(uuid,text,text,uuid,text,text)', 'SERVER'),  -- Only called through service-role clients
    ('update_admin_activity(uuid,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('update_conversation_priority(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('update_conversation_status(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('update_master_status_skip_trigger(uuid[],uuid,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('update_redemption_fulfillment(uuid,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('update_scratch_winner_details(uuid,text,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('update_whatsapp_conversation_mode(uuid,text,whatsapp_conversation_mode,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('validate_reference_eligibility(uuid)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('verify_and_post_inventory_opening_cutoff_pre_transactions_polic(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('verify_and_post_inventory_opening_cutoff_scoped_legacy(uuid,text)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: verify_and_post_inventory_opening_cutoff_pre_transactions_polic(SD)
    ('verify_and_post_stock_classification(uuid,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('wms_deduct_and_summarize(uuid,uuid,uuid,integer,uuid,timestamp with time zone)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: wms_from_master(SD)
    ('wms_from_master(uuid)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: wms_from_mixed(SD)
    ('wms_from_mixed(uuid,uuid[],uuid,uuid,uuid,timestamp with time zone)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('wms_from_unique_codes(uuid[],uuid,uuid,uuid,timestamp with time zone)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: wms_from_mixed(SD), wms_ship_unique_auto(SD)
    ('wms_record_movement_from_summary(jsonb)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: wms_record_movements_from_items(SD)
    ('wms_record_movements_from_items(jsonb)', 'SERVER'),  -- Only called from SECURITY DEFINER functions: trg_qr_unique_shipdeduct_stmt(SD), wms_ship_unique_auto(SD)
    ('wms_ship_manual(uuid,uuid,uuid,uuid,integer,uuid,text,text)', 'SERVER'),  -- No application, policy, view, trigger or function caller found (legacy/unused)
    ('wms_ship_unique_auto(uuid[],uuid,uuid,uuid,timestamp with time zone)', 'SERVER'),  -- Only called through service-role clients
    -- TRIGGER
    ('accrue_referral_from_scan()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('accrue_referral_from_transaction()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('audit_trigger_func()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('auto_create_stock_adjustment_from_movement()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('auto_generate_display_doc_no()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('auto_post_document_to_gl()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('auto_post_payment_to_gl()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('create_default_stock_config_for_variant()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('documents_ensure_company_id()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('fn_auto_create_hr_employee()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('handle_new_user()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('inventory_cutoff_category_decision_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('inventory_cutoff_excluded_transaction_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('inventory_cutoff_inventory_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('inventory_cutoff_movement_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('prepare_product_variant_product_code()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('prevent_self_service_access_field_update()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('return_cases_validate_source()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('revert_inventory_on_movement_delete()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('stock_count_discard_posting_started_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('stock_count_opening_category_scope_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('stock_count_unified_opening_balance_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('stock_movements_apply_to_inventory()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('sync_product_variant_product_code_brand()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('sync_roadtour_event_reward_rule_version()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('sync_variant_default_media()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trg_on_purchase_receive_create_balance_request()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trg_qr_unique_shipdeduct()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trg_qr_unique_shipdeduct_stmt()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trg_qrmaster_shipdeduct()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trg_warehouse_receipt_h2m_excluded_guard()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trigger_document_notification()', 'TRIGGER'),  -- Trigger function; triggers do not need caller EXECUTE
    ('trigger_order_notification()', 'TRIGGER')   -- Trigger function; triggers do not need caller EXECUTE
    ) AS t(sig, tier)
  LOOP
    v_fn := to_regprocedure('public.' || r.sig);
    IF v_fn IS NULL THEN
      RAISE NOTICE 'Phase 0B: public.% not present in this database, skipped', r.sig;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);

    IF r.tier = 'PUBLIC' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', v_fn);
    ELSIF r.tier = 'USER' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
    ELSIF r.tier = 'SERVER' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    ELSIF r.tier = 'TRIGGER' THEN
      NULL; -- trigger functions are never called through the API
    ELSE
      RAISE EXCEPTION 'Unknown Phase 0B tier % for %', r.tier, r.sig;
    END IF;
  END LOOP;
END
$phase0b_tiers$;

-- ---------------------------------------------------------------------------
-- 4. Catch-all: no other SECURITY DEFINER function in public is anon-callable.
-- ---------------------------------------------------------------------------
DO $phase0b_anon_catchall$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname <> ALL (ARRAY['can_access_org', 'check_serapod_user_phone', 'current_user_org_id', 'current_user_role_level', 'get_auth_user_context', 'get_auth_user_info', 'get_email_by_phone', 'get_public_branding', 'get_user_company_id', 'has_role_level', 'is_admin', 'is_hq_admin', 'is_org_admin_or_super', 'is_power_user', 'is_super_admin', 'is_support_admin', 'play_scratch_card_turn', 'return_current_user_is_manager', 'return_current_user_org_id', 'validate_roadtour_qr_token'])
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       -- functions evaluated inside RLS/storage policies must stay callable by
       -- anon, otherwise anonymous reads of those tables fail
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies pol
          WHERE coalesce(pol.qual, '') ~ ('\m' || p.proname || '\(')
             OR coalesce(pol.with_check, '') ~ ('\m' || p.proname || '\(')
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
    RAISE NOTICE 'Phase 0B: revoked anon EXECUTE on %', r.fn;
  END LOOP;
END
$phase0b_anon_catchall$;

-- ---------------------------------------------------------------------------
-- 5. Fixed search_path for every SECURITY DEFINER function in public.
--    Functions with no search_path get public, extensions, pg_temp (a superset
--    of what PostgREST requests resolve today, plus pg_temp last).
--    Functions with a search_path lacking pg_temp get pg_temp appended.
-- ---------------------------------------------------------------------------
DO $phase0b_search_path$
DECLARE
  r record;
  v_current text;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
  LOOP
    SELECT substr(c, length('search_path=') + 1)
      INTO v_current
      FROM unnest(coalesce(r.proconfig, ARRAY[]::text[])) AS c
     WHERE c LIKE 'search_path=%'
     LIMIT 1;

    IF v_current IS NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.fn);
    ELSIF v_current !~ '(^|[ ,])pg_temp($|[ ,])' THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = %s, pg_temp', r.fn, v_current);
    END IF;
  END LOOP;
END
$phase0b_search_path$;

-- ---------------------------------------------------------------------------
-- 6. Post-conditions (the migration fails instead of half-applying).
-- ---------------------------------------------------------------------------
DO $phase0b_assert$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.proname <> ALL (ARRAY['can_access_org', 'check_serapod_user_phone', 'current_user_org_id', 'current_user_role_level', 'get_auth_user_context', 'get_auth_user_info', 'get_email_by_phone', 'get_public_branding', 'get_user_company_id', 'has_role_level', 'is_admin', 'is_hq_admin', 'is_org_admin_or_super', 'is_power_user', 'is_super_admin', 'is_support_admin', 'play_scratch_card_turn', 'return_current_user_is_manager', 'return_current_user_org_id', 'validate_roadtour_qr_token'])
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies pol
        WHERE coalesce(pol.qual, '') ~ ('\m' || p.proname || '\(')
           OR coalesce(pol.with_check, '') ~ ('\m' || p.proname || '\(')
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0B: anon can still execute SECURITY DEFINER functions: %', v_bad;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%pg_temp%'
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0B: SECURITY DEFINER functions without fixed search_path: %', v_bad;
  END IF;

  IF has_function_privilege('authenticated', 'public.delete_all_transactions_with_inventory_v3()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.hard_delete_organization(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.adjust_inventory_quantity(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wms_ship_unique_auto(uuid[],uuid,uuid,uuid,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.search_eligible_references(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 0B: server-only function still executable by authenticated';
  END IF;
END
$phase0b_assert$;
