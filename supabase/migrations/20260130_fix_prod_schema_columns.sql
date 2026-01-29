-- Fix missing columns for product_variants in Production
-- Date: 30 Jan 2026
-- This fixes the error: "Could not find the 'additional_images' column of 'product_variants' in the schema cache"

DO $$ 
BEGIN 
    -- 1. Ensure additional_images exists (JSONB array for multiple images)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_variants' 
                   AND column_name = 'additional_images') THEN
        
        ALTER TABLE public.product_variants 
        ADD COLUMN additional_images JSONB DEFAULT '[]'::jsonb;
        
        RAISE NOTICE 'Added additional_images column to public.product_variants';
    ELSE
        RAISE NOTICE 'Column additional_images already exists in public.product_variants';
    END IF;

    -- 2. Ensure animation_url exists (just to be absolutely safe as previous migration might have been skipped or failed silently)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_variants' 
                   AND column_name = 'animation_url') THEN
                   
        ALTER TABLE public.product_variants ADD COLUMN animation_url TEXT;
        RAISE NOTICE 'Added animation_url column to public.product_variants';
    END IF;

    -- 3. Ensure other commonly used new columns exist (manual_sku)
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_variants' 
                   AND column_name = 'manual_sku') THEN
                   
        ALTER TABLE public.product_variants ADD COLUMN manual_sku TEXT;
        RAISE NOTICE 'Added manual_sku column to public.product_variants';
    END IF;

END $$;

-- 4. Reload the schema cache
-- Supabase/PostgREST caches the schema. When columns are added, the cache must be reloaded.
NOTIFY pgrst, 'reload config';

COMMENT ON COLUMN public.product_variants.additional_images IS 'Array of additional image paths/URLs for the variant';
