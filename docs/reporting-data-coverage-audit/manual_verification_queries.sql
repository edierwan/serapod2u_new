-- Serapod2U Reporting Data Coverage Audit
-- Manual verification queries
-- Read-only SELECT queries only.

-- ============================================================
-- 1. Core coverage spot check
-- ============================================================
with scan_base as (
  select *
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
)
select
  count(*)::bigint as total_non_manual_scans,
  count(*) filter (where shop_id is not null)::bigint as scans_with_shop_id,
  count(*) filter (where shop_id is null)::bigint as scans_without_shop_id,
  count(*) filter (where consumer_id is not null)::bigint as scans_with_consumer_id,
  count(*) filter (where consumer_id is null)::bigint as scans_without_consumer_id,
  count(*) filter (where shop_id is not null and consumer_id is not null)::bigint as scans_with_both,
  count(*) filter (where shop_id is null and consumer_id is null)::bigint as scans_with_neither
from scan_base;

-- ============================================================
-- 2. Monthly attribution percentages
-- ============================================================
with scan_base as (
  select *
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
)
select
  to_char(date_trunc('month', scanned_at), 'YYYY-MM') as month,
  count(*)::bigint as total_scans,
  round(100.0 * count(*) filter (where shop_id is not null) / nullif(count(*), 0), 2) as pct_shop_attributed,
  round(100.0 * count(*) filter (where consumer_id is not null) / nullif(count(*), 0), 2) as pct_consumer_identified,
  count(*) filter (where shop_id is null and consumer_id is null)::bigint as neither_present_count
from scan_base
group by 1
order by 1;

-- ============================================================
-- 3. Missing shop_id field availability
-- ============================================================
with missing_shop as (
  select s.*
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.shop_id is null
), joined as (
  select
    ms.id,
    ms.claim_lane,
    ms.consumer_id,
    ms.qr_code_id,
    ms.points_amount,
    ms.collected_points,
    ms.ip_address,
    ms.user_agent,
    q.product_id,
    q.variant_id,
    q.order_id,
    q.current_location_org_id,
    q.consumer_name as qr_consumer_name,
    q.consumer_phone as qr_consumer_phone,
    q.consumer_email as qr_consumer_email
  from missing_shop ms
  left join public.qr_codes q on q.id = ms.qr_code_id
)
select
  count(*)::bigint as total_missing_shop_rows,
  count(*) filter (where qr_code_id is not null)::bigint as with_qr_code,
  count(*) filter (where product_id is not null)::bigint as with_product_id_via_qr,
  count(*) filter (where variant_id is not null)::bigint as with_variant_id_via_qr,
  count(*) filter (where order_id is not null)::bigint as with_order_id_via_qr,
  count(*) filter (where consumer_id is not null)::bigint as with_consumer_id,
  count(*) filter (where nullif(trim(qr_consumer_name), '') is not null)::bigint as with_qr_consumer_name,
  count(*) filter (where nullif(trim(qr_consumer_phone), '') is not null)::bigint as with_qr_consumer_phone,
  count(*) filter (where nullif(trim(qr_consumer_email), '') is not null)::bigint as with_qr_consumer_email,
  count(*) filter (where current_location_org_id is not null)::bigint as with_current_location_org,
  count(*) filter (where claim_lane = 'shop')::bigint as claim_lane_shop,
  count(*) filter (where claim_lane = 'consumer')::bigint as claim_lane_consumer
from joined;

-- ============================================================
-- 4. Missing shop_id inference risk through order organizations
-- ============================================================
with missing_shop as (
  select s.id, s.qr_code_id
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.shop_id is null
)
select
  seller.org_type_code as seller_org_type,
  wh.org_type_code as warehouse_org_type,
  count(*)::bigint as row_count
from missing_shop ms
left join public.qr_codes q on q.id = ms.qr_code_id
left join public.orders ord on ord.id = q.order_id
left join public.organizations seller on seller.id = ord.seller_org_id
left join public.organizations wh on wh.id = ord.warehouse_org_id
group by seller.org_type_code, wh.org_type_code
order by row_count desc;

-- ============================================================
-- 5. Missing consumer_id fallback identity coverage
-- ============================================================
with missing_consumer as (
  select s.id, s.qr_code_id
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.consumer_id is null
), base as (
  select
    mc.id,
    nullif(trim(q.consumer_name), '') as qr_consumer_name,
    nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
    nullif(trim(q.consumer_email), '') as qr_consumer_email,
    exists(
      select 1
      from public.users u
      where lower(u.email) = lower(nullif(trim(q.consumer_email), ''))
    ) as qr_email_matches_user,
    exists(
      select 1
      from public.users u
      where regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') <> ''
        and regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(q.consumer_phone, ''), '[^0-9]', '', 'g')
    ) as qr_phone_matches_user
  from missing_consumer mc
  left join public.qr_codes q on q.id = mc.qr_code_id
)
select
  count(*)::bigint as total_missing_consumer_rows,
  count(*) filter (where qr_consumer_name is not null)::bigint as qr_has_consumer_name,
  count(*) filter (where qr_consumer_phone is not null)::bigint as qr_has_consumer_phone,
  count(*) filter (where qr_consumer_email is not null)::bigint as qr_has_consumer_email,
  count(*) filter (where qr_email_matches_user)::bigint as qr_email_matches_user,
  count(*) filter (where qr_phone_matches_user)::bigint as qr_phone_matches_user,
  count(*) filter (where qr_email_matches_user or qr_phone_matches_user)::bigint as any_fallback_matches_user
from base;

-- ============================================================
-- 6. Shop organization completeness spot check
-- ============================================================
with shop_orgs as (
  select o.*, s.state_name, r.region_name
  from public.organizations o
  left join public.states s on s.id = o.state_id
  left join public.regions r on r.id = s.region_id
  where o.org_type_code = 'SHOP'
)
select
  count(*)::bigint as total_shops,
  count(*) filter (where state_id is not null)::bigint as shops_with_state,
  count(*) filter (where nullif(trim(branch), '') is not null)::bigint as shops_with_branch,
  count(*) filter (where nullif(trim(city), '') is not null)::bigint as shops_with_city,
  count(*) filter (where nullif(trim(contact_phone), '') is not null)::bigint as shops_with_contact_phone,
  count(*) filter (where nullif(trim(contact_email), '') is not null)::bigint as shops_with_contact_email,
  count(*) filter (where region_name is not null)::bigint as shops_with_region_name
from shop_orgs;

-- ============================================================
-- 7. Regional readiness top groups
-- ============================================================
with shop_orgs as (
  select
    o.id,
    coalesce(s.state_name, 'Unknown') as state_name,
    coalesce(nullif(trim(o.branch), ''), 'Unknown') as branch
  from public.organizations o
  left join public.states s on s.id = o.state_id
  where o.org_type_code = 'SHOP'
), scans as (
  select shop_id, scanned_at
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
    and shop_id is not null
)
select
  state_name,
  branch,
  count(distinct shop_orgs.id)::bigint as total_shops,
  count(distinct shop_orgs.id) filter (where scans.scanned_at >= now() - interval '30 days')::bigint as shops_with_scans_last_30_days,
  count(scans.*) filter (where scans.scanned_at >= now() - interval '30 days')::bigint as attributed_scans_last_30_days,
  count(scans.*) filter (where scans.scanned_at >= now() - interval '90 days')::bigint as attributed_scans_last_90_days
from shop_orgs
left join scans on scans.shop_id = shop_orgs.id
group by state_name, branch
order by attributed_scans_last_90_days desc, state_name, branch
limit 25;

-- ============================================================
-- 8. Safe sample rows for manual verification
-- ============================================================

-- Missing shop_id sample
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.consumer_id,
  s.qr_code_id,
  q.product_id,
  q.variant_id,
  q.order_id,
  s.points_amount,
  s.collected_points,
  q.consumer_name,
  q.consumer_phone,
  q.consumer_email
from public.consumer_qr_scans s
left join public.qr_codes q on q.id = s.qr_code_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is null
order by s.scanned_at desc
limit 100;

-- Missing consumer_id sample
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.shop_id,
  o.org_name as shop_org_name,
  s.qr_code_id,
  q.consumer_name,
  q.consumer_phone,
  q.consumer_email,
  s.points_amount,
  s.collected_points
from public.consumer_qr_scans s
left join public.organizations o on o.id = s.shop_id
left join public.qr_codes q on q.id = s.qr_code_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.consumer_id is null
order by s.scanned_at desc
limit 100;

-- Missing both sample
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.qr_code_id,
  q.product_id,
  q.variant_id,
  q.order_id,
  s.points_amount,
  q.consumer_name,
  q.consumer_phone,
  q.consumer_email
from public.consumer_qr_scans s
left join public.qr_codes q on q.id = s.qr_code_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is null
  and s.consumer_id is null
order by s.scanned_at desc
limit 100;

-- Both present sample
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  o.org_name as shop_org_name,
  o.branch,
  u.full_name,
  u.phone,
  u.email,
  s.qr_code_id,
  s.points_amount,
  s.collected_points
from public.consumer_qr_scans s
left join public.organizations o on o.id = s.shop_id
left join public.users u on u.id = s.consumer_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is not null
  and s.consumer_id is not null
order by s.scanned_at desc
limit 100;