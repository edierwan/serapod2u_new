-- Fix v_admin_redemptions to handle 3-level hierarchy (Shop -> Distributor -> HQ)
-- This ensures that HQ admins can see redemptions from shops under distributors.
-- Also fixes missing shop phone number by falling back to user phone or transaction phone.

DROP VIEW IF EXISTS public.v_admin_redemptions;

CREATE OR REPLACE VIEW public.v_admin_redemptions AS
SELECT 
    pt.id,
    pt.transaction_date AS redeemed_at,
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
    -- Determine the top-level company ID (HQ)
    -- If shop has a parent (Distributor), and Distributor has a parent (HQ), use HQ.
    -- If shop has a parent (HQ/Distributor) but that parent has no parent, use the parent.
    -- If shop has no parent, use shop ID.
    COALESCE(parent_org.parent_org_id, shop_org.parent_org_id, shop_org.id) AS company_id,
    -- Reward details
    ri.id AS reward_id,
    ri.item_name AS reward_name,
    ri.item_code AS reward_code,
    ri.item_image_url AS reward_image_url,
    ri.points_required,
    -- Shop organization details
    shop_org.org_name AS shop_name,
    COALESCE(shop_org.contact_phone, u.phone, pt.consumer_phone) AS shop_phone,
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
-- Join to get the parent organization (Distributor or HQ)
LEFT JOIN public.organizations parent_org ON parent_org.id = shop_org.parent_org_id
LEFT JOIN public.users u ON u.phone = pt.consumer_phone OR u.email = pt.consumer_email
LEFT JOIN public.users fb ON fb.id = pt.fulfilled_by
WHERE pt.transaction_type = 'redeem'
ORDER BY pt.transaction_date DESC;

-- Grant access to the view
GRANT SELECT ON public.v_admin_redemptions TO authenticated;

COMMENT ON VIEW public.v_admin_redemptions IS 'Admin view of all redemptions showing shop details and fulfillment status. Includes company_id for filtering by top-level organization (HQ).';
