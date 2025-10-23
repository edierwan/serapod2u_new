-- Add logo_url column to organizations table
-- This allows organizations to upload and display their logo/avatar

-- Add logo_url column
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS logo_url text;

-- Add comment for documentation
COMMENT ON COLUMN public.organizations.logo_url IS 'URL to organization logo/avatar image stored in Supabase storage';

-- Create storage bucket for organization logos if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-logos',
  'organization-logos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the bucket
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to upload organization logos
CREATE POLICY IF NOT EXISTS "Authenticated users can upload organization logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'organization-logos');

-- Allow public read access to organization logos
CREATE POLICY IF NOT EXISTS "Public can view organization logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'organization-logos');

-- Allow authenticated users to update their organization logos
CREATE POLICY IF NOT EXISTS "Authenticated users can update organization logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'organization-logos')
WITH CHECK (bucket_id = 'organization-logos');

-- Allow authenticated users to delete organization logos
CREATE POLICY IF NOT EXISTS "Authenticated users can delete organization logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'organization-logos');
