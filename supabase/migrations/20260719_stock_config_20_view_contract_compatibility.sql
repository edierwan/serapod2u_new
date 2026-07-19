-- Forward compatibility for stock-configuration reporting views.
-- Definitions only: no inventory balances, movements, or SKUs are rewritten.
BEGIN;

CREATE OR REPLACE VIEW public.vw_inventory_on_hand AS
SELECT pi.id,pi.variant_id,pi.organization_id,pi.quantity_on_hand,pi.quantity_allocated,pi.quantity_available,
 pi.reorder_point,pi.reorder_quantity,pi.max_stock_level,pi.safety_stock,pi.lead_time_days,pi.average_cost,
 pi.total_value,pi.warehouse_location,pv.variant_code,pv.variant_name,pv.image_url AS variant_image_url,
 p.id AS product_id,p.product_name,p.product_code,o.org_name AS organization_name,o.org_code AS organization_code,
 pi.updated_at,
 pi.stock_config_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,c.status AS stock_config_status,
 c.is_variant_default,c.requires_repacking_before_sale,c.default_for_ord
FROM public.product_inventory pi
JOIN public.inventory_stock_configurations c ON c.id=pi.stock_config_id AND c.variant_id=pi.variant_id
JOIN public.product_variants pv ON pv.id=pi.variant_id
JOIN public.products p ON p.id=pv.product_id
JOIN public.organizations o ON o.id=pi.organization_id
WHERE pi.is_active=true
  AND (c.status='active' OR pi.quantity_on_hand<>0 OR pi.quantity_allocated<>0);

CREATE OR REPLACE VIEW public.vw_manual_stock_balance AS
SELECT CASE WHEN sm.movement_type='manual_in' THEN sm.to_organization_id
            WHEN sm.movement_type='manual_out' THEN sm.from_organization_id END AS warehouse_id,
 sm.variant_id,
 SUM(CASE WHEN sm.movement_type IN ('manual_in','manual_out') THEN sm.quantity_change ELSE 0 END) AS manual_balance_qty,
 sm.stock_config_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,
 (sm.stock_config_id IS NULL) AS is_legacy_configuration
FROM public.stock_movements sm
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
WHERE sm.movement_type IN ('manual_in','manual_out')
GROUP BY CASE WHEN sm.movement_type='manual_in' THEN sm.to_organization_id
              WHEN sm.movement_type='manual_out' THEN sm.from_organization_id END,
 sm.variant_id,sm.stock_config_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging;

CREATE OR REPLACE VIEW public.vw_stock_movements_ordered AS
SELECT sm.id,sm.movement_type,sm.reference_type,sm.reference_id,sm.reference_no,sm.variant_id,
 sm.from_organization_id,sm.to_organization_id,sm.quantity_change,sm.quantity_before,
 sm.quantity_before+sm.quantity_change AS quantity_after,sm.unit_cost,sm.total_cost,sm.manufacturer_id,
 sm.warehouse_location,sm.reason,sm.notes,sm.company_id,sm.created_by,sm.created_at,
 sm.stock_config_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,
 (sm.stock_config_id IS NULL) AS is_legacy_configuration,
 pv.variant_code,pv.variant_name,p.product_name,
 COALESCE(dst.org_name,src.org_name) AS organization_name,
 COALESCE(dst.org_code,src.org_code) AS organization_code,
 mfg.org_name AS manufacturer_name,u.email AS created_by_email
FROM public.stock_movements sm
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
LEFT JOIN public.product_variants pv ON pv.id=sm.variant_id
LEFT JOIN public.products p ON p.id=pv.product_id
LEFT JOIN public.organizations src ON src.id=sm.from_organization_id
LEFT JOIN public.organizations dst ON dst.id=sm.to_organization_id
LEFT JOIN public.organizations mfg ON mfg.id=sm.manufacturer_id
LEFT JOIN public.users u ON u.id=sm.created_by
ORDER BY sm.created_at,sm.id;

CREATE OR REPLACE VIEW public.v_stock_movements_display AS
SELECT sm.id,sm.created_at,sm.movement_type,sm.variant_id,sm.from_organization_id,sm.to_organization_id,
 sm.quantity_change,sm.quantity_before,sm.quantity_before+sm.quantity_change AS quantity_after,
 sm.unit_cost,sm.reference_id,sm.reason,sm.created_by,sm.reference_type,
 sm.stock_config_id,c.config_code,c.config_label,c.stock_sku,c.volume_ml,c.packaging,
 (sm.stock_config_id IS NULL) AS is_legacy_configuration
FROM public.stock_movements sm
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
WHERE NOT (sm.movement_type='order_fulfillment' AND sm.quantity_before=0
  AND sm.quantity_before+sm.quantity_change=0)
AND NOT (sm.from_organization_id IS NULL AND sm.to_organization_id IS NULL);

CREATE OR REPLACE VIEW public.v_wms_movements_recent AS
SELECT sm.created_at,sm.movement_type,sm.reference_type,sm.reference_id AS order_id,sm.variant_id,
 sm.from_organization_id AS from_org_id,sm.to_organization_id AS to_org_id,sm.quantity_before,
 sm.quantity_change,sm.quantity_before+sm.quantity_change AS quantity_after,
 sm.stock_config_id,c.config_code,c.stock_sku,c.volume_ml,c.packaging,
 (sm.stock_config_id IS NULL) AS is_legacy_configuration
FROM public.stock_movements sm
LEFT JOIN public.inventory_stock_configurations c ON c.id=sm.stock_config_id AND c.variant_id=sm.variant_id
ORDER BY sm.created_at DESC,sm.id DESC LIMIT 500;

-- Preserve the installed numeric typmods. This supports databases that saw the
-- original Migration 06 (unconstrained numeric), the patched Migration 06
-- (numeric(12,2)/numeric(15,2)), or have not run Migration 06 yet.
DO $compatibility$
DECLARE
 v_average_cost_type text;
 v_total_value_type text;
BEGIN
 SELECT format_type(a.atttypid,a.atttypmod) INTO v_average_cost_type
 FROM pg_catalog.pg_attribute a
 WHERE a.attrelid=to_regclass('public.v_hq_inventory') AND a.attname='average_cost' AND a.attnum>0 AND NOT a.attisdropped;

 SELECT format_type(a.atttypid,a.atttypmod) INTO v_total_value_type
 FROM pg_catalog.pg_attribute a
 WHERE a.attrelid=to_regclass('public.v_hq_inventory') AND a.attname='total_value' AND a.attnum>0 AND NOT a.attisdropped;

 v_average_cost_type:=COALESCE(v_average_cost_type,'numeric(12,2)');
 v_total_value_type:=COALESCE(v_total_value_type,'numeric(15,2)');
 IF v_average_cost_type !~ '^numeric(?:\([0-9]+,[0-9]+\))?$'
    OR v_total_value_type !~ '^numeric(?:\([0-9]+,[0-9]+\))?$' THEN
  RAISE EXCEPTION 'Unexpected v_hq_inventory numeric contract: average_cost=%, total_value=%',
   v_average_cost_type,v_total_value_type;
 END IF;

 EXECUTE format($view$
CREATE OR REPLACE VIEW public.v_hq_inventory AS
SELECT p.id AS product_id,p.product_code,p.product_name,pv.id AS variant_id,pv.variant_code,pv.variant_name,
 hq.id AS hq_org_id,hq.org_name AS hq_org_name,
 COALESCE(SUM(pi.quantity_on_hand),0)::integer AS quantity_on_hand,
 COALESCE(SUM(pi.quantity_allocated),0)::integer AS quantity_allocated,
 COALESCE(SUM(pi.quantity_available),0)::integer AS quantity_available,
 CASE WHEN COALESCE(SUM(pi.quantity_on_hand),0)=0 THEN NULL
      ELSE SUM(pi.total_value)/NULLIF(SUM(pi.quantity_on_hand),0) END::%s AS average_cost,
 COALESCE(SUM(pi.total_value),0)::%s AS total_value
FROM public.products p
JOIN public.product_variants pv ON pv.product_id=p.id AND pv.is_active=true
CROSS JOIN public.organizations hq
LEFT JOIN public.product_inventory pi ON pi.variant_id=pv.id AND pi.organization_id=hq.id AND pi.is_active=true
WHERE hq.org_type_code='HQ'
GROUP BY p.id,p.product_code,p.product_name,pv.id,pv.variant_code,pv.variant_name,hq.id,hq.org_name
$view$,v_average_cost_type,v_total_value_type);
END
$compatibility$;

CREATE OR REPLACE VIEW public.v_low_stock_alerts AS
WITH balances AS (
 SELECT MIN(pi.id::text)::uuid AS id,pi.organization_id,pi.variant_id,
  SUM(pi.quantity_on_hand)::integer quantity_on_hand,SUM(pi.quantity_allocated)::integer quantity_allocated,
  SUM(pi.quantity_available)::integer quantity_available,MAX(pi.reorder_point)::integer reorder_point,
  MAX(pi.reorder_quantity)::integer reorder_quantity,MAX(pi.max_stock_level)::integer max_stock_level,
  string_agg(DISTINCT pi.warehouse_location,', ') FILTER(WHERE pi.warehouse_location IS NOT NULL) warehouse_location,
  MAX(pi.last_counted_at) last_counted_at,MAX(pi.updated_at) updated_at
 FROM public.product_inventory pi WHERE pi.is_active=true
 GROUP BY pi.organization_id,pi.variant_id
)
SELECT a.id,a.organization_id,o.org_name,o.org_type_code,a.variant_id,pv.variant_code,pv.variant_name,
 p.id AS product_id,p.product_code,p.product_name,p.brand_id,b.brand_name,a.quantity_on_hand,a.quantity_allocated,
 a.quantity_available,a.reorder_point,a.reorder_quantity,a.max_stock_level,
 a.reorder_point-a.quantity_available AS units_below_reorder,
 CASE WHEN a.reorder_point>0 THEN round(a.quantity_available::numeric/a.reorder_point::numeric*100,1) ELSE 0 END stock_level_percent,
 CASE WHEN a.quantity_available<=0 THEN 'CRITICAL' WHEN a.quantity_available<=a.reorder_point*0.5 THEN 'HIGH'
      WHEN a.quantity_available<=a.reorder_point THEN 'MEDIUM' ELSE 'LOW' END priority,
 a.warehouse_location,a.last_counted_at,a.updated_at
FROM balances a JOIN public.product_variants pv ON pv.id=a.variant_id JOIN public.products p ON p.id=pv.product_id
LEFT JOIN public.brands b ON b.id=p.brand_id JOIN public.organizations o ON o.id=a.organization_id
WHERE a.quantity_available<=a.reorder_point;

CREATE OR REPLACE VIEW public.v_incoming_transfers_detail WITH (security_invoker=true) AS
WITH transfer_lines AS (
 SELECT t.id transfer_id,t.company_id,t.transfer_no,t.status,t.from_organization_id,t.to_organization_id,
  t.created_at,t.shipped_at,t.received_at,(item.value->>'variant_id')::uuid variant_id,
  NULLIF(item.value->>'stock_config_id','')::uuid stock_config_id,
  SUM(COALESCE((item.value->>'quantity')::numeric,0))::integer quantity
 FROM public.stock_transfers t CROSS JOIN LATERAL jsonb_array_elements(t.items) item(value)
 WHERE t.status='in_transit' AND item.value->>'variant_id' IS NOT NULL
 GROUP BY t.id,t.company_id,t.transfer_no,t.status,t.from_organization_id,t.to_organization_id,
  t.created_at,t.shipped_at,t.received_at,(item.value->>'variant_id')::uuid,NULLIF(item.value->>'stock_config_id','')::uuid
)
SELECT tl.company_id,tl.transfer_id,tl.transfer_no,tl.status,
 tl.from_organization_id source_warehouse_org_id,src.org_name source_warehouse_name,
 tl.to_organization_id destination_warehouse_org_id,dst.org_name destination_warehouse_name,
 tl.variant_id,tl.quantity,COALESCE(tl.shipped_at,tl.created_at) dispatched_at,tl.received_at,
 EXISTS(SELECT 1 FROM public.stock_movements sm WHERE sm.reference_type='transfer' AND sm.reference_id=tl.transfer_id
   AND sm.movement_type='transfer_in' AND sm.to_organization_id=tl.to_organization_id AND sm.variant_id=tl.variant_id
   AND sm.stock_config_id IS NOT DISTINCT FROM tl.stock_config_id) destination_posted,
 CASE WHEN EXISTS(SELECT 1 FROM public.stock_movements sm WHERE sm.reference_type='transfer' AND sm.reference_id=tl.transfer_id
   AND sm.movement_type='transfer_in' AND sm.to_organization_id=tl.to_organization_id AND sm.variant_id=tl.variant_id
   AND sm.stock_config_id IS NOT DISTINCT FROM tl.stock_config_id) THEN 0 ELSE tl.quantity END incoming_qty,
 CASE WHEN EXISTS(SELECT 1 FROM public.stock_movements sm WHERE sm.reference_type='transfer' AND sm.reference_id=tl.transfer_id
   AND sm.movement_type='transfer_in' AND sm.to_organization_id=tl.to_organization_id AND sm.variant_id=tl.variant_id
   AND sm.stock_config_id IS NOT DISTINCT FROM tl.stock_config_id) THEN 'destination_already_posted' END excluded_reason,
 tl.stock_config_id,c.stock_sku,c.volume_ml,c.packaging,(tl.stock_config_id IS NULL) is_legacy_configuration
FROM transfer_lines tl LEFT JOIN public.organizations src ON src.id=tl.from_organization_id
LEFT JOIN public.organizations dst ON dst.id=tl.to_organization_id
LEFT JOIN public.inventory_stock_configurations c ON c.id=tl.stock_config_id AND c.variant_id=tl.variant_id;

COMMENT ON VIEW public.vw_inventory_on_hand IS 'Internal warehouse configuration detail. Inactive zero-stock configurations are hidden; nonzero historical balances remain visible.';
COMMENT ON VIEW public.v_hq_inventory IS 'HQ management inventory aggregated once per organization and variant across all stock configurations.';
COMMENT ON VIEW public.v_low_stock_alerts IS 'Variant-level low stock alerts computed after configuration balances are aggregated.';

COMMIT;
