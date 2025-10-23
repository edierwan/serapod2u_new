-- Migration: Add image_url to product_variants table
-- Purpose: Enable avatar/image upload for each product variant
-- Date: 2025-10-20

-- Add image_url column to product_variants table
ALTER TABLE public.product_variants
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN public.product_variants.image_url IS 'URL to variant image stored in avatars bucket with cache-busting timestamp';

-- Create index for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_product_variants_image_url 
ON public.product_variants(image_url) 
WHERE image_url IS NOT NULL;

-- Add comment to the index
COMMENT ON INDEX idx_product_variants_image_url IS 'Index for product variants with images for faster filtering';
