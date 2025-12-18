-- Combined Migration: Fix Redemption History Issues
-- Run this file to fix all redemption history and code generation issues
-- Date: 2025-12-19

-- ============================================================================
-- PART 1: Fix Admin Redemptions View (Issue #1)
-- ============================================================================
-- Fix the v_admin_redemptions view to show all redemptions for a company
-- by checking parent_org_id. This allows admin to see redemptions from all shops.

DROP VIEW IF EXISTS public.v_admin_redemptions;

CREATE OR REPLACE VIEW public.v_admin_redemptions AS
SELECT 
    pt.id,
    pt.transaction_date AS redeemed_at,  -- Renamed for consistency
    pt.created_at,
    pt.points_amount,
    pt.balance_after,
    pt.description,
    pt.redemption_code,
    pt.fulfillment_status,
    pt.fulfilled_by,
    pt.fulfilled_at,
    pt.fulfillment_notes,
    pt.company_id AS shop_id,
    -- Company/HQ ID (parent organization) - THIS IS THE KEY FIX
    COALESCE(shop_org.parent_org_id, shop_org.id) AS company_id,
    -- Reward details
    ri.id AS reward_id,
    ri.item_name AS reward_name,
    ri.item_code AS reward_code,
    ri.item_image_url AS reward_image_url,
    ri.points_required,
    -- Shop organization details
    shop_org.org_name AS shop_name,
    shop_org.contact_phone AS shop_phone,
    shop_org.contact_email AS shop_email,
    shop_org.address AS shop_address,
    shop_org.address_line2 AS shop_address_line2,
    shop_org.city AS shop_city,
    shop_org.state_id AS shop_state_id,
    shop_org.postal_code AS shop_postal_code,
    -- User who made redemption (shop staff)
    u.id AS staff_user_id,
    u.full_name AS staff_name,
    u.email AS staff_email,
    u.phone AS staff_phone,
    -- Fulfilled by user details
    fb.full_name AS fulfilled_by_name,
    fb.email AS fulfilled_by_email
FROM public.points_transactions pt
LEFT JOIN public.redeem_items ri ON ri.id = pt.redeem_item_id
LEFT JOIN public.organizations shop_org ON shop_org.id = pt.company_id
LEFT JOIN public.users u ON u.phone = pt.consumer_phone OR u.email = pt.consumer_email
LEFT JOIN public.users fb ON fb.id = pt.fulfilled_by
WHERE pt.transaction_type = 'redeem'
ORDER BY pt.transaction_date DESC;

-- Grant access to the view
GRANT SELECT ON public.v_admin_redemptions TO authenticated;

COMMENT ON VIEW public.v_admin_redemptions IS 'Admin view of all redemptions showing shop details and fulfillment status. Includes company_id for filtering by parent organization.';

-- ============================================================================
-- PART 2: Auto-generate Redemption Codes (Issue #3)
-- ============================================================================
-- Add trigger to automatically generate redemption codes for new redemptions

-- Create trigger function to generate redemption code
CREATE OR REPLACE FUNCTION public.generate_redemption_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only generate code for redemption transactions if not already set
    IF NEW.transaction_type = 'redeem' AND (NEW.redemption_code IS NULL OR NEW.redemption_code = '') THEN
        NEW.redemption_code := 'RED-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT FROM 1 FOR 8));
    END IF;
    
    -- Set default fulfillment_status if not set for redemptions
    IF NEW.transaction_type = 'redeem' AND NEW.fulfillment_status IS NULL THEN
        NEW.fulfillment_status := 'pending';
    END IF;
    
    RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS tr_generate_redemption_code ON public.points_transactions;

-- Create trigger
CREATE TRIGGER tr_generate_redemption_code
    BEFORE INSERT ON public.points_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_redemption_code();

-- Update any existing records that don't have redemption codes
UPDATE public.points_transactions
SET redemption_code = 'RED-' || UPPER(SUBSTRING(id::TEXT FROM 1 FOR 8))
WHERE transaction_type = 'redeem' 
AND (redemption_code IS NULL OR redemption_code = '');

-- Ensure fulfillment_status is set for existing records
UPDATE public.points_transactions
SET fulfillment_status = 'pending'
WHERE transaction_type = 'redeem' 
AND fulfillment_status IS NULL;

COMMENT ON FUNCTION public.generate_redemption_code IS 'Automatically generates redemption codes and sets default fulfillment status for redemption transactions';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these queries after migration to verify everything works:

-- 1. Check if redemption codes were generated
-- SELECT COUNT(*) as total_redemptions,
--        COUNT(redemption_code) as with_codes,
--        COUNT(*) - COUNT(redemption_code) as missing_codes
-- FROM points_transactions
-- WHERE transaction_type = 'redeem';

-- 2. View sample redemptions with shop details
-- SELECT company_id, shop_name, reward_name, redemption_code, fulfillment_status, redeemed_at
-- FROM v_admin_redemptions
-- ORDER BY redeemed_at DESC
-- LIMIT 10;

-- 3. Test the trigger by inserting a test redemption (DON'T RUN THIS IN PRODUCTION)
-- INSERT INTO points_transactions (company_id, transaction_type, points_amount, transaction_date)
-- VALUES ('some-shop-id', 'redeem', -100, NOW());
-- Then check if redemption_code and fulfillment_status were set automatically

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
