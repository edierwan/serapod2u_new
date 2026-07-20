-- ============================================================================
-- HQ Warehouse Inventory Flow — Batch 3
-- Consolidated "All Serapod HQ Warehouses" inventory totals
-- ----------------------------------------------------------------------------
-- Read-only aggregation of active WH children for a given HQ.
-- Never accepted as a posting source/destination.
-- security_invoker view + SECURITY DEFINER RPC with can_access_org guard.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.list_active_hq_warehouse_ids(p_hq_org_id uuid)
RETURNS TABLE(warehouse_org_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT wh.id
  FROM public.organizations wh
  JOIN public.organizations hq ON hq.id = wh.parent_org_id
  WHERE hq.id = p_hq_org_id
    AND hq.org_type_code = 'HQ'
    AND hq.is_active = true
    AND wh.org_type_code = 'WH'
    AND wh.is_active = true;
$$;

COMMENT ON FUNCTION public.list_active_hq_warehouse_ids(uuid) IS
  'Returns active warehouse organization IDs whose direct parent is the given HQ. Excludes the HQ itself, distributors, inactive warehouses, and warehouses under other parents.';

CREATE OR REPLACE VIEW public.vw_hq_consolidated_warehouse_inventory
WITH (security_invoker = true) AS
SELECT
  hq.id AS hq_org_id,
  hq.org_name AS hq_org_name,
  pi.variant_id,
  pi.stock_config_id,
  c.config_code,
  c.config_label,
  c.stock_sku,
  c.volume_ml,
  c.packaging,
  c.status AS stock_config_status,
  pv.variant_code,
  pv.variant_name,
  p.id AS product_id,
  p.product_name,
  p.product_code,
  SUM(pi.quantity_on_hand)::integer AS quantity_on_hand,
  SUM(pi.quantity_allocated)::integer AS quantity_allocated,
  SUM(pi.quantity_available)::integer AS quantity_available,
  SUM(COALESCE(pi.total_value, 0))::numeric AS total_value,
  COUNT(DISTINCT pi.organization_id)::integer AS warehouse_count
FROM public.product_inventory pi
JOIN public.organizations wh ON wh.id = pi.organization_id
JOIN public.organizations hq ON hq.id = wh.parent_org_id
JOIN public.product_variants pv ON pv.id = pi.variant_id
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN public.inventory_stock_configurations c
  ON c.id = pi.stock_config_id AND c.variant_id = pi.variant_id
WHERE pi.is_active = true
  AND wh.org_type_code = 'WH'
  AND wh.is_active = true
  AND hq.org_type_code = 'HQ'
  AND hq.is_active = true
GROUP BY
  hq.id, hq.org_name, pi.variant_id, pi.stock_config_id,
  c.config_code, c.config_label, c.stock_sku, c.volume_ml, c.packaging, c.status,
  pv.variant_code, pv.variant_name, p.id, p.product_name, p.product_code;

COMMENT ON VIEW public.vw_hq_consolidated_warehouse_inventory IS
  'Display-only consolidated inventory across active HQ child warehouses. Excludes direct HQ balances and distributor warehouses. Not a posting location.';

CREATE OR REPLACE FUNCTION public.get_hq_consolidated_warehouse_inventory(p_hq_org_id uuid)
RETURNS SETOF public.vw_hq_consolidated_warehouse_inventory
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_hq_org_id IS NULL THEN
    RAISE EXCEPTION 'HQ organization is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_hq_org_id AND org_type_code = 'HQ' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active HQ organization is required';
  END IF;

  IF auth.role() = 'authenticated' THEN
    IF NOT (public.is_hq_admin() OR public.can_access_org(p_hq_org_id)) THEN
      RAISE EXCEPTION 'Not authorized to view consolidated HQ warehouse inventory';
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.vw_hq_consolidated_warehouse_inventory v
  WHERE v.hq_org_id = p_hq_org_id;
END;
$$;

COMMENT ON FUNCTION public.get_hq_consolidated_warehouse_inventory(uuid) IS
  'Secure RPC for consolidated active HQ warehouse inventory totals. Display-only; never a posting source or destination.';

REVOKE ALL ON FUNCTION public.list_active_hq_warehouse_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_hq_warehouse_ids(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_hq_consolidated_warehouse_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hq_consolidated_warehouse_inventory(uuid) TO authenticated, service_role;

GRANT SELECT ON public.vw_hq_consolidated_warehouse_inventory TO authenticated, service_role;

COMMIT;
