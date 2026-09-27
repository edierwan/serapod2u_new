-- ============================================================================
-- Payment request documents: close anonymous and cross-tenant read access
-- ----------------------------------------------------------------------------
-- Purpose
--   Policy doc_payment_request_select (FOR SELECT TO public USING
--   doc_type = 'PAYMENT_REQUEST') made every payment request readable by the
--   anon role and by any signed-in account (shoppers, other tenants), through
--   PostgREST, including payload and signed_pdf_url. Found during Final Wave
--   staging UAT; present on staging and production since at least 2025-12.
--
--   The legitimate readers are already covered by documents_select
--   (authenticated): the issuing organization, the receiving organization and
--   HQ power users of the same company. Server routes that need wider access
--   use the service role. Dropping the public policy removes only the
--   unintended readers.
--
-- Grants      unchanged (RLS decides; no policy now admits anon).
-- RLS         documents keeps documents_select, "Super Admins can view all
--             documents" and the write policies.
-- search_path n/a (no functions).
--
-- Rollback (restores the previous, exposed behaviour — not recommended):
--   create policy doc_payment_request_select on public.documents
--     for select using (doc_type = 'PAYMENT_REQUEST'::public.document_type);
-- ============================================================================

drop policy if exists doc_payment_request_select on public.documents;

-- Post-conditions
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents'
             and cmd in ('SELECT', 'ALL') and 'public' = any(roles)) then
    raise exception 'postcondition: documents must not have a SELECT policy for the public role';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents'
             and cmd in ('SELECT', 'ALL') and 'anon' = any(roles)) then
    raise exception 'postcondition: documents must not have a SELECT policy for anon';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents'
                 and policyname = 'documents_select') then
    raise exception 'postcondition: tenant read policy documents_select is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.documents'::regclass) then
    raise exception 'postcondition: documents must keep RLS enabled';
  end if;
end $$;
