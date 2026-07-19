-- Stock configuration production preflight (2026-07-19)
-- Read-only: every top-level statement is a catalog or data SELECT.
-- Run the whole file in the production SQL editor and copy every result grid.
-- query_to_xml is used only to execute guarded SELECT text. This lets the file
-- report an absent or partially applied Migration 01 without failing parse-time
-- relation checks. It does not change database state.

-- A. MIGRATION STATE ---------------------------------------------------------

SELECT
  'A01_MIGRATION_STATE' AS section,
  'inventory_stock_configurations_table' AS result_label,
  to_regclass('public.inventory_stock_configurations') IS NOT NULL AS exists;

WITH expected(table_name) AS (
  VALUES
    ('product_inventory'::text),
    ('stock_movements'),
    ('stock_count_session_items'),
    ('stock_adjustment_items'),
    ('warehouse_receipt_items')
)
SELECT
  'A02_MIGRATION_STATE' AS section,
  'phase_01_stock_config_columns' AS result_label,
  e.table_name,
  to_regclass(format('public.%I', e.table_name)) IS NOT NULL AS table_exists,
  EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = e.table_name
      AND c.column_name = 'stock_config_id'
  ) AS stock_config_id_exists
FROM expected e
ORDER BY e.table_name;

WITH markers(marker, present) AS (
  VALUES
    ('table:inventory_stock_configurations', to_regclass('public.inventory_stock_configurations') IS NOT NULL),
    ('function:generate_stock_sku', to_regprocedure('public.generate_stock_sku(uuid,text)') IS NOT NULL),
    ('function:resolve_default_stock_config', to_regprocedure('public.resolve_default_stock_config(uuid)') IS NOT NULL),
    ('function:create_default_stock_config_for_variant', to_regprocedure('public.create_default_stock_config_for_variant()') IS NOT NULL),
    ('function:enable_variant_stock_configurations', to_regprocedure('public.enable_variant_stock_configurations(uuid)') IS NOT NULL),
    ('index:isc_stock_sku_key', to_regclass('public.isc_stock_sku_key') IS NOT NULL),
    ('index:isc_one_variant_default', to_regclass('public.isc_one_variant_default') IS NOT NULL),
    ('index:isc_one_ord_default', to_regclass('public.isc_one_ord_default') IS NOT NULL),
    ('index:isc_variant_dimensions_key', to_regclass('public.isc_variant_dimensions_key') IS NOT NULL),
    ('column:product_inventory.stock_config_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_inventory' AND column_name='stock_config_id')),
    ('column:stock_movements.stock_config_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_movements' AND column_name='stock_config_id')),
    ('column:stock_count_session_items.stock_config_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_count_session_items' AND column_name='stock_config_id')),
    ('column:stock_adjustment_items.stock_config_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_adjustment_items' AND column_name='stock_config_id')),
    ('column:warehouse_receipt_items.stock_config_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='warehouse_receipt_items' AND column_name='stock_config_id')),
    ('trigger:trg_product_variants_default_stock_config', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.product_variants') AND tgname='trg_product_variants_default_stock_config' AND NOT tgisinternal))
), summary AS (
  SELECT count(*) FILTER (WHERE present) AS found, count(*) AS expected
  FROM markers
)
SELECT
  'A03_MIGRATION_STATE' AS section,
  'phase_01_application_assessment' AS result_label,
  found,
  expected,
  CASE
    WHEN found = 0 THEN 'FULLY_ABSENT'
    WHEN found = expected THEN 'COMPLETED'
    ELSE 'PARTIALLY_APPLIED'
  END AS assessment
FROM summary;

WITH expected(object_type, object_name, present) AS (
  VALUES
    ('function', 'generate_stock_sku(uuid,text)', to_regprocedure('public.generate_stock_sku(uuid,text)') IS NOT NULL),
    ('function', 'resolve_default_stock_config(uuid)', to_regprocedure('public.resolve_default_stock_config(uuid)') IS NOT NULL),
    ('function', 'create_default_stock_config_for_variant()', to_regprocedure('public.create_default_stock_config_for_variant()') IS NOT NULL),
    ('function', 'enable_variant_stock_configurations(uuid)', to_regprocedure('public.enable_variant_stock_configurations(uuid)') IS NOT NULL),
    ('trigger', 'trg_product_variants_default_stock_config', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.product_variants') AND tgname='trg_product_variants_default_stock_config' AND NOT tgisinternal)),
    ('trigger', 'set_isc_updated_at', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.inventory_stock_configurations') AND tgname='set_isc_updated_at' AND NOT tgisinternal)),
    ('index', 'isc_stock_sku_key', to_regclass('public.isc_stock_sku_key') IS NOT NULL),
    ('index', 'isc_one_variant_default', to_regclass('public.isc_one_variant_default') IS NOT NULL),
    ('index', 'isc_one_ord_default', to_regclass('public.isc_one_ord_default') IS NOT NULL),
    ('index', 'isc_variant_dimensions_key', to_regclass('public.isc_variant_dimensions_key') IS NOT NULL),
    ('index', 'isc_variant_idx', to_regclass('public.isc_variant_idx') IS NOT NULL),
    ('index', 'idx_product_inventory_stock_config', to_regclass('public.idx_product_inventory_stock_config') IS NOT NULL),
    ('index', 'idx_stock_movements_stock_config', to_regclass('public.idx_stock_movements_stock_config') IS NOT NULL),
    ('constraint', 'isc_variant_config_code_key', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.inventory_stock_configurations') AND conname='isc_variant_config_code_key')),
    ('constraint', 'isc_id_variant_key', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.inventory_stock_configurations') AND conname='isc_id_variant_key')),
    ('constraint', 'product_inventory_stock_config_fk', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.product_inventory') AND conname='product_inventory_stock_config_fk')),
    ('constraint', 'stock_movements_stock_config_fk', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.stock_movements') AND conname='stock_movements_stock_config_fk')),
    ('constraint', 'stock_count_session_items_stock_config_fk', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.stock_count_session_items') AND conname='stock_count_session_items_stock_config_fk')),
    ('constraint', 'stock_adjustment_items_stock_config_fk', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.stock_adjustment_items') AND conname='stock_adjustment_items_stock_config_fk')),
    ('constraint', 'warehouse_receipt_items_stock_config_fk', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.warehouse_receipt_items') AND conname='warehouse_receipt_items_stock_config_fk'))
)
SELECT
  'A04_MIGRATION_STATE' AS section,
  'phase_01_objects' AS result_label,
  object_type,
  object_name,
  present
FROM expected
ORDER BY object_type, object_name;

SELECT
  'A05_SCHEMA_STRUCTURE' AS section,
  'product_variants_and_inventory_columns' AS result_label,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
    c.table_name = 'product_variants'
    OR c.table_name ILIKE '%inventory%'
    OR c.table_name ILIKE '%stock%'
    OR c.table_name ILIKE 'warehouse_receipt%'
    OR c.table_name IN ('order_items', 'orders', 'qr_batches', 'qr_master_codes')
  )
ORDER BY c.table_name, c.ordinal_position;

SELECT
  'A06_SCHEMA_STRUCTURE' AS section,
  'variant_related_foreign_keys' AS result_label,
  conrelid::regclass::text AS source_table,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace
  AND (
    confrelid = to_regclass('public.product_variants')
    OR confrelid = to_regclass('public.inventory_stock_configurations')
  )
ORDER BY source_table, constraint_name;

-- B. EXISTING CONFIGURATION DATA --------------------------------------------

SELECT
  'B01_EXISTING_CONFIGURATION_DATA' AS section,
  'configuration_row_count' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent>'
    ELSE query_to_xml($q$
      SELECT 'B01_EXISTING_CONFIGURATION_DATA' AS section,
             'configuration_row_count' AS result_label,
             count(*) AS row_count
      FROM public.inventory_stock_configurations
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'B02_EXISTING_CONFIGURATION_DATA' AS section,
  'std_unc_20nb_50nb_50ob_rows' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent>'
    ELSE query_to_xml($q$
      SELECT 'B02_EXISTING_CONFIGURATION_DATA' AS section,
             'std_unc_20nb_50nb_50ob_rows' AS result_label,
             c.id, c.variant_id, c.config_code, c.config_label, c.stock_sku,
             c.is_variant_default, c.default_for_ord, c.status
      FROM public.inventory_stock_configurations c
      WHERE c.config_code IN ('STD','UNC','UNCLASSIFIED','20NB','50NB','50OB')
      ORDER BY c.variant_id, c.sort_order, c.config_code
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'B03_EXISTING_CONFIGURATION_DATA' AS section,
  'duplicate_config_code_per_variant' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent>'
    ELSE query_to_xml($q$
      SELECT 'B03_EXISTING_CONFIGURATION_DATA' AS section,
             'duplicate_config_code_per_variant' AS result_label,
             variant_id, config_code, count(*) AS duplicate_count,
             array_agg(id ORDER BY id) AS configuration_ids
      FROM public.inventory_stock_configurations
      GROUP BY variant_id, config_code
      HAVING count(*) > 1
      ORDER BY variant_id, config_code
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'B04_EXISTING_CONFIGURATION_DATA' AS section,
  'duplicate_stock_sku_case_insensitive' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent>'
    ELSE query_to_xml($q$
      SELECT 'B04_EXISTING_CONFIGURATION_DATA' AS section,
             'duplicate_stock_sku_case_insensitive' AS result_label,
             upper(stock_sku) AS normalized_stock_sku, count(*) AS duplicate_count,
             array_agg(id ORDER BY id) AS configuration_ids,
             array_agg(variant_id ORDER BY variant_id) AS variant_ids
      FROM public.inventory_stock_configurations
      GROUP BY upper(stock_sku)
      HAVING count(*) > 1
      ORDER BY upper(stock_sku)
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'B05_EXISTING_CONFIGURATION_DATA' AS section,
  'variants_with_multiple_defaults' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent>'
    ELSE query_to_xml($q$
      SELECT 'B05_EXISTING_CONFIGURATION_DATA' AS section,
             'variants_with_multiple_defaults' AS result_label,
             variant_id, count(*) AS default_count,
             array_agg(id ORDER BY id) AS configuration_ids
      FROM public.inventory_stock_configurations
      WHERE is_variant_default
      GROUP BY variant_id
      HAVING count(*) > 1
      ORDER BY variant_id
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'B06_EXISTING_CONFIGURATION_DATA' AS section,
  'variants_with_no_default' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent; every variant still needs its Migration 01 seed>'
    ELSE query_to_xml($q$
      SELECT 'B06_EXISTING_CONFIGURATION_DATA' AS section,
             'variants_with_no_default' AS result_label,
             pv.id AS variant_id,
             to_jsonb(pv) ->> 'variant_code' AS variant_code,
             to_jsonb(pv) ->> 'product_code' AS product_code
      FROM public.product_variants pv
      WHERE NOT EXISTS (
        SELECT 1 FROM public.inventory_stock_configurations c
        WHERE c.variant_id = pv.id AND c.is_variant_default
      )
      ORDER BY pv.id
    $q$, false, true, '')::text
  END AS result_rows;

-- C. SOURCE COLLISION ANALYSIS ----------------------------------------------

WITH source AS (
  SELECT
    pv.id AS variant_id,
    to_jsonb(pv) ->> 'variant_code' AS variant_code,
    to_jsonb(pv) ->> 'product_code' AS product_code,
    trim(BOTH '-' FROM regexp_replace(
      upper(coalesce(nullif(btrim(to_jsonb(pv) ->> 'product_code'), ''), to_jsonb(pv) ->> 'variant_code')),
      '[^A-Z0-9]+', '-', 'g'
    )) AS sku_base
  FROM public.product_variants pv
), collisions AS (
  SELECT sku_base
  FROM source
  GROUP BY sku_base
  HAVING count(*) > 1
)
SELECT
  'C01_SOURCE_COLLISION_ANALYSIS' AS section,
  'duplicate_legacy_sku_bases' AS result_label,
  s.variant_id,
  s.variant_code,
  s.product_code,
  s.sku_base,
  s.sku_base || '-STD' AS legacy_generated_stock_sku
FROM source s
JOIN collisions c USING (sku_base)
ORDER BY s.sku_base, s.variant_id;

WITH source AS (
  SELECT
    pv.id AS variant_id,
    to_jsonb(pv) ->> 'variant_code' AS variant_code,
    to_jsonb(pv) ->> 'product_code' AS product_code,
    trim(BOTH '-' FROM regexp_replace(
      upper(coalesce(nullif(btrim(to_jsonb(pv) ->> 'product_code'), ''), to_jsonb(pv) ->> 'variant_code')),
      '[^A-Z0-9]+', '-', 'g'
    )) AS sku_base
  FROM public.product_variants pv
)
SELECT
  'C02_SOURCE_COLLISION_ANALYSIS' AS section,
  'variants_that_legacy_generator_maps_to_te_std' AS result_label,
  variant_id,
  variant_code,
  product_code,
  sku_base,
  sku_base || '-STD' AS legacy_generated_stock_sku
FROM source
WHERE sku_base || '-STD' = 'TE-STD'
ORDER BY variant_id;

WITH source AS (
  SELECT
    pv.id AS variant_id,
    to_jsonb(pv) ->> 'variant_code' AS variant_code,
    to_jsonb(pv) ->> 'product_code' AS product_code,
    trim(BOTH '-' FROM regexp_replace(
      upper(coalesce(nullif(btrim(to_jsonb(pv) ->> 'product_code'), ''), to_jsonb(pv) ->> 'variant_code')),
      '[^A-Z0-9]+', '-', 'g'
    )) AS sku_base
  FROM public.product_variants pv
)
SELECT
  'C03_SOURCE_COLLISION_ANALYSIS' AS section,
  'patched_stable_std_sku_preview' AS result_label,
  variant_id,
  variant_code,
  product_code,
  sku_base || '-STD-' || replace(variant_id::text, '-', '') AS patched_generated_stock_sku
FROM source
ORDER BY sku_base, variant_id;

-- D. MIGRATION SAFETY --------------------------------------------------------

SELECT
  'D01_MIGRATION_SAFETY' AS section,
  'product_inventory_rows_not_safely_backfillable' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN query_to_xml($q$
      SELECT 'D01_MIGRATION_SAFETY' AS section,
             'product_inventory_rows_not_safely_backfillable_before_phase_01' AS result_label,
             pi.id AS inventory_id, pi.variant_id, pi.organization_id,
             CASE WHEN pv.id IS NULL THEN 'ORPHAN_VARIANT' ELSE 'AWAITING_PHASE_01_DEFAULT_SEED' END AS reason
      FROM public.product_inventory pi
      LEFT JOIN public.product_variants pv ON pv.id = pi.variant_id
      WHERE pi.variant_id IS NULL OR pv.id IS NULL
      ORDER BY pi.id
    $q$, false, true, '')::text
    ELSE query_to_xml($q$
      SELECT 'D01_MIGRATION_SAFETY' AS section,
             'product_inventory_rows_not_safely_backfillable' AS result_label,
             pi.id AS inventory_id, pi.variant_id, pi.organization_id,
             count(c.id) AS matching_default_count
      FROM public.product_inventory pi
      LEFT JOIN public.product_variants pv ON pv.id = pi.variant_id
      LEFT JOIN public.inventory_stock_configurations c
        ON c.variant_id = pi.variant_id AND c.is_variant_default
      GROUP BY pi.id, pi.variant_id, pi.organization_id, pv.id
      HAVING pi.variant_id IS NULL OR pv.id IS NULL OR count(c.id) <> 1
      ORDER BY pi.id
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'D02_MIGRATION_SAFETY' AS section,
  'orphan_variant_ids_in_inventory_tables' AS result_label,
  query_to_xml($q$
    SELECT 'D02_MIGRATION_SAFETY' AS section,
           'orphan_variant_ids_in_product_inventory' AS result_label,
           pi.variant_id, count(*) AS row_count
    FROM public.product_inventory pi
    LEFT JOIN public.product_variants pv ON pv.id = pi.variant_id
    WHERE pi.variant_id IS NULL OR pv.id IS NULL
    GROUP BY pi.variant_id
    ORDER BY pi.variant_id
  $q$, false, true, '')::text AS result_rows;

SELECT
  'D03_MIGRATION_SAFETY' AS section,
  'duplicate_inventory_rows_before_and_after_phase_02_key' AS result_label,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_inventory' AND column_name='stock_config_id')
    THEN query_to_xml($q$
      SELECT 'D03_MIGRATION_SAFETY' AS section,
             'duplicate_variant_organization_configuration' AS result_label,
             variant_id, organization_id, stock_config_id, count(*) AS duplicate_count,
             array_agg(id ORDER BY id) AS inventory_ids
      FROM public.product_inventory
      GROUP BY variant_id, organization_id, stock_config_id
      HAVING count(*) > 1
      ORDER BY variant_id, organization_id, stock_config_id
    $q$, false, true, '')::text
    ELSE query_to_xml($q$
      SELECT 'D03_MIGRATION_SAFETY' AS section,
             'duplicate_variant_organization' AS result_label,
             variant_id, organization_id, count(*) AS duplicate_count,
             array_agg(id ORDER BY id) AS inventory_ids
      FROM public.product_inventory
      GROUP BY variant_id, organization_id
      HAVING count(*) > 1
      ORDER BY variant_id, organization_id
    $q$, false, true, '')::text
  END AS result_rows;

WITH relationships(table_name) AS (
  VALUES
    ('product_inventory'::text),
    ('stock_movements'),
    ('stock_count_session_items'),
    ('stock_adjustment_items'),
    ('warehouse_receipt_items'),
    ('order_items')
)
SELECT
  'D04_MIGRATION_SAFETY' AS section,
  'stock_configuration_relationship_column_readiness' AS result_label,
  r.table_name,
  to_regclass(format('public.%I', r.table_name)) IS NOT NULL AS table_exists,
  EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name='variant_id') AS variant_id_exists,
  EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name='stock_config_id') AS stock_config_id_exists
FROM relationships r
ORDER BY r.table_name;

SELECT
  'D05_MIGRATION_SAFETY' AS section,
  'invalid_configuration_rows_against_phase_01_rules' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
    THEN '<inventory_stock_configurations is absent>'
    ELSE query_to_xml($q$
      SELECT 'D05_MIGRATION_SAFETY' AS section,
             'invalid_configuration_rows_against_phase_01_rules' AS result_label,
             id, variant_id, config_code, stock_sku, volume_ml, packaging, status,
             allow_ord, allow_so, default_for_ord, requires_repacking_before_sale, units_per_case
      FROM public.inventory_stock_configurations
      WHERE config_code !~ '^[A-Z0-9_]{2,24}$'
         OR status NOT IN ('active','phase_out','inactive')
         OR packaging IS NOT NULL AND packaging NOT IN ('new_box','old_box')
         OR NOT (
              volume_ml IS NULL AND packaging IS NULL
              OR volume_ml = 20 AND packaging = 'new_box'
              OR volume_ml = 50 AND packaging IN ('new_box','old_box')
            )
         OR allow_so AND requires_repacking_before_sale
         OR default_for_ord AND NOT allow_ord
         OR units_per_case IS NOT NULL AND units_per_case <= 0
      ORDER BY variant_id, config_code
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'D06_MIGRATION_SAFETY' AS section,
  'invalid_or_null_configuration_relationships' AS result_label,
  CASE WHEN to_regclass('public.inventory_stock_configurations') IS NULL
         OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_inventory' AND column_name='stock_config_id')
    THEN '<configuration table or product_inventory.stock_config_id is absent>'
    ELSE query_to_xml($q$
      SELECT 'D06_MIGRATION_SAFETY' AS section,
             'invalid_or_null_product_inventory_configuration_relationships' AS result_label,
             pi.id AS inventory_id, pi.variant_id, pi.stock_config_id,
             CASE
               WHEN pi.stock_config_id IS NULL THEN 'NULL_STOCK_CONFIG'
               WHEN c.id IS NULL THEN 'ORPHAN_STOCK_CONFIG'
               WHEN c.variant_id IS DISTINCT FROM pi.variant_id THEN 'VARIANT_CONFIG_MISMATCH'
             END AS reason
      FROM public.product_inventory pi
      LEFT JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
      WHERE pi.stock_config_id IS NULL
         OR c.id IS NULL
         OR c.variant_id IS DISTINCT FROM pi.variant_id
      ORDER BY pi.id
    $q$, false, true, '')::text
  END AS result_rows;

SELECT
  'D07_MIGRATION_SAFETY' AS section,
  'existing_data_at_risk_for_phase_01_to_18_constraints' AS result_label,
  query_to_xml($q$
    SELECT 'D07_MIGRATION_SAFETY' AS section,
           'invalid_product_inventory_quantities' AS result_label,
           id, variant_id, organization_id, quantity_on_hand, quantity_allocated
    FROM public.product_inventory
    WHERE quantity_on_hand < 0
       OR quantity_allocated < 0
       OR quantity_allocated > quantity_on_hand
    ORDER BY id
  $q$, false, true, '')::text AS result_rows;

SELECT
  'D08_MIGRATION_SAFETY' AS section,
  'stock_movement_values_outside_phase_18_allowlists' AS result_label,
  query_to_xml($q$
    SELECT 'D08_MIGRATION_SAFETY' AS section,
           'stock_movement_values_outside_phase_18_allowlists' AS result_label,
           id, movement_type, reference_type, quantity_change
    FROM public.stock_movements
    WHERE reference_type IS NOT NULL
      AND reference_type NOT IN (
        'manual','order','transfer','adjustment','purchase_order','return','campaign',
        'repack','order_config_change','order_cancel_reversal','stock_classification'
      )
    ORDER BY id
  $q$, false, true, '')::text AS result_rows;

-- E. LATER MIGRATION READINESS ----------------------------------------------

WITH required(migration_range, object_kind, object_name, present) AS (
  VALUES
    ('02', 'table', 'inventory_stock_configurations', to_regclass('public.inventory_stock_configurations') IS NOT NULL),
    ('02', 'column', 'product_inventory.stock_config_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_inventory' AND column_name='stock_config_id')),
    ('02', 'function', 'resolve_default_stock_config(uuid)', to_regprocedure('public.resolve_default_stock_config(uuid)') IS NOT NULL),
    ('03', 'table', 'warehouse_receipt_items', to_regclass('public.warehouse_receipt_items') IS NOT NULL),
    ('03', 'table', 'stock_movements', to_regclass('public.stock_movements') IS NOT NULL),
    ('04', 'table', 'stock_count_sessions', to_regclass('public.stock_count_sessions') IS NOT NULL),
    ('04', 'table', 'stock_count_session_items', to_regclass('public.stock_count_session_items') IS NOT NULL),
    ('04', 'table', 'stock_adjustment_items', to_regclass('public.stock_adjustment_items') IS NOT NULL),
    ('05', 'table', 'order_items', to_regclass('public.order_items') IS NOT NULL),
    ('05', 'table', 'orders', to_regclass('public.orders') IS NOT NULL),
    ('06', 'table', 'product_inventory', to_regclass('public.product_inventory') IS NOT NULL),
    ('08-09', 'table', 'stock_count_verification_requests', to_regclass('public.stock_count_verification_requests') IS NOT NULL),
    ('08-09', 'column', 'stock_count_sessions.count_type', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_count_sessions' AND column_name='count_type')),
    ('10', 'function', 'repack_stock(uuid,uuid,uuid,uuid,integer,text,uuid)', to_regprocedure('public.repack_stock(uuid,uuid,uuid,uuid,integer,text,uuid)') IS NOT NULL),
    ('11-12', 'table', 'stock_transfers', to_regclass('public.stock_transfers') IS NOT NULL),
    ('13', 'function', 'record_stock_movement', EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='record_stock_movement')),
    ('14-18', 'table', 'stock_count_verification_requests', to_regclass('public.stock_count_verification_requests') IS NOT NULL),
    ('14-18', 'function', 'verify_and_post_stock_count(uuid,text)', to_regprocedure('public.verify_and_post_stock_count(uuid,text)') IS NOT NULL)
)
SELECT
  'E01_LATER_MIGRATION_READINESS' AS section,
  'required_objects_for_migrations_02_to_18' AS result_label,
  migration_range,
  object_kind,
  object_name,
  present
FROM required
ORDER BY migration_range, object_kind, object_name;

SELECT
  'E02_LATER_MIGRATION_READINESS' AS section,
  'existing_stock_configuration_objects_and_possible_manual_application' AS result_label,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'i' THEN 'index'
    WHEN 'S' THEN 'sequence'
    ELSE c.relkind::text
  END AS object_kind,
  n.nspname AS schema_name,
  c.relname AS object_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (
    c.relname ILIKE '%stock%config%'
    OR c.relname IN ('vw_inventory_on_hand','vw_manual_stock_balance','vw_stock_movements_ordered','v_stock_movements_display','v_wms_movements_recent')
  )
ORDER BY object_kind, object_name;

SELECT
  'E03_LATER_MIGRATION_READINESS' AS section,
  'existing_stock_configuration_functions_and_possible_manual_application' AS result_label,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  l.lanname AS language,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%stock%config%'
    OR p.proname IN (
      'record_stock_movement','repack_stock','repack_stock_v2',
      'prepare_stock_count_verification','verify_and_post_stock_count',
      'verify_and_post_stock_classification','stock_count_assert_classification_postable',
      'archive_stock_count_draft','discard_stock_count_drafts',
      'save_stock_transfer_draft','submit_stock_transfer_for_approval',
      'approve_stock_transfer','dispatch_stock_transfer','receive_stock_transfer'
    )
  )
ORDER BY function_name, identity_arguments;

SELECT
  'E04_LATER_MIGRATION_READINESS' AS section,
  'existing_named_constraints_that_may_conflict' AS result_label,
  conrelid::regclass::text AS table_name,
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND (
    conname ILIKE '%stock%config%'
    OR conname IN (
      'uq_variant_org','uq_variant_org_config','stock_movements_reference_type_check',
      'valid_quantity_change','stock_count_sessions_count_type_check',
      'stock_count_sessions_status_check','stock_transfers_status_check'
    )
  )
ORDER BY table_name, constraint_name;

SELECT
  'E05_LATER_MIGRATION_READINESS' AS section,
  'migration_history_rows_for_stock_config_01_to_18' AS result_label,
  CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
    THEN '<supabase_migrations.schema_migrations is not visible>'
    ELSE query_to_xml($q$
      SELECT 'E05_LATER_MIGRATION_READINESS' AS section,
             'migration_history_rows_for_stock_config_01_to_18' AS result_label,
             to_jsonb(m) ->> 'version' AS version,
             to_jsonb(m) ->> 'name' AS name,
             to_jsonb(m) AS migration_row
      FROM supabase_migrations.schema_migrations m
      WHERE coalesce(to_jsonb(m) ->> 'name', '') ILIKE '%stock_config%'
         OR coalesce(to_jsonb(m) ->> 'version', '') IN ('20260717','20260718','20260719')
      ORDER BY to_jsonb(m) ->> 'version', to_jsonb(m) ->> 'name'
    $q$, false, true, '')::text
  END AS result_rows;
