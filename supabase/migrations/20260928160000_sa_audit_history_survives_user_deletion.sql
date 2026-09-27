-- ============================================================================
-- S&A audit history must not block (or be rewritten by) user deletion
-- ----------------------------------------------------------------------------
-- Purpose
--   sa_access_change_log(actor_id, target_user_id) and sa_sod_violations(user_id)
--   referenced public.users ON DELETE SET NULL, but both tables are
--   append-only (BEFORE UPDATE/DELETE trigger sa_reject_append_only_mutation).
--   Deleting any user with audit rows therefore failed:
--     ERROR sa_access_change_log_is_append_only
--     (UPDATE ONLY sa_access_change_log SET target_user_id = NULL ...)
--   After the Final Wave lifecycle backfill every portal user has such rows,
--   so hard user deletion (admin delete-user flow, auth.admin.deleteUser
--   cascade) broke on staging. Found in Final Wave staging review.
--
--   Audit history should keep who did what, even after an account is removed.
--   The fix drops only these three foreign keys: the columns keep the raw user
--   id, rows stay append-only, and the append-only triggers are unchanged.
--   Other S&A foreign keys are unchanged (operational rows cascade, authorship
--   columns keep NO ACTION).
--
-- Grants / RLS / search_path: unchanged (no functions or policies).
--
-- Rollback (restores the defect; only if every referenced user still exists):
--   alter table public.sa_access_change_log add constraint sa_access_change_log_actor_id_fkey
--     foreign key (actor_id) references public.users(id) on delete set null;
--   alter table public.sa_access_change_log add constraint sa_access_change_log_target_user_id_fkey
--     foreign key (target_user_id) references public.users(id) on delete set null;
--   alter table public.sa_sod_violations add constraint sa_sod_violations_user_id_fkey
--     foreign key (user_id) references public.users(id) on delete set null;
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.users'::regclass
      and c.conrelid in ('public.sa_access_change_log'::regclass, 'public.sa_sod_violations'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

comment on column public.sa_access_change_log.actor_id is
  'User id of the actor at the time of the change (kept after the account is deleted; no foreign key by design).';
comment on column public.sa_access_change_log.target_user_id is
  'User id the change applied to (kept after the account is deleted; no foreign key by design).';
comment on column public.sa_sod_violations.user_id is
  'User id involved in the violation (kept after the account is deleted; no foreign key by design).';

-- Post-conditions
do $$
begin
  if exists (select 1 from pg_constraint c
             where c.contype = 'f' and c.confrelid = 'public.users'::regclass
               and c.conrelid in ('public.sa_access_change_log'::regclass, 'public.sa_sod_violations'::regclass)) then
    raise exception 'postcondition: append-only S&A audit tables must not reference public.users';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sa_access_change_log_append_only' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'sa_sod_violations_append_only' and not tgisinternal) then
    raise exception 'postcondition: append-only triggers must remain';
  end if;
end $$;
