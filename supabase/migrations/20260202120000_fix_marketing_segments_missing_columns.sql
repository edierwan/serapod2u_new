
-- Fix marketing_segments table schema to match API expectations
-- This fixes the 'estimated_count' column missing error and ensures org_id exists

DO $$ 
BEGIN
    -- 1. Ensure marketing_segments table exists (it should, but safety first)
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'marketing_segments') THEN
        CREATE TABLE marketing_segments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            description TEXT,
            filters JSONB NOT NULL DEFAULT '{}'::jsonb,
            estimated_count INTEGER DEFAULT 0,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    END IF;

    -- 2. Add 'org_id' column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'org_id') THEN
        ALTER TABLE marketing_segments ADD COLUMN org_id UUID REFERENCES organizations(id);
    END IF;

    -- 3. Add 'estimated_count' column if missing
    -- The error message specifically mentioned this column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'estimated_count') THEN
        ALTER TABLE marketing_segments ADD COLUMN estimated_count INTEGER DEFAULT 0;
    END IF;
    
    -- 4. Check for 'last_estimated_size' and migrate data if needed/possible?
    -- If 'estimated_count' is 0 or null and 'last_estimated_size' has value, copy it.
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_segments' AND column_name = 'last_estimated_size') THEN
        UPDATE marketing_segments 
        SET estimated_count = last_estimated_size 
        WHERE (estimated_count IS NULL OR estimated_count = 0) AND last_estimated_size IS NOT NULL;
    END IF;

    -- 5. Backfill org_id from created_by if possible
    -- If org_id is null, try to find it from the user who created it
    UPDATE marketing_segments ms
    SET org_id = u.organization_id
    FROM users u
    WHERE ms.created_by = u.id AND ms.org_id IS NULL;

    -- 6. Ensure RLS policies exist for org_id
    -- The previous migration might have failed to set up org-based RLS if org_id was missing
    
END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
