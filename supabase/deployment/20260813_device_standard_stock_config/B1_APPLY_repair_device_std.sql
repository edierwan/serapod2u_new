-- ============================================================================
-- B1. APPLY — repair the Device Standard configuration IN PLACE.
--     Mirrors supabase/migrations/20260813120000_device_standard_stock_config_repair.sql
--     Run ONLY after A_PRECHECK has been reviewed and confirmed.
-- ----------------------------------------------------------------------------
-- WHAT IT CHANGES
--   For every Device variant (products.is_vape = true in a group whose
--   stock_config_profile = 'standard'), the ONE dimensionless configuration
--   row is rewritten in place to the canonical Standard invariant:
--     config_code 'STD' / config_label 'Standard' / status 'active' /
--     allow_so / allow_ord / default_for_ord / is_variant_default /
--     NOT requires_repacking_before_sale / sort_order 0
--   This covers BOTH damaged states with a single UPDATE:
--     SAFE_RENAME_UNCLASSIFIED_TO_STD  (UNCLASSIFIED + phase_out)
--     SAFE_ACTIVATE_EXISTING_STD       (STD + inactive)
--   It is the SAME row — every product_inventory / stock_movements /
--   order_items / stock-count reference keeps pointing at it.
--
-- WHAT IT DOES NOT TOUCH
--   No quantity, allocation, unit cost, movement or stock-count row.
--   No Cartridge (stock_config_profile = 'concentration') configuration.
--   No configuration is inserted or deleted here. Removing the invalid
--   20NB/50NB/50OB rows is B2, a SEPARATE transaction.
--
-- GATING — read this before running
--   This script ABORTS on BLOCKED_DUPLICATE_GENERIC_CONFIG,
--   BLOCKED_DUPLICATE_STD and UNEXPECTED_STATE.
--   It deliberately does NOT abort on BLOCKED_REFERENCED_LIQUID_CONFIG.
--   Reason: that classification describes a DIFFERENT row (a phantom
--   20NB/50NB/50OB row) that this script neither reads for update nor
--   modifies. In production every one of those 36 rows is blocked, so gating
--   B1 on them would mean the sellability fix could never be applied at all.
--   The blocked rows are handled — and correctly refused — by B2.
--
-- ROLLBACK
--   Pre-change rows are copied verbatim into
--   public._backup_device_stock_config_20260813 (backup_reason =
--   'repair_generic_to_std'). To revert:
--     UPDATE public.inventory_stock_configurations c
--        SET config_code = b.config_code, config_label = b.config_label,
--            status = b.status, allow_so = b.allow_so, allow_ord = b.allow_ord,
--            default_for_ord = b.default_for_ord,
--            is_variant_default = b.is_variant_default,
--            requires_repacking_before_sale = b.requires_repacking_before_sale,
--            sort_order = b.sort_order
--       FROM public._backup_device_stock_config_20260813 b
--      WHERE c.id = b.id AND b.backup_reason = 'repair_generic_to_std';
-- ============================================================================

BEGIN;

-- 1. Serialise: block concurrent writers of the configuration catalog for the
--    duration of the repair (plain readers are unaffected).
LOCK TABLE public.inventory_stock_configurations IN SHARE ROW EXCLUSIVE MODE;

-- 2. Timestamped backup / audit table.
CREATE TABLE IF NOT EXISTS public._backup_device_stock_config_20260813 (
  LIKE public.inventory_stock_configurations INCLUDING DEFAULTS
);
ALTER TABLE public._backup_device_stock_config_20260813
  ADD COLUMN IF NOT EXISTS backup_reason text,
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public._backup_device_stock_config_20260813 IS
  'Verbatim pre-change copy of Device stock configuration rows repaired by B1 / purged by B2 on 2026-08-13. Audit + manual rollback source; never read by the application.';

DO $repair$
DECLARE
  v_blocked      text;
  v_qty_before   bigint;  v_qty_after   bigint;
  v_alloc_before bigint;  v_alloc_after bigint;
  v_cart_before  text;    v_cart_after  text;
  v_repaired     integer;
BEGIN
  -- 3. Re-resolve the target set INSIDE this transaction (never trust the
  --    precheck's snapshot) and re-run every safety assertion.
  DROP TABLE IF EXISTS _device_variants;
  CREATE TEMP TABLE _device_variants ON COMMIT DROP AS
  SELECT pv.id AS variant_id
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard';

  IF NOT EXISTS (SELECT 1 FROM _device_variants) THEN
    RAISE EXCEPTION 'No Device variants resolved. Refusing to run a repair that targets nothing.'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(sum(quantity_on_hand), 0), COALESCE(sum(quantity_allocated), 0)
    INTO v_qty_before, v_alloc_before FROM public.product_inventory;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_cart_before FROM (
    SELECT c.id::text||':'||c.config_code||':'||c.status||':'||
           COALESCE(c.volume_ml::text,'-')||':'||COALESCE(c.packaging,'-')||':'||
           c.allow_so::text||c.allow_ord::text||c.default_for_ord::text||
           c.is_variant_default::text||c.requires_repacking_before_sale::text||
           c.sort_order::text AS t
    FROM public.inventory_stock_configurations c
    JOIN public.product_variants pv ON pv.id = c.variant_id
    JOIN public.products p          ON p.id = pv.product_id
    JOIN public.product_groups g    ON g.id = p.group_id
    WHERE COALESCE(g.stock_config_profile,'standard') = 'concentration') s;

  -- BLOCKED_DUPLICATE_GENERIC_CONFIG
  SELECT string_agg(format('variant %s has %s generic configs', variant_id, n), '; ')
    INTO v_blocked
  FROM (SELECT c.variant_id, count(*) AS n
        FROM public.inventory_stock_configurations c
        JOIN _device_variants d ON d.variant_id = c.variant_id
        WHERE c.volume_ml IS NULL AND c.packaging IS NULL
        GROUP BY c.variant_id HAVING count(*) > 1) x;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_DUPLICATE_GENERIC_CONFIG: %', v_blocked;
  END IF;

  -- BLOCKED_DUPLICATE_STD (would violate UNIQUE isc_variant_config_code_key)
  SELECT string_agg(format('variant %s already has a separate STD config', c.variant_id), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.volume_ml IS NULL AND c.packaging IS NULL AND c.config_code <> 'STD'
    AND EXISTS (SELECT 1 FROM public.inventory_stock_configurations o
                WHERE o.variant_id = c.variant_id AND o.config_code = 'STD' AND o.id <> c.id);
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_DUPLICATE_STD: %', v_blocked;
  END IF;

  -- UNEXPECTED_STATE (a) no generic row to repair in place
  SELECT string_agg(format('variant %s has no generic config', d.variant_id), '; ')
    INTO v_blocked
  FROM _device_variants d
  WHERE NOT EXISTS (SELECT 1 FROM public.inventory_stock_configurations c
                    WHERE c.variant_id = d.variant_id AND c.volume_ml IS NULL AND c.packaging IS NULL);
  IF v_blocked IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked; END IF;

  -- UNEXPECTED_STATE (b) unrecognised generic code
  SELECT string_agg(format('config %s (variant %s) has unexpected code %s', c.id, c.variant_id, c.config_code), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.volume_ml IS NULL AND c.packaging IS NULL
    AND c.config_code NOT IN ('STD','UNCLASSIFIED');
  IF v_blocked IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked; END IF;

  -- UNEXPECTED_STATE (c) a dimensioned row still owns default_for_ord
  --   (setting it on the generic row would violate index isc_one_ord_default)
  SELECT string_agg(format('config %s (%s, variant %s) still holds default_for_ord', c.id, c.config_code, c.variant_id), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE (c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL) AND c.default_for_ord;
  IF v_blocked IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked; END IF;

  -- UNEXPECTED_STATE (d) a dimensioned row still owns is_variant_default
  --   (would violate index isc_one_variant_default)
  SELECT string_agg(format('variant %s: is_variant_default is held by config %s (%s)', c.variant_id, c.id, c.config_code), '; ')
    INTO v_blocked
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.is_variant_default AND (c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL);
  IF v_blocked IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_STATE: %', v_blocked; END IF;

  -- 4. Back up every row about to change.
  INSERT INTO public._backup_device_stock_config_20260813
  SELECT c.*, 'repair_generic_to_std', now()
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.volume_ml IS NULL AND c.packaging IS NULL
    AND (c.config_code <> 'STD' OR c.config_label <> 'Standard' OR c.status <> 'active'
      OR NOT c.allow_so OR NOT c.allow_ord OR NOT c.default_for_ord
      OR NOT c.is_variant_default OR c.requires_repacking_before_sale OR c.sort_order <> 0);

  -- 5. Repair the SAME row in place, writing the COMPLETE invariant.
  --    stock_sku is intentionally left as-is: it is a business identifier that
  --    is snapshotted into stock_count_session_items.sku and exported, and it
  --    is not part of the required invariant.
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
    AND (c.config_code <> 'STD' OR c.config_label <> 'Standard' OR c.status <> 'active'
      OR NOT c.allow_so OR NOT c.allow_ord OR NOT c.default_for_ord
      OR NOT c.is_variant_default OR c.requires_repacking_before_sale OR c.sort_order <> 0);
  GET DIAGNOSTICS v_repaired = ROW_COUNT;

  -- 6. Verify BEFORE commit. Any failure rolls the whole transaction back.
  IF EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    WHERE c.volume_ml IS NULL AND c.packaging IS NULL
      AND (c.config_code <> 'STD' OR c.config_label <> 'Standard' OR c.status <> 'active'
        OR NOT c.allow_so OR NOT c.allow_ord OR NOT c.default_for_ord
        OR NOT c.is_variant_default OR c.requires_repacking_before_sale OR c.sort_order <> 0)
  ) THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a Device generic configuration is still not a correct active STD row.';
  END IF;

  SELECT COALESCE(sum(quantity_on_hand),0), COALESCE(sum(quantity_allocated),0)
    INTO v_qty_after, v_alloc_after FROM public.product_inventory;
  IF v_qty_after <> v_qty_before OR v_alloc_after <> v_alloc_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: inventory changed (on_hand % -> %, allocated % -> %).',
      v_qty_before, v_qty_after, v_alloc_before, v_alloc_after;
  END IF;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_cart_after FROM (
    SELECT c.id::text||':'||c.config_code||':'||c.status||':'||
           COALESCE(c.volume_ml::text,'-')||':'||COALESCE(c.packaging,'-')||':'||
           c.allow_so::text||c.allow_ord::text||c.default_for_ord::text||
           c.is_variant_default::text||c.requires_repacking_before_sale::text||
           c.sort_order::text AS t
    FROM public.inventory_stock_configurations c
    JOIN public.product_variants pv ON pv.id = c.variant_id
    JOIN public.products p          ON p.id = pv.product_id
    JOIN public.product_groups g    ON g.id = p.group_id
    WHERE COALESCE(g.stock_config_profile,'standard') = 'concentration') s;
  IF v_cart_after IS DISTINCT FROM v_cart_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a Cartridge (concentration) configuration was modified.';
  END IF;

  RAISE NOTICE 'Device STD repair: % configuration row(s) repaired in place.', v_repaired;
END
$repair$;

-- ----------------------------------------------------------------------------
-- 7. Recurrence guard (requirement 7)
-- ----------------------------------------------------------------------------
-- `assert_stock_config_group_eligibility()` (20260727) already rejects a
-- concentration row on a non-'concentration' group, but only on the INSERT — by
-- which point this function has ALREADY rewritten the variant's STD row into
-- UNCLASSIFIED/phase_out. Fail fast, before any mutation, naming the profile.
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

  -- Both supported profiles create at least the 20NB concentration row, so the
  -- whole call is invalid for a group that is not a flavour/Cartridge group.
  -- Raising HERE is what stops a Device STD from ever becoming UNCLASSIFIED.
  SELECT g.stock_config_profile
  INTO v_group_profile
  FROM public.product_variants pv
  JOIN public.products p            ON p.id = pv.product_id
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

-- ----------------------------------------------------------------------------
-- 8. Affected rows — exactly what changed (before -> after), still in-transaction
-- ----------------------------------------------------------------------------
SELECT
  p.product_name,
  pv.variant_name,
  b.id AS stock_config_id,
  b.config_code   AS before_config_code, c.config_code   AS after_config_code,
  b.config_label  AS before_config_label, c.config_label AS after_config_label,
  b.status        AS before_status,      c.status        AS after_status,
  b.allow_so      AS before_allow_so,    c.allow_so      AS after_allow_so,
  b.allow_ord     AS before_allow_ord,   c.allow_ord     AS after_allow_ord,
  b.default_for_ord AS before_default_for_ord, c.default_for_ord AS after_default_for_ord,
  b.is_variant_default AS before_is_variant_default, c.is_variant_default AS after_is_variant_default,
  b.requires_repacking_before_sale AS before_repack, c.requires_repacking_before_sale AS after_repack,
  b.sort_order    AS before_sort_order,  c.sort_order    AS after_sort_order,
  c.stock_sku,
  (SELECT COALESCE(sum(pi.quantity_on_hand),0) FROM public.product_inventory pi WHERE pi.stock_config_id = c.id) AS on_hand_unchanged
FROM public._backup_device_stock_config_20260813 b
JOIN public.inventory_stock_configurations c ON c.id = b.id
JOIN public.product_variants pv ON pv.id = c.variant_id
JOIN public.products p          ON p.id = pv.product_id
WHERE b.backup_reason = 'repair_generic_to_std'
  -- Only what THIS run changed (backed_up_at defaults to transaction_timestamp),
  -- so a repeat run correctly reports an empty change set.
  AND b.backed_up_at = transaction_timestamp()
ORDER BY p.product_name, pv.variant_name;

COMMIT;
