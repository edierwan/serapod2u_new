-- Ellbow Loyalty Phase 2: explicit Pet Food category mapping and atomic RoadTour awards.
-- Run after 20260623_ellbow_reporting_referrals_04.sql.
-- Rollback: drop ellbow_award_roadtour_scan and ellbow_loyalty_mappings.
-- Existing Vape/Cellera RoadTour records and functions are not altered.

create table if not exists public.ellbow_loyalty_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loyalty_program_id uuid not null,
  product_category_id uuid not null references public.product_categories(id) on delete restrict,
  experience_key text not null default 'pet_food' check (experience_key = 'pet_food'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ellbow_mappings_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete restrict,
  constraint ellbow_mappings_org_category_key unique (organization_id, product_category_id),
  constraint ellbow_mappings_identity_key unique (id, organization_id, loyalty_program_id)
);

create index if not exists ellbow_mappings_program_idx on public.ellbow_loyalty_mappings(loyalty_program_id, active);
drop trigger if exists ellbow_mappings_set_updated_at on public.ellbow_loyalty_mappings;
create trigger ellbow_mappings_set_updated_at before update on public.ellbow_loyalty_mappings
for each row execute function public.ellbow_set_updated_at();

-- Add only mapping rows. No existing category, RoadTour, reward, wallet, or Cellera row is updated.
insert into public.ellbow_loyalty_mappings (organization_id, loyalty_program_id, product_category_id)
select p.organization_id, p.id, c.id
from public.loyalty_programs p
cross join public.product_categories c
where p.code = 'ellbow'
  and c.is_active = true
  and (lower(regexp_replace(coalesce(c.category_code,''), '[^a-zA-Z0-9]+', '', 'g')) = 'petfood'
    or lower(regexp_replace(coalesce(c.category_name,''), '[^a-zA-Z0-9]+', '', 'g')) = 'petfood')
on conflict (organization_id, product_category_id) do nothing;

alter table public.ellbow_loyalty_mappings enable row level security;
drop policy if exists ellbow_mappings_admin_select on public.ellbow_loyalty_mappings;
create policy ellbow_mappings_admin_select on public.ellbow_loyalty_mappings for select to authenticated using (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
);
drop policy if exists ellbow_mappings_admin_manage on public.ellbow_loyalty_mappings;
create policy ellbow_mappings_admin_manage on public.ellbow_loyalty_mappings for all to authenticated using (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
) with check (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
);

create or replace function public.ellbow_award_roadtour_scan(
  p_roadtour_event_id uuid,
  p_campaign_id uuid,
  p_scan_id uuid,
  p_participant_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mapping public.ellbow_loyalty_mappings%rowtype;
  v_settings public.ellbow_loyalty_settings%rowtype;
  v_user public.users%rowtype;
  v_org_type text;
  v_staff_points bigint := 0;
  v_consumer_points bigint := 0;
  v_staff_result jsonb;
  v_consumer_result jsonb;
  v_registration_result jsonb;
  v_referral_result jsonb;
  v_referrer uuid;
  v_referral_transaction uuid;
  v_total bigint := 0;
  v_balance bigint := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  select m.* into v_mapping
  from public.ellbow_loyalty_mappings m
  join public.roadtour_runs rr on rr.id = p_roadtour_event_id and rr.product_category_id = m.product_category_id
  join public.roadtour_campaigns rc on rc.id = p_campaign_id and rc.roadtour_run_id = rr.id and rc.org_id = m.organization_id
  where m.active = true and m.experience_key = 'pet_food';
  if not found then return jsonb_build_object('success', false, 'awarded', false, 'reason', 'not_ellbow_event'); end if;

  if not exists (select 1 from public.roadtour_scan_events s where s.id = p_scan_id and s.campaign_id = p_campaign_id and s.scanned_by_user_id = p_participant_user_id) then
    raise exception 'Invalid RoadTour scan context';
  end if;
  select * into v_settings from public.ellbow_loyalty_settings s
  where s.organization_id = v_mapping.organization_id and s.loyalty_program_id = v_mapping.loyalty_program_id;
  if not found or not v_settings.active then
    return jsonb_build_object('success', true, 'awarded', false, 'reason', 'ellbow_inactive', 'points_awarded', 0);
  end if;
  if v_settings.point_value_rm <= 0 or (v_settings.staff_points_per_scan <= 0 and v_settings.consumer_points_per_scan <= 0 and v_settings.roadtour_reward_points <= 0) then
    return jsonb_build_object('success', true, 'awarded', false, 'reason', 'ellbow_settings_incomplete', 'points_awarded', 0);
  end if;

  select * into v_user from public.users u where u.id = p_participant_user_id and u.is_active = true;
  if not found then raise exception 'Invalid Ellbow participant'; end if;
  select o.org_type_code into v_org_type from public.organizations o where o.id = v_user.organization_id;

  if v_org_type = 'SHOP' then
    v_staff_points := coalesce(nullif(v_settings.roadtour_reward_points, 0), v_settings.staff_points_per_scan);
  end if;
  if v_settings.claim_mode = 'dual' then v_consumer_points := v_settings.consumer_points_per_scan; end if;

  if v_staff_points > 0 then
    v_staff_result := public.ellbow_apply_points_core(v_mapping.organization_id, v_mapping.loyalty_program_id,
      p_participant_user_id, 'shop_staff', v_staff_points, 'roadtour_bonus', 'roadtour_scan',
      'roadtour:' || p_scan_id::text || ':shop_staff', 'Ellbow RoadTour Pet Food award', p_scan_id,
      p_roadtour_event_id, p_campaign_id, null, p_scan_id,
      jsonb_build_object('experience', 'pet_food'), p_participant_user_id);
    v_total := v_total + v_staff_points;
    v_balance := (v_staff_result->>'balance_after')::bigint;
  end if;
  if v_consumer_points > 0 then
    v_consumer_result := public.ellbow_apply_points_core(v_mapping.organization_id, v_mapping.loyalty_program_id,
      p_participant_user_id, 'consumer', v_consumer_points, 'roadtour_bonus', 'roadtour_scan',
      'roadtour:' || p_scan_id::text || ':consumer', 'Ellbow RoadTour Pet Food consumer award', p_scan_id,
      p_roadtour_event_id, p_campaign_id, null, p_scan_id,
      jsonb_build_object('experience', 'pet_food'), p_participant_user_id);
    v_total := v_total + v_consumer_points;
    v_balance := (v_consumer_result->>'balance_after')::bigint;
  end if;

  if v_settings.registration_bonus > 0 then
    v_registration_result := public.ellbow_apply_points_core(v_mapping.organization_id, v_mapping.loyalty_program_id,
      p_participant_user_id, 'consumer', v_settings.registration_bonus, 'registration_bonus', 'roadtour_registration',
      'registration:' || p_roadtour_event_id::text || ':' || p_participant_user_id::text,
      'Ellbow Pet Food registration bonus', p_participant_user_id, p_roadtour_event_id, p_campaign_id, null, p_scan_id,
      jsonb_build_object('eligible_flow', 'pet_food_roadtour'), p_participant_user_id);
    v_balance := (v_registration_result->>'balance_after')::bigint;
  end if;

  if v_settings.referral_incentive_default > 0 and nullif(btrim(v_user.referral_phone), '') is not null then
    select u.id into v_referrer from public.users u
    where u.id <> p_participant_user_id and u.is_active = true
      and right(regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g'), 9) = right(regexp_replace(v_user.referral_phone, '[^0-9]', '', 'g'), 9)
    limit 1;
    if v_referrer is not null then
      v_referral_result := public.ellbow_apply_points_core(v_mapping.organization_id, v_mapping.loyalty_program_id,
        v_referrer, 'consumer', v_settings.referral_incentive_default, 'referral_bonus', 'roadtour_referral',
        'referral:' || p_roadtour_event_id::text || ':' || p_participant_user_id::text,
        'Ellbow Pet Food referral bonus', p_participant_user_id, p_roadtour_event_id, p_campaign_id, null, p_scan_id,
        jsonb_build_object('referred_user_id', p_participant_user_id), p_participant_user_id);
      v_referral_transaction := (v_referral_result->>'transaction_id')::uuid;
      insert into public.ellbow_referral_accruals (
        organization_id, loyalty_program_id, referrer_user_id, referred_user_id, event_id, campaign_id,
        points_awarded, point_value_rm, transaction_id, idempotency_key
      ) values (
        v_mapping.organization_id, v_mapping.loyalty_program_id, v_referrer, p_participant_user_id,
        p_roadtour_event_id, p_campaign_id, v_settings.referral_incentive_default, v_settings.point_value_rm,
        v_referral_transaction, 'referral:' || p_roadtour_event_id::text || ':' || p_participant_user_id::text
      ) on conflict (organization_id, loyalty_program_id, idempotency_key) do nothing;
    end if;
  end if;

  -- reward_transaction_id intentionally remains NULL because that legacy column
  -- references Cellera points_transactions. Ellbow transaction ids stay in the
  -- isolated ellbow_point_transactions ledger.
  update public.roadtour_scan_events set scan_status = 'success', points_awarded = v_total
  where id = p_scan_id;

  return jsonb_build_object('success', true, 'awarded', v_total > 0, 'points_awarded', v_total,
    'balance_after', v_balance, 'staff', v_staff_result, 'consumer', v_consumer_result,
    'registration_bonus', v_registration_result, 'referral_bonus', v_referral_result,
    'loyalty_program_id', v_mapping.loyalty_program_id);
end;
$$;
revoke all on function public.ellbow_award_roadtour_scan(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ellbow_award_roadtour_scan(uuid,uuid,uuid,uuid) to service_role;

comment on table public.ellbow_loyalty_mappings is 'Stable Product Category to Ellbow program mapping used only for Pet Food RoadTour flows.';
