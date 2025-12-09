-- Migration: 064_get_journey_qr_count.sql

CREATE OR REPLACE FUNCTION get_journey_qr_count(p_journey_config_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
    v_order_id UUID;
BEGIN
    -- 1. Try to find Order ID from journey_order_links (Best Method)
    SELECT order_id INTO v_order_id 
    FROM journey_order_links 
    WHERE journey_config_id = p_journey_config_id
    LIMIT 1;

    -- 2. If not found, try heuristic match (Fallback)
    IF v_order_id IS NULL THEN
        SELECT id INTO v_order_id 
        FROM orders 
        WHERE (SELECT name FROM journey_configurations WHERE id = p_journey_config_id) LIKE '%' || order_no || '%'
        LIMIT 1;
    END IF;

    IF v_order_id IS NOT NULL THEN
        -- Count QR codes for this order
        SELECT COUNT(*) INTO v_count FROM qr_codes WHERE order_id = v_order_id;
    ELSE
        v_count := 0;
    END IF;

    RETURN v_count;
END;
$$;
