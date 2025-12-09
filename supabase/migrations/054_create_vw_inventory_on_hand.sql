-- Migration: 054_create_vw_inventory_on_hand.sql
-- Description: Create view for inventory on hand to fix 404 error and support inventory listing

CREATE OR REPLACE VIEW vw_inventory_on_hand AS
SELECT
    pi.id,
    pi.variant_id,
    pi.organization_id,
    pi.quantity_on_hand,
    pi.quantity_allocated,
    pi.quantity_available,
    pi.reorder_point,
    pi.reorder_quantity,
    pi.max_stock_level,
    pi.safety_stock,
    pi.lead_time_days,
    pi.average_cost,
    pi.total_value,
    pi.warehouse_location,
    pv.variant_code,
    pv.variant_name,
    pv.image_url as variant_image_url,
    p.id as product_id,
    p.product_name,
    p.product_code,
    o.org_name as organization_name,
    o.org_code as organization_code
FROM product_inventory pi
JOIN product_variants pv ON pi.variant_id = pv.id
JOIN products p ON pv.product_id = p.id
JOIN organizations o ON pi.organization_id = o.id
WHERE pi.is_active = true;
