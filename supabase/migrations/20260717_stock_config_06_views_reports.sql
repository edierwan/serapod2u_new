-- Inventory Stock Configurations - Phase 5: deliberate detail vs aggregation
-- No balance or movement data is rewritten by this migration.
BEGIN;

-- A. Warehouse inventory detail: one row per organization/variant/config.
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

-- Manual ledgers are also configuration detail. Historical NULL configuration
-- movements deliberately remain grouped under a visible NULL/legacy bucket.
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

-- Movement detail: original column order is preserved and configuration/
-- descriptive columns are appended for PostgREST and exports.
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

-- B. Management/HQ variant aggregation. A balance join can now have several
-- rows, so every measure is aggregated before it reaches consumers.
CREATE OR REPLACE VIEW public.v_hq_inventory AS
SELECT p.id AS product_id,p.product_code,p.product_name,pv.id AS variant_id,pv.variant_code,pv.variant_name,
 hq.id AS hq_org_id,hq.org_name AS hq_org_name,
 COALESCE(SUM(pi.quantity_on_hand),0)::integer AS quantity_on_hand,
 COALESCE(SUM(pi.quantity_allocated),0)::integer AS quantity_allocated,
 COALESCE(SUM(pi.quantity_available),0)::integer AS quantity_available,
 CASE WHEN COALESCE(SUM(pi.quantity_on_hand),0)=0 THEN NULL
      ELSE SUM(pi.total_value)/NULLIF(SUM(pi.quantity_on_hand),0) END::numeric(12,2) AS average_cost,
 COALESCE(SUM(pi.total_value),0)::numeric(15,2) AS total_value
FROM public.products p
JOIN public.product_variants pv ON pv.product_id=p.id AND pv.is_active=true
CROSS JOIN public.organizations hq
LEFT JOIN public.product_inventory pi ON pi.variant_id=pv.id AND pi.organization_id=hq.id AND pi.is_active=true
WHERE hq.org_type_code='HQ'
GROUP BY p.id,p.product_code,p.product_name,pv.id,pv.variant_code,pv.variant_name,hq.id,hq.org_name;

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

-- Transfer detail retains configuration for matching destination postings;
-- the existing v_incoming_stock_transfers view then deliberately SUMs these
-- rows back to variant level for management incoming totals.
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

-- Configuration-aware, all-or-nothing stock transfer posting. A forced error
-- on any line rolls back the transfer row and every preceding movement.
CREATE OR REPLACE FUNCTION public.post_stock_transfer_configured(
 p_transfer_no text,p_company_id uuid,p_from_organization_id uuid,p_to_organization_id uuid,
 p_items jsonb,p_notes text DEFAULT NULL,p_created_by uuid DEFAULT NULL)
RETURNS public.stock_transfers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_transfer public.stock_transfers; v_item jsonb; v_variant uuid; v_cfg uuid; v_qty int; v_cost numeric;
 v_total_items int:=0; v_total_value numeric:=0; v_creator uuid:=COALESCE(auth.uid(),p_created_by);
BEGIN
 IF p_from_organization_id IS NULL OR p_to_organization_id IS NULL OR p_from_organization_id=p_to_organization_id
 THEN RAISE EXCEPTION 'Distinct source and destination warehouses are required'; END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Transfer items are required'; END IF;
 IF NOT (public.is_hq_admin() OR (public.can_access_org(p_from_organization_id) AND public.can_access_org(p_to_organization_id)))
 THEN RAISE EXCEPTION 'Not authorized for transfer organizations'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_variant:=(v_item->>'variant_id')::uuid; v_cfg:=(v_item->>'stock_config_id')::uuid;
  v_qty:=(v_item->>'quantity')::int; v_cost:=NULLIF(v_item->>'cost','')::numeric;
  IF v_qty IS NULL OR v_qty<=0 OR NOT EXISTS(SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.id=v_cfg AND c.variant_id=v_variant AND c.status='active')
  THEN RAISE EXCEPTION 'Invalid variant/configuration transfer line'; END IF;
  v_total_items:=v_total_items+v_qty; v_total_value:=v_total_value+v_qty*COALESCE(v_cost,0);
 END LOOP;
 INSERT INTO public.stock_transfers(transfer_no,from_organization_id,to_organization_id,status,items,total_items,
  total_value,notes,company_id,created_by)
 VALUES(p_transfer_no,p_from_organization_id,p_to_organization_id,'in_transit',p_items,v_total_items,v_total_value,
  p_notes,p_company_id,v_creator) RETURNING * INTO v_transfer;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_variant:=(v_item->>'variant_id')::uuid; v_cfg:=(v_item->>'stock_config_id')::uuid;
  v_qty:=(v_item->>'quantity')::int; v_cost:=NULLIF(v_item->>'cost','')::numeric;
  PERFORM public.record_stock_movement(p_movement_type:='transfer_out',p_variant_id:=v_variant,
    p_organization_id:=p_from_organization_id,p_quantity_change:=-v_qty,p_unit_cost:=v_cost,
    p_reason:='Configured warehouse transfer out',p_notes:=p_notes,p_reference_type:='transfer',
    p_reference_id:=v_transfer.id,p_reference_no:=p_transfer_no,p_company_id:=p_company_id,
    p_created_by:=v_creator,p_stock_config_id:=v_cfg);
  PERFORM public.record_stock_movement(p_movement_type:='transfer_in',p_variant_id:=v_variant,
    p_organization_id:=p_to_organization_id,p_quantity_change:=v_qty,p_unit_cost:=v_cost,
    p_reason:='Configured warehouse transfer in',p_notes:=p_notes,p_reference_type:='transfer',
    p_reference_id:=v_transfer.id,p_reference_no:=p_transfer_no,p_company_id:=p_company_id,
    p_created_by:=v_creator,p_stock_config_id:=v_cfg);
 END LOOP;
 RETURN v_transfer;
END $$;

REVOKE ALL ON FUNCTION public.post_stock_transfer_configured(text,uuid,uuid,uuid,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_stock_transfer_configured(text,uuid,uuid,uuid,jsonb,text,uuid) TO authenticated;

COMMENT ON VIEW public.vw_inventory_on_hand IS 'Internal warehouse configuration detail. Inactive zero-stock configurations are hidden; nonzero historical balances remain visible.';
COMMENT ON VIEW public.v_hq_inventory IS 'HQ management inventory aggregated once per organization and variant across all stock configurations.';
COMMENT ON VIEW public.v_low_stock_alerts IS 'Variant-level low stock alerts computed after configuration balances are aggregated.';
COMMENT ON VIEW public.v_org_hierarchy_with_stock IS 'Variant-level management totals; SUM of configuration balances and COUNT DISTINCT variants prevent double counting.';
COMMENT ON VIEW public.v_incoming_stock_detail IS 'Variant-level H2M incoming detail. Configuration is determined at receipt; this view intentionally does not guess it.';
COMMENT ON VIEW public.v_incoming_stock_transfers IS 'Variant-level transfer incoming summary. Configuration remains traceable in transfer movement detail.';
COMMENT ON VIEW public.v_incoming_stock IS 'Variant-level total incoming summary; manufacturer and transfer quantities are independently aggregated without balance joins.';

COMMIT;
