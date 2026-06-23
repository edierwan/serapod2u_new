-- Ellbow Loyalty Phase 2: financial preview field and final scope guards.
-- Run after 20260623_ellbow_roadtour_integration_05.sql.
-- Rollback: remove the added reward column and mapping guard trigger only if unused.

alter table public.ellbow_rewards
  add column if not exists estimated_financial_cost_rm numeric(12,2) null
  check (estimated_financial_cost_rm is null or estimated_financial_cost_rm >= 0);

comment on column public.ellbow_rewards.estimated_financial_cost_rm is
  'Optional admin-entered fulfillment cost used for non-blocking Ellbow margin warnings.';

create or replace function public.ellbow_enforce_mapping_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.loyalty_programs p where p.id = new.loyalty_program_id and p.organization_id = new.organization_id and p.code = 'ellbow') then
    raise exception 'Mapping must belong to Ellbow Loyalty';
  end if;
  if not exists (
    select 1 from public.product_categories c where c.id = new.product_category_id and c.is_active = true
      and (lower(regexp_replace(coalesce(c.category_code,''), '[^a-zA-Z0-9]+', '', 'g')) = 'petfood'
        or lower(regexp_replace(coalesce(c.category_name,''), '[^a-zA-Z0-9]+', '', 'g')) = 'petfood')
  ) then raise exception 'Ellbow mapping requires an active Pet Food category'; end if;
  return new;
end;
$$;

drop trigger if exists ellbow_mappings_enforce_scope on public.ellbow_loyalty_mappings;
create trigger ellbow_mappings_enforce_scope before insert or update on public.ellbow_loyalty_mappings
for each row execute function public.ellbow_enforce_mapping_scope();

revoke insert, update, delete on public.ellbow_wallets from authenticated, anon;
revoke insert, update, delete on public.ellbow_point_transactions from authenticated, anon;
revoke insert, update, delete on public.ellbow_redemptions from authenticated, anon;
revoke insert, update, delete on public.ellbow_referral_accruals from authenticated, anon;

create index if not exists ellbow_rewards_cost_preview_idx
  on public.ellbow_rewards(organization_id, loyalty_program_id, estimated_financial_cost_rm)
  where estimated_financial_cost_rm is not null;
