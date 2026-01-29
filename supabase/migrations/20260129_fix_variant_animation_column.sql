-- Migration to ensure animation_url column exists in product_variants
-- Fixes production issue where saving variant with animation fails
-- Corresponds to Issue 2 reported by user
DO $$ 
BEGIN 
    -- Check and add animation_url column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_variants' 
                   AND table_schema = 'public'
                   AND column_name = 'animation_url') THEN
        
        ALTER TABLE public.product_variants ADD COLUMN animation_url TEXT;
        
        RAISE NOTICE 'Added animation_url column to public.product_variants';
    ELSE
        RAISE NOTICE 'Column animation_url already exists in public.product_variants';
    END IF;

    -- Ensure avatars bucket allows video files and larger sizes
    UPDATE storage.buckets
    SET allowed_mime_types = null,
        file_size_limit = 52428800 -- 50MB
    WHERE id = 'avatars';
    
    RAISE NOTICE 'Updated avatars bucket configuration for video support';
END $$;

COMMENT ON COLUMN public.product_variants.animation_url IS 'URL to the storage path for the product variant animation (mp4/webm)';
