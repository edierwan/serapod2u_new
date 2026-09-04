-- ============================================================================
-- auto_create_stock_adjustment_from_movement: skip when the reason is unknown
-- ----------------------------------------------------------------------------
-- The trigger creates a stock_adjustments header from a stock movement whose
-- reason is a quality issue or a return to supplier. It looked the reason up in
-- stock_adjustment_reasons and then guarded with:
--
--     IF v_reason_code NOT IN ('quality_issue', 'return_to_supplier') THEN
--       RETURN NEW;
--
-- carrying the comment "If v_reason_code is NULL, this condition is NULL
-- (false), so it skips." The comment describes the intent; the code does the
-- opposite. `NULL NOT IN (...)` is NULL, NULL is not true, so the IF does not
-- fire, control falls through, and a pending adjustment header is created for
-- ANY movement whose reason text matches no reason row at all.
--
-- That is where the unexplained pending adjustments came from. Production
-- carried 195 and staging 177 — none raised by a person, each mirroring a
-- movement posted by some other workflow. The legacy configuration cutover made
-- it unmissable by generating 481 in a single transaction (its retirement
-- reason, "Legacy configuration retired to zero …", matches no reason row),
-- which then blocked its own deactivation step through the cutover preflight.
--
-- The fix is the missing IS NULL arm. Behaviour for a recognised quality or
-- return reason is unchanged; only the unknown-reason path now skips, exactly
-- as the original comment always claimed it did.
--
-- The body below is the current definition — byte-identical in staging and
-- production — with that one guard changed.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_create_stock_adjustment_from_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_reason_id uuid;
  v_manufacturer_id uuid;
  v_adjustment_id uuid;
  v_reason_code text;
BEGIN
  -- Check if reason is relevant
  IF NEW.reason IS NULL THEN
    RETURN NEW;
  END IF;

  -- Explicitly ignore warehouse_receive
  IF NEW.reason = 'warehouse_receive' THEN
    RETURN NEW;
  END IF;

  -- If from_organization_id is NULL (e.g. addition), we can't create an adjustment record
  -- that requires organization_id (which maps to from_organization_id).
  IF NEW.from_organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get reason_id and code
  SELECT id, reason_code INTO v_reason_id, v_reason_code
  FROM public.stock_adjustment_reasons
  WHERE reason_name = NEW.reason OR reason_code = NEW.reason
  LIMIT 1;

  -- If not a quality/return issue, ignore.
  -- The IS NULL arm is the fix: when NEW.reason matches no row in
  -- stock_adjustment_reasons, v_reason_code is NULL and
  -- `NULL NOT IN (...)` evaluates to NULL, which is not true, so control fell
  -- THROUGH and an adjustment was created for a movement that has nothing to
  -- do with a quality issue. The original comment here asserted the opposite.
  IF v_reason_code IS NULL
     OR v_reason_code NOT IN ('quality_issue', 'return_to_supplier') THEN
    RETURN NEW;
  END IF;

  -- Determine manufacturer
  v_manufacturer_id := NEW.manufacturer_id;

  IF v_manufacturer_id IS NULL THEN
    -- Try to find from variant -> product -> manufacturer
    -- Using a safe approach with exception handling in case tables differ
    BEGIN
        SELECT p.manufacturer_id INTO v_manufacturer_id
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = NEW.variant_id;
    EXCEPTION WHEN OTHERS THEN
        -- Ignore errors if tables don't exist or schema differs
        NULL;
    END;
  END IF;

  -- Create stock_adjustment header
  INSERT INTO public.stock_adjustments (
    organization_id,
    reason_id,
    notes,
    proof_images,
    status,
    created_by,
    target_manufacturer_org_id,
    manufacturer_status,
    manufacturer_assigned_at
  ) VALUES (
    NEW.from_organization_id, -- For adjustment (negative), it's from.
    v_reason_id,
    NEW.notes,
    NEW.evidence_urls,
    'pending',
    NEW.created_by,
    v_manufacturer_id,
    'pending',
    CASE WHEN v_manufacturer_id IS NOT NULL THEN now() ELSE NULL END
  ) RETURNING id INTO v_adjustment_id;

  -- Create stock_adjustment_item
  -- Note: stock_adjustment_items table has columns: system_quantity, physical_quantity, adjustment_quantity
  INSERT INTO public.stock_adjustment_items (
    adjustment_id,
    variant_id,
    system_quantity,
    physical_quantity,
    adjustment_quantity,
    unit_cost
  ) VALUES (
    v_adjustment_id,
    NEW.variant_id,
    COALESCE(NEW.quantity_before, 0),
    COALESCE(NEW.quantity_after, 0),
    NEW.quantity_change,
    NEW.unit_cost
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.auto_create_stock_adjustment_from_movement() IS
  'Creates a stock_adjustments header from a movement whose reason is a quality_issue or return_to_supplier. Skips movements whose reason matches no stock_adjustment_reasons row: before 20260904140000 those fell through a NULL comparison and produced spurious pending adjustments.';

COMMIT;
