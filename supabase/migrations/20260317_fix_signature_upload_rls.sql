-- Fix: Add missing storage RLS policies for signature uploads
-- These policies exist in production but may be missing from localhost/staging.
-- They allow authenticated users to upload, update, and delete signature images
-- in the documents/signatures/ folder.
--
-- The error: "new row violates row-level security policy" when uploading
-- a digital signature under My Profile.

-- 1. INSERT policy (upload new signatures)
DROP POLICY IF EXISTS users_upload_own_signatures ON storage.objects;
CREATE POLICY users_upload_own_signatures
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'signatures'
  );

-- 2. UPDATE policy (replace existing signatures)
DROP POLICY IF EXISTS users_update_own_signatures ON storage.objects;
CREATE POLICY users_update_own_signatures
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'signatures'
  );

-- 3. DELETE policy (remove old signatures)
DROP POLICY IF EXISTS users_delete_own_signatures ON storage.objects;
CREATE POLICY users_delete_own_signatures
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'signatures'
  );
