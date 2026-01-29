-- Add consumer_location to v_consumer_points_balance view
-- This migration adds the location field from users table to the consumer points view

DROP VIEW IF EXISTS public.v_consumer_points_balance;

CREATE OR REPLACE VIEW public.v_consumer_points_balance AS
WITH scan_points AS (
    SELECT 
        cqs.consumer_id,
        SUM(cqs.points_amount) as total_earned,
        COUNT(*) as scan_count,
        MAX(cqs.scanned_at) as last_scan_at
    FROM public.consumer_qr_scans cqs
    WHERE cqs.collected_points = true AND cqs.consumer_id IS NOT NULL
    GROUP BY cqs.consumer_id
),
transaction_points AS (
    SELECT 
        user_id,
        SUM(points_amount) as total_transaction_points,
        COUNT(*) as transaction_count,
        MAX(transaction_date) as last_transaction_at,
        SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END) as total_redeemed,
        SUM(CASE WHEN transaction_type = 'adjust' THEN points_amount ELSE 0 END) as total_adjusted,
        SUM(CASE WHEN transaction_type = 'MIGRATION' THEN points_amount ELSE 0 END) as total_migration
    FROM public.points_transactions
    WHERE user_id IS NOT NULL
    GROUP BY user_id
)
SELECT 
    u.id as user_id,
    COALESCE(u.full_name, 'Unknown Consumer') as consumer_name,
    u.phone as consumer_phone,
    u.email as consumer_email,
    u.location as consumer_location,
    (COALESCE(sp.total_earned, 0) + COALESCE(tp.total_transaction_points, 0)) as current_balance,
    COALESCE(sp.total_earned, 0) as total_collected_system,
    COALESCE(tp.total_adjusted, 0) as total_collected_manual,
    COALESCE(tp.total_migration, 0) as total_migration,
    COALESCE(tp.total_redeemed, 0) as total_redeemed,
    (COALESCE(sp.scan_count, 0) + COALESCE(tp.transaction_count, 0)) as transaction_count,
    GREATEST(sp.last_scan_at, tp.last_transaction_at) as last_transaction_date
FROM public.users u
LEFT JOIN scan_points sp ON u.id = sp.consumer_id
LEFT JOIN transaction_points tp ON u.id = tp.user_id
WHERE (u.role_code IN ('CONSUMER', 'GUEST') OR sp.consumer_id IS NOT NULL OR tp.user_id IS NOT NULL);

-- Grant permissions
GRANT SELECT ON public.v_consumer_points_balance TO authenticated;
GRANT SELECT ON public.v_consumer_points_balance TO service_role;

-- Force schema reload
NOTIFY pgrst, 'reload schema';
