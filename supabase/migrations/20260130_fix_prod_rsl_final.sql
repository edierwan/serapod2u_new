-- Fix permissions for product_variants and storage in Production
-- Date: 30 Jan 2026

-- 1. Ensure column exists (Just in case)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_variants' 
                   AND column_name = 'animation_url') THEN
        ALTER TABLE product_variants ADD COLUMN animation_url TEXT;
    END IF;
END $$;

-- 2. Update Storage Bucket 'avatars' settings
-- Allow ANY mime type (video/mp4, etc) AND 50MB size
UPDATE storage.buckets
SET allowed_mime_types = null,
    file_size_limit = 52428800 -- 50MB
WHERE id = 'avatars';


-- 3. Fix Storage Objects RLS to be permissive for 'avatars' bucket
-- Sometimes policies get stuck or conflict. This resets them.

-- Drop existing policies for avatars bucket explicitly if needed
DROP POLICY IF EXISTS "Public Access Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Give me access to own files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Select" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Insert" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete" ON storage.objects;


-- Create simple, broad policies for authenticated users on 'avatars' bucket
-- READ: Public
CREATE POLICY "Avatars Public Read"
ON storage.objects FOR SELECT
USING ( bucket_id = 'avatars' );

-- INSERT: Any authenticated user
CREATE POLICY "Avatars Auth Insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'avatars' );

-- UPDATE: Any authenticated user (Checking owner if possible, or just open for this bucket if owner not reliable)
-- Assuming we want any authenticated user to be able to update/overwrite files in this bucket
CREATE POLICY "Avatars Auth Update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'avatars' );

-- DELETE: Any authenticated user
CREATE POLICY "Avatars Auth Delete"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'avatars' );


-- 4. Check product_variants RLS
-- If product_variants has strict RLS, update it.
-- This part assumes standard RLS. 
-- We'll enable RLS on product_variants just to be safe it's on, 
-- and then add a permissive policy if one doesn't exist.

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- Drop potentially conflicting policies
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.product_variants;
DROP POLICY IF EXISTS "Authenticated variants access" ON public.product_variants;

-- Create a policy allowing full access to authenticated users
-- (Adjust this if you have specific role requirements, but for fixing this bug, this ensures access)
CREATE POLICY "Authenticated variants access"
ON public.product_variants
FOR ALL 
TO authenticated
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  RAISE NOTICE 'Fixed permissions for product_variants and avatars bucket';
END $$;
