-- Migration: Auto-create stock_adjustment from stock_movement
-- This ensures that when a stock movement is recorded with 'Quality Issue' or 'Return to Supplier',
-- a corresponding stock_adjustment record is created for the Manufacturer Portal.

BEGIN;

-- 1. Ensure tables exist
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  reason_id uuid,
  notes text,
  proof_images text[],
  status text DEFAULT 'pending'::text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  target_manufacturer_org_id uuid,
  manufacturer_status text DEFAULT 'pending'::text,
  manufacturer_assigned_at timestamp with time zone,
  manufacturer_acknowledged_by uuid,
  manufacturer_acknowledged_at timestamp with time zone,
  manufacturer_notes text,
  CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.stock_adjustment_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  adjustment_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity_change integer NOT NULL,
  unit_cost numeric,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stock_adjustment_items_pkey PRIMARY KEY (id),
  CONSTRAINT fk_stock_adjustment_items_adjustment FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE
);

-- 2. Create Trigger Function
CREATE OR REPLACE FUNCTION public.auto_create_stock_adjustment_from_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  -- Get reason_id and code
  SELECT id, reason_code INTO v_reason_id, v_reason_code
  FROM public.stock_adjustment_reasons
  WHERE reason_name = NEW.reason OR reason_code = NEW.reason
  LIMIT 1;

  -- If not a quality/return issue, ignore
  IF v_reason_code NOT IN ('quality_issue', 'return_to_supplier') THEN
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
$$;

-- 3. Create Trigger
DROP TRIGGER IF EXISTS trg_auto_create_stock_adjustment ON public.stock_movements;

CREATE TRIGGER trg_auto_create_stock_adjustment
AFTER INSERT ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_stock_adjustment_from_movement();

COMMIT;
