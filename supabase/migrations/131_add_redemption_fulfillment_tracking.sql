-- Migration: 131_add_redemption_fulfillment_tracking.sql
-- Add fulfillment tracking fields to points_transactions table for admin redemption management

-- Add fulfillment status and tracking columns to points_transactions
ALTER TABLE public.points_transactions
ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'processing', 'fulfilled', 'cancelled')),
ADD COLUMN IF NOT EXISTS fulfilled_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT,
ADD COLUMN IF NOT EXISTS redemption_code TEXT;

-- Create index for faster queries on redemption transactions
CREATE INDEX IF NOT EXISTS idx_points_transactions_redeem_type 
ON public.points_transactions(transaction_type) 
WHERE transaction_type = 'redeem';

CREATE INDEX IF NOT EXISTS idx_points_transactions_fulfillment_status 
ON public.points_transactions(fulfillment_status) 
WHERE transaction_type = 'redeem';

-- Add comments for documentation
COMMENT ON COLUMN public.points_transactions.fulfillment_status IS 'Status of redemption fulfillment: pending, processing, fulfilled, cancelled';
COMMENT ON COLUMN public.points_transactions.fulfilled_by IS 'User ID of admin who fulfilled the redemption';
COMMENT ON COLUMN public.points_transactions.fulfilled_at IS 'Timestamp when redemption was fulfilled';
COMMENT ON COLUMN public.points_transactions.fulfillment_notes IS 'Notes added by admin during fulfillment';
COMMENT ON COLUMN public.points_transactions.redemption_code IS 'Unique redemption code for tracking (e.g., RED-XXXXXXXX)';

-- Create a view for admin redemption management with all necessary shop details
CREATE OR REPLACE VIEW public.v_admin_redemptions AS
SELECT 
    pt.id,
    pt.transaction_date,
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
    shop_org.address_line1 AS shop_address_line1,
    shop_org.address_line2 AS shop_address_line2,
    shop_org.city AS shop_city,
    shop_org.state AS shop_state,
    shop_org.postal_code AS shop_postal_code,
    shop_org.country AS shop_country,
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

-- Create RPC function to update redemption fulfillment status
CREATE OR REPLACE FUNCTION public.update_redemption_fulfillment(
    p_transaction_id UUID,
    p_status TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_result JSON;
BEGIN
    -- Get the current user ID
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'User not authenticated');
    END IF;
    
    -- Validate status
    IF p_status NOT IN ('pending', 'processing', 'fulfilled', 'cancelled') THEN
        RETURN json_build_object('success', false, 'error', 'Invalid status. Must be: pending, processing, fulfilled, or cancelled');
    END IF;
    
    -- Update the transaction
    UPDATE public.points_transactions
    SET 
        fulfillment_status = p_status,
        fulfilled_by = CASE WHEN p_status IN ('fulfilled', 'cancelled') THEN v_user_id ELSE fulfilled_by END,
        fulfilled_at = CASE WHEN p_status IN ('fulfilled', 'cancelled') THEN NOW() ELSE fulfilled_at END,
        fulfillment_notes = COALESCE(p_notes, fulfillment_notes)
    WHERE id = p_transaction_id
    AND transaction_type = 'redeem';
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Redemption transaction not found');
    END IF;
    
    RETURN json_build_object(
        'success', true, 
        'message', 'Fulfillment status updated successfully',
        'status', p_status,
        'updated_by', v_user_id
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.update_redemption_fulfillment(UUID, TEXT, TEXT) TO authenticated;

-- Update existing redemption transactions to have 'pending' status and generate redemption codes
UPDATE public.points_transactions
SET 
    fulfillment_status = 'pending',
    redemption_code = 'RED-' || UPPER(SUBSTRING(id::TEXT FROM 1 FOR 8))
WHERE transaction_type = 'redeem' 
AND fulfillment_status IS NULL;
