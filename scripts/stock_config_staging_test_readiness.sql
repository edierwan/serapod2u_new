-- ============================================================================
-- Stock Configuration Enhancement (migrations 01-07)
-- Staging test-readiness, controlled setup, reconciliation, and cleanup
-- ============================================================================
-- ASSESSMENT / TEST PREPARATION ONLY. DO NOT RUN AGAINST PRODUCTION.
--
-- This file is intentionally safe by default:
--   * Section A is read-only.
--   * Persistent changes in Section C require all four UUID parameters,
--     CONFIRM_TARGET = 'STAGING-ONLY', and RUN_SETUP = true.
--   * Test stock is additionally gated by ADD_TEST_STOCK = true.
--   * Cleanup is separately gated by RUN_CLEANUP = true and only reverses
--     movements carrying this script's TEST-STOCKCFG-* references.
--   * RUN_SETUP and RUN_CLEANUP cannot both be true.
--
-- IMPORTANT READINESS GATE
-- Migration 03 constrains stock_movements.reference_type to:
--   manual, order, transfer, adjustment, purchase_order, return, campaign,
--   repack
-- but migration 05 writes order_config_change and order_cancel_reversal.
-- Migration 07 extends the two closed allowlists. Section A.7 reports FAIL and
-- Section C refuses setup if migration 07 has not been applied.
--
-- This script never moves or classifies an existing balance. Calling
-- enable_variant_stock_configurations(uuid) converts the selected variant's
-- STD catalog row to UNCLASSIFIED, but its quantities stay on that same row.
-- ============================================================================

-- ============================================================================
-- SECTION A — READ-ONLY PREFLIGHT
-- Run this section independently before considering any setup.
-- ============================================================================

SELECT 'A.1 expected tables' AS check_section;
WITH expected(object_name) AS (
  VALUES
    ('public.inventory_stock_configurations'),
    ('public.distributor_stock_config_eligibility'),
    ('public.product_inventory'),
    ('public.stock_movements'),
    ('public.stock_count_session_items'),
    ('public.stock_adjustment_items'),
    ('public.warehouse_receipt_items'),
    ('public.order_items'),
    ('public.wms_movement_dedup')
)
SELECT object_name,
       to_regclass(object_name) IS NOT NULL AS exists,
       CASE WHEN to_regclass(object_name) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status
FROM expected
ORDER BY object_name;

SELECT 'A.2 required columns' AS check_section;
WITH expected(table_name, column_name, expected_nullable) AS (
  VALUES
    ('inventory_stock_configurations','variant_id','NO'),
    ('inventory_stock_configurations','config_code','NO'),
    ('inventory_stock_configurations','config_label','NO'),
    ('inventory_stock_configurations','stock_sku','NO'),
    ('inventory_stock_configurations','volume_ml','YES'),
    ('inventory_stock_configurations','packaging','YES'),
    ('inventory_stock_configurations','is_variant_default','NO'),
    ('inventory_stock_configurations','allow_ord','NO'),
    ('inventory_stock_configurations','allow_so','NO'),
    ('inventory_stock_configurations','default_for_ord','NO'),
    ('inventory_stock_configurations','requires_repacking_before_sale','NO'),
    ('product_inventory','stock_config_id','NO'),
    ('stock_movements','stock_config_id','YES'),
    ('stock_count_session_items','stock_config_id','YES'),
    ('stock_adjustment_items','stock_config_id','YES'),
    ('warehouse_receipt_items','stock_config_id','YES'),
    ('order_items','stock_config_id','YES'),
    ('order_items','stock_config_confirmed_at','YES'),
    ('order_items','stock_config_confirmed_by','YES'),
    ('distributor_stock_config_eligibility','distributor_org_id','NO'),
    ('distributor_stock_config_eligibility','allow_50ml_new_box','NO'),
    ('distributor_stock_config_eligibility','notes','YES'),
    ('distributor_stock_config_eligibility','created_by','YES'),
    ('distributor_stock_config_eligibility','created_at','NO'),
    ('distributor_stock_config_eligibility','updated_at','NO')
)
SELECT e.table_name, e.column_name, e.expected_nullable,
       c.data_type, c.is_nullable AS actual_nullable,
       CASE
         WHEN c.column_name IS NULL THEN 'FAIL: missing'
         WHEN c.is_nullable <> e.expected_nullable THEN 'FAIL: nullability'
         ELSE 'PASS'
       END AS status
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
ORDER BY e.table_name,e.column_name;

SELECT 'A.3 required constraints and indexes' AS check_section;
WITH expected_constraint(name) AS (
  VALUES
    ('isc_valid_dimension_combos'),
    ('isc_repack_blocks_so'),
    ('isc_default_ord_requires_allow'),
    ('isc_id_variant_key'),
    ('product_inventory_stock_config_fk'),
    ('stock_movements_stock_config_fk'),
    ('stock_count_session_items_stock_config_fk'),
    ('stock_adjustment_items_stock_config_fk'),
    ('warehouse_receipt_items_stock_config_fk'),
    ('uq_variant_org_config'),
    ('valid_quantity_change'),
    ('stock_movements_reference_type_check'),
    ('order_items_stock_config_variant_fkey')
), expected_index(name) AS (
  VALUES
    ('isc_stock_sku_key'),
    ('isc_one_variant_default'),
    ('isc_one_ord_default'),
    ('isc_variant_dimensions_key'),
    ('stock_count_session_items_unique_config'),
    ('order_items_stock_config_idx')
), found AS (
  SELECT e.name, 'constraint'::text AS object_type,
         c.oid IS NOT NULL AS exists,
         CASE WHEN c.oid IS NULL THEN NULL ELSE pg_get_constraintdef(c.oid) END AS definition
  FROM expected_constraint e
  LEFT JOIN pg_constraint c ON c.conname=e.name AND c.connamespace='public'::regnamespace
  UNION ALL
  SELECT e.name, 'index', i.indexrelid IS NOT NULL,
         CASE WHEN i.indexrelid IS NULL THEN NULL ELSE pg_get_indexdef(i.indexrelid) END
  FROM expected_index e
  LEFT JOIN pg_class ic ON ic.relname=e.name AND ic.relnamespace='public'::regnamespace
  LEFT JOIN pg_index i ON i.indexrelid=ic.oid
)
SELECT object_type,name,exists,
       CASE WHEN exists THEN 'PASS' ELSE 'FAIL' END AS status,
       definition
FROM found
ORDER BY object_type,name;

SELECT 'A.4 required triggers' AS check_section;
WITH expected(table_name,trigger_name) AS (
  VALUES
    ('inventory_stock_configurations','set_isc_updated_at'),
    ('product_variants','trg_product_variants_default_stock_config'),
    ('distributor_stock_config_eligibility','set_dsce_updated_at')
)
SELECT e.table_name,e.trigger_name,
       t.oid IS NOT NULL AS exists,
       CASE WHEN t.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
       CASE WHEN t.oid IS NULL THEN NULL ELSE pg_get_triggerdef(t.oid) END AS definition
FROM expected e
LEFT JOIN pg_class tbl ON tbl.relname=e.table_name AND tbl.relnamespace='public'::regnamespace
LEFT JOIN pg_trigger t ON t.tgrelid=tbl.oid AND t.tgname=e.trigger_name AND NOT t.tgisinternal
ORDER BY e.table_name,e.trigger_name;

SELECT 'A.5 exact RPC/function signatures and PostgREST prerequisites' AS check_section;
WITH expected(function_name,arg_types) AS (
  VALUES
    ('enable_variant_stock_configurations','uuid'),
    ('record_stock_movement','text, uuid, uuid, integer, numeric, uuid, text, text, text, text, uuid, text, uuid, uuid, text[], uuid'),
    ('post_warehouse_receipt','uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text, text'),
    ('repack_stock','uuid, uuid, uuid, uuid, integer, text, uuid'),
    ('stock_count_snapshot_hash','uuid'),
    ('prepare_stock_count_verification','uuid, uuid, text, jsonb, jsonb'),
    ('verify_and_post_stock_count','uuid, text'),
    ('distributor_can_receive_stock_config','uuid, uuid'),
    ('resolve_so_stock_config','uuid, uuid, uuid, integer'),
    ('allocate_inventory_for_order','uuid'),
    ('release_allocation_for_order','uuid'),
    ('set_order_item_stock_config','uuid, uuid'),
    ('fulfill_order_inventory','uuid'),
    ('orders_approve','uuid'),
    ('wms_from_unique_codes','uuid[], uuid, uuid, uuid, timestamp with time zone'),
    ('wms_record_movement_from_summary','jsonb'),
    ('wms_ship_master_auto','uuid'),
    ('post_stock_transfer_configured','text, uuid, uuid, uuid, jsonb, text, uuid')
), found AS (
  SELECT e.function_name,e.arg_types,p.oid,p.prorettype::regtype AS return_type,
         has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
         count(p.oid) OVER (PARTITION BY e.function_name) AS exact_signature_matches
  FROM expected e
  LEFT JOIN pg_proc p
    ON p.pronamespace='public'::regnamespace
   AND p.proname=e.function_name
   AND oidvectortypes(p.proargtypes)=e.arg_types
)
SELECT function_name,arg_types,return_type,
       oid IS NOT NULL AS exact_signature_exists,
       authenticated_can_execute,
       exact_signature_matches,
       CASE
         WHEN oid IS NULL THEN 'FAIL: missing signature'
         WHEN NOT authenticated_can_execute THEN 'FAIL: authenticated lacks EXECUTE'
         ELSE 'PASS: eligible for public-schema PostgREST RPC exposure'
       END AS status
FROM found
ORDER BY function_name;

-- PostgREST RPC exposure also requires public to be in the project's exposed
-- schemas and a schema-cache reload after migration. Those API settings are
-- not stored in public SQL catalogs; verify them in Supabase API settings.
SELECT p.proname,
       count(*) AS public_overload_count,
       string_agg(oidvectortypes(p.proargtypes), ' | ' ORDER BY oidvectortypes(p.proargtypes)) AS signatures
FROM pg_proc p
WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN (
    'enable_variant_stock_configurations','record_stock_movement','repack_stock',
    'set_order_item_stock_config','post_stock_transfer_configured'
  )
GROUP BY p.proname
ORDER BY p.proname;

SELECT 'A.6 required views' AS check_section;
WITH expected(view_name) AS (
  VALUES
    ('vw_inventory_on_hand'),('vw_manual_stock_balance'),('vw_stock_movements_ordered'),
    ('v_stock_movements_display'),('v_wms_movements_recent'),('v_hq_inventory'),
    ('v_low_stock_alerts'),('v_org_hierarchy_with_stock'),('v_incoming_stock_detail'),
    ('v_incoming_transfers_detail'),('v_incoming_stock_transfers'),('v_incoming_stock')
)
SELECT view_name,to_regclass('public.'||view_name) IS NOT NULL AS exists,
       CASE WHEN to_regclass('public.'||view_name) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status
FROM expected
ORDER BY view_name;

SELECT 'A.7 BLOCKER: Phase 4 movement reference types must be permitted' AS check_section;
WITH expected(name) AS (VALUES ('stock_movements_reference_type_check'))
SELECT e.name AS conname,
       pg_get_constraintdef(c.oid) AS definition,
       coalesce(position('order_config_change' IN pg_get_constraintdef(c.oid)) > 0,false) AS permits_order_config_change,
       coalesce(position('order_cancel_reversal' IN pg_get_constraintdef(c.oid)) > 0,false) AS permits_order_cancel_reversal,
       CASE
         WHEN c.oid IS NULL THEN 'FAIL: constraint missing'
         WHEN position('order_config_change' IN pg_get_constraintdef(c.oid)) > 0
          AND position('order_cancel_reversal' IN pg_get_constraintdef(c.oid)) > 0
         THEN 'PASS'
         ELSE 'FAIL: forward-only migration required before Phase 4 staging tests'
       END AS status
FROM expected e
LEFT JOIN pg_constraint c
  ON c.connamespace='public'::regnamespace AND c.conname=e.name;

SELECT 'A.8 configuration invariants (every result row is a failure)' AS check_section;
SELECT c.conname,
       pg_get_constraintdef(c.oid) AS definition,
       coalesce(position('spin_wheel_in' IN pg_get_constraintdef(c.oid))>0,false) AS permits_positive_spin_wheel,
       coalesce(position('spin_wheel_out' IN pg_get_constraintdef(c.oid))>0,false) AS permits_negative_spin_wheel,
       CASE
         WHEN position('spin_wheel_in' IN pg_get_constraintdef(c.oid))>0
          AND position('spin_wheel_out' IN pg_get_constraintdef(c.oid))>0
          AND position('quantity_change > 0' IN pg_get_constraintdef(c.oid))>0
          AND position('quantity_change < 0' IN pg_get_constraintdef(c.oid))>0
         THEN 'PASS'
         ELSE 'FAIL: migration 07 movement/sign allowlist is not active'
       END AS status
FROM pg_constraint c
WHERE c.connamespace='public'::regnamespace AND c.conname='valid_quantity_change';

SELECT 'A.9 configuration invariants (every result row is a failure)' AS check_section;
SELECT c.id,c.variant_id,c.config_code,c.volume_ml,c.packaging,c.allow_so,c.requires_repacking_before_sale
FROM public.inventory_stock_configurations c
WHERE NOT (
  (c.volume_ml IS NULL AND c.packaging IS NULL)
  OR (c.volume_ml=20 AND c.packaging='new_box')
  OR (c.volume_ml=50 AND c.packaging IN ('new_box','old_box'))
)
OR (c.packaging='old_box' AND (c.allow_so OR NOT c.requires_repacking_before_sale));

SELECT 'A.10 active Cellera variants eligible for explicit enablement' AS check_section;
SELECT p.id AS product_id,p.product_code,p.product_name,p.is_vape,
       pv.id AS variant_id,pv.variant_code,pv.variant_name,
       count(c.id) AS configuration_rows,
       count(c.id) FILTER (WHERE c.volume_ml IS NOT NULL) AS physical_configuration_rows,
       max(c.config_code) FILTER (WHERE c.is_variant_default) AS current_default_code,
       coalesce(sum(pi.quantity_on_hand) FILTER (WHERE c.is_variant_default),0) AS current_default_on_hand,
       CASE
         WHEN count(c.id) FILTER (WHERE c.volume_ml IS NOT NULL)=0
          AND count(c.id) FILTER (WHERE c.is_variant_default)=1
         THEN 'ELIGIBLE: business may select explicitly'
         ELSE 'ALREADY ENABLED OR REQUIRES REVIEW'
       END AS enablement_status
FROM public.products p
JOIN public.product_variants pv ON pv.product_id=p.id
LEFT JOIN public.inventory_stock_configurations c ON c.variant_id=pv.id
LEFT JOIN public.product_inventory pi ON pi.variant_id=pv.id AND pi.stock_config_id=c.id AND pi.is_active=true
WHERE p.is_active=true AND pv.is_active=true
  AND p.is_vape=true
  AND (p.product_name ILIKE '%Cellera%' OR p.product_code ILIKE 'CEL%')
GROUP BY p.id,p.product_code,p.product_name,p.is_vape,pv.id,pv.variant_code,pv.variant_name
ORDER BY p.product_name,pv.variant_name;

SELECT 'A.11 legacy/unclassified balances (no rows are changed)' AS check_section;
SELECT o.id AS organization_id,o.org_code,o.org_name,
       p.product_name,pv.id AS variant_id,pv.variant_code,pv.variant_name,
       c.id AS stock_config_id,c.config_code,c.config_label,c.status,
       pi.quantity_on_hand,pi.quantity_allocated,pi.quantity_available
FROM public.product_inventory pi
JOIN public.organizations o ON o.id=pi.organization_id
JOIN public.product_variants pv ON pv.id=pi.variant_id
JOIN public.products p ON p.id=pv.product_id
JOIN public.inventory_stock_configurations c ON c.id=pi.stock_config_id AND c.variant_id=pi.variant_id
WHERE c.config_code='UNCLASSIFIED'
   OR (c.is_variant_default AND c.volume_ml IS NULL AND c.packaging IS NULL)
ORDER BY o.org_name,p.product_name,pv.variant_name;

SELECT count(*) AS historical_movements_with_null_configuration,
       min(created_at) AS earliest_legacy_movement,
       max(created_at) AS latest_legacy_movement
FROM public.stock_movements
WHERE stock_config_id IS NULL;

SELECT 'A.12 active warehouses suitable for selection (identifiers only)' AS check_section;
SELECT o.id,o.org_code,o.org_name,o.parent_org_id,
       public.get_company_id(o.id) AS resolved_company_id,
       count(pi.id) AS active_inventory_rows
FROM public.organizations o
LEFT JOIN public.product_inventory pi ON pi.organization_id=o.id AND pi.is_active=true
WHERE o.org_type_code='WH' AND o.is_active=true
GROUP BY o.id,o.org_code,o.org_name,o.parent_org_id
ORDER BY o.org_name;

SELECT 'A.13 active distributor organizations suitable for selection' AS check_section;
SELECT o.id,o.org_code,o.org_name,o.parent_org_id,
       coalesce(e.allow_50ml_new_box,false) AS currently_eligible_50ml,
       e.notes AS eligibility_notes
FROM public.organizations o
LEFT JOIN public.distributor_stock_config_eligibility e ON e.distributor_org_id=o.id
WHERE o.org_type_code='DIST' AND o.is_active=true
ORDER BY o.org_name;

-- ============================================================================
-- SECTION B — SESSION-LOCAL PARAMETERS (NO PERSISTENT BUSINESS DATA CHANGE)
-- Replace each NULL with a quoted UUID selected from Section A.
-- Never copy identifiers from another environment.
-- ============================================================================

DROP TABLE IF EXISTS pg_temp.stock_config_test_parameters;
CREATE TEMP TABLE stock_config_test_parameters (
  confirm_target text NOT NULL,
  run_setup boolean NOT NULL,
  add_test_stock boolean NOT NULL,
  run_cleanup boolean NOT NULL,
  test_variant_id uuid,
  test_warehouse_id uuid,
  normal_distributor_org_id uuid,
  eligible_50ml_distributor_org_id uuid,
  seed_20nb_qty integer NOT NULL,
  seed_50nb_qty integer NOT NULL,
  seed_50ob_qty integer NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO stock_config_test_parameters VALUES (
  'NO',  -- Change to STAGING-ONLY only after confirming localhost targets staging.
  false, -- RUN_SETUP: change to true for controlled setup only.
  false, -- ADD_TEST_STOCK: optional; requires empty selected configuration balances.
  false, -- RUN_CLEANUP: keep false during setup/testing; never true with RUN_SETUP.
  NULL,  -- TEST_VARIANT_ID
  NULL,  -- TEST_WAREHOUSE_ID
  NULL,  -- NORMAL_DISTRIBUTOR_ORG_ID
  NULL,  -- ELIGIBLE_50ML_DISTRIBUTOR_ORG_ID
  20,    -- optional 20NB test units
  20,    -- optional 50NB test units
  20     -- optional 50OB test units
);

SELECT * FROM stock_config_test_parameters;

-- ============================================================================
-- SECTION C — CONTROLLED SETUP (PERSISTENT STAGING TEST-DATA CHANGES)
-- Does nothing while RUN_SETUP=false. All changes occur in one DO statement,
-- so an error rolls back configuration enablement, optional stock, and test
-- eligibility together.
-- ============================================================================

DO $setup$
DECLARE
  p stock_config_test_parameters%ROWTYPE;
  v_company_id uuid;
  v_base_cost numeric;
  v_existing_notes text;
  v_cfg record;
  v_reference_no text;
BEGIN
  SELECT * INTO STRICT p FROM stock_config_test_parameters;
  IF NOT p.run_setup THEN RETURN; END IF;

  IF p.run_cleanup THEN
    RAISE EXCEPTION 'RUN_SETUP and RUN_CLEANUP cannot both be true';
  END IF;
  IF p.confirm_target <> 'STAGING-ONLY' THEN
    RAISE EXCEPTION 'Persistent changes refused: CONFIRM_TARGET must equal STAGING-ONLY';
  END IF;
  IF p.test_variant_id IS NULL OR p.test_warehouse_id IS NULL
     OR p.normal_distributor_org_id IS NULL OR p.eligible_50ml_distributor_org_id IS NULL THEN
    RAISE EXCEPTION 'All four selected UUID parameters are required';
  END IF;
  IF p.normal_distributor_org_id=p.eligible_50ml_distributor_org_id THEN
    RAISE EXCEPTION 'Normal and 50ml-eligible distributors must be different organizations';
  END IF;
  IF p.seed_20nb_qty<=0 OR p.seed_50nb_qty<=0 OR p.seed_50ob_qty<=0 THEN
    RAISE EXCEPTION 'Optional seed quantities must be positive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products prod
    JOIN public.product_variants pv ON pv.product_id=prod.id
    WHERE pv.id=p.test_variant_id AND pv.is_active=true AND prod.is_active=true
      AND prod.is_vape=true
      AND (prod.product_name ILIKE '%Cellera%' OR prod.product_code ILIKE 'CEL%')
  ) THEN
    RAISE EXCEPTION 'TEST_VARIANT_ID is not an active Cellera vape variant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p.test_warehouse_id AND org_type_code='WH' AND is_active=true) THEN
    RAISE EXCEPTION 'TEST_WAREHOUSE_ID is not an active WH organization';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p.normal_distributor_org_id AND org_type_code='DIST' AND is_active=true) THEN
    RAISE EXCEPTION 'NORMAL_DISTRIBUTOR_ORG_ID is not an active DIST organization';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.distributor_stock_config_eligibility e
    WHERE e.distributor_org_id=p.normal_distributor_org_id AND e.allow_50ml_new_box=true
  ) THEN
    RAISE EXCEPTION 'NORMAL_DISTRIBUTOR_ORG_ID is already eligible for 50ml; select a genuinely normal distributor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p.eligible_50ml_distributor_org_id AND org_type_code='DIST' AND is_active=true) THEN
    RAISE EXCEPTION 'ELIGIBLE_50ML_DISTRIBUTOR_ORG_ID is not an active DIST organization';
  END IF;

  -- Fail before changing anything while migration 05's reference types remain
  -- incompatible with migration 03's CHECK constraint.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.connamespace='public'::regnamespace
      AND c.conname='stock_movements_reference_type_check'
      AND position('order_config_change' IN pg_get_constraintdef(c.oid))>0
      AND position('order_cancel_reversal' IN pg_get_constraintdef(c.oid))>0
  ) THEN
    RAISE EXCEPTION 'Phase 4 reference-type blocker is unresolved; apply an approved forward-only correction before setup';
  END IF;

  v_company_id:=public.get_company_id(p.test_warehouse_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve a company for TEST_WAREHOUSE_ID';
  END IF;
  SELECT coalesce(pv.base_cost,0) INTO v_base_cost
  FROM public.product_variants pv WHERE pv.id=p.test_variant_id;

  -- Actual Phase 0 signature: enable_variant_stock_configurations(uuid).
  -- Idempotent; existing balances remain on the same generic/default row,
  -- renamed UNCLASSIFIED when its code was STD.
  PERFORM public.enable_variant_stock_configurations(p.test_variant_id);

  IF (
    SELECT count(*) FROM public.inventory_stock_configurations c
    WHERE c.variant_id=p.test_variant_id AND c.volume_ml IS NOT NULL
  ) <> 3 OR EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.variant_id=p.test_variant_id
      AND NOT (
        (c.volume_ml IS NULL AND c.packaging IS NULL)
        OR (c.volume_ml=20 AND c.packaging='new_box')
        OR (c.volume_ml=50 AND c.packaging IN ('new_box','old_box'))
      )
  ) THEN
    RAISE EXCEPTION 'Selected variant does not have exactly the three permitted physical configurations';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.variant_id=p.test_variant_id AND c.config_code='20NB'
      AND c.volume_ml=20 AND c.packaging='new_box' AND c.status='active'
      AND c.allow_ord=true AND c.allow_so=true AND c.default_for_ord=true
      AND c.requires_repacking_before_sale=false
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.variant_id=p.test_variant_id AND c.config_code='50NB'
      AND c.volume_ml=50 AND c.packaging='new_box' AND c.status='active'
      AND c.allow_ord=false AND c.allow_so=true AND c.default_for_ord=false
      AND c.requires_repacking_before_sale=false
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.variant_id=p.test_variant_id AND c.config_code='50OB'
      AND c.volume_ml=50 AND c.packaging='old_box' AND c.status='phase_out'
      AND c.allow_ord=false AND c.allow_so=false AND c.default_for_ord=false
      AND c.requires_repacking_before_sale=true
  ) THEN
    RAISE EXCEPTION '20NB/50NB/50OB flags do not match migrations 01-06';
  END IF;

  IF p.add_test_stock THEN
    FOR v_cfg IN
      SELECT c.id,c.config_code,
             CASE c.config_code
               WHEN '20NB' THEN p.seed_20nb_qty
               WHEN '50NB' THEN p.seed_50nb_qty
               WHEN '50OB' THEN p.seed_50ob_qty
             END AS seed_qty
      FROM public.inventory_stock_configurations c
      WHERE c.variant_id=p.test_variant_id AND c.config_code IN ('20NB','50NB','50OB')
      ORDER BY c.config_code
    LOOP
      v_reference_no:=format(
        'TEST-STOCKCFG-SEED-%s-%s-%s',
        v_cfg.config_code,left(p.test_variant_id::text,8),left(p.test_warehouse_id::text,8)
      );

      -- Repeat-safe: an existing tagged seed is not posted twice.
      IF EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.reference_no=v_reference_no
          AND sm.reference_type='adjustment'
          AND sm.variant_id=p.test_variant_id
          AND sm.stock_config_id=v_cfg.id
          AND sm.to_organization_id=p.test_warehouse_id
      ) THEN
        CONTINUE;
      END IF;

      -- Protect staging-like business data: optional seed is only permitted
      -- when that exact physical balance is absent or zero and unallocated.
      IF EXISTS (
        SELECT 1 FROM public.product_inventory pi
        WHERE pi.variant_id=p.test_variant_id
          AND pi.organization_id=p.test_warehouse_id
          AND pi.stock_config_id=v_cfg.id
          AND (pi.quantity_on_hand<>0 OR pi.quantity_allocated<>0)
      ) THEN
        RAISE EXCEPTION 'Refusing test seed: % already has a nonzero balance at the selected warehouse',v_cfg.config_code;
      END IF;

      PERFORM public.record_stock_movement(
        p_movement_type   => 'addition',
        p_variant_id      => p.test_variant_id,
        p_organization_id => p.test_warehouse_id,
        p_quantity_change => v_cfg.seed_qty,
        p_unit_cost       => v_base_cost,
        p_reason          => 'STAGING stock-configuration localhost test seed',
        p_notes           => 'TEST-STOCKCFG: reverse with Section F after all test orders/repacking are reversed',
        p_reference_type  => 'adjustment',
        p_reference_id    => NULL,
        p_reference_no    => v_reference_no,
        p_company_id      => v_company_id,
        p_created_by      => auth.uid(),
        p_evidence_urls   => NULL,
        p_stock_config_id => v_cfg.id
      );
    END LOOP;
  END IF;

  -- Do not overwrite or later delete a pre-existing business eligibility row.
  SELECT e.notes INTO v_existing_notes
  FROM public.distributor_stock_config_eligibility e
  WHERE e.distributor_org_id=p.eligible_50ml_distributor_org_id;
  IF FOUND AND v_existing_notes IS DISTINCT FROM 'TEST-STOCKCFG-ELIGIBILITY' THEN
    RAISE EXCEPTION 'Selected eligible distributor already has a non-test eligibility row; choose another distributor';
  END IF;

  INSERT INTO public.distributor_stock_config_eligibility(
    distributor_org_id,allow_50ml_new_box,notes,created_by
  ) VALUES (
    p.eligible_50ml_distributor_org_id,true,'TEST-STOCKCFG-ELIGIBILITY',auth.uid()
  )
  ON CONFLICT(distributor_org_id) DO UPDATE
    SET allow_50ml_new_box=true,
        notes='TEST-STOCKCFG-ELIGIBILITY',
        updated_at=now();
END
$setup$;

SELECT 'C.1 selected flavour configuration verification' AS check_section;
SELECT c.id,c.variant_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,c.status,
       c.is_variant_default,c.allow_ord,c.allow_so,c.default_for_ord,c.requires_repacking_before_sale,
       CASE
         WHEN c.config_code='20NB' THEN c.volume_ml=20 AND c.packaging='new_box' AND c.allow_so AND c.default_for_ord
         WHEN c.config_code='50NB' THEN c.volume_ml=50 AND c.packaging='new_box' AND c.allow_so AND NOT c.default_for_ord
         WHEN c.config_code='50OB' THEN c.volume_ml=50 AND c.packaging='old_box' AND NOT c.allow_so AND c.requires_repacking_before_sale
         WHEN c.config_code='UNCLASSIFIED' THEN c.volume_ml IS NULL AND c.packaging IS NULL
         ELSE false
       END AS expected_flags
FROM public.inventory_stock_configurations c
JOIN stock_config_test_parameters p ON p.test_variant_id=c.variant_id
ORDER BY c.sort_order,c.config_code;

SELECT 'C.2 20ml + Old Box must return zero rows' AS check_section;
SELECT c.*
FROM public.inventory_stock_configurations c
JOIN stock_config_test_parameters p ON p.test_variant_id=c.variant_id
WHERE c.volume_ml=20 AND c.packaging='old_box';

SELECT 'C.3 eligibility verification' AS check_section;
SELECT o.id,o.org_code,o.org_name,e.allow_50ml_new_box,e.notes,e.created_at,e.updated_at
FROM stock_config_test_parameters p
JOIN public.organizations o ON o.id=p.eligible_50ml_distributor_org_id
LEFT JOIN public.distributor_stock_config_eligibility e ON e.distributor_org_id=o.id;

-- ============================================================================
-- SECTION D — READ-ONLY RECONCILIATION FOR THE SELECTED PARAMETERS
-- Requires Section B's temporary parameter row in the same SQL session.
-- ============================================================================

SELECT 'D.1 selected warehouse balance by configuration' AS check_section;
SELECT o.org_code,o.org_name,pv.variant_code,pv.variant_name,
       c.id AS stock_config_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,c.status,
       coalesce(pi.quantity_on_hand,0) AS quantity_on_hand,
       coalesce(pi.quantity_allocated,0) AS quantity_allocated,
       coalesce(pi.quantity_available,0) AS quantity_available,
       pi.average_cost,pi.total_value
FROM stock_config_test_parameters t
JOIN public.organizations o ON o.id=t.test_warehouse_id
JOIN public.product_variants pv ON pv.id=t.test_variant_id
JOIN public.inventory_stock_configurations c ON c.variant_id=pv.id
LEFT JOIN public.product_inventory pi
  ON pi.organization_id=o.id AND pi.variant_id=pv.id AND pi.stock_config_id=c.id AND pi.is_active=true
ORDER BY c.sort_order,c.config_code;

SELECT 'D.2 variant aggregate, allocated, and available' AS check_section;
SELECT pi.organization_id,pi.variant_id,
       sum(pi.quantity_on_hand) AS variant_on_hand,
       sum(pi.quantity_allocated) AS variant_allocated,
       sum(pi.quantity_available) AS variant_available,
       sum(pi.quantity_on_hand)-sum(pi.quantity_allocated) AS recomputed_available,
       bool_and(pi.quantity_available=pi.quantity_on_hand-pi.quantity_allocated) AS every_row_consistent
FROM public.product_inventory pi
JOIN stock_config_test_parameters t
  ON t.test_warehouse_id=pi.organization_id AND t.test_variant_id=pi.variant_id
WHERE pi.is_active=true
GROUP BY pi.organization_id,pi.variant_id;

SELECT 'D.3 configuration detail view must equal base-table variant total' AS check_section;
WITH base AS (
  SELECT pi.organization_id,pi.variant_id,
         sum(pi.quantity_on_hand) on_hand,
         sum(pi.quantity_allocated) allocated,
         sum(pi.quantity_available) available
  FROM public.product_inventory pi
  JOIN stock_config_test_parameters t
    ON t.test_warehouse_id=pi.organization_id AND t.test_variant_id=pi.variant_id
  WHERE pi.is_active=true
  GROUP BY pi.organization_id,pi.variant_id
), detail_view AS (
  SELECT v.organization_id,v.variant_id,
         sum(v.quantity_on_hand) on_hand,
         sum(v.quantity_allocated) allocated,
         sum(v.quantity_available) available,
         count(*) detail_rows
  FROM public.vw_inventory_on_hand v
  JOIN stock_config_test_parameters t
    ON t.test_warehouse_id=v.organization_id AND t.test_variant_id=v.variant_id
  GROUP BY v.organization_id,v.variant_id
)
SELECT b.organization_id,b.variant_id,d.detail_rows,
       b.on_hand AS base_on_hand,d.on_hand AS detail_sum_on_hand,
       b.allocated AS base_allocated,d.allocated AS detail_sum_allocated,
       b.available AS base_available,d.available AS detail_sum_available,
       b.on_hand IS NOT DISTINCT FROM d.on_hand
       AND b.allocated IS NOT DISTINCT FROM d.allocated
       AND b.available IS NOT DISTINCT FROM d.available AS totals_match_without_duplication
FROM base b
LEFT JOIN detail_view d USING(organization_id,variant_id);

SELECT 'D.4 stock movements by exact configuration' AS check_section;
SELECT sm.id,sm.created_at,sm.movement_type,sm.reference_type,sm.reference_id,sm.reference_no,
       sm.from_organization_id,sm.to_organization_id,sm.quantity_before,sm.quantity_change,sm.quantity_after,
       c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,sm.reason,sm.notes
FROM public.stock_movements sm
JOIN stock_config_test_parameters t ON t.test_variant_id=sm.variant_id
LEFT JOIN public.inventory_stock_configurations c
  ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
WHERE sm.stock_config_id IS NOT NULL
ORDER BY sm.created_at DESC,sm.id DESC
LIMIT 250;

SELECT 'D.5 RPK repack movement pairs' AS check_section;
SELECT sm.reference_no,sm.variant_id,
       max(sm.created_at) AS posted_at,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='repack_out') AS repack_out_qty,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='repack_in') AS repack_in_qty,
       max(c.config_code) FILTER(WHERE sm.movement_type='repack_out') AS from_config,
       max(c.config_code) FILTER(WHERE sm.movement_type='repack_in') AS to_config,
       coalesce(sum(sm.quantity_change),0)=0 AS quantity_balances
FROM public.stock_movements sm
JOIN stock_config_test_parameters t ON t.test_variant_id=sm.variant_id
JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
WHERE sm.reference_type='repack' AND sm.reference_no LIKE 'RPK-%'
GROUP BY sm.reference_no,sm.variant_id
ORDER BY posted_at DESC;

SELECT 'D.6 SO allocation, outbound, buyer credit, and reversal detail' AS check_section;
SELECT o.id AS order_id,o.order_no,o.order_type,o.status,o.seller_org_id,o.buyer_org_id,
       oi.id AS order_item_id,oi.qty,oi.stock_config_id,oi.stock_config_confirmed_at,
       c.config_code,c.stock_sku,
       sm.id AS movement_id,sm.created_at,sm.movement_type,sm.reference_type,
       sm.from_organization_id,sm.to_organization_id,
       sm.quantity_before,sm.quantity_change,sm.quantity_after,sm.notes
FROM stock_config_test_parameters t
JOIN public.order_items oi ON oi.variant_id=t.test_variant_id
JOIN public.orders o ON o.id=oi.order_id
LEFT JOIN public.inventory_stock_configurations c
  ON c.id=oi.stock_config_id AND c.variant_id=oi.variant_id
LEFT JOIN public.stock_movements sm
  ON sm.reference_id=o.id AND sm.variant_id=oi.variant_id
 AND sm.stock_config_id IS NOT DISTINCT FROM oi.stock_config_id
WHERE o.buyer_org_id IN (t.normal_distributor_org_id,t.eligible_50ml_distributor_org_id)
  AND o.order_type IN ('D2H','S2D')
ORDER BY o.created_at DESC,oi.id,sm.created_at,sm.id;

SELECT 'D.7 SO signed movement summary by order/configuration' AS check_section;
SELECT o.id AS order_id,o.order_no,o.status,sm.stock_config_id,c.config_code,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='allocation') AS allocated_events,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='deallocation') AS deallocated_events,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='order_fulfillment') AS warehouse_outbound,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='transfer_in' AND sm.reference_type='order') AS buyer_credit,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='transfer_out' AND sm.reference_type='order_cancel_reversal') AS buyer_reversal,
       sum(sm.quantity_change) FILTER(WHERE sm.movement_type='order_cancelled' AND sm.reference_type='order_cancel_reversal') AS warehouse_restore
FROM stock_config_test_parameters t
JOIN public.order_items oi ON oi.variant_id=t.test_variant_id
JOIN public.orders o ON o.id=oi.order_id
JOIN public.stock_movements sm ON sm.reference_id=o.id AND sm.variant_id=oi.variant_id
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
WHERE o.buyer_org_id IN (t.normal_distributor_org_id,t.eligible_50ml_distributor_org_id)
GROUP BY o.id,o.order_no,o.status,sm.stock_config_id,c.config_code
ORDER BY max(sm.created_at) DESC;

SELECT 'D.8 WMS QR/order-line configuration reconciliation' AS check_section;
WITH qr AS (
  SELECT qc.order_id,qc.order_item_id,
         count(*) AS linked_qr_units,
         count(*) FILTER(WHERE qc.variant_id<>oi.variant_id) AS qr_variant_mismatches
  FROM public.qr_codes qc
  JOIN public.order_items oi ON oi.id=qc.order_item_id AND oi.order_id=qc.order_id
  GROUP BY qc.order_id,qc.order_item_id
), movement AS (
  SELECT sm.reference_id AS order_id,sm.variant_id,sm.stock_config_id,
         count(*) FILTER(WHERE sm.movement_type='order_fulfillment') AS outbound_movement_count,
         coalesce(sum(sm.quantity_change) FILTER(WHERE sm.movement_type='order_fulfillment'),0) AS outbound_quantity,
         string_agg(DISTINCT sm.notes,' | ') FILTER(WHERE sm.movement_type='order_fulfillment') AS outbound_notes
  FROM public.stock_movements sm
  WHERE sm.reference_type='order'
  GROUP BY sm.reference_id,sm.variant_id,sm.stock_config_id
)
SELECT o.id AS order_id,o.order_no,oi.id AS order_item_id,oi.variant_id,
       oi.stock_config_id,c.config_code,oi.stock_config_confirmed_at,
       coalesce(qr.linked_qr_units,0) AS linked_qr_units,
       coalesce(qr.qr_variant_mismatches,0) AS qr_variant_mismatches,
       coalesce(movement.outbound_movement_count,0) AS outbound_movement_count,
       coalesce(movement.outbound_quantity,0) AS outbound_quantity,
       movement.outbound_notes
FROM stock_config_test_parameters t
JOIN public.order_items oi ON oi.variant_id=t.test_variant_id
JOIN public.orders o ON o.id=oi.order_id
LEFT JOIN public.inventory_stock_configurations c ON c.id=oi.stock_config_id AND c.variant_id=oi.variant_id
LEFT JOIN qr ON qr.order_id=o.id AND qr.order_item_id=oi.id
LEFT JOIN movement
  ON movement.order_id=o.id AND movement.variant_id=oi.variant_id
 AND movement.stock_config_id IS NOT DISTINCT FROM oi.stock_config_id
WHERE o.buyer_org_id IN (t.normal_distributor_org_id,t.eligible_50ml_distributor_org_id)
ORDER BY o.created_at DESC,oi.id;

SELECT 'D.9 WMS dedup rows tied to selected configured movements' AS check_section;
SELECT d.dedup_key,d.movement_id,d.created_at,
       sm.reference_id AS order_id,sm.variant_id,sm.stock_config_id,c.config_code,
       sm.movement_type,sm.quantity_change,sm.notes
FROM public.wms_movement_dedup d
JOIN public.stock_movements sm ON sm.id=d.movement_id
JOIN stock_config_test_parameters t ON t.test_variant_id=sm.variant_id
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
ORDER BY d.created_at DESC;

-- ============================================================================
-- SECTION E — ELIGIBILITY REMOVAL (standalone cleanup statement)
-- This exact DELETE is also performed by Section F. It only removes the row
-- if it carries this script's marker, preserving pre-existing business rows.
-- Keep commented unless intentionally cleaning up the selected test mapping.
-- ============================================================================
-- DELETE FROM public.distributor_stock_config_eligibility e
-- USING stock_config_test_parameters p
-- WHERE e.distributor_org_id=p.eligible_50ml_distributor_org_id
--   AND e.notes='TEST-STOCKCFG-ELIGIBILITY';

-- ============================================================================
-- SECTION F — CONTROLLED TEST QUANTITY + ELIGIBILITY CLEANUP
-- Before setting RUN_CLEANUP=true:
--   1. Cancel/reverse every test SO and verify buyer credit is reversed.
--   2. Reverse/complete test transfers.
--   3. Reverse any RPK test so quantities are back in their seed configs.
--   4. Confirm selected warehouse allocations are zero in D.1.
-- Cleanup never removes configuration catalog rows and never touches
-- UNCLASSIFIED stock. Configuration enablement is intentionally persistent.
-- ============================================================================

DO $cleanup$
DECLARE
  p stock_config_test_parameters%ROWTYPE;
  v_company_id uuid;
  v_cfg record;
  v_seed_reference text;
  v_cleanup_reference text;
  v_tagged_net integer;
  v_available integer;
  v_allocated integer;
  v_unit_cost numeric;
BEGIN
  SELECT * INTO STRICT p FROM stock_config_test_parameters;
  IF NOT p.run_cleanup THEN RETURN; END IF;

  IF p.run_setup THEN RAISE EXCEPTION 'RUN_SETUP and RUN_CLEANUP cannot both be true'; END IF;
  IF p.confirm_target<>'STAGING-ONLY' THEN
    RAISE EXCEPTION 'Cleanup refused: CONFIRM_TARGET must equal STAGING-ONLY';
  END IF;
  IF p.test_variant_id IS NULL OR p.test_warehouse_id IS NULL
     OR p.eligible_50ml_distributor_org_id IS NULL THEN
    RAISE EXCEPTION 'Cleanup requires the same selected UUID parameters used during setup';
  END IF;

  v_company_id:=public.get_company_id(p.test_warehouse_id);
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Cannot resolve company for selected warehouse'; END IF;

  FOR v_cfg IN
    SELECT c.id,c.config_code
    FROM public.inventory_stock_configurations c
    WHERE c.variant_id=p.test_variant_id AND c.config_code IN ('20NB','50NB','50OB')
    ORDER BY c.config_code
  LOOP
    v_seed_reference:=format(
      'TEST-STOCKCFG-SEED-%s-%s-%s',
      v_cfg.config_code,left(p.test_variant_id::text,8),left(p.test_warehouse_id::text,8)
    );
    v_cleanup_reference:=format(
      'TEST-STOCKCFG-CLEANUP-%s-%s-%s',
      v_cfg.config_code,left(p.test_variant_id::text,8),left(p.test_warehouse_id::text,8)
    );

    SELECT coalesce(sum(sm.quantity_change),0)::integer INTO v_tagged_net
    FROM public.stock_movements sm
    WHERE sm.variant_id=p.test_variant_id
      AND sm.stock_config_id=v_cfg.id
      AND sm.reference_type='adjustment'
      AND sm.reference_no IN (v_seed_reference,v_cleanup_reference)
      AND public._movement_warehouse_id(sm.movement_type,sm.from_organization_id,sm.to_organization_id)=p.test_warehouse_id;

    IF v_tagged_net<0 THEN
      RAISE EXCEPTION 'Tagged test movement net is negative for %; manual review required',v_cfg.config_code;
    END IF;
    IF v_tagged_net=0 THEN CONTINUE; END IF;

    SELECT pi.quantity_available,pi.quantity_allocated,coalesce(pi.average_cost,0)
      INTO v_available,v_allocated,v_unit_cost
    FROM public.product_inventory pi
    WHERE pi.variant_id=p.test_variant_id
      AND pi.organization_id=p.test_warehouse_id
      AND pi.stock_config_id=v_cfg.id
      AND pi.is_active=true
    FOR UPDATE;

    IF NOT FOUND OR v_allocated<>0 OR v_available<v_tagged_net THEN
      RAISE EXCEPTION 'Cannot safely reverse % test units from %: reverse test workflows and allocations first',v_tagged_net,v_cfg.config_code;
    END IF;

    PERFORM public.record_stock_movement(
      p_movement_type   => 'adjustment',
      p_variant_id      => p.test_variant_id,
      p_organization_id => p.test_warehouse_id,
      p_quantity_change => -v_tagged_net,
      p_unit_cost       => v_unit_cost,
      p_reason          => 'STAGING stock-configuration test seed cleanup',
      p_notes           => 'TEST-STOCKCFG cleanup; reverses tagged seed only',
      p_reference_type  => 'adjustment',
      p_reference_id    => NULL,
      p_reference_no    => v_cleanup_reference,
      p_company_id      => v_company_id,
      p_created_by      => auth.uid(),
      p_evidence_urls   => NULL,
      p_stock_config_id => v_cfg.id
    );
  END LOOP;

  DELETE FROM public.distributor_stock_config_eligibility e
  WHERE e.distributor_org_id=p.eligible_50ml_distributor_org_id
    AND e.notes='TEST-STOCKCFG-ELIGIBILITY';
END
$cleanup$;

SELECT 'F.1 cleanup verification: every tagged net must be zero' AS check_section;
SELECT sm.variant_id,sm.stock_config_id,c.config_code,
       sum(sm.quantity_change) AS tagged_net,
       min(sm.created_at) AS first_tagged_movement,
       max(sm.created_at) AS last_tagged_movement
FROM public.stock_movements sm
JOIN stock_config_test_parameters p ON p.test_variant_id=sm.variant_id
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
WHERE sm.reference_type='adjustment'
  AND sm.reference_no LIKE 'TEST-STOCKCFG-%'
GROUP BY sm.variant_id,sm.stock_config_id,c.config_code
ORDER BY c.config_code;

SELECT 'F.2 cleanup verification: test eligibility row must be absent' AS check_section;
SELECT e.*
FROM public.distributor_stock_config_eligibility e
JOIN stock_config_test_parameters p ON p.eligible_50ml_distributor_org_id=e.distributor_org_id
WHERE e.notes='TEST-STOCKCFG-ELIGIBILITY';
