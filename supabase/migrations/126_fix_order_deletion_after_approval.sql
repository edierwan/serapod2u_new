-- Migration: Fix Order Deletion After Approval
-- Description:
-- When deleting an order that has been approved, the system was trying to release
-- allocation that had already been released during fulfillment, causing
-- quantity_allocated to go negative and violate the valid_quantities constraint.
--
-- Fix: Only release allocation if the order is being cancelled from 'submitted' status.
-- If it was approved, the allocation was already released during fulfillment.

CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        -- D2H and S2D: Release allocation only if order was NOT yet fulfilled
        -- If order was 'submitted', allocation exists and needs to be released
        -- If order was 'approved', allocation was already released during fulfillment
        IF NEW.order_type IN ('D2H', 'S2D') AND OLD.status = 'submitted' THEN
             PERFORM public.release_allocation_for_order(NEW.id);
        END IF;
    END IF;

    IF NEW.status = 'shipped_distributor' AND OLD.status != 'shipped_distributor' THEN
        IF NEW.order_type IN ('D2H', 'S2D') THEN
             NULL; 
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.handle_order_status_change() IS 'Handles order status changes: releases allocation on cancel for D2H/S2D orders ONLY if not yet fulfilled (submitted status).';
