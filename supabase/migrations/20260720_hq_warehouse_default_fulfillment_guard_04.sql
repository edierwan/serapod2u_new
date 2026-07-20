-- ============================================================================
-- Protect HQ default fulfillment warehouse integrity
-- ----------------------------------------------------------------------------
-- Source of truth remains organizations.default_warehouse_org_id on the HQ.
-- Prevents leaving an invalid/inactive default when a warehouse is deactivated
-- or when an HQ default points at a non-eligible warehouse.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.organizations_protect_default_fulfillment_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hq_name text;
BEGIN
  -- Block deactivation of the warehouse currently configured as an HQ default.
  IF TG_OP = 'UPDATE'
     AND OLD.is_active IS TRUE
     AND NEW.is_active IS DISTINCT FROM TRUE
     AND EXISTS (
       SELECT 1
       FROM public.organizations hq
       WHERE hq.org_type_code = 'HQ'
         AND hq.default_warehouse_org_id = OLD.id
     ) THEN
    SELECT org_name INTO v_hq_name
    FROM public.organizations
    WHERE org_type_code = 'HQ'
      AND default_warehouse_org_id = OLD.id
    LIMIT 1;

    RAISE EXCEPTION
      'Cannot deactivate the default fulfillment warehouse for %. Set another active HQ warehouse as default first.',
      COALESCE(v_hq_name, 'the parent HQ');
  END IF;

  -- Validate HQ default_warehouse_org_id updates.
  IF NEW.org_type_code = 'HQ'
     AND NEW.default_warehouse_org_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.default_warehouse_org_id IS DISTINCT FROM OLD.default_warehouse_org_id
     )
     AND NOT public.is_active_hq_fulfillment_warehouse(NEW.id, NEW.default_warehouse_org_id) THEN
    RAISE EXCEPTION
      'Default fulfillment warehouse must be an active warehouse directly under this HQ';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_protect_default_fulfillment_warehouse
  ON public.organizations;
CREATE TRIGGER trg_organizations_protect_default_fulfillment_warehouse
  BEFORE INSERT OR UPDATE OF is_active, default_warehouse_org_id, org_type_code, parent_org_id
  ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_protect_default_fulfillment_warehouse();

COMMENT ON FUNCTION public.organizations_protect_default_fulfillment_warehouse() IS
  'Keeps organizations.default_warehouse_org_id valid: active WH child of the HQ, and blocks deactivation of the current default until replaced.';

COMMIT;
