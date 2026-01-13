-- Migration: Fix redeem_items constraint and create support attachments bucket
-- Date: 2026-01-13
-- Issues:
--   1. Fix redeem_items_points_positive constraint to allow 0 for Point rewards
--   2. Create storage bucket for support chat attachments

-- ============================================
-- ISSUE 1: Fix redeem_items points constraint
-- ============================================

-- Drop the old constraint that requires points > 0
ALTER TABLE public.redeem_items DROP CONSTRAINT IF EXISTS redeem_items_points_positive;

-- Add new constraint that allows points >= 0 (0 for Point rewards that GIVE points)
ALTER TABLE public.redeem_items 
ADD CONSTRAINT redeem_items_points_non_negative CHECK (points_required >= 0);

COMMENT ON CONSTRAINT redeem_items_points_non_negative ON public.redeem_items IS 
'Points required must be >= 0. Zero is allowed for Point category rewards that give points to users instead of requiring points.';

-- ============================================
-- ISSUE 2: Create support_attachments bucket
-- ============================================

-- Create bucket for support chat attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'support-attachments',
    'support-attachments',
    false,
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS Policies for support-attachments bucket

-- Allow authenticated users to upload their own attachments
DROP POLICY IF EXISTS "Users can upload support attachments" ON storage.objects;
CREATE POLICY "Users can upload support attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'support-attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to read their own attachments
DROP POLICY IF EXISTS "Users can read own support attachments" ON storage.objects;
CREATE POLICY "Users can read own support attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'support-attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow admins to read all support attachments
DROP POLICY IF EXISTS "Admins can read all support attachments" ON storage.objects;
CREATE POLICY "Admins can read all support attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'support-attachments' AND
    EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'HQ_ADMIN', 'POWER_USER', 'admin', 'super_admin', 'hq_admin')
    )
);

-- Allow users to delete their own attachments
DROP POLICY IF EXISTS "Users can delete own support attachments" ON storage.objects;
CREATE POLICY "Users can delete own support attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'support-attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
