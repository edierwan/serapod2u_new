-- ============================================================================
-- Device Standard stock configuration repair (part 1 of 2)
-- ----------------------------------------------------------------------------
-- CONTEXT
--   Serapod Device S.Box / S.Line variants live in a product group whose
--   `stock_config_profile` is 'standard'. A Device has no nicotine volume and
--   no Box packaging version, so its ONLY valid stock configuration is the
--   dimensionless Standard row that
--   `create_default_stock_config_for_variant()` creates for every new variant:
--
--     config_code 'STD' / config_label 'Standard' / volume_ml NULL /
--     packaging NULL / status 'active' / allow_so / allow_ord /
--     default_for_ord / is_variant_default / NOT requires_repacking_before_sale
--     / sort_order 0
--
--   Production drifted away from that invariant in two distinct ways, both of
--   which make the config non-sellable (Quick/Standard Order and D2H skip any
--   config whose status <> 'active' or whose allow_so is false — see
--   app/src/lib/orders/quick-order-catalog.ts), so D2H sellable availability
--   reads 0 even though physical stock exists:
--
--     STATE 1  the generic row was rewritten to config_code 'UNCLASSIFIED',
--              status 'phase_out', allow_ord false, sort_order 99 by
--              `_enable_variant_stock_configurations_core()` when the Cellera
--              concentration rollout was applied to Device variants by mistake.
--              (e.g. "Serapod Device S.Line — Oliver")
--
--     STATE 2  the generic row is still 'STD' but was deactivated to
--              status 'inactive'.
--              (e.g. "Serapod Device S.Line — White [ Raya 2026 Edition ]")
--
--   Both states are repaired IN PLACE on the SAME row, so every
--   product_inventory / stock_movements / order_items / stock-count reference
--   that already points at that configuration keeps pointing at it. No row is
--   inserted, no row is deleted and no quantity is touched by this migration.
--
-- SCOPE
--   "Device" is resolved structurally, never by product or variant name:
--     products.is_vape = true  AND  owning group's stock_config_profile
--     = 'standard'  (a vape product that is not a flavour/Cartridge group).
--   Cartridge/liquid groups (stock_config_profile = 'concentration') are NOT
--   matched and are never read for update here. Non-vape standard groups
--   (Speaker, Camping, Cat Treat) are deliberately out of scope.
--
-- NOT IN THIS FILE
--   Removing the invalid 20NB/50NB/50OB rows that the same faulty rollout
--   created on Device variants. That is a separate, separately abortable
--   transaction: 20260813120100_device_remove_concentration_stock_configs.sql.
--   Keeping it separate means a blocked purge can never roll back this repair.
--
-- ROLLBACK
--   The pre-change rows are copied verbatim into
--   public._backup_device_stock_config_20260813 before the UPDATE. To revert:
--     UPDATE public.inventory_stock_configurations c
--        SET config_code = b.config_code, config_label = b.config_label,
--            status = b.status, allow_so = b.allow_so, allow_ord = b.allow_ord,
--            default_for_ord = b.default_for_ord,
--            is_variant_default = b.is_variant_default,
--            requires_repacking_before_sale = b.requires_repacking_before_sale,
--            sort_order = b.sort_order
--       FROM public._backup_device_stock_config_20260813 b
--      WHERE c.id = b.id;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Serialise against concurrent stock operations on the targeted rows
-- ----------------------------------------------------------------------------
-- SHARE ROW EXCLUSIVE blocks concurrent writers of this catalog table (and
-- other DDL/repairs) while still allowing plain readers.
LOCK TABLE public.inventory_stock_configurations IN SHARE ROW EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- 1. Timestamped backup of every row this migration is allowed to change
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_device_stock_config_20260813 (
  LIKE public.inventory_stock_configurations INCLUDING DEFAULTS
);
ALTER TABLE public._backup_device_stock_config_20260813
  ADD COLUMN IF NOT EXISTS backup_reason text,
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public._backup_device_stock_config_20260813 IS
  'Verbatim pre-change copy of Device stock configuration rows repaired by 20260813120000 / purged by 20260813120100. Audit + manual rollback source; never read by the application.';

DO $repair$
DECLARE
  v_blocked      text;
  v_qty_before   bigint;
  v_qty_after    bigint;
  v_alloc_before bigint;
  v_alloc_after  bigint;
  v_cartridge_fingerprint_before text;
  v_cartridge_fingerprint_after  text;
  v_repaired     integer;
BEGIN
  -- --------------------------------------------------------------------------
  -- 2. Baselines that must be provably unchanged at COMMIT time
  -- --------------------------------------------------------------------------
  DROP TABLE IF EXISTS _device_variants;
  CREATE TEMP TABLE _device_variants ON COMMIT DROP AS
  SELECT pv.id AS variant_id
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard';

  IF NOT EXISTS (SELECT 1 FROM _device_variants) THEN
    RAISE EXCEPTION
      'No Device variants resolved (products.is_vape = true in a stock_config_profile = ''standard'' group). Refusing to run a repair that targets nothing.'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(sum(quantity_on_hand), 0), COALESCE(sum(quantity_allocated), 0)
    INTO v_qty_before, v_alloc_before
  FROM public.product_inventory;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_cartridge_fingerprint_before
  FROM (
    SELECT c.id::text || ':' || c.config_code || ':' || c.status || ':' ||
           COALESCE(c.volume_ml::text, '-') || ':' || COALESCE(c.packaging, '-') || ':' ||
           c.allow_so::text || c.allow_ord::text || c.default_for_ord::text ||
           c.is_variant_default::text || c.requires_repacking_before_sale::text ||
           c.sort_order::text AS t
    FROM public.inventory_stock_configurations c
    JOIN public.product_variants pv ON pv.id = c.variant_id
    JOIN public.products p          ON p.id = pv.product_id
    JOIN public.product_groups g    ON g.id = p.group_id
    WHERE COALESCE(g.stock_config_profile, 'standard') = 'concentration'
  ) s;

  -- --------------------------------------------------------------------------
  -- 3. Safety assertions — refuse to repair anything ambiguous
  -- --------------------------------------------------------------------------

  -- BLOCKED_DUPLICATE_GENERIC: more than one dimensionless config per variant.
  SELECT string_agg(format('variant %s has %s generic configs', variant_id, n), '; ')
    INTO v_blocked
  FROM (
    SELECT c.variant_id, count(*) AS n
    FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    WHERE c.volume_ml IS NULL AND c.packaging IS NULL
    GROUP BY c.variant_id HAVING count(*) > 1
  ) x;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_DUPLICATE_GENERIC_CONFIG: %', v_blocked
      USING ERRCODE = 'raise_exception';
  END IF;

  -- BLOCKED_DUPLICATE_STD: a non-STD generic row cannot be renamed to STD while
  -- a separate STD row already exists on the same variant
  -- (UNIQUE isc_variant_config_code_key).
  SELECT string_agg(format('variant %s already has a separate STD config', c.variant_id), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.volume_ml IS NULL AND c.packaging IS NULL AND c.config_code <> 'STD'
    AND EXISTS (
      SELECT 1 FROM public.inventory_stock_configurations o
      WHERE o.variant_id = c.variant_id AND o.config_code = 'STD' AND o.id <> c.id
    );
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_DUPLICATE_STD: %', v_blocked
      USING ERRCODE = 'raise_exception';
  END IF;

  -- UNEXPECTED_STATE (a): a Device variant with no dimensionless config at all —
  -- there is nothing to repair in place and inventing one would orphan history.
  SELECT string_agg(format('variant %s has no generic config', d.variant_id), '; ')
    INTO v_blocked
  FROM _device_variants d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.variant_id = d.variant_id AND c.volume_ml IS NULL AND c.packaging IS NULL
  );
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked USING ERRCODE = 'raise_exception';
  END IF;

  -- UNEXPECTED_STATE (b): the generic row carries a code this repair does not
  -- recognise. Only STD (state 2) and UNCLASSIFIED (state 1) are expected.
  SELECT string_agg(format('config %s (variant %s) has unexpected code %s',
                           c.id, c.variant_id, c.config_code), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.volume_ml IS NULL AND c.packaging IS NULL
    AND c.config_code NOT IN ('STD', 'UNCLASSIFIED');
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked USING ERRCODE = 'raise_exception';
  END IF;

  -- UNEXPECTED_STATE (c): a concentration config on a Device variant still owns
  -- default_for_ord. Setting default_for_ord on the generic row would then
  -- violate the partial unique index isc_one_ord_default, and clearing it here
  -- would silently mutate a row this migration is not allowed to touch.
  SELECT string_agg(format('config %s (%s, variant %s) still holds default_for_ord',
                           c.id, c.config_code, c.variant_id), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE (c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL)
    AND c.default_for_ord;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked USING ERRCODE = 'raise_exception';
  END IF;

  -- UNEXPECTED_STATE (d): the generic row is not the variant default while some
  -- other row is. is_variant_default is protected by the partial unique index
  -- isc_one_variant_default, so it must be released before it can be moved.
  SELECT string_agg(format('variant %s: is_variant_default is held by config %s (%s)',
                           c.variant_id, c.id, c.config_code), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.is_variant_default AND (c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL);
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked USING ERRCODE = 'raise_exception';
  END IF;

  -- --------------------------------------------------------------------------
  -- 4. Back up every row about to change
  -- --------------------------------------------------------------------------
  INSERT INTO public._backup_device_stock_config_20260813
  SELECT c.*, 'repair_generic_to_std', now()
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.volume_ml IS NULL AND c.packaging IS NULL
    AND (c.config_code <> 'STD'
      OR c.config_label <> 'Standard'
      OR c.status <> 'active'
      OR NOT c.allow_so
      OR NOT c.allow_ord
      OR NOT c.default_for_ord
      OR NOT c.is_variant_default
      OR c.requires_repacking_before_sale
      OR c.sort_order <> 0);

  -- --------------------------------------------------------------------------
  -- 5. Repair the SAME row in place (states 1 and 2 collapse to one UPDATE)
  -- --------------------------------------------------------------------------
  -- stock_sku is intentionally left untouched: it is a business identifier that
  -- is snapshotted into stock_count_session_items.sku and exported, and it is
  -- not part of the required invariant. Rows repaired from UNCLASSIFIED keep
  -- their '-UNC-' SKU segment.
  UPDATE public.inventory_stock_configurations c
  SET config_code                    = 'STD',
      config_label                   = 'Standard',
      status                         = 'active',
      allow_so                       = true,
      allow_ord                      = true,
      default_for_ord                = true,
      is_variant_default             = true,
      requires_repacking_before_sale = false,
      sort_order                     = 0,
      updated_at                     = now()
  FROM _device_variants d
  WHERE d.variant_id = c.variant_id
    AND c.volume_ml IS NULL AND c.packaging IS NULL
    AND (c.config_code <> 'STD'
      OR c.config_label <> 'Standard'
      OR c.status <> 'active'
      OR NOT c.allow_so
      OR NOT c.allow_ord
      OR NOT c.default_for_ord
      OR NOT c.is_variant_default
      OR c.requires_repacking_before_sale
      OR c.sort_order <> 0);
  GET DIAGNOSTICS v_repaired = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 6. Post-conditions — any failure rolls the whole transaction back
  -- --------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    WHERE c.volume_ml IS NULL AND c.packaging IS NULL
      AND (c.config_code <> 'STD' OR c.config_label <> 'Standard'
        OR c.status <> 'active' OR NOT c.allow_so OR NOT c.allow_ord
        OR NOT c.default_for_ord OR NOT c.is_variant_default
        OR c.requires_repacking_before_sale OR c.sort_order <> 0)
  ) THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a Device generic configuration is still not a correct active STD row.';
  END IF;

  SELECT COALESCE(sum(quantity_on_hand), 0), COALESCE(sum(quantity_allocated), 0)
    INTO v_qty_after, v_alloc_after
  FROM public.product_inventory;
  IF v_qty_after <> v_qty_before OR v_alloc_after <> v_alloc_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: inventory changed (on_hand % -> %, allocated % -> %).',
      v_qty_before, v_qty_after, v_alloc_before, v_alloc_after;
  END IF;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_cartridge_fingerprint_after
  FROM (
    SELECT c.id::text || ':' || c.config_code || ':' || c.status || ':' ||
           COALESCE(c.volume_ml::text, '-') || ':' || COALESCE(c.packaging, '-') || ':' ||
           c.allow_so::text || c.allow_ord::text || c.default_for_ord::text ||
           c.is_variant_default::text || c.requires_repacking_before_sale::text ||
           c.sort_order::text AS t
    FROM public.inventory_stock_configurations c
    JOIN public.product_variants pv ON pv.id = c.variant_id
    JOIN public.products p          ON p.id = pv.product_id
    JOIN public.product_groups g    ON g.id = p.group_id
    WHERE COALESCE(g.stock_config_profile, 'standard') = 'concentration'
  ) s;
  IF v_cartridge_fingerprint_after IS DISTINCT FROM v_cartridge_fingerprint_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a Cartridge (concentration) configuration was modified.';
  END IF;

  RAISE NOTICE 'Device STD repair: % configuration row(s) repaired in place.', v_repaired;
END
$repair$;

-- ----------------------------------------------------------------------------
-- 7. Recurrence guard
-- ----------------------------------------------------------------------------
-- `assert_stock_config_group_eligibility()` (20260727) already rejects a
-- concentration row on a non-'concentration' group, but it only fires on the
-- INSERT — by which point `_enable_variant_stock_configurations_core` has
-- ALREADY rewritten the variant's STD row into UNCLASSIFIED/phase_out. The
-- statement-level failure does undo that in a plain call, yet
-- `bulk_enable_variant_stock_configurations` swallows the per-variant error and
-- reports it as a skipped variant, so the operator gets no clear signal about
-- what was attempted. Fail fast, before any mutation, with a message that names
-- the profile.
CREATE OR REPLACE FUNCTION public._enable_variant_stock_configurations_core(
  p_variant_id uuid,
  p_profile text DEFAULT 'transition'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default public.inventory_stock_configurations%ROWTYPE;
  v_group_profile text;
  v_created integer := 0;
  v_batch_created integer := 0;
BEGIN
  IF p_profile NOT IN ('transition', 'new_standard') THEN
    RAISE EXCEPTION 'Unknown stock configuration profile %', p_profile;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = p_variant_id) THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  -- Recurrence guard: every profile this function supports creates at least the
  -- 20NB concentration configuration, so the whole call is invalid for a group
  -- that is not a flavour/Cartridge group. Raise BEFORE touching the variant's
  -- Standard row, so a Device STD can never be converted to UNCLASSIFIED again.
  SELECT g.stock_config_profile
  INTO v_group_profile
  FROM public.product_variants pv
  JOIN public.products p           ON p.id = pv.product_id
  LEFT JOIN public.product_groups g ON g.id = p.group_id
  WHERE pv.id = p_variant_id;

  IF COALESCE(v_group_profile, 'standard') <> 'concentration' THEN
    RAISE EXCEPTION
      'Concentration stock configurations (20NB/50NB/50OB) cannot be enabled for variant %: its product group profile is %. Devices and other non-flavour groups keep exactly one dimensionless Standard (STD) configuration.',
      p_variant_id, COALESCE(v_group_profile, 'standard')
      USING ERRCODE = 'check_violation',
            HINT = 'Set product_groups.stock_config_profile = ''concentration'' for genuine Cartridge/liquid groups only.';
  END IF;

  SELECT * INTO v_default
  FROM public.inventory_stock_configurations
  WHERE variant_id = p_variant_id AND is_variant_default
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant % has no default stock configuration', p_variant_id;
  END IF;

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
     20, 'new_box', false, true,  true,  true,  false, 'active',    1)
  ON CONFLICT (variant_id, config_code) DO NOTHING;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  IF p_profile = 'transition' THEN
    INSERT INTO public.inventory_stock_configurations (
      variant_id, config_code, config_label, stock_sku, volume_ml, packaging,
      is_variant_default, allow_ord, allow_so, default_for_ord,
      requires_repacking_before_sale, status, sort_order
    )
    VALUES
      (p_variant_id, '50NB', '50ml · New Box', public.generate_stock_sku(p_variant_id, '50NB'),
       50, 'new_box', false, false, true,  false, false, 'active',    2),
      (p_variant_id, '50OB', '50ml · Old Box', public.generate_stock_sku(p_variant_id, '50OB'),
       50, 'old_box', false, false, false, false, true,  'phase_out', 3)
    ON CONFLICT (variant_id, config_code) DO NOTHING;
    GET DIAGNOSTICS v_batch_created = ROW_COUNT;
    v_created := v_created + v_batch_created;
  END IF;

  RETURN jsonb_build_object(
    'variant_id', p_variant_id,
    'default_config_id', v_default.id,
    'profile', p_profile,
    'vape_configs_created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public._enable_variant_stock_configurations_core(uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public._enable_variant_stock_configurations_core(uuid, text) IS
  'Enables the concentration stock configurations for ONE Cartridge/liquid variant. Rejects any variant whose product group stock_config_profile is not ''concentration'' (Devices and other standard groups) BEFORE mutating the variant Standard row, so a Device STD can never be converted to UNCLASSIFIED. Unchanged for genuine Cartridge variants.';

COMMIT;
