-- Snapshot the eligible Stock Configuration catalog for every Stock Count
-- draft. This prevents configurations created later from silently appearing
-- in an already-saved historical draft.

begin;

create table if not exists public.stock_count_session_scope (
  session_id uuid not null references public.stock_count_sessions(id) on delete cascade,
  stock_config_id uuid not null references public.inventory_stock_configurations(id),
  created_at timestamptz not null default now(),
  primary key (session_id, stock_config_id)
);

comment on table public.stock_count_session_scope is
  'Immutable eligible Stock Configuration snapshot captured on the first save of a Stock Count draft.';

alter table public.stock_count_session_scope enable row level security;

drop policy if exists stock_count_session_scope_manage_org on public.stock_count_session_scope;
create policy stock_count_session_scope_manage_org
  on public.stock_count_session_scope
  to authenticated
  using (
    exists (
      select 1 from public.stock_count_sessions sessions
      where sessions.id = stock_count_session_scope.session_id
        and (public.can_access_org(sessions.warehouse_organization_id) or public.is_hq_admin())
    )
  )
  with check (
    exists (
      select 1 from public.stock_count_sessions sessions
      where sessions.id = stock_count_session_scope.session_id
        and sessions.status = 'draft'
        and (public.can_access_org(sessions.warehouse_organization_id) or public.is_hq_admin())
    )
  );

grant select, insert, delete on public.stock_count_session_scope to authenticated;

-- Historical drafts did not persist their entire blank catalog. Preserve the
-- only authoritative snapshot they do have: their saved configuration items.
-- Do not infer or inject newly visible zero-balance configurations.
insert into public.stock_count_session_scope (session_id, stock_config_id)
select distinct items.session_id, items.stock_config_id
from public.stock_count_session_items items
where items.stock_config_id is not null
on conflict (session_id, stock_config_id) do nothing;

commit;
