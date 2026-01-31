-- ============================================
-- Migration: Add Point-Based Audience Segment Filters
-- ============================================

-- 1. Create view for consumer points summary (reusable for segments)
CREATE OR REPLACE VIEW v_consumer_points_summary AS
SELECT 
    u.id as user_id,
    u.full_name as name,
    u.phone as whatsapp_phone,
    u.phone IS NOT NULL AND length(trim(u.phone)) >= 8 as whatsapp_valid,
    u.is_active,
    u.location as state,
    u.organization_id,
    o.org_type_code as organization_type,
    COALESCE(spl.current_balance, 0) as current_balance,
    COALESCE(spl.total_collected_system, 0) as collected_system,
    COALESCE(spl.total_collected_manual, 0) as collected_manual,
    COALESCE(spl.migration_points, 0) as migration_points,
    COALESCE(spl.other_points, 0) as other_points,
    COALESCE(spl.total_redeemed, 0) as total_redeemed,
    COALESCE(
        (SELECT COUNT(*) FROM shop_points_transactions spt WHERE spt.user_id = u.id),
        0
    ) as transactions_count,
    COALESCE(spl.last_activity_at, spl.updated_at) as last_activity_at
FROM users u
LEFT JOIN organizations o ON u.organization_id = o.id
LEFT JOIN shop_points_ledger spl ON spl.user_id = u.id
WHERE u.is_active = true;

-- 2. Create index on shop_points_ledger for faster lookups
CREATE INDEX IF NOT EXISTS idx_shop_points_ledger_user_id ON shop_points_ledger(user_id);

-- 3. Update marketing_segments table to support new filter schema
-- (If the table doesn't exist, this will create it. If it exists, we just ensure columns exist)
DO $$ 
BEGIN
    -- Create table if not exists
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'marketing_segments') THEN
        CREATE TABLE marketing_segments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            description TEXT,
            filters JSONB DEFAULT '{}',
            only_opted_in BOOLEAN DEFAULT true,
            only_valid_whatsapp BOOLEAN DEFAULT true,
            status TEXT DEFAULT 'active',
            last_computed_at TIMESTAMPTZ,
            last_estimated_size INTEGER,
            last_excluded_count INTEGER,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        );
    ELSE
        -- Add new columns if they don't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'only_opted_in') THEN
            ALTER TABLE marketing_segments ADD COLUMN only_opted_in BOOLEAN DEFAULT true;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'only_valid_whatsapp') THEN
            ALTER TABLE marketing_segments ADD COLUMN only_valid_whatsapp BOOLEAN DEFAULT true;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'status') THEN
            ALTER TABLE marketing_segments ADD COLUMN status TEXT DEFAULT 'active';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'last_computed_at') THEN
            ALTER TABLE marketing_segments ADD COLUMN last_computed_at TIMESTAMPTZ;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'last_estimated_size') THEN
            ALTER TABLE marketing_segments ADD COLUMN last_estimated_size INTEGER;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'last_excluded_count') THEN
            ALTER TABLE marketing_segments ADD COLUMN last_excluded_count INTEGER;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'created_by') THEN
            ALTER TABLE marketing_segments ADD COLUMN created_by UUID REFERENCES users(id);
        END IF;
    END IF;
END $$;

-- 4. Create marketing_opt_outs table if not exists
CREATE TABLE IF NOT EXISTS marketing_opt_outs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    reason TEXT,
    opted_out_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_opt_outs_phone ON marketing_opt_outs(phone);

-- 5. Grant necessary permissions (adjust role names as needed)
-- GRANT SELECT ON v_consumer_points_summary TO authenticated;
-- GRANT ALL ON marketing_segments TO authenticated;
-- GRANT ALL ON marketing_opt_outs TO authenticated;

-- ============================================
-- End of Migration
-- ============================================
