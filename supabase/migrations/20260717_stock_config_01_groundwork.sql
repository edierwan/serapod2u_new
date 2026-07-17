-- ============================================================================
-- Inventory Stock Configurations — Phase 0: Groundwork (01)
-- ----------------------------------------------------------------------------
-- Introduces per-variant stock configurations (Volume × Packaging) so one
-- product variant/flavour can hold multiple physical stock balances:
--   * 20ml + New Box   (default for manufacturer ORD receiving)
--   * 50ml + New Box   (sellable to selected distributors)
--   * 50ml + Old Box   (must be repacked to 50ml + New Box before sale)
-- There is deliberately NO 20ml + Old Box: the CHECK constraint
-- isc_valid_dimension_combos enumerates the only legal combinations instead
-- of a generated Volume × Packaging matrix.
--
-- Phase 0 is strictly additive and behaviour-preserving:
--   * Creates public.inventory_stock_configurations (+ RLS, updated_at).
--   * Seeds exactly ONE dimensionless default configuration ('STD') per
--     existing variant, and auto-creates it for future variants via trigger.
--   * Adds nullable stock_config_id columns (composite FK on (id, variant_id)
--     so a movement/balance can never reference a config of another variant)
--     to product_inventory, stock_movements, stock_count_session_items,
--     stock_adjustment_items and warehouse_receipt_items.
--   * Backfills product_inventory.stock_config_id to the variant default.
--     Quantities are NOT touched and stock_movements history is NOT rewritten
--     (historical movements keep stock_config_id = NULL = "legacy").
--   * Ships enable_variant_stock_configurations(variant_id): converts the
--     variant's 'STD' default into 'UNCLASSIFIED' (pending physical stock
--     take — existing balances are intentionally NOT guessed into a real
--     configuration) and adds the three valid vape configurations.
--     It is NOT executed for any variant here: the affected Cellera variant
--     list must be confirmed by the business and enabled explicitly.
--
-- ROLLBACK NOTES (manual, valid while Phase 1 has not been applied):
--   DROP TRIGGER trg_product_variants_default_stock_config ON public.product_variants;
--   DROP FUNCTION public.create_default_stock_config_for_variant();
--   DROP FUNCTION public.enable_variant_stock_configurations(uuid);
--   DROP FUNCTION public.generate_stock_sku(uuid, text);
--   DROP FUNCTION public.resolve_default_stock_config(uuid);
--   ALTER TABLE public.warehouse_receipt_items    DROP COLUMN stock_config_id;
--   ALTER TABLE public.stock_adjustment_items     DROP COLUMN stock_config_id;
--   ALTER TABLE public.stock_count_session_items  DROP COLUMN stock_config_id;
--   ALTER TABLE public.stock_movements            DROP COLUMN stock_config_id;
--   ALTER TABLE public.product_inventory          DROP COLUMN stock_config_id;
--   DROP TABLE public.inventory_stock_configurations;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Configuration table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_stock_configurations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  config_code   text NOT NULL,
  config_label  text NOT NULL,
  stock_sku     text NOT NULL,
  volume_ml     smallint,
  packaging     text,
  status        text NOT NULL DEFAULT 'active',
  -- Exactly one per variant: the catch-all sink used whenever a flow does not
  -- (yet) specify a configuration. For multi-config variants this is the
  -- 'UNCLASSIFIED' row that holds pre-existing balances until the approved
  -- physical stock take reclassifies them.
  is_variant_default boolean NOT NULL DEFAULT false,
  allow_ord     boolean NOT NULL DEFAULT true,
  allow_so      boolean NOT NULL DEFAULT true,
  default_for_ord boolean NOT NULL DEFAULT false,
  requires_repacking_before_sale boolean NOT NULL DEFAULT false,
  units_per_case integer,
  sort_order    integer NOT NULL DEFAULT 0,
  notes         text,
  created_by    uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT isc_config_code_check CHECK (config_code ~ '^[A-Z0-9_]{2,24}$'),
  CONSTRAINT isc_status_check CHECK (status IN ('active', 'phase_out', 'inactive')),
  CONSTRAINT isc_packaging_check CHECK (packaging IS NULL OR packaging IN ('new_box', 'old_box')),
  -- The ONLY legal dimension combinations. NULL/NULL is the dimensionless
  -- generic configuration used by unrelated product categories.
  CONSTRAINT isc_valid_dimension_combos CHECK (
    (volume_ml IS NULL AND packaging IS NULL)
    OR (volume_ml = 20 AND packaging = 'new_box')
    OR (volume_ml = 50 AND packaging IN ('new_box', 'old_box'))
  ),
  -- Stock that requires repacking can never be directly sellable.
  CONSTRAINT isc_repack_blocks_so CHECK (NOT (allow_so AND requires_repacking_before_sale)),
  CONSTRAINT isc_default_ord_requires_allow CHECK (NOT default_for_ord OR allow_ord),
  CONSTRAINT isc_units_per_case_check CHECK (units_per_case IS NULL OR units_per_case > 0),
  CONSTRAINT isc_variant_config_code_key UNIQUE (variant_id, config_code),
  -- Composite target for FKs from balance/ledger tables: guarantees the
  -- referenced configuration belongs to the same variant as the row itself.
  CONSTRAINT isc_id_variant_key UNIQUE (id, variant_id)
);

COMMENT ON TABLE public.inventory_stock_configurations IS
  'Stock configurations (Volume × Packaging) below a product variant. Balances and movements reference (id, variant_id) so variant/config can never disagree. Only 20ml/new_box, 50ml/new_box, 50ml/old_box and the dimensionless generic/unclassified rows are valid.';
COMMENT ON COLUMN public.inventory_stock_configurations.is_variant_default IS
  'Exactly one per variant (partial unique index). Catch-all sink for flows that do not specify a configuration; holds legacy balances as UNCLASSIFIED for multi-config variants until physically reclassified.';
COMMENT ON COLUMN public.inventory_stock_configurations.default_for_ord IS
  'Configuration that manufacturer ORD receiving posts into (20ml + New Box for vape variants). At most one per variant.';
COMMENT ON COLUMN public.inventory_stock_configurations.requires_repacking_before_sale IS
  'TRUE for 50ml + Old Box: stock must be repacked (RPK-*) into 50ml + New Box before it can be issued through SO.';

CREATE UNIQUE INDEX IF NOT EXISTS isc_stock_sku_key
  ON public.inventory_stock_configurations (upper(stock_sku));
CREATE UNIQUE INDEX IF NOT EXISTS isc_one_variant_default
  ON public.inventory_stock_configurations (variant_id) WHERE is_variant_default;
CREATE UNIQUE INDEX IF NOT EXISTS isc_one_ord_default
  ON public.inventory_stock_configurations (variant_id) WHERE default_for_ord;
-- One row per physical dimension combination per variant (NULLs folded so the
-- dimensionless generic config is also unique per variant).
CREATE UNIQUE INDEX IF NOT EXISTS isc_variant_dimensions_key
  ON public.inventory_stock_configurations (variant_id, COALESCE(volume_ml, -1), COALESCE(packaging, '<none>'));
CREATE INDEX IF NOT EXISTS isc_variant_idx
  ON public.inventory_stock_configurations (variant_id);

DROP TRIGGER IF EXISTS set_isc_updated_at ON public.inventory_stock_configurations;
CREATE TRIGGER set_isc_updated_at
  BEFORE UPDATE ON public.inventory_stock_configurations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS: readable catalog data; managed by HQ admins only (mirrors products /
-- product_variants policy pattern).
ALTER TABLE public.inventory_stock_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isc_read_all ON public.inventory_stock_configurations;
CREATE POLICY isc_read_all ON public.inventory_stock_configurations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS isc_admin_manage ON public.inventory_stock_configurations;
CREATE POLICY isc_admin_manage ON public.inventory_stock_configurations
  TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());

-- ----------------------------------------------------------------------------
-- 2. Stock SKU generation
-- ----------------------------------------------------------------------------
-- Base = product_variants.product_code when the optional 20260715 migration is
-- applied (read via to_jsonb so this function works either way), otherwise
-- variant_code. Uniqueness is enforced by isc_stock_sku_key; collisions get a
-- numeric suffix.

CREATE OR REPLACE FUNCTION public.generate_stock_sku(p_variant_id uuid, p_config_code text)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
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

  v_candidate := v_base || '-' || upper(p_config_code);
  WHILE EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE upper(c.stock_sku) = upper(v_candidate)
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || upper(p_config_code) || '-' || v_suffix::text;
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Default-configuration resolver (used by Phase 1 ledger functions)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_default_stock_config(p_variant_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.id
  FROM public.inventory_stock_configurations c
  WHERE c.variant_id = p_variant_id
    AND c.is_variant_default
  LIMIT 1
$$;

COMMENT ON FUNCTION public.resolve_default_stock_config(uuid) IS
  'Returns the variant''s catch-all stock configuration (is_variant_default). Used by ledger functions whenever a flow does not specify a configuration.';

-- ----------------------------------------------------------------------------
-- 4. Seed one generic default configuration per existing variant
-- ----------------------------------------------------------------------------

INSERT INTO public.inventory_stock_configurations (
  variant_id, config_code, config_label, stock_sku,
  is_variant_default, allow_ord, allow_so, default_for_ord, status, sort_order
)
SELECT pv.id, 'STD', 'Standard', public.generate_stock_sku(pv.id, 'STD'),
       true, true, true, true, 'active', 0
FROM public.product_variants pv
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory_stock_configurations c WHERE c.variant_id = pv.id
);

-- Auto-create the generic default for variants created after this migration
-- (Phase 1 makes product_inventory.stock_config_id NOT NULL, so every variant
-- must always have a default configuration).

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

DROP TRIGGER IF EXISTS trg_product_variants_default_stock_config ON public.product_variants;
CREATE TRIGGER trg_product_variants_default_stock_config
  AFTER INSERT ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.create_default_stock_config_for_variant();

-- ----------------------------------------------------------------------------
-- 5. Enable the three vape configurations for a confirmed variant
-- ----------------------------------------------------------------------------
-- NOT executed for any variant in this migration: the Cellera variant list
-- must be confirmed by the business first ("do not guess"). HQ admins run:
--   SELECT public.enable_variant_stock_configurations('<variant uuid>');
-- Idempotent. Existing balances stay on the variant default row, which is
-- renamed to UNCLASSIFIED (pending stock take) — they are never silently
-- assigned to 20ml + New Box.

CREATE OR REPLACE FUNCTION public.enable_variant_stock_configurations(p_variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_default public.inventory_stock_configurations%ROWTYPE;
  v_created integer := 0;
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Only HQ admins can enable stock configurations';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = p_variant_id) THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  SELECT * INTO v_default
  FROM public.inventory_stock_configurations
  WHERE variant_id = p_variant_id AND is_variant_default
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant % has no default stock configuration', p_variant_id;
  END IF;

  -- Convert the generic default into the clearly-identified legacy bucket.
  -- Quantities are untouched; ORD receiving must no longer post here and the
  -- 20NB row takes over default_for_ord below.
  IF v_default.config_code = 'STD' THEN
    UPDATE public.inventory_stock_configurations
    SET config_code   = 'UNCLASSIFIED',
        config_label  = 'Unclassified (pending stock take)',
        stock_sku     = public.generate_stock_sku(p_variant_id, 'UNC'),
        allow_ord     = false,
        default_for_ord = false,
        status        = 'phase_out',
        sort_order    = 99,
        updated_at    = now()
    WHERE id = v_default.id;
  END IF;

  INSERT INTO public.inventory_stock_configurations (
    variant_id, config_code, config_label, stock_sku, volume_ml, packaging,
    is_variant_default, allow_ord, allow_so, default_for_ord,
    requires_repacking_before_sale, status, sort_order
  )
  VALUES
    (p_variant_id, '20NB', '20ml · New Box', public.generate_stock_sku(p_variant_id, '20NB'),
     20, 'new_box', false, true,  true,  true,  false, 'active',    1),
    (p_variant_id, '50NB', '50ml · New Box', public.generate_stock_sku(p_variant_id, '50NB'),
     50, 'new_box', false, false, true,  false, false, 'active',    2),
    (p_variant_id, '50OB', '50ml · Old Box', public.generate_stock_sku(p_variant_id, '50OB'),
     50, 'old_box', false, false, false, false, true,  'phase_out', 3)
  ON CONFLICT (variant_id, config_code) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'variant_id', p_variant_id,
    'default_config_id', v_default.id,
    'vape_configs_created', v_created
  );
END;
$$;

COMMENT ON FUNCTION public.enable_variant_stock_configurations(uuid) IS
  'Idempotently enables the three valid vape stock configurations (20NB/50NB/50OB) for one variant and converts its generic default into UNCLASSIFIED (pending stock take). Run per confirmed Cellera variant; never auto-applied.';

-- ----------------------------------------------------------------------------
-- 6. stock_config_id columns (nullable in Phase 0; composite FKs)
-- ----------------------------------------------------------------------------

ALTER TABLE public.product_inventory
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;
ALTER TABLE public.stock_count_session_items
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;
ALTER TABLE public.stock_adjustment_items
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;
ALTER TABLE public.warehouse_receipt_items
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_inventory_stock_config_fk') THEN
    ALTER TABLE public.product_inventory
      ADD CONSTRAINT product_inventory_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_stock_config_fk') THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_session_items_stock_config_fk') THEN
    ALTER TABLE public.stock_count_session_items
      ADD CONSTRAINT stock_count_session_items_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_items_stock_config_fk') THEN
    ALTER TABLE public.stock_adjustment_items
      ADD CONSTRAINT stock_adjustment_items_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_receipt_items_stock_config_fk') THEN
    ALTER TABLE public.warehouse_receipt_items
      ADD CONSTRAINT warehouse_receipt_items_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
END
$$;

COMMENT ON COLUMN public.product_inventory.stock_config_id IS
  'Stock configuration this balance row belongs to. Backfilled to the variant default in Phase 0; NOT NULL + part of the uniqueness key from Phase 1.';
COMMENT ON COLUMN public.stock_movements.stock_config_id IS
  'Stock configuration affected by this movement. NULL on historical (pre-configuration) rows — never backfilled, audit history is not rewritten.';

CREATE INDEX IF NOT EXISTS idx_product_inventory_stock_config
  ON public.product_inventory (stock_config_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_config
  ON public.stock_movements (stock_config_id) WHERE stock_config_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 7. Backfill balance pointers (quantities untouched)
-- ----------------------------------------------------------------------------

UPDATE public.product_inventory pi
SET stock_config_id = c.id
FROM public.inventory_stock_configurations c
WHERE c.variant_id = pi.variant_id
  AND c.is_variant_default
  AND pi.stock_config_id IS NULL;

COMMIT;
