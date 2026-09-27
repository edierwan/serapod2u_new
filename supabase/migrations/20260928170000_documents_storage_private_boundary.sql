-- ============================================================================
-- Private boundary for signed documents, order files, signatures and evidence
-- ----------------------------------------------------------------------------
-- The documents bucket previously had both `public = true` and storage.object
-- policies which allowed every anonymous/authenticated caller to list and read
-- every tenant's objects. The private `order-documents` bucket also had a
-- bucket-wide authenticated SELECT policy. Database RLS on public.documents
-- does not protect the bytes in either Storage bucket.
--
-- Browser reads now go through resource-authorizing server routes. The only
-- direct end-user Storage access retained here is a user's own signature
-- directory. Server/service-role uploads, PDF generation, Serapp attachments
-- and authorized evidence delivery continue to bypass object RLS as designed.
--
-- Rollback (security regression; emergency use only):
--   update storage.buckets set public = true where id = 'documents';
--   Recreate the prior broad policies from a pre-migration catalog backup.
-- ============================================================================

update storage.buckets
set public = false,
    updated_at = now()
where id = 'documents';

update storage.buckets
set public = false,
    updated_at = now()
where id = 'order-documents';

-- Remove every existing policy which explicitly targets this bucket. This is
-- deliberately catalog-driven so legacy policy names cannot leave an exposed
-- path behind. Order-document reads and writes now pass through server routes
-- which authorize the exact public.documents + document_files relationship.
do $$
declare
  policy_row record;
  policy_expression text;
begin
  for policy_row in
    select p.polname,
           pg_get_expr(p.polqual, p.polrelid) as using_expression,
           pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
    from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
  loop
    policy_expression := coalesce(policy_row.using_expression, '') || ' ' ||
                         coalesce(policy_row.check_expression, '');
    if policy_expression like '%''documents''%'
       or policy_expression like '%''order-documents''%' then
      execute format('drop policy if exists %I on storage.objects', policy_row.polname);
    end if;
  end loop;
end $$;

-- Supabase Storage upload/upsert uses RETURNING, so SELECT is required as well
-- as INSERT/UPDATE. All four operations are confined to the authenticated
-- user's immutable auth uid segment.
create policy documents_signature_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'signatures'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy documents_signature_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'signatures'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy documents_signature_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'signatures'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'signatures'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy documents_signature_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'signatures'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Post-conditions fail the migration rather than leaving a partially hardened
-- bucket. Service-role access does not require an explicit policy.
do $$
declare
  remaining_policy record;
  policy_expression text;
begin
  if not exists (select 1 from storage.buckets where id = 'documents') then
    raise exception 'postcondition: documents bucket is missing';
  end if;

  if exists (select 1 from storage.buckets where id = 'documents' and public) then
    raise exception 'postcondition: documents bucket must be private';
  end if;

  if not exists (select 1 from storage.buckets where id = 'order-documents') then
    raise exception 'postcondition: order-documents bucket is missing';
  end if;

  if exists (select 1 from storage.buckets where id = 'order-documents' and public) then
    raise exception 'postcondition: order-documents bucket must be private';
  end if;

  for remaining_policy in
    select p.polname,
           pg_get_expr(p.polqual, p.polrelid) as using_expression,
           pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
    from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
  loop
    policy_expression := coalesce(remaining_policy.using_expression, '') || ' ' ||
                         coalesce(remaining_policy.check_expression, '');
    if policy_expression like '%''documents''%'
       and remaining_policy.polname not in (
         'documents_signature_select_own',
         'documents_signature_insert_own',
         'documents_signature_update_own',
         'documents_signature_delete_own'
       ) then
      raise exception 'postcondition: unexpected documents policy remains: %', remaining_policy.polname;
    end if;
    if policy_expression like '%''order-documents''%' then
      raise exception 'postcondition: order-documents must not have end-user object policies: %', remaining_policy.polname;
    end if;
  end loop;

  if (select count(*) from pg_policy
      where polrelid = 'storage.objects'::regclass
        and polname in (
          'documents_signature_select_own',
          'documents_signature_insert_own',
          'documents_signature_update_own',
          'documents_signature_delete_own'
        )) <> 4 then
    raise exception 'postcondition: all four owner-scoped signature policies are required';
  end if;
end $$;
