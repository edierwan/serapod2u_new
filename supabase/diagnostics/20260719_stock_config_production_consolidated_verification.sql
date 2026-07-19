-- Completely read-only production verification for Stock Configurations 01-20.
-- Run with a database role that can inspect public catalog objects.
WITH
function_defs AS (
  SELECT
    to_regprocedure('public.generate_stock_sku(uuid,text)') AS generator_oid,
    to_regprocedure('public.create_default_stock_config_for_variant()') AS trigger_function_oid,
    to_regprocedure('public.prepare_stock_count_verification(uuid,uuid,text,jsonb,jsonb)') AS prepare_oid,
    to_regprocedure('public.verify_and_post_stock_count(uuid,text)') AS count_post_oid,
    to_regprocedure('public.verify_and_post_stock_classification(uuid,text)') AS classification_post_oid,
    to_regprocedure('public.stock_count_assert_classification_postable(uuid,uuid)') AS classification_guard_oid,
    to_regprocedure('public.archive_stock_count_draft(uuid)') AS archive_oid,
    to_regprocedure('public.discard_stock_count_drafts(uuid[])') AS discard_oid
), definitions AS (
  SELECT
    CASE WHEN generator_oid IS NULL THEN '' ELSE pg_get_functiondef(generator_oid) END AS generator_def,
    CASE WHEN trigger_function_oid IS NULL THEN '' ELSE pg_get_functiondef(trigger_function_oid) END AS trigger_function_def,
    CASE WHEN prepare_oid IS NULL THEN '' ELSE pg_get_functiondef(prepare_oid) END AS prepare_def,
    CASE WHEN count_post_oid IS NULL THEN '' ELSE pg_get_functiondef(count_post_oid) END AS count_post_def,
    CASE WHEN classification_post_oid IS NULL THEN '' ELSE pg_get_functiondef(classification_post_oid) END AS classification_post_def,
    CASE WHEN classification_guard_oid IS NULL THEN '' ELSE pg_get_functiondef(classification_guard_oid) END AS classification_guard_def,
    CASE WHEN classification_guard_oid IS NULL THEN '' ELSE coalesce(obj_description(classification_guard_oid,'pg_proc'),'') END AS classification_guard_comment,
    CASE WHEN archive_oid IS NULL THEN '' ELSE pg_get_functiondef(archive_oid) END AS archive_def,
    CASE WHEN discard_oid IS NULL THEN '' ELSE pg_get_functiondef(discard_oid) END AS discard_def
  FROM function_defs
), generator_version AS (
  SELECT CASE
    WHEN generator_def='' THEN 'MISSING'
    WHEN position('replace(p_variant_id::text, ''-'', '''')' IN generator_def)>0
     AND position('WHILE EXISTS' IN upper(generator_def))=0
      THEN 'COLLISION_SAFE_VARIANT_UUID_V2'
    WHEN position('WHILE EXISTS' IN upper(generator_def))>0
      THEN 'LEGACY_STATEMENT_SNAPSHOT_SUFFIX_V1'
    ELSE 'UNKNOWN'
  END AS installed_version
  FROM definitions
), duplicate_skus AS (
  SELECT count(*)::bigint AS problem_groups
  FROM (
    SELECT upper(stock_sku)
    FROM public.inventory_stock_configurations
    GROUP BY upper(stock_sku)
    HAVING count(*)>1
  ) d
), duplicate_variant_codes AS (
  SELECT count(*)::bigint AS problem_groups
  FROM (
    SELECT variant_id,config_code
    FROM public.inventory_stock_configurations
    GROUP BY variant_id,config_code
    HAVING count(*)>1
  ) d
), enabled_variant_defaults AS (
  SELECT count(*) FILTER (WHERE default_count<>1)::bigint AS problem_variants,
         count(*)::bigint AS enabled_variants
  FROM (
    SELECT variant_id,count(*) FILTER (WHERE is_variant_default) AS default_count
    FROM public.inventory_stock_configurations
    GROUP BY variant_id
  ) d
), multiple_ord_defaults AS (
  SELECT count(*)::bigint AS problem_variants
  FROM (
    SELECT variant_id
    FROM public.inventory_stock_configurations
    WHERE default_for_ord
    GROUP BY variant_id
    HAVING count(*)>1
  ) d
), invalid_relationships AS (
  SELECT count(*)::bigint AS problem_rows
  FROM (
    SELECT 'product_inventory' AS source_name,pi.id
    FROM public.product_inventory pi
    LEFT JOIN public.product_variants pv ON pv.id=pi.variant_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id=pi.stock_config_id
    WHERE pv.id IS NULL OR c.id IS NULL OR c.variant_id IS DISTINCT FROM pi.variant_id
    UNION ALL
    SELECT 'stock_movements',sm.id
    FROM public.stock_movements sm
    LEFT JOIN public.product_variants pv ON pv.id=sm.variant_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id
    WHERE pv.id IS NULL OR (sm.stock_config_id IS NOT NULL AND (c.id IS NULL OR c.variant_id IS DISTINCT FROM sm.variant_id))
    UNION ALL
    SELECT 'stock_count_session_items',i.id
    FROM public.stock_count_session_items i
    LEFT JOIN public.product_variants pv ON pv.id=i.variant_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id=i.stock_config_id
    WHERE pv.id IS NULL OR (i.stock_config_id IS NOT NULL AND (c.id IS NULL OR c.variant_id IS DISTINCT FROM i.variant_id))
    UNION ALL
    SELECT 'stock_adjustment_items',i.id
    FROM public.stock_adjustment_items i
    LEFT JOIN public.product_variants pv ON pv.id=i.variant_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id=i.stock_config_id
    WHERE pv.id IS NULL OR (i.stock_config_id IS NOT NULL AND (c.id IS NULL OR c.variant_id IS DISTINCT FROM i.variant_id))
    UNION ALL
    SELECT 'warehouse_receipt_items',i.id
    FROM public.warehouse_receipt_items i
    LEFT JOIN public.product_variants pv ON pv.id=i.variant_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id=i.stock_config_id
    WHERE pv.id IS NULL OR (i.stock_config_id IS NOT NULL AND (c.id IS NULL OR c.variant_id IS DISTINCT FROM i.variant_id))
    UNION ALL
    SELECT 'order_items',i.id
    FROM public.order_items i
    LEFT JOIN public.product_variants pv ON pv.id=i.variant_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id=i.stock_config_id
    WHERE pv.id IS NULL OR (i.stock_config_id IS NOT NULL AND (c.id IS NULL OR c.variant_id IS DISTINCT FROM i.variant_id))
  ) problems
), prohibited_nulls AS (
  SELECT
    (SELECT count(*) FROM public.product_inventory WHERE stock_config_id IS NULL)
    +
    (SELECT count(*)
     FROM public.stock_count_session_items i
     JOIN public.stock_count_sessions s ON s.id=i.session_id
     WHERE i.stock_config_id IS NULL AND s.status<>'archived'
       AND (s.count_type='initial_configuration_classification' OR s.created_at>=(SELECT min(created_at) FROM public.inventory_stock_configurations)))
    AS problem_rows
), invalid_quantities AS (
  SELECT count(*)::bigint AS problem_rows
  FROM public.product_inventory
  WHERE quantity_on_hand<0 OR quantity_allocated<0 OR quantity_allocated>quantity_on_hand
), duplicate_inventory AS (
  SELECT count(*)::bigint AS problem_groups
  FROM (
    SELECT variant_id,organization_id,stock_config_id
    FROM public.product_inventory
    GROUP BY variant_id,organization_id,stock_config_id
    HAVING count(*)>1
  ) d
), unsafe_backfill AS (
  SELECT count(*)::bigint AS problem_rows
  FROM public.product_inventory pi
  LEFT JOIN public.product_variants pv ON pv.id=pi.variant_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS default_count
    FROM public.inventory_stock_configurations c
    WHERE c.variant_id=pi.variant_id AND c.is_variant_default
  ) d ON true
  WHERE pv.id IS NULL OR pi.stock_config_id IS NULL OR d.default_count<>1
), hq_contract AS (
  SELECT
    max(format_type(a.atttypid,a.atttypmod)) FILTER (WHERE a.attname='average_cost') AS average_cost_type,
    max(format_type(a.atttypid,a.atttypmod)) FILTER (WHERE a.attname='total_value') AS total_value_type
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=to_regclass('public.v_hq_inventory')
    AND a.attnum>0 AND NOT a.attisdropped
), record_stock_movement_contract AS (
  SELECT
    count(*) FILTER (
      WHERE p.pronargs=16
        AND pg_get_function_identity_arguments(p.oid) LIKE 'p_movement_type text, p_variant_id uuid, p_organization_id uuid, p_quantity_change integer,%'
        AND pg_get_function_identity_arguments(p.oid) LIKE '%, p_evidence_urls text[], p_stock_config_id uuid'
        AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%OUT %'
    )=1 AS valid_contract,
    coalesce(string_agg(
      format('%s args: %s',p.pronargs,pg_get_function_identity_arguments(p.oid)),
      '; ' ORDER BY p.oid
    ),'missing') AS installed_contract
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='record_stock_movement'
), required_functions(signature) AS (
  VALUES
    ('public.generate_stock_sku(uuid,text)'),
    ('public.create_default_stock_config_for_variant()'),
    ('public.resolve_default_stock_config(uuid)'),
    ('public.enable_variant_stock_configurations(uuid)'),
    ('public.enable_variant_stock_configurations_with_profile(uuid,text)'),
    ('public.bulk_enable_variant_stock_configurations(uuid[])'),
    ('public.prepare_stock_count_verification(uuid,uuid,text,jsonb,jsonb)'),
    ('public.verify_and_post_stock_count(uuid,text)'),
    ('public.verify_and_post_stock_classification(uuid,text)'),
    ('public.stock_count_assert_classification_postable(uuid,uuid)'),
    ('public.archive_stock_count_draft(uuid)'),
    ('public.discard_stock_count_drafts(uuid[])'),
    ('public.repack_stock_v2(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)'),
    ('public.save_stock_transfer_draft(uuid,uuid,uuid,jsonb,text,date,uuid,uuid)'),
    ('public.submit_stock_transfer_for_approval(uuid,uuid)'),
    ('public.approve_stock_transfer(uuid,uuid)'),
    ('public.dispatch_stock_transfer(uuid,uuid)'),
    ('public.receive_stock_transfer(uuid,uuid)'),
    ('public.post_manual_stock_addition(uuid,uuid,jsonb,text,text,uuid,text,text,uuid,uuid)')
), missing_functions AS (
  SELECT count(*) FILTER (WHERE to_regprocedure(signature) IS NULL)::bigint AS missing_count,
         coalesce(string_agg(signature,', ' ORDER BY signature) FILTER (WHERE to_regprocedure(signature) IS NULL),'none') AS missing_names
  FROM required_functions
), required_grants(signature) AS (
  VALUES
    ('public.prepare_stock_count_verification(uuid,uuid,text,jsonb,jsonb)'),
    ('public.verify_and_post_stock_count(uuid,text)'),
    ('public.verify_and_post_stock_classification(uuid,text)'),
    ('public.stock_count_assert_classification_postable(uuid,uuid)'),
    ('public.archive_stock_count_draft(uuid)'),
    ('public.discard_stock_count_drafts(uuid[])'),
    ('public.repack_stock_v2(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)'),
    ('public.save_stock_transfer_draft(uuid,uuid,uuid,jsonb,text,date,uuid,uuid)'),
    ('public.submit_stock_transfer_for_approval(uuid,uuid)'),
    ('public.approve_stock_transfer(uuid,uuid)'),
    ('public.dispatch_stock_transfer(uuid,uuid)'),
    ('public.receive_stock_transfer(uuid,uuid)'),
    ('public.post_manual_stock_addition(uuid,uuid,jsonb,text,text,uuid,text,text,uuid,uuid)')
), grant_state AS (
  SELECT count(*) FILTER (
           WHERE to_regprocedure(signature) IS NULL
              OR NOT coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)
         )::bigint AS missing_count,
         coalesce(string_agg(signature,', ' ORDER BY signature) FILTER (
           WHERE to_regprocedure(signature) IS NULL
              OR NOT coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)
         ),'none') AS missing_names
  FROM required_grants
), required_relations(kind,name) AS (
  VALUES
    ('table','inventory_stock_configurations'),('table','distributor_stock_config_eligibility'),
    ('view','vw_inventory_on_hand'),('view','vw_manual_stock_balance'),
    ('view','vw_stock_movements_ordered'),('view','v_stock_movements_display'),
    ('view','v_wms_movements_recent'),('view','v_hq_inventory'),
    ('view','v_low_stock_alerts'),('view','v_incoming_transfers_detail')
), missing_relations AS (
  SELECT count(*) FILTER (WHERE to_regclass('public.'||name) IS NULL)::bigint AS missing_count,
         coalesce(string_agg(kind||':'||name,', ' ORDER BY name) FILTER (WHERE to_regclass('public.'||name) IS NULL),'none') AS missing_names
  FROM required_relations
), required_columns(table_name,column_name) AS (
  VALUES
    ('product_inventory','stock_config_id'),('stock_movements','stock_config_id'),
    ('stock_count_session_items','stock_config_id'),('stock_adjustment_items','stock_config_id'),
    ('warehouse_receipt_items','stock_config_id'),('order_items','stock_config_id'),
    ('stock_count_sessions','archived_by'),('stock_count_sessions','archived_at')
), missing_columns AS (
  SELECT count(*) FILTER (WHERE c.column_name IS NULL)::bigint AS missing_count,
         coalesce(string_agg(r.table_name||'.'||r.column_name,', ' ORDER BY r.table_name,r.column_name)
           FILTER (WHERE c.column_name IS NULL),'none') AS missing_names
  FROM required_columns r
  LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
), required_catalog_objects(kind,name) AS (
  VALUES
    ('index','isc_stock_sku_key'),('index','isc_one_variant_default'),
    ('index','isc_one_ord_default'),('index','isc_variant_dimensions_key'),
    ('index','uq_variant_org_config'),('index','stock_count_session_items_unique_config'),
    ('constraint','product_inventory_stock_config_fk'),('constraint','stock_movements_stock_config_fk'),
    ('constraint','stock_count_session_items_stock_config_fk'),('constraint','stock_adjustment_items_stock_config_fk'),
    ('constraint','warehouse_receipt_items_stock_config_fk'),('constraint','order_items_stock_config_variant_fkey')
), missing_catalog_objects AS (
  SELECT count(*) FILTER (WHERE NOT CASE kind
      WHEN 'index' THEN EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='i' AND c.relname=r.name)
      ELSE EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.conname=r.name)
    END)::bigint AS missing_count,
    coalesce(string_agg(kind||':'||name,', ' ORDER BY name) FILTER (WHERE NOT CASE kind
      WHEN 'index' THEN EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='i' AND c.relname=r.name)
      ELSE EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.conname=r.name)
    END),'none') AS missing_names
  FROM required_catalog_objects r
), trigger_state AS (
  SELECT EXISTS(
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='product_variants'
      AND t.tgname='trg_product_variants_default_stock_config'
      AND t.tgenabled<>'D' AND NOT t.tgisinternal
      AND t.tgfoid=to_regprocedure('public.create_default_stock_config_for_variant()')
  ) AS valid_trigger
), raw_checks(section,check_name,status,details,sort_order) AS (
  SELECT 'GENERATOR','generator_version',CASE WHEN installed_version='COLLISION_SAFE_VARIANT_UUID_V2' THEN 'PASS' ELSE 'FAIL' END,
         installed_version,10 FROM generator_version
  UNION ALL SELECT 'GENERATOR','variant_trigger_corrected',
    CASE WHEN valid_trigger AND position('generate_stock_sku(NEW.id, ''STD'')' IN trigger_function_def)>0 THEN 'PASS' ELSE 'FAIL' END,
    format('enabled trigger=%s; corrected function call=%s',valid_trigger,position('generate_stock_sku(NEW.id, ''STD'')' IN trigger_function_def)>0),20
    FROM trigger_state CROSS JOIN definitions
  UNION ALL SELECT 'CONFIGURATION_DATA','case_insensitive_stock_sku_uniqueness',CASE WHEN problem_groups=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s duplicate SKU group(s)',problem_groups),30 FROM duplicate_skus
  UNION ALL SELECT 'CONFIGURATION_DATA','variant_config_code_uniqueness',CASE WHEN problem_groups=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s duplicate variant/config_code group(s)',problem_groups),40 FROM duplicate_variant_codes
  UNION ALL SELECT 'CONFIGURATION_DATA','one_default_per_enabled_variant',CASE WHEN problem_variants=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s enabled variant(s); %s invalid default count(s)',enabled_variants,problem_variants),50 FROM enabled_variant_defaults
  UNION ALL SELECT 'CONFIGURATION_DATA','at_most_one_ord_default_per_variant',CASE WHEN problem_variants=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s variant(s) with multiple ORD defaults',problem_variants),60 FROM multiple_ord_defaults
  UNION ALL SELECT 'RELATIONSHIPS','valid_stock_configuration_relationships',CASE WHEN problem_rows=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s orphan or variant/config mismatch row(s)',problem_rows),70 FROM invalid_relationships
  UNION ALL SELECT 'RELATIONSHIPS','no_prohibited_null_stock_config_ids',CASE WHEN problem_rows=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s prohibited NULL row(s); historical movements/adjustments/receipts and archived legacy drafts are intentionally excluded',problem_rows),80 FROM prohibited_nulls
  UNION ALL SELECT 'INVENTORY_SAFETY','allocated_not_above_on_hand',CASE WHEN problem_rows=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s invalid balance row(s)',problem_rows),90 FROM invalid_quantities
  UNION ALL SELECT 'INVENTORY_SAFETY','no_duplicate_inventory_rows',CASE WHEN problem_groups=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s duplicate variant/organization/configuration group(s)',problem_groups),100 FROM duplicate_inventory
  UNION ALL SELECT 'VIEW_CONTRACT','v_hq_inventory_numeric_contract',
    CASE WHEN average_cost_type='numeric(12,2)' AND total_value_type='numeric(15,2)' THEN 'PASS' ELSE 'FAIL' END,
    format('average_cost=%s; total_value=%s',coalesce(average_cost_type,'MISSING'),coalesce(total_value_type,'MISSING')),110 FROM hq_contract
  UNION ALL SELECT 'FUNCTIONS','required_stock_count_and_classification_functions',CASE WHEN missing_count=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s missing: %s',missing_count,missing_names),120 FROM missing_functions
  UNION ALL SELECT 'FUNCTIONS','record_stock_movement_current_contract',CASE WHEN valid_contract THEN 'PASS' ELSE 'FAIL' END,
    installed_contract,125 FROM record_stock_movement_contract
  UNION ALL SELECT 'GRANTS','authenticated_execute_grants',CASE WHEN missing_count=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s missing: %s',missing_count,missing_names),130 FROM grant_state
  UNION ALL SELECT 'CLASSIFICATION_GUARDS','allocation_and_stale_legacy_guards',
    CASE WHEN position('live_allocated > 0' IN classification_guard_def)>0
           AND position('live_on_hand <= 0' IN classification_guard_def)>0
           AND position('stock_count_assert_classification_postable' IN prepare_def)>0
           AND position('stock_count_assert_classification_postable' IN classification_post_def)>0 THEN 'PASS' ELSE 'FAIL' END,
    'Live allocation/stale Legacy checks must run during both preparation and posting',140 FROM definitions
  UNION ALL SELECT 'CLASSIFICATION_GUARDS','physical_variance_above_and_below_legacy',
    CASE WHEN position('Target totals above or below Legacy are valid physical-count variances' IN classification_guard_comment)>0
           AND position('requested_total >' IN classification_guard_def)=0
           AND position('stock_count_classification_exceeds_legacy' IN classification_guard_def)=0
           AND position('p_quantity_change => v_item.adjustment_quantity' IN classification_post_def)>0
           AND position('coalesce(i.adjustment_quantity, 0) <> 0' IN classification_post_def)>0
           AND position('adjustment_quantity > 0' IN classification_post_def)=0
           AND position('adjustment_quantity < 0' IN classification_post_def)=0 THEN 'PASS' ELSE 'FAIL' END,
    'obj_description confirms both directions; posting passes signed adjustment_quantity without a positive/negative filter',150 FROM definitions
  UNION ALL SELECT 'POSTING_SAFETY','verification_posting_atomic_and_idempotent',
    CASE WHEN position('FOR UPDATE' IN upper(count_post_def))>0
           AND position('verification_code_already_used' IN count_post_def)>0
           AND position('v_request.status = ''posted'' OR v_request.consumed_at IS NOT NULL' IN count_post_def)>0
           AND position('status = ''posted'', verified_by = v_user_id, verified_at = now(), consumed_at = now()' IN count_post_def)>0
           AND position('WHERE id = v_session.id AND status = ''draft''' IN count_post_def)>0
           AND position('IF NOT FOUND THEN RAISE EXCEPTION ''stock_count_already_posted''' IN count_post_def)>0
           AND position('PERFORM public.record_stock_movement' IN count_post_def)>0
           AND position('status = ''posted'', verified_by = v_user_id, verified_at = now(), consumed_at = now()' IN count_post_def)
               > position('PERFORM public.record_stock_movement' IN count_post_def)
           AND position('FOR UPDATE' IN upper(classification_post_def))>0
           AND position('verification_code_already_used' IN classification_post_def)>0
           AND position('v_request.status = ''posted'' OR v_request.consumed_at IS NOT NULL' IN classification_post_def)>0
           AND position('status = ''posted'', verified_by = v_user_id, verified_at = now(), consumed_at = now()' IN classification_post_def)>0
           AND position('WHERE id = v_session.id AND status = ''draft''' IN classification_post_def)>0
           AND position('IF NOT FOUND THEN RAISE EXCEPTION ''stock_count_already_posted''' IN classification_post_def)>0
           AND position('PERFORM public.record_stock_movement' IN classification_post_def)>0
           AND position('status = ''posted'', verified_by = v_user_id, verified_at = now(), consumed_at = now()' IN classification_post_def)
               > position('PERFORM public.record_stock_movement' IN classification_post_def) THEN 'PASS' ELSE 'FAIL' END,
    'Both functions lock the verification/session rows, reject posted or consumed codes, guard draft-to-posted, then post inventory and set posted+consumed_at in one function transaction',160 FROM definitions
  UNION ALL SELECT 'DRAFT_MANAGEMENT','draft_archive_and_discard_safety',
    CASE WHEN position('status = ''archived''' IN archive_def)>0
           AND position('stock_count_not_discardable' IN archive_def)>0
           AND position('archive_stock_count_draft' IN discard_def)>0
           AND (SELECT missing_count FROM grant_state)=0 THEN 'PASS' ELSE 'FAIL' END,
    'Single and bulk draft functions exist, soft-archive only, and authenticated grants are present',170 FROM definitions
  UNION ALL SELECT 'MIGRATIONS_01_20','required_relations',CASE WHEN missing_count=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s missing: %s',missing_count,missing_names),180 FROM missing_relations
  UNION ALL SELECT 'MIGRATIONS_01_20','required_columns',CASE WHEN missing_count=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s missing: %s',missing_count,missing_names),190 FROM missing_columns
  UNION ALL SELECT 'MIGRATIONS_01_20','required_indexes_and_constraints',CASE WHEN missing_count=0 THEN 'PASS' ELSE 'FAIL' END,
    format('%s missing: %s',missing_count,missing_names),200 FROM missing_catalog_objects
  UNION ALL SELECT 'INVENTORY_SAFETY','no_critical_orphan_or_unsafe_backfill',
    CASE WHEN u.problem_rows=0 AND r.problem_rows=0 AND q.problem_rows=0 AND d.problem_groups=0 THEN 'PASS' ELSE 'FAIL' END,
    format('unsafe backfill=%s; invalid relationships=%s; invalid quantities=%s; duplicate inventory groups=%s',u.problem_rows,r.problem_rows,q.problem_rows,d.problem_groups),210
    FROM unsafe_backfill u CROSS JOIN invalid_relationships r CROSS JOIN invalid_quantities q CROSS JOIN duplicate_inventory d
  UNION ALL SELECT 'MIGRATION_HISTORY','migration_history_visibility','INFO',
    CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
      THEN 'Migration-history table is not visible in this self-hosted connection; assessed installed objects and definitions directly'
      ELSE 'supabase_migrations.schema_migrations is visible'
    END,220
), all_rows AS (
  SELECT section,check_name,status,details,sort_order FROM raw_checks
  UNION ALL
  SELECT 'OVERALL','OVERALL_STATUS',
         CASE WHEN count(*) FILTER (WHERE status='FAIL')=0 THEN 'PASS' ELSE 'FAIL' END,
         format('%s PASS; %s FAIL; %s INFO',count(*) FILTER (WHERE status='PASS'),count(*) FILTER (WHERE status='FAIL'),count(*) FILTER (WHERE status='INFO')),
         999
  FROM raw_checks
)
SELECT section,check_name,status,details
FROM all_rows
ORDER BY sort_order,section,check_name;
