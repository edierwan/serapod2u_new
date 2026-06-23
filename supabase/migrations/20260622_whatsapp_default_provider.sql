-- Persist the default provider independently from the provider currently being edited.
alter table public.notification_provider_configs
  add column if not exists is_default boolean not null default false;

-- Preserve existing behaviour: prefer the newest enabled WhatsApp provider per org.
with ranked as (
  select id,
         row_number() over (
           partition by org_id, channel
           order by is_active desc, updated_at desc nulls last, created_at desc nulls last, id
         ) as position
  from public.notification_provider_configs
  where channel = 'whatsapp' and is_active = true
)
update public.notification_provider_configs config
set is_default = true
from ranked
where config.id = ranked.id
  and ranked.position = 1
  and not exists (
    select 1
    from public.notification_provider_configs existing
    where existing.org_id = config.org_id
      and existing.channel = 'whatsapp'
      and existing.is_default = true
  );

create unique index if not exists notification_provider_configs_one_default_per_channel
  on public.notification_provider_configs (org_id, channel)
  where is_default = true;

alter table public.notification_provider_configs
  drop constraint if exists notification_provider_configs_default_must_be_active;

alter table public.notification_provider_configs
  add constraint notification_provider_configs_default_must_be_active
  check (not is_default or is_active);

create or replace function public.set_default_whatsapp_provider(
  p_org_id uuid,
  p_provider_name text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_id uuid;
begin
  select id into selected_id
  from public.notification_provider_configs
  where org_id = p_org_id
    and channel = 'whatsapp'
    and provider_name = p_provider_name
    and is_active = true
    and (config_public is not null or config_encrypted is not null)
  for update;

  if selected_id is null then
    raise exception 'Provider must be configured and enabled before it can be set as default';
  end if;

  update public.notification_provider_configs
  set is_default = (id = selected_id), updated_at = now()
  where org_id = p_org_id and channel = 'whatsapp';

  return selected_id;
end;
$$;
