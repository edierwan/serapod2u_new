-- Migration: Fix ambiguous record_stock_movement function
-- Drops the old signature of record_stock_movement that causes ambiguity with the new one accepting evidence_urls

DROP FUNCTION IF EXISTS public.record_stock_movement(
    text, -- p_movement_type
    uuid, -- p_variant_id
    uuid, -- p_organization_id
    integer, -- p_quantity_change
    numeric, -- p_unit_cost
    uuid, -- p_manufacturer_id
    text, -- p_warehouse_location
    text, -- p_reason
    text, -- p_notes
    text, -- p_reference_type
    uuid, -- p_reference_id
    text, -- p_reference_no
    uuid, -- p_company_id
    uuid -- p_created_by
);
