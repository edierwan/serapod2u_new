-- Inventory Stock Configurations - Phase 19: collision-safe stock SKU generator
--
-- Forward correction for databases that recorded Migration 01 before its SKU
-- generator was patched. This migration replaces definitions only. Existing
-- configuration rows, stock_sku values, inventory balances, movements and
-- references are intentionally left unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_stock_sku(p_variant_id uuid, p_config_code text)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
BEGIN
  SELECT COALESCE(NULLIF(trim(to_jsonb(pv) ->> 'product_code'), ''), pv.variant_code)
    INTO v_base
  FROM public.product_variants pv
  WHERE pv.id = p_variant_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Variant % not found for stock SKU generation', p_variant_id;
  END IF;

  v_base := trim(BOTH '-' FROM regexp_replace(upper(v_base), '[^A-Z0-9]+', '-', 'g'));
  IF v_base = '' THEN
    v_base := 'VAR';
  END IF;

  RETURN v_base
    || '-' || upper(p_config_code)
    || '-' || replace(p_variant_id::text, '-', '');
END;
$$;

COMMENT ON FUNCTION public.generate_stock_sku(uuid, text) IS
  'Returns a stable collision-safe SKU for a variant/configuration pair. The normalized Product Code or variant code remains human-readable and the full variant UUID guarantees uniqueness across duplicate Product Codes and concurrent variant creation.';

-- Reinstall the trigger function so an already-migrated database cannot retain
-- a stale function body. CREATE OR REPLACE preserves the existing trigger
-- dependency and is safe whether Migration 01 was original or patched.
CREATE OR REPLACE FUNCTION public.create_default_stock_config_for_variant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.inventory_stock_configurations (
    variant_id, config_code, config_label, stock_sku,
    is_variant_default, allow_ord, allow_so, default_for_ord, status, sort_order
  )
  VALUES (
    NEW.id, 'STD', 'Standard', public.generate_stock_sku(NEW.id, 'STD'),
    true, true, true, true, 'active', 0
  )
  ON CONFLICT (variant_id, config_code) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_default_stock_config_for_variant() IS
  'Creates the collision-safe STD configuration for a newly inserted product variant. Existing variants and configurations are never rewritten.';

COMMIT;
