-- =====================================================
-- Organizations Stats Enhancement - Optional Optimizations
-- =====================================================
-- These are OPTIONAL performance optimizations for the Organizations page stats
-- The current implementation works without these, but these can improve performance
-- for large datasets.

-- =====================================================
-- 1. MATERIALIZED VIEW: Organization Statistics
-- =====================================================
-- Creates a pre-computed view of all organization statistics
-- Refresh this view periodically (e.g., every hour or after bulk operations)

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_organization_stats AS
WITH 
-- Children counts
children_stats AS (
  SELECT 
    parent_org_id AS org_id,
    COUNT(*) AS children_count
  FROM public.organizations
  WHERE is_active = true
    AND parent_org_id IS NOT NULL
  GROUP BY parent_org_id
),
-- User counts
user_stats AS (
  SELECT 
    organization_id AS org_id,
    COUNT(*) AS users_count
  FROM public.users
  WHERE is_active = true
  GROUP BY organization_id
),
-- Product counts for manufacturers
mfg_product_stats AS (
  SELECT 
    manufacturer_id AS org_id,
    COUNT(*) AS products_count
  FROM public.products
  WHERE is_active = true
  GROUP BY manufacturer_id
),
-- Product counts for distributors
dist_product_stats AS (
  SELECT 
    distributor_id AS org_id,
    COUNT(*) AS products_count
  FROM public.distributor_products
  WHERE is_active = true
  GROUP BY distributor_id
),
-- Distributor counts for shops
shop_distributor_stats AS (
  SELECT 
    shop_id AS org_id,
    COUNT(*) AS distributors_count
  FROM public.shop_distributors
  WHERE is_active = true
  GROUP BY shop_id
),
-- Shop counts for distributors
distributor_shop_stats AS (
  SELECT 
    distributor_id AS org_id,
    COUNT(*) AS shops_count
  FROM public.shop_distributors
  WHERE is_active = true
  GROUP BY distributor_id
),
-- Order counts (as buyer)
buyer_order_stats AS (
  SELECT 
    buyer_org_id AS org_id,
    COUNT(*) AS orders_count
  FROM public.orders
  GROUP BY buyer_org_id
),
-- Order counts (as seller)
seller_order_stats AS (
  SELECT 
    seller_org_id AS org_id,
    COUNT(*) AS orders_count
  FROM public.orders
  GROUP BY seller_org_id
)
SELECT 
  o.id AS org_id,
  o.org_type_code,
  COALESCE(cs.children_count, 0) AS children_count,
  COALESCE(us.users_count, 0) AS users_count,
  COALESCE(mps.products_count, 0) + COALESCE(dps.products_count, 0) AS products_count,
  COALESCE(sds.distributors_count, 0) AS distributors_count,
  COALESCE(dss.shops_count, 0) AS shops_count,
  COALESCE(bos.orders_count, 0) + COALESCE(sos.orders_count, 0) AS orders_count
FROM public.organizations o
LEFT JOIN children_stats cs ON cs.org_id = o.id
LEFT JOIN user_stats us ON us.org_id = o.id
LEFT JOIN mfg_product_stats mps ON mps.org_id = o.id
LEFT JOIN dist_product_stats dps ON dps.org_id = o.id
LEFT JOIN shop_distributor_stats sds ON sds.org_id = o.id
LEFT JOIN distributor_shop_stats dss ON dss.org_id = o.id
LEFT JOIN buyer_order_stats bos ON bos.org_id = o.id
LEFT JOIN seller_order_stats sos ON sos.org_id = o.id
WHERE o.is_active = true;

-- Create unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_org_stats_org_id 
ON public.mv_organization_stats (org_id);

-- Add comment
COMMENT ON MATERIALIZED VIEW public.mv_organization_stats IS 
'Pre-computed organization statistics for dashboard performance. Refresh periodically.';


-- =====================================================
-- 2. FUNCTION: Refresh Organization Stats
-- =====================================================
-- Call this function to refresh the materialized view
-- Can be called manually or scheduled via cron

CREATE OR REPLACE FUNCTION public.refresh_organization_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_organization_stats;
  
  RAISE NOTICE 'Organization stats refreshed at %', NOW();
END;
$$;

COMMENT ON FUNCTION public.refresh_organization_stats() IS 
'Refreshes the organization statistics materialized view. Call after bulk data operations.';


-- =====================================================
-- 3. FUNCTION: Get HQ Aggregated Products
-- =====================================================
-- Helper function to get aggregated product count for HQ
-- from all child manufacturers

CREATE OR REPLACE FUNCTION public.get_hq_aggregated_products(p_hq_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(SUM(
    CASE 
      WHEN mv.org_id IS NOT NULL THEN mv.products_count
      ELSE 0
    END
  ), 0)::INTEGER
  FROM public.organizations o
  LEFT JOIN public.mv_organization_stats mv ON mv.org_id = o.id
  WHERE o.parent_org_id = p_hq_id
    AND o.org_type_code = 'MFG'
    AND o.is_active = true;
$$;

COMMENT ON FUNCTION public.get_hq_aggregated_products(UUID) IS 
'Returns aggregated product count for HQ from all child manufacturers';


-- =====================================================
-- 4. INDEXES for Performance
-- =====================================================
-- Add indexes if they don't already exist

-- Index on shop_distributors for faster counting
CREATE INDEX IF NOT EXISTS idx_shop_dist_active_shop 
ON public.shop_distributors (shop_id) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_shop_dist_active_distributor 
ON public.shop_distributors (distributor_id) 
WHERE is_active = true;

-- Index on orders for faster counting
CREATE INDEX IF NOT EXISTS idx_orders_buyer 
ON public.orders (buyer_org_id);

CREATE INDEX IF NOT EXISTS idx_orders_seller 
ON public.orders (seller_org_id);

-- Index on distributor_products
CREATE INDEX IF NOT EXISTS idx_dist_products_active 
ON public.distributor_products (distributor_id) 
WHERE is_active = true;

-- Index on products
CREATE INDEX IF NOT EXISTS idx_products_mfg_active 
ON public.products (manufacturer_id) 
WHERE is_active = true;


-- =====================================================
-- 5. USAGE EXAMPLES
-- =====================================================

-- Example 1: Refresh stats (run after bulk operations)
-- SELECT public.refresh_organization_stats();

-- Example 2: Get stats for specific org
-- SELECT * FROM public.mv_organization_stats WHERE org_id = 'your-org-uuid';

-- Example 3: Get HQ aggregated products
-- SELECT public.get_hq_aggregated_products('hq-org-uuid');

-- Example 4: Get all orgs with their stats
-- SELECT 
--   o.*,
--   s.children_count,
--   s.users_count,
--   s.products_count,
--   s.distributors_count,
--   s.shops_count,
--   s.orders_count
-- FROM public.organizations o
-- LEFT JOIN public.mv_organization_stats s ON s.org_id = o.id
-- WHERE o.is_active = true;


-- =====================================================
-- 6. SCHEDULED REFRESH (PostgreSQL + pg_cron)
-- =====================================================
-- If you have pg_cron extension enabled, schedule automatic refresh:

-- Enable pg_cron (run as superuser)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule refresh every hour
-- SELECT cron.schedule(
--   'refresh-org-stats',
--   '0 * * * *',  -- Every hour at minute 0
--   'SELECT public.refresh_organization_stats();'
-- );

-- Or schedule every 15 minutes during business hours
-- SELECT cron.schedule(
--   'refresh-org-stats-frequent',
--   '*/15 9-18 * * 1-5',  -- Every 15 min, 9am-6pm, Mon-Fri
--   'SELECT public.refresh_organization_stats();'
-- );


-- =====================================================
-- 7. MIGRATION ROLLBACK (If Needed)
-- =====================================================
-- To remove all optimizations:

-- DROP MATERIALIZED VIEW IF EXISTS public.mv_organization_stats CASCADE;
-- DROP FUNCTION IF EXISTS public.refresh_organization_stats();
-- DROP FUNCTION IF EXISTS public.get_hq_aggregated_products(UUID);
-- DROP INDEX IF EXISTS idx_shop_dist_active_shop;
-- DROP INDEX IF EXISTS idx_shop_dist_active_distributor;
-- DROP INDEX IF EXISTS idx_orders_buyer;
-- DROP INDEX IF EXISTS idx_orders_seller;
-- DROP INDEX IF EXISTS idx_dist_products_active;
-- DROP INDEX IF EXISTS idx_products_mfg_active;


-- =====================================================
-- NOTES
-- =====================================================
-- 1. The current implementation in OrganizationsView.tsx works WITHOUT these optimizations
-- 2. These are OPTIONAL performance enhancements for large datasets (1000+ orgs)
-- 3. The materialized view needs periodic refresh (not real-time)
-- 4. If you need real-time data, use the current implementation
-- 5. If you prioritize performance over real-time accuracy, use the materialized view
-- 6. Consider your data volume and refresh frequency requirements

-- =====================================================
-- DEPLOYMENT DECISION
-- =====================================================
-- Current Setup (No migration needed):
-- ✅ Works for small to medium datasets (< 1000 orgs)
-- ✅ Real-time data (no caching)
-- ✅ No additional maintenance
-- ✅ Simple implementation

-- With Optimizations (Run this migration):
-- ✅ Better for large datasets (1000+ orgs)
-- ⚠️ Requires periodic refresh
-- ⚠️ Data may be slightly stale (depends on refresh frequency)
-- ✅ Much faster query performance

-- RECOMMENDATION:
-- - Start WITHOUT optimizations
-- - Monitor query performance
-- - Add optimizations if needed (when you notice slowness)
