-- ============================================================================
-- Identity Foundation Stage 1 — 1/3
-- Authorization decisions must not block (or be rewritten by) user deletion
-- ----------------------------------------------------------------------------
-- Purpose
--   sa_authorization_decisions.actor_id references public.users ON DELETE SET
--   NULL (20260927140000_sa_wave1_foundation.sql), but the table is append-only:
--   the BEFORE UPDATE/DELETE trigger sa_authorization_decisions_append_only
--   (sa_reject_decision_mutation) rejects every UPDATE. Deleting any user who has
--   ever passed through authorize() therefore fails with
--     ERROR authorization_decisions_are_append_only
--   (the FK action issues UPDATE ... SET actor_id = NULL). Same defect class as
--   20260928160000_sa_audit_history_survives_user_deletion.sql, which fixed
--   sa_access_change_log and sa_sod_violations but missed this table.
--   Verified on staging 2026-09-28: sa_authorization_decisions_actor_id_fkey,
--   confdeltype = 'n' (SET NULL).
--
-- Security rationale
--   Historical actor attribution must survive account removal. The fix drops
--   only the foreign key; the column keeps the raw user id, the append-only,
--   no-truncate and audit-class triggers are unchanged, and the retention purge
--   (ORDINARY_SHADOW only, flag-gated) is unchanged. As a generic guard the
--   migration also drops any other foreign key from an append-only S&A table
--   (a table carrying a trigger that calls public.sa_reject_*) to public.users.
--
-- Grants / RLS / search_path: unchanged (no functions, policies or grants).
-- Idempotent: yes (drops only constraints that exist).
--
-- Rollback (restores the defect; only if every referenced user still exists):
--   alter table public.sa_authorization_decisions
--     add constraint sa_authorization_decisions_actor_id_fkey
--     foreign key (actor_id) references public.users(id) on delete set null;
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select distinct c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    join pg_trigger t on t.tgrelid = c.conrelid and not t.tgisinternal
    join pg_proc p on p.oid = t.tgfoid
    where c.contype = 'f'
      and c.confrelid = 'public.users'::regclass
      and p.proname like 'sa\_reject\_%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    raise notice 'dropped % on % (append-only history keeps raw user ids)', r.conname, r.tbl;
  end loop;
end $$;

comment on column public.sa_authorization_decisions.actor_id is
  'User id of the actor at decision time (kept after the account is deleted; no foreign key by design — append-only history).';

-- Post-conditions
do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_trigger t on t.tgrelid = c.conrelid and not t.tgisinternal
    join pg_proc p on p.oid = t.tgfoid
    where c.contype = 'f' and c.confrelid = 'public.users'::regclass and p.proname like 'sa\_reject\_%') then
    raise exception 'postcondition: append-only S&A history tables must not reference public.users';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sa_authorization_decisions_append_only'
                 and tgrelid = 'public.sa_authorization_decisions'::regclass and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'sa_authorization_decisions_no_truncate'
                 and tgrelid = 'public.sa_authorization_decisions'::regclass and not tgisinternal) then
    raise exception 'postcondition: authorization decision append-only/no-truncate triggers must remain';
  end if;
end $$;
