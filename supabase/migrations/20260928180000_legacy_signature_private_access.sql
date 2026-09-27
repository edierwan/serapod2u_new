-- ============================================================================
-- Owner-scoped read compatibility for historical signature object names
-- ----------------------------------------------------------------------------
-- Migration 20260928170000 made the documents bucket private and requires new
-- signatures to use:
--
--   signatures/<authenticated-user-id>/<filename>
--
-- Historical objects remain stored as:
--
--   signatures/<authenticated-user-id>_<timestamp>.<extension>
--
-- This additive SELECT-only policy lets an authenticated user read exactly
-- their own historical flat-path signature. It does not permit legacy-format
-- INSERT, UPDATE or DELETE, does not grant anonymous access, and does not alter
-- either bucket's private state. Service-role PDF generation continues to
-- bypass object RLS after authorizing the relevant business resource.
--
-- Rollback:
--   drop policy if exists documents_signature_select_own_legacy
--     on storage.objects;
-- ============================================================================

drop policy if exists documents_signature_select_own_legacy
  on storage.objects;

create policy documents_signature_select_own_legacy
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and name ~ (
      '^signatures/' || auth.uid()::text || '_[0-9]+[.][A-Za-z0-9]+$'
    )
  );

comment on policy documents_signature_select_own_legacy on storage.objects is
  'SELECT-only compatibility for signatures/<own-auth-uid>_<timestamp>.<ext>; new writes remain nested.';

-- Fail rather than silently weakening the private-storage boundary.
do $$
begin
  if exists (
    select 1 from storage.buckets
    where id in ('documents', 'order-documents') and public
  ) then
    raise exception 'postcondition: document storage buckets must remain private';
  end if;

  -- Validate stable catalog attributes rather than matching pg_get_expr()
  -- output text, whose qualification/parentheses vary between PostgreSQL and
  -- Supabase Storage versions. The exact owner/path predicate is defined by
  -- the CREATE POLICY statement above and is contract-tested in source.
  if not exists (
    select 1
    from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and p.polname = 'documents_signature_select_own_legacy'
      and p.polcmd = 'r'
      and p.polroles = array['authenticated'::regrole::oid]
      and p.polqual is not null
  ) then
    raise exception 'postcondition: authenticated legacy signature SELECT policy is missing or malformed';
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'documents_signature_select_own'
      and polcmd = 'r'
  ) then
    raise exception 'postcondition: current nested signature SELECT policy must remain active';
  end if;
end $$;
