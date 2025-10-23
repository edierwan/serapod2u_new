-- =====================================================
-- INVENTORY STOCK MOVEMENTS & ADJUSTMENTS
-- Migration: 20251023_inventory_stock_movements
-- Purpose: Track all stock additions, adjustments, transfers
-- Author: System
-- Date: 2025-10-23
-- =====================================================

-- =====================================================
-- 1. STOCK MOVEMENTS TABLE (Audit Trail)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    
    -- Movement Details
    movement_type TEXT NOT NULL CHECK (movement_type IN ('addition', 'adjustment', 'transfer_out', 'transfer_in', 'allocation', 'deallocation', 'order_fulfillment', 'order_cancelled')),
    reference_type TEXT CHECK (reference_type IN ('manual', 'order', 'transfer', 'adjustment', 'purchase_order', 'return')),
    reference_id UUID, -- Links to orders, transfers, etc.
    reference_no TEXT, -- Human-readable reference (e.g., order number)
    
    -- Product & Location
    variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    from_organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    to_organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Quantity Changes
    quantity_change INTEGER NOT NULL, -- Positive for additions, negative for deductions
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    
    -- Cost Tracking
    unit_cost NUMERIC(12,2),
    total_cost NUMERIC(15,2) GENERATED ALWAYS AS (ABS(quantity_change)::NUMERIC * COALESCE(unit_cost, 0)) STORED,
    
    -- Additional Context
    manufacturer_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL, -- For stock additions
    warehouse_location TEXT,
    reason TEXT,
    notes TEXT,
    
    -- Metadata
    company_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_movement_direction CHECK (
        (movement_type = 'transfer_out' AND from_organization_id IS NOT NULL) OR
        (movement_type = 'transfer_in' AND to_organization_id IS NOT NULL) OR
        (movement_type NOT IN ('transfer_out', 'transfer_in'))
    ),
    CONSTRAINT valid_quantity_change CHECK (
        (movement_type IN ('addition', 'transfer_in', 'deallocation', 'order_cancelled') AND quantity_change > 0) OR
        (movement_type IN ('adjustment') AND quantity_change != 0) OR
        (movement_type IN ('transfer_out', 'allocation', 'order_fulfillment') AND quantity_change < 0)
    )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON public.stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_from_org ON public.stock_movements(from_organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_to_org ON public.stock_movements(to_organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON public.stock_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_company ON public.stock_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON public.stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_manufacturer ON public.stock_movements(manufacturer_id) WHERE manufacturer_id IS NOT NULL;

-- Comments
COMMENT ON TABLE public.stock_movements IS 'Complete audit trail of all inventory movements';
COMMENT ON COLUMN public.stock_movements.movement_type IS 'Type of stock movement: addition, adjustment, transfer, allocation, fulfillment';
COMMENT ON COLUMN public.stock_movements.quantity_change IS 'Positive for increases, negative for decreases';
COMMENT ON COLUMN public.stock_movements.manufacturer_id IS 'Tracks which manufacturer supplied the stock (for additions)';

-- =====================================================
-- 2. STOCK ADJUSTMENT REASONS (Optional Lookup)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.stock_adjustment_reasons (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    reason_code TEXT NOT NULL UNIQUE,
    reason_name TEXT NOT NULL,
    reason_description TEXT,
    requires_approval BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert common adjustment reasons
INSERT INTO public.stock_adjustment_reasons (reason_code, reason_name, reason_description, requires_approval) VALUES
('physical_count', 'Physical Count Adjustment', 'Adjustment based on physical inventory count', false),
('damaged_goods', 'Damaged Goods', 'Stock damaged and needs to be written off', false),
('expired_goods', 'Expired Goods', 'Stock expired and removed from inventory', false),
('theft_loss', 'Theft or Loss', 'Stock lost due to theft or unaccounted loss', true),
('found_stock', 'Found Stock', 'Previously unaccounted stock found during audit', false),
('system_correction', 'System Correction', 'Correction of system error', true),
('quality_issue', 'Quality Issue', 'Stock removed due to quality issues', false),
('return_to_supplier', 'Return to Supplier', 'Stock returned to manufacturer/supplier', false)
ON CONFLICT (reason_code) DO NOTHING;

-- =====================================================
-- 3. STOCK TRANSFERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.stock_transfers (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    transfer_no TEXT NOT NULL UNIQUE,
    
    -- Transfer Details
    from_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    to_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'received', 'cancelled')),
    
    -- Items (stored as JSONB for simplicity)
    items JSONB NOT NULL DEFAULT '[]'::JSONB,
    -- Structure: [{"variant_id": "uuid", "variant_name": "string", "quantity": 123, "cost": 12.50}]
    
    total_items INTEGER DEFAULT 0,
    total_value NUMERIC(15,2) DEFAULT 0,
    
    -- Tracking
    shipped_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Metadata
    notes TEXT,
    company_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    received_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT no_self_transfer CHECK (from_organization_id != to_organization_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON public.stock_transfers(from_organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON public.stock_transfers(to_organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON public.stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_company ON public.stock_transfers(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_transfer_no ON public.stock_transfers(transfer_no);

COMMENT ON TABLE public.stock_transfers IS 'Stock transfer orders between warehouses/organizations';

-- =====================================================
-- 4. FUNCTION: Record Stock Movement
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_stock_movement(
    p_movement_type TEXT,
    p_variant_id UUID,
    p_organization_id UUID,
    p_quantity_change INTEGER,
    p_unit_cost NUMERIC DEFAULT NULL,
    p_manufacturer_id UUID DEFAULT NULL,
    p_warehouse_location TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_reference_type TEXT DEFAULT 'manual',
    p_reference_id UUID DEFAULT NULL,
    p_reference_no TEXT DEFAULT NULL,
    p_company_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_movement_id UUID;
    v_current_qty INTEGER;
    v_new_qty INTEGER;
    v_inventory_id UUID;
    v_company_id UUID;
BEGIN
    -- Get company_id if not provided
    IF p_company_id IS NULL THEN
        SELECT company_id INTO v_company_id FROM public.organizations WHERE id = p_organization_id;
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
            company_id,
            created_at,
            updated_at
        ) VALUES (
            p_variant_id,
            p_organization_id,
            0,
            0,
            p_warehouse_location,
            p_unit_cost,
            v_company_id,
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
        created_at
    ) VALUES (
        p_movement_type,
        p_reference_type,
        p_reference_id,
        p_reference_no,
        p_variant_id,
        p_organization_id,
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
        NOW()
    ) RETURNING id INTO v_movement_id;

    -- Update inventory
    UPDATE public.product_inventory
    SET 
        quantity_on_hand = v_new_qty,
        warehouse_location = COALESCE(p_warehouse_location, warehouse_location),
        average_cost = CASE 
            WHEN p_unit_cost IS NOT NULL AND p_quantity_change > 0 THEN
                -- Weighted average for additions
                ((COALESCE(average_cost, 0) * v_current_qty) + (p_unit_cost * p_quantity_change)) / NULLIF(v_new_qty, 0)
            ELSE
                COALESCE(average_cost, p_unit_cost)
        END,
        updated_at = NOW()
    WHERE id = v_inventory_id;

    RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_stock_movement IS 'Records stock movement and updates product_inventory atomically';

-- =====================================================
-- 5. FUNCTION: Generate Transfer Number
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_transfer_number()
RETURNS TEXT AS $$
DECLARE
    v_year TEXT;
    v_month TEXT;
    v_sequence INTEGER;
    v_transfer_no TEXT;
BEGIN
    v_year := TO_CHAR(NOW(), 'YY');
    v_month := TO_CHAR(NOW(), 'MM');
    
    -- Get next sequence for this month
    SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_no FROM 8 FOR 4) AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM public.stock_transfers
    WHERE transfer_no LIKE 'ST' || v_year || v_month || '%';
    
    v_transfer_no := 'ST' || v_year || v_month || LPAD(v_sequence::TEXT, 4, '0');
    
    RETURN v_transfer_no;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustment_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

-- Stock Movements: All authenticated users can view, HQ can modify
CREATE POLICY "stock_movements_view_all" ON public.stock_movements
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "stock_movements_insert_hq" ON public.stock_movements
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            WHERE u.id = auth.uid()
              AND o.org_type_code = 'HQ'
        )
    );

-- Adjustment Reasons: Read-only for all
CREATE POLICY "adjustment_reasons_view_all" ON public.stock_adjustment_reasons
    FOR SELECT TO authenticated
    USING (is_active = true);

-- Stock Transfers: HQ can manage
CREATE POLICY "stock_transfers_view_all" ON public.stock_transfers
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "stock_transfers_manage_hq" ON public.stock_transfers
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            WHERE u.id = auth.uid()
              AND o.org_type_code = 'HQ'
        )
    );

-- =====================================================
-- 7. TRIGGERS
-- =====================================================

-- Auto-update updated_at on stock_transfers
CREATE OR REPLACE FUNCTION public.update_stock_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stock_transfers_updated_at
    BEFORE UPDATE ON public.stock_transfers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_stock_transfers_updated_at();

-- =====================================================
-- 8. GRANT PERMISSIONS
-- =====================================================
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT INSERT ON public.stock_movements TO authenticated;
GRANT SELECT ON public.stock_adjustment_reasons TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stock_transfers TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
