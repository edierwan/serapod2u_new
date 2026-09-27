-- ============================================================================
-- ROLLBACK for 20260928170000_documents_storage_private_boundary
--          and 20260928180000_legacy_signature_private_access
-- ----------------------------------------------------------------------------
-- EMERGENCY USE ONLY. This restores the previous EXPOSED state: anonymous and
-- cross-tenant listing/download of every signed PDF, quality evidence file and
-- signature in the `documents` bucket, bucket-wide authenticated read of
-- `order-documents`, and any-user write/delete of any signature.
--
-- The policy definitions below are the pre-migration catalog captured from
-- schema dumps of staging (KVM2) and production (KVM8) on 2026-09-27; both
-- were identical. Before applying the forward migration, capture the live
-- catalog with PREFLIGHT below and keep the output: if it differs from these
-- definitions, restore from that output instead.
--
-- Order: the application can stay on the new code during a SQL rollback
-- (every new route uses the service role). Rolling the APPLICATION back while
-- the forward migration is still applied breaks the old browser uploads and
-- public-URL reads, so always roll SQL back first, then the application.
--
-- Payment request table RLS (20260928150000) and audit history
-- (20260928160000) are independent and are NOT touched here.
-- ============================================================================

-- PREFLIGHT (read-only; run and save the output BEFORE the forward migration)
-- select id, public from storage.buckets where id in ('documents','order-documents');
-- select polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as check_expr
--   from pg_policy
--  where polrelid = 'storage.objects'::regclass
--    and (coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
--        ~ '''(order-)?documents''';

-- 1. Remove the policies added by the forward migrations.
drop policy if exists documents_signature_select_own on storage.objects;
drop policy if exists documents_signature_insert_own on storage.objects;
drop policy if exists documents_signature_update_own on storage.objects;
drop policy if exists documents_signature_delete_own on storage.objects;
drop policy if exists documents_signature_select_own_legacy on storage.objects;

-- 2. Restore the previous `documents` bucket policies.
drop policy if exists "Public read access" on storage.objects;
create policy "Public read access" on storage.objects
  for select to public
  using (bucket_id = 'documents');

drop policy if exists "Authenticated can view documents" on storage.objects;
create policy "Authenticated can view documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents');

drop policy if exists "Admins can manage documents" on storage.objects;
create policy "Admins can manage documents" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and (select public.is_hq_admin()))
  with check (bucket_id = 'documents' and (select public.is_hq_admin()));

drop policy if exists authenticated_users_read_documents on storage.objects;
create policy authenticated_users_read_documents on storage.objects
  for select to authenticated
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = 'signatures'
              or (storage.foldername(name))[1] = any (array['PO','INVOICE','PAYMENT','RECEIPT'])));

drop policy if exists service_role_upload_signed_pdfs on storage.objects;
create policy service_role_upload_signed_pdfs on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = any (array['PO','INVOICE','PAYMENT','RECEIPT']));

drop policy if exists users_upload_own_signatures on storage.objects;
create policy users_upload_own_signatures on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'signatures');

drop policy if exists users_update_own_signatures on storage.objects;
create policy users_update_own_signatures on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'signatures');

drop policy if exists users_delete_own_signatures on storage.objects;
create policy users_delete_own_signatures on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'signatures');

-- 3. Restore the previous `order-documents` bucket policies.
drop policy if exists order_docs_select on storage.objects;
create policy order_docs_select on storage.objects
  for select to authenticated
  using (bucket_id = 'order-documents');

drop policy if exists order_docs_insert on storage.objects;
create policy order_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-documents'
              and (select (public.get_org_type(public.current_user_org_id()) = 'HQ' and public.is_power_user())));

drop policy if exists order_docs_update on storage.objects;
create policy order_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'order-documents'
         and (select (public.get_org_type(public.current_user_org_id()) = 'HQ' and public.is_power_user())))
  with check (bucket_id = 'order-documents');

drop policy if exists order_docs_delete on storage.objects;
create policy order_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-documents'
         and (select (public.get_org_type(public.current_user_org_id()) = 'HQ' and public.is_power_user())));

-- 4. Bucket visibility as before (documents public, order-documents private).
update storage.buckets set public = true, updated_at = now() where id = 'documents';
update storage.buckets set public = false, updated_at = now() where id = 'order-documents';
