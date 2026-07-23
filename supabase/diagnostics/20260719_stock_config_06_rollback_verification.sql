-- Read-only verification after the failed stock-configuration reporting migration.
-- Every result has stable section and result labels for copying into review.

SELECT
 'A_TRANSACTION_ROLLBACK' AS section_label,
 'migration_06_catalog_state' AS result_label,
 CASE
  WHEN COUNT(*) FILTER (WHERE marker_present)=0 THEN 'FULLY_ABSENT_CONSISTENT_WITH_ROLLBACK'
  WHEN COUNT(*) FILTER (WHERE marker_present)=COUNT(*) THEN 'ALL_MARKERS_PRESENT'
  ELSE 'PARTIAL_OR_MANUAL_OBJECTS_PRESENT'
 END AS assessment,
 COUNT(*) FILTER (WHERE marker_present) AS present_markers,
 COUNT(*) AS checked_markers
FROM (
 VALUES
  ('vw_inventory_on_hand.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_inventory_on_hand' AND column_name='stock_config_id')),
  ('vw_manual_stock_balance.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_manual_stock_balance' AND column_name='stock_config_id')),
  ('vw_stock_movements_ordered.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_stock_movements_ordered' AND column_name='stock_config_id')),
  ('v_stock_movements_display.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_stock_movements_display' AND column_name='stock_config_id')),
  ('v_wms_movements_recent.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_wms_movements_recent' AND column_name='stock_config_id')),
  ('v_incoming_transfers_detail.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_incoming_transfers_detail' AND column_name='stock_config_id')),
  ('post_stock_transfer_configured',to_regprocedure('public.post_stock_transfer_configured(text,uuid,uuid,uuid,jsonb,text,uuid)') IS NOT NULL)
) AS markers(marker_name,marker_present);

SELECT
 'A_TRANSACTION_ROLLBACK' AS section_label,
 'migration_06_marker_detail' AS result_label,
 marker_name,
 marker_present
FROM (
 VALUES
  ('vw_inventory_on_hand.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_inventory_on_hand' AND column_name='stock_config_id')),
  ('vw_manual_stock_balance.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_manual_stock_balance' AND column_name='stock_config_id')),
  ('vw_stock_movements_ordered.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_stock_movements_ordered' AND column_name='stock_config_id')),
  ('v_stock_movements_display.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_stock_movements_display' AND column_name='stock_config_id')),
  ('v_wms_movements_recent.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_wms_movements_recent' AND column_name='stock_config_id')),
  ('v_incoming_transfers_detail.stock_config_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_incoming_transfers_detail' AND column_name='stock_config_id')),
  ('post_stock_transfer_configured',to_regprocedure('public.post_stock_transfer_configured(text,uuid,uuid,uuid,jsonb,text,uuid)') IS NOT NULL)
) AS markers(marker_name,marker_present)
ORDER BY marker_name;

SELECT
 'B_VIEW_CONTRACTS' AS section_label,
 'migration_06_view_columns' AS result_label,
 c.table_name AS view_name,
 c.ordinal_position,
 c.column_name,
 format_type(a.atttypid,a.atttypmod) AS exact_data_type
FROM information_schema.columns c
JOIN pg_catalog.pg_namespace n ON n.nspname=c.table_schema
JOIN pg_catalog.pg_class r ON r.relnamespace=n.oid AND r.relname=c.table_name
JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attname=c.column_name AND a.attnum=c.ordinal_position
WHERE c.table_schema='public'
 AND c.table_name IN (
  'vw_inventory_on_hand','vw_manual_stock_balance','vw_stock_movements_ordered',
  'v_stock_movements_display','v_wms_movements_recent','v_hq_inventory',
  'v_low_stock_alerts','v_incoming_transfers_detail'
 )
ORDER BY c.table_name,c.ordinal_position;

SELECT
 'C_HQ_NUMERIC_CONTRACT' AS section_label,
 'v_hq_inventory_expected_types' AS result_label,
 MAX(format_type(a.atttypid,a.atttypmod)) FILTER (WHERE a.attname='average_cost') AS average_cost_type,
 MAX(format_type(a.atttypid,a.atttypmod)) FILTER (WHERE a.attname='total_value') AS total_value_type,
 CASE WHEN
  MAX(format_type(a.atttypid,a.atttypmod)) FILTER (WHERE a.attname='average_cost')='numeric(12,2)'
  AND MAX(format_type(a.atttypid,a.atttypmod)) FILTER (WHERE a.attname='total_value')='numeric(15,2)'
  THEN 'MATCHES_CONFIRMED_PRODUCTION_CONTRACT'
  ELSE 'REVIEW_REQUIRED'
 END AS assessment
FROM pg_catalog.pg_attribute a
WHERE a.attrelid=to_regclass('public.v_hq_inventory')
 AND a.attname IN ('average_cost','total_value')
 AND a.attnum>0 AND NOT a.attisdropped;

SELECT
 'D_VIEW_DEFINITIONS' AS section_label,
 'current_definition_for_review' AS result_label,
 v.viewname AS view_name,
 pg_get_viewdef(format('%I.%I',v.schemaname,v.viewname)::regclass,true) AS view_definition
FROM pg_catalog.pg_views v
WHERE v.schemaname='public'
 AND v.viewname IN (
  'vw_inventory_on_hand','vw_manual_stock_balance','vw_stock_movements_ordered',
  'v_stock_movements_display','v_wms_movements_recent','v_hq_inventory',
  'v_low_stock_alerts','v_incoming_transfers_detail',
  'v_org_hierarchy_with_stock','v_incoming_stock_detail',
  'v_incoming_stock_transfers','v_incoming_stock'
 )
ORDER BY v.viewname;
