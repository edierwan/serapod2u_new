-- Add evidence_urls column to stock_movements
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS evidence_urls text[];

-- Update record_stock_movement function to accept evidence_urls
CREATE OR REPLACE FUNCTION public.record_stock_movement(
    p_movement_type text,
    p_variant_id uuid,
    p_organization_id uuid,
    p_quantity_change integer,
    p_unit_cost numeric DEFAULT NULL::numeric,
    p_manufacturer_id uuid DEFAULT NULL::uuid,
    p_warehouse_location text DEFAULT NULL::text,
    p_reason text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_reference_type text DEFAULT 'manual'::text,
    p_reference_id uuid DEFAULT NULL::uuid,
    p_reference_no text DEFAULT NULL::text,
    p_company_id uuid DEFAULT NULL::uuid,
    p_created_by uuid DEFAULT NULL::uuid,
    p_evidence_urls text[] DEFAULT NULL::text[]
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_movement_id UUID;
    v_current_qty INTEGER;
    v_new_qty INTEGER;
    v_inventory_id UUID;
    v_company_id UUID;
    v_from_org UUID := NULL;
    v_to_org UUID := NULL;
BEGIN
    -- Determine direction of movement for org columns
    IF p_quantity_change < 0 THEN
        v_from_org := p_organization_id;
    ELSE
        v_to_org := p_organization_id;
    END IF;

    -- Get company_id if not provided
    IF p_company_id IS NULL THEN
        SELECT get_company_id(p_organization_id) INTO v_company_id;
    ELSE
        v_company_id := p_company_id;
    END IF;

    -- Get current inventory record
    SELECT id, quantity_on_hand INTO v_inventory_id, v_current_qty
    FROM public.product_inventory
    WHERE variant_id = p_variant_id
      AND organization_id = p_organization_id
      AND is_active = true;

    -- If no inventory record exists, create one
    IF v_inventory_id IS NULL THEN
        INSERT INTO public.product_inventory (
            variant_id,
            organization_id,
            quantity_on_hand,
            quantity_allocated,
            warehouse_location,
            average_cost,
            created_at,
            updated_at
        ) VALUES (
            p_variant_id,
            p_organization_id,
            0,
            0,
            p_warehouse_location,
            p_unit_cost,
            NOW(),
            NOW()
        ) RETURNING id, quantity_on_hand INTO v_inventory_id, v_current_qty;
    END IF;

    -- Calculate new quantity
    v_new_qty := v_current_qty + p_quantity_change;

    -- Ensure quantity doesn't go negative
    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'Insufficient stock. Current: %, Requested change: %', v_current_qty, p_quantity_change;
    END IF;

    -- Create movement record
    INSERT INTO public.stock_movements (
        movement_type,
        reference_type,
        reference_id,
        reference_no,
        variant_id,
        from_organization_id,
        to_organization_id,
        quantity_change,
        quantity_before,
        quantity_after,
        unit_cost,
        manufacturer_id,
        warehouse_location,
        reason,
        notes,
        company_id,
        created_by,
        created_at,
        evidence_urls
    ) VALUES (
        p_movement_type,
        p_reference_type,
        p_reference_id,
        p_reference_no,
        p_variant_id,
        v_from_org,
        v_to_org,
        p_quantity_change,
        v_current_qty,
        v_new_qty,
        p_unit_cost,
        p_manufacturer_id,
        p_warehouse_location,
        p_reason,
        p_notes,
        v_company_id,
        p_created_by,
        NOW(),
        p_evidence_urls
    ) RETURNING id INTO v_movement_id;

    -- Update inventory
    UPDATE public.product_inventory
    SET
        quantity_on_hand = v_new_qty,
        warehouse_location = COALESCE(p_warehouse_location, warehouse_location),
        average_cost = CASE
            WHEN p_unit_cost IS NOT NULL AND p_quantity_change > 0 THEN
                ((COALESCE(average_cost, 0) * v_current_qty) + (p_unit_cost * p_quantity_change)) / NULLIF(v_new_qty, 0)
            ELSE
                COALESCE(average_cost, p_unit_cost)
        END,
        updated_at = NOW()
    WHERE id = v_inventory_id;

    RETURN v_movement_id;
END;
$$;
