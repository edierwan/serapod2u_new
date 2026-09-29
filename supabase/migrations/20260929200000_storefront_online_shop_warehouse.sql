-- ============================================================================
-- Online shop warehouse, separate from the distributor fulfilment default
-- ----------------------------------------------------------------------------
-- organizations.default_warehouse_org_id is the HQ's default warehouse for
-- distributor (D2H) orders. Website orders (Outdoor + /store) may ship from a
-- different warehouse, so the HQ gets its own storefront_warehouse_org_id.
--
--   * NULL  -> website orders follow default_warehouse_org_id (unchanged
--              behaviour of 20260928210000).
--   * set   -> website orders ship from that warehouse; distributor orders
--              keep using default_warehouse_org_id.
--
-- Same integrity rules as the distributor default: it must be an active
-- warehouse directly under the HQ, and it cannot be deactivated while in use.
-- An explicit choice that is no longer valid fails closed instead of quietly
-- shipping from another warehouse.
--
-- Additive and rerunnable. Requires 20260928210000_storefront_order_stock.sql.
-- ============================================================================

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS storefront_warehouse_org_id uuid
    REFERENCES public.organizations(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.organizations.storefront_warehouse_org_id IS
  'HQ only. Warehouse that website orders (Outdoor + /store) ship from and sell against. NULL = follow default_warehouse_org_id.';

-- ---------------------------------------------------------------------------
-- Integrity guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.organizations_protect_storefront_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hq_name text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.is_active IS TRUE
     AND NEW.is_active IS DISTINCT FROM TRUE THEN
    SELECT org_name INTO v_hq_name
      FROM public.organizations
     WHERE org_type_code = 'HQ'
       AND storefront_warehouse_org_id = OLD.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION
        'Cannot deactivate the online shop warehouse for %. Choose another online shop warehouse first.',
        COALESCE(v_hq_name, 'the parent HQ');
    END IF;
  END IF;

  IF NEW.storefront_warehouse_org_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.storefront_warehouse_org_id IS DISTINCT FROM OLD.storefront_warehouse_org_id
     ) THEN
    IF NEW.org_type_code IS DISTINCT FROM 'HQ' THEN
      RAISE EXCEPTION 'Only an HQ can have an online shop warehouse';
    END IF;
    IF NOT public.is_active_hq_fulfillment_warehouse(NEW.id, NEW.storefront_warehouse_org_id) THEN
      RAISE EXCEPTION 'Online shop warehouse must be an active warehouse directly under this HQ';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_protect_storefront_warehouse ON public.organizations;
CREATE TRIGGER trg_organizations_protect_storefront_warehouse
  BEFORE INSERT OR UPDATE OF is_active, storefront_warehouse_org_id, org_type_code
  ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_protect_storefront_warehouse();

-- ---------------------------------------------------------------------------
-- Website orders resolve the online shop warehouse first
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storefront_fulfilment_warehouse(p_organization_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hq uuid;
  v_wh uuid;
  v_explicit boolean := false;
  v_count integer;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    v_hq := public.resolve_seller_hq_organization(p_organization_id);
    SELECT COALESCE(storefront_warehouse_org_id, default_warehouse_org_id),
           storefront_warehouse_org_id IS NOT NULL
      INTO v_wh, v_explicit
      FROM public.organizations
     WHERE id = v_hq;
  ELSE
    SELECT count(*),
           (array_agg(COALESCE(storefront_warehouse_org_id, default_warehouse_org_id)))[1],
           (array_agg(storefront_warehouse_org_id IS NOT NULL))[1]
      INTO v_count, v_wh, v_explicit
      FROM public.organizations
     WHERE org_type_code = 'HQ'
       AND is_active = true
       AND COALESCE(storefront_warehouse_org_id, default_warehouse_org_id) IS NOT NULL;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'storefront_no_fulfilment_warehouse: more than one HQ has a warehouse set; the order must carry its organization.';
    END IF;
    SELECT parent_org_id INTO v_hq FROM public.organizations WHERE id = v_wh;
  END IF;

  IF v_wh IS NULL OR NOT public.is_active_hq_fulfillment_warehouse(v_hq, v_wh) THEN
    IF v_explicit THEN
      RAISE EXCEPTION 'storefront_no_fulfilment_warehouse: the online shop warehouse is no longer an active warehouse under the HQ.';
    END IF;
    RAISE EXCEPTION 'storefront_no_fulfilment_warehouse: no active default warehouse is set for the online shop.';
  END IF;
  RETURN v_wh;
END;
$$;

REVOKE ALL ON FUNCTION public.storefront_fulfilment_warehouse(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_fulfilment_warehouse(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
