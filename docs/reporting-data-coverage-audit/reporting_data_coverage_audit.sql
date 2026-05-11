-- Serapod2U Reporting Data Coverage Audit
-- Read-only audit queries only.
-- All sections below use SELECT statements and do not modify database data.

-- ============================================================
-- A. Overall scan coverage
-- ============================================================
with scan_base as (
  select *
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
)
select metric, count_value
from (
  select 'total_non_manual_scans' as metric, count(*)::bigint as count_value from scan_base
  union all select 'scans_with_shop_id', count(*)::bigint from scan_base where shop_id is not null
  union all select 'scans_without_shop_id', count(*)::bigint from scan_base where shop_id is null
  union all select 'scans_with_consumer_id', count(*)::bigint from scan_base where consumer_id is not null
  union all select 'scans_without_consumer_id', count(*)::bigint from scan_base where consumer_id is null
  union all select 'scans_with_both_shop_id_and_consumer_id', count(*)::bigint from scan_base where shop_id is not null and consumer_id is not null
  union all select 'scans_with_shop_id_but_no_consumer_id', count(*)::bigint from scan_base where shop_id is not null and consumer_id is null
  union all select 'scans_with_consumer_id_but_no_shop_id', count(*)::bigint from scan_base where shop_id is null and consumer_id is not null
  union all select 'scans_with_neither_shop_id_nor_consumer_id', count(*)::bigint from scan_base where shop_id is null and consumer_id is null
) metrics
order by metric;

-- ============================================================
-- B. Coverage by month
-- ============================================================
with scan_base as (
  select *
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
)
select
  to_char(date_trunc('month', scanned_at), 'YYYY-MM') as month,
  count(*)::bigint as total_scans,
  count(*) filter (where shop_id is not null)::bigint as shop_id_present_count,
  count(*) filter (where shop_id is null)::bigint as shop_id_missing_count,
  count(*) filter (where consumer_id is not null)::bigint as consumer_id_present_count,
  count(*) filter (where consumer_id is null)::bigint as consumer_id_missing_count,
  count(*) filter (where shop_id is not null and consumer_id is not null)::bigint as both_present_count,
  count(*) filter (where shop_id is null and consumer_id is null)::bigint as neither_present_count,
  round(100.0 * count(*) filter (where shop_id is not null) / nullif(count(*), 0), 2) as pct_shop_attributed,
  round(100.0 * count(*) filter (where consumer_id is not null) / nullif(count(*), 0), 2) as pct_consumer_identified
from scan_base
group by 1
order by 1;

-- ============================================================
-- C. Coverage by claim_lane
-- ============================================================
with scan_base as (
  select *
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
)
select
  coalesce(claim_lane, 'null') as claim_lane,
  count(*)::bigint as total_scans,
  count(*) filter (where shop_id is not null)::bigint as shop_id_present_count,
  count(*) filter (where shop_id is null)::bigint as shop_id_missing_count,
  count(*) filter (where consumer_id is not null)::bigint as consumer_id_present_count,
  count(*) filter (where consumer_id is null)::bigint as consumer_id_missing_count,
  coalesce(sum(points_amount), 0)::bigint as points_amount_total,
  count(*) filter (where collected_points = true)::bigint as collected_points_count
from scan_base
group by 1
order by total_scans desc, claim_lane;

-- ============================================================
-- D. Missing shop_id breakdown
-- ============================================================
with missing_shop as (
  select s.*
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.shop_id is null
), joined as (
  select
    ms.id,
    ms.scanned_at,
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
    nullif(trim(q.consumer_name), '') as qr_consumer_name,
    nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
    nullif(trim(q.consumer_email), '') as qr_consumer_email,
    u.full_name as linked_consumer_name,
    u.phone as linked_consumer_phone,
    u.email as linked_consumer_email,
    o.org_name as current_location_org_name,
    o.org_type_code as current_location_org_type,
    p.product_name,
    v.variant_name
  from missing_shop ms
  left join public.qr_codes q on q.id = ms.qr_code_id
  left join public.users u on u.id = ms.consumer_id
  left join public.organizations o on o.id = q.current_location_org_id
  left join public.products p on p.id = q.product_id
  left join public.product_variants v on v.id = q.variant_id
)
select
  field_or_path,
  rows_present,
  round(100.0 * rows_present / nullif(total_rows, 0), 2) as pct_of_missing_shop_rows,
  interpretation
from (
  select 'qr_code_id' as field_or_path, count(*) filter (where qr_code_id is not null)::bigint as rows_present, count(*)::bigint as total_rows,
         'QR identity is preserved even when shop_id is missing.' as interpretation
  from joined
  union all
  select 'product_id_via_qr', count(*) filter (where product_id is not null)::bigint, count(*)::bigint,
         'Product context is recoverable via qr_codes.'
  from joined
  union all
  select 'variant_id_via_qr', count(*) filter (where variant_id is not null)::bigint, count(*)::bigint,
         'Variant context is recoverable via qr_codes.'
  from joined
  union all
  select 'order_id_via_qr', count(*) filter (where order_id is not null)::bigint, count(*)::bigint,
         'Order lineage is recoverable via qr_codes.'
  from joined
  union all
  select 'consumer_id', count(*) filter (where consumer_id is not null)::bigint, count(*)::bigint,
         'A subset still preserves direct consumer identity.'
  from joined
  union all
  select 'qr_consumer_name', count(*) filter (where qr_consumer_name is not null)::bigint, count(*)::bigint,
         'QR-level fallback name exists on many rows but is not a shop key.'
  from joined
  union all
  select 'qr_consumer_phone', count(*) filter (where qr_consumer_phone is not null)::bigint, count(*)::bigint,
         'QR-level fallback phone exists on many rows but does not recover shop_id.'
  from joined
  union all
  select 'qr_consumer_email', count(*) filter (where qr_consumer_email is not null)::bigint, count(*)::bigint,
         'QR-level fallback email exists on many rows but does not recover shop_id.'
  from joined
  union all
  select 'ip_address', count(*) filter (where ip_address is not null)::bigint, count(*)::bigint,
         'Event source metadata exists on a subset of missing-shop rows.'
  from joined
  union all
  select 'user_agent', count(*) filter (where user_agent is not null)::bigint, count(*)::bigint,
         'Device/browser metadata exists on a subset of missing-shop rows.'
  from joined
  union all
  select 'current_location_org_id_via_qr', count(*) filter (where current_location_org_id is not null)::bigint, count(*)::bigint,
         'Current organization ownership is not materially populated for missing-shop recovery.'
  from joined
) summary
order by rows_present desc, field_or_path;

-- Detailed missing shop rows for manual inspection
with missing_shop as (
  select s.*
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.shop_id is null
)
select
  ms.id,
  ms.scanned_at,
  ms.claim_lane,
  ms.consumer_id,
  ms.qr_code_id,
  q.product_id,
  p.product_name,
  q.variant_id,
  v.variant_name,
  q.order_id,
  ms.points_amount,
  ms.collected_points,
  ms.ip_address,
  ms.user_agent,
  q.current_location_org_id,
  o.org_name as current_location_org_name,
  o.org_type_code as current_location_org_type,
  nullif(trim(q.consumer_name), '') as qr_consumer_name,
  nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
  nullif(trim(q.consumer_email), '') as qr_consumer_email,
  u.full_name as linked_consumer_name,
  u.phone as linked_consumer_phone,
  u.email as linked_consumer_email
from missing_shop ms
left join public.qr_codes q on q.id = ms.qr_code_id
left join public.products p on p.id = q.product_id
left join public.product_variants v on v.id = q.variant_id
left join public.organizations o on o.id = q.current_location_org_id
left join public.users u on u.id = ms.consumer_id
order by ms.scanned_at desc
limit 100;

-- ============================================================
-- E. Missing consumer_id breakdown
-- ============================================================
with missing_consumer as (
  select s.*
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.consumer_id is null
), joined as (
  select
    mc.id,
    mc.scanned_at,
    mc.claim_lane,
    mc.shop_id,
    mc.qr_code_id,
    mc.points_amount,
    mc.collected_points,
    nullif(trim(mc.consumer_name), '') as scan_consumer_name,
    nullif(trim(mc.consumer_phone), '') as scan_consumer_phone,
    nullif(trim(mc.consumer_email), '') as scan_consumer_email,
    q.product_id,
    q.variant_id,
    nullif(trim(q.consumer_name), '') as qr_consumer_name,
    nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
    nullif(trim(q.consumer_email), '') as qr_consumer_email,
    o.org_name as shop_org_name,
    a.consumer_name as activation_consumer_name,
    a.consumer_phone as activation_consumer_phone,
    a.consumer_email as activation_consumer_email
  from missing_consumer mc
  left join public.qr_codes q on q.id = mc.qr_code_id
  left join public.organizations o on o.id = mc.shop_id
  left join public.consumer_activations a on a.qr_code_id = mc.qr_code_id
)
select
  field_or_path,
  rows_present,
  round(100.0 * rows_present / nullif(total_rows, 0), 2) as pct_of_missing_consumer_rows,
  interpretation
from (
  select 'shop_id' as field_or_path, count(*) filter (where shop_id is not null)::bigint as rows_present, count(*)::bigint as total_rows,
         'A very small subset remains shop-attributed even when consumer_id is missing.' as interpretation
  from joined
  union all
  select 'qr_code_id', count(*) filter (where qr_code_id is not null)::bigint, count(*)::bigint,
         'QR identity is preserved even when consumer_id is missing.'
  from joined
  union all
  select 'product_id_via_qr', count(*) filter (where product_id is not null)::bigint, count(*)::bigint,
         'Product context is recoverable via qr_codes.'
  from joined
  union all
  select 'variant_id_via_qr', count(*) filter (where variant_id is not null)::bigint, count(*)::bigint,
         'Variant context is recoverable via qr_codes.'
  from joined
  union all
  select 'scan_consumer_name', count(*) filter (where scan_consumer_name is not null)::bigint, count(*)::bigint,
         'Current scan-row fallback name does not materially help.'
  from joined
  union all
  select 'scan_consumer_phone', count(*) filter (where scan_consumer_phone is not null)::bigint, count(*)::bigint,
         'Current scan-row fallback phone does not materially help.'
  from joined
  union all
  select 'scan_consumer_email', count(*) filter (where scan_consumer_email is not null)::bigint, count(*)::bigint,
         'Current scan-row fallback email does not materially help.'
  from joined
  union all
  select 'qr_consumer_name', count(*) filter (where qr_consumer_name is not null)::bigint, count(*)::bigint,
         'QR-level fallback name exists for a material subset.'
  from joined
  union all
  select 'qr_consumer_phone', count(*) filter (where qr_consumer_phone is not null)::bigint, count(*)::bigint,
         'QR-level fallback phone exists for a material subset.'
  from joined
  union all
  select 'qr_consumer_email', count(*) filter (where qr_consumer_email is not null)::bigint, count(*)::bigint,
         'QR-level fallback email exists for a material subset.'
  from joined
  union all
  select 'activation_consumer_name', count(*) filter (where nullif(trim(activation_consumer_name), '') is not null)::bigint, count(*)::bigint,
         'consumer_activations does not currently add meaningful fallback identity for this population.'
  from joined
  union all
  select 'activation_consumer_phone', count(*) filter (where nullif(trim(activation_consumer_phone), '') is not null)::bigint, count(*)::bigint,
         'consumer_activations does not currently add meaningful fallback phone for this population.'
  from joined
  union all
  select 'activation_consumer_email', count(*) filter (where nullif(trim(activation_consumer_email), '') is not null)::bigint, count(*)::bigint,
         'consumer_activations does not currently add meaningful fallback email for this population.'
  from joined
) summary
order by rows_present desc, field_or_path;

-- Detailed missing consumer rows for manual inspection
with missing_consumer as (
  select s.*
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.consumer_id is null
)
select
  mc.id,
  mc.scanned_at,
  mc.claim_lane,
  mc.shop_id,
  o.org_name as shop_org_name,
  mc.qr_code_id,
  q.product_id,
  p.product_name,
  q.variant_id,
  v.variant_name,
  mc.points_amount,
  mc.collected_points,
  nullif(trim(mc.consumer_name), '') as scan_consumer_name,
  nullif(trim(mc.consumer_phone), '') as scan_consumer_phone,
  nullif(trim(mc.consumer_email), '') as scan_consumer_email,
  nullif(trim(q.consumer_name), '') as qr_consumer_name,
  nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
  nullif(trim(q.consumer_email), '') as qr_consumer_email
from missing_consumer mc
left join public.organizations o on o.id = mc.shop_id
left join public.qr_codes q on q.id = mc.qr_code_id
left join public.products p on p.id = q.product_id
left join public.product_variants v on v.id = q.variant_id
order by mc.scanned_at desc
limit 100;

-- ============================================================
-- F. Shop attribution recoverability check
-- ============================================================
with missing_shop as (
  select s.id, s.qr_code_id, s.claim_lane
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.shop_id is null
), joined as (
  select
    ms.id,
    ms.claim_lane,
    q.product_id,
    q.variant_id,
    q.order_id,
    q.current_location_org_id,
    buyer.org_type_code as buyer_org_type,
    seller.org_type_code as seller_org_type,
    wh.org_type_code as warehouse_org_type
  from missing_shop ms
  left join public.qr_codes q on q.id = ms.qr_code_id
  left join public.orders ord on ord.id = q.order_id
  left join public.organizations buyer on buyer.id = ord.buyer_org_id
  left join public.organizations seller on seller.id = ord.seller_org_id
  left join public.organizations wh on wh.id = ord.warehouse_org_id
)
select *
from (
  select
    'qr_codes.product_id / qr_codes.variant_id' as candidate_source_table,
    count(*) filter (where product_id is not null and variant_id is not null)::bigint as rows_with_signal,
    'no' as recoverable_path_exists,
    'high' as confidence,
    'not a shop key' as risk,
    'This path recovers product lineage only, not shop attribution.' as notes
  from joined
  union all
  select
    'qr_codes.order_id -> orders buyer/seller/warehouse orgs',
    count(*) filter (where order_id is not null)::bigint,
    'no',
    'high',
    'order organizations resolve to manufacturer and warehouse, not scanning shop',
    'Observed missing-shop rows map to seller=MFG and warehouse=WH.'
  from joined
  union all
  select
    'qr_codes.current_location_org_id',
    count(*) filter (where current_location_org_id is not null)::bigint,
    'no',
    'high',
    'field not populated for the missing-shop population',
    'No usable current-location organization path was found.'
  from joined
  union all
  select
    'consumer_qr_scans.claim_lane = shop',
    count(*) filter (where claim_lane = 'shop')::bigint,
    'no',
    'high',
    'missing-shop rows are not shop-lane rows in current production',
    'Current missing-shop population is entirely consumer-lane.'
  from joined
) recoverability;

-- ============================================================
-- G. Consumer identity recoverability check
-- ============================================================
with missing_consumer as (
  select s.id, s.qr_code_id, s.consumer_name, s.consumer_phone, s.consumer_email
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.consumer_id is null
), base as (
  select
    mc.id,
    nullif(trim(mc.consumer_name), '') as scan_consumer_name,
    nullif(trim(mc.consumer_phone), '') as scan_consumer_phone,
    nullif(trim(mc.consumer_email), '') as scan_consumer_email,
    nullif(trim(q.consumer_name), '') as qr_consumer_name,
    nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
    nullif(trim(q.consumer_email), '') as qr_consumer_email,
    nullif(trim(a.consumer_name), '') as activation_consumer_name,
    nullif(trim(a.consumer_phone), '') as activation_consumer_phone,
    nullif(trim(a.consumer_email), '') as activation_consumer_email,
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
  left join public.consumer_activations a on a.qr_code_id = mc.qr_code_id
)
select *
from (
  select
    'scan row consumer_name / consumer_phone / consumer_email' as candidate_source_table,
    count(*) filter (where scan_consumer_name is not null or scan_consumer_phone is not null or scan_consumer_email is not null)::bigint as rows_with_signal,
    'no' as recoverable_path_exists,
    'high' as confidence,
    'scan-event fallback identity is effectively absent',
    'The scan row itself does not preserve usable fallback identity for this missing-consumer population.' as notes
  from base
  union all
  select
    'qr_codes consumer_name / consumer_phone / consumer_email',
    count(*) filter (where qr_consumer_name is not null or qr_consumer_phone is not null or qr_consumer_email is not null)::bigint,
    'partial',
    'medium',
    'values live on qr_codes rather than the immutable scan event',
    'This can support investigation but is not a safe event-grade substitute for consumer_id.'
  from base
  union all
  select
    'qr_codes fallback email/phone -> users exact match',
    count(*) filter (where qr_email_matches_user or qr_phone_matches_user)::bigint,
    'partial',
    'medium',
    'exact matches are possible, but duplicate or stale contact values remain a risk',
    'This is the strongest current recovery signal for missing consumer_id rows.'
  from base
  union all
  select
    'consumer_activations consumer_name / consumer_phone / consumer_email',
    count(*) filter (where activation_consumer_name is not null or activation_consumer_phone is not null or activation_consumer_email is not null)::bigint,
    'no',
    'high',
    'no meaningful production coverage for this missing-consumer population',
    'consumer_activations does not currently improve recovery for these rows.'
  from base
) recoverability;

-- ============================================================
-- H. Shop organization fields
-- ============================================================
select
  o.id as org_id,
  o.org_name,
  o.branch,
  o.city,
  o.state_id,
  s.state_name,
  r.region_name,
  o.parent_org_id,
  case when o.is_active then 'active' else 'inactive' end as status,
  o.contact_name as contact_person,
  o.contact_phone,
  o.contact_email,
  o.created_at,
  (o.state_id is not null) as has_state,
  (nullif(trim(o.branch), '') is not null) as has_branch,
  (nullif(trim(o.city), '') is not null) as has_city,
  (nullif(trim(o.contact_phone), '') is not null) as has_contact_phone,
  (nullif(trim(o.contact_email), '') is not null) as has_contact_email
from public.organizations o
left join public.states s on s.id = o.state_id
left join public.regions r on r.id = s.region_id
where o.org_type_code = 'SHOP'
order by o.org_name;

-- Shop organization summary counts
with shop_orgs as (
  select o.*, s.state_name, r.region_name
  from public.organizations o
  left join public.states s on s.id = o.state_id
  left join public.regions r on r.id = s.region_id
  where o.org_type_code = 'SHOP'
)
select metric, count_value
from (
  select 'total_shops' as metric, count(*)::bigint as count_value from shop_orgs
  union all select 'shops_with_state', count(*)::bigint from shop_orgs where state_id is not null
  union all select 'shops_with_branch', count(*)::bigint from shop_orgs where nullif(trim(branch), '') is not null
  union all select 'shops_with_city', count(*)::bigint from shop_orgs where nullif(trim(city), '') is not null
  union all select 'shops_with_contact_phone', count(*)::bigint from shop_orgs where nullif(trim(contact_phone), '') is not null
  union all select 'shops_with_contact_email', count(*)::bigint from shop_orgs where nullif(trim(contact_email), '') is not null
) metrics
order by metric;

-- ============================================================
-- I. Regional readiness
-- ============================================================
with shop_orgs as (
  select
    o.id,
    o.org_name,
    coalesce(s.state_name, 'Unknown') as state_name,
    coalesce(nullif(trim(o.branch), ''), 'Unknown') as branch
  from public.organizations o
  left join public.states s on s.id = o.state_id
  where o.org_type_code = 'SHOP'
), attributed_scans as (
  select shop_id, scanned_at
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
    and shop_id is not null
)
select
  shop_orgs.state_name,
  shop_orgs.branch,
  count(distinct shop_orgs.id)::bigint as total_shops,
  count(distinct shop_orgs.id) filter (where attributed_scans.scanned_at >= now() - interval '7 days')::bigint as shops_with_scans_last_7_days,
  count(distinct shop_orgs.id) filter (where attributed_scans.scanned_at >= now() - interval '30 days')::bigint as shops_with_scans_last_30_days,
  count(distinct shop_orgs.id) filter (where attributed_scans.scanned_at >= now() - interval '90 days')::bigint as shops_with_scans_last_90_days,
  count(attributed_scans.*) filter (where attributed_scans.scanned_at >= now() - interval '30 days')::bigint as total_attributed_scans_last_30_days,
  count(attributed_scans.*) filter (where attributed_scans.scanned_at >= now() - interval '90 days')::bigint as total_attributed_scans_last_90_days
from shop_orgs
left join attributed_scans on attributed_scans.shop_id = shop_orgs.id
group by shop_orgs.state_name, shop_orgs.branch
order by total_attributed_scans_last_90_days desc, shop_orgs.state_name, shop_orgs.branch;

-- ============================================================
-- J. Safe sample rows
-- ============================================================

-- Sample scans missing shop_id
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.consumer_id,
  s.qr_code_id,
  q.product_id,
  p.product_name,
  q.variant_id,
  v.variant_name,
  q.order_id,
  s.points_amount,
  s.collected_points,
  s.ip_address,
  s.user_agent,
  q.consumer_name as qr_consumer_name,
  q.consumer_phone as qr_consumer_phone,
  q.consumer_email as qr_consumer_email
from public.consumer_qr_scans s
left join public.qr_codes q on q.id = s.qr_code_id
left join public.products p on p.id = q.product_id
left join public.product_variants v on v.id = q.variant_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is null
order by s.scanned_at desc
limit 100;

-- Sample scans missing consumer_id
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.shop_id,
  o.org_name as shop_org_name,
  s.qr_code_id,
  q.product_id,
  p.product_name,
  q.variant_id,
  v.variant_name,
  s.points_amount,
  s.collected_points,
  s.consumer_name as scan_consumer_name,
  s.consumer_phone as scan_consumer_phone,
  s.consumer_email as scan_consumer_email,
  q.consumer_name as qr_consumer_name,
  q.consumer_phone as qr_consumer_phone,
  q.consumer_email as qr_consumer_email
from public.consumer_qr_scans s
left join public.organizations o on o.id = s.shop_id
left join public.qr_codes q on q.id = s.qr_code_id
left join public.products p on p.id = q.product_id
left join public.product_variants v on v.id = q.variant_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.consumer_id is null
order by s.scanned_at desc
limit 100;

-- Sample scans missing both shop_id and consumer_id
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.qr_code_id,
  q.product_id,
  p.product_name,
  q.variant_id,
  v.variant_name,
  q.order_id,
  s.points_amount,
  s.collected_points,
  q.consumer_name as qr_consumer_name,
  q.consumer_phone as qr_consumer_phone,
  q.consumer_email as qr_consumer_email,
  s.ip_address,
  s.user_agent
from public.consumer_qr_scans s
left join public.qr_codes q on q.id = s.qr_code_id
left join public.products p on p.id = q.product_id
left join public.product_variants v on v.id = q.variant_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is null
  and s.consumer_id is null
order by s.scanned_at desc
limit 100;

-- Sample scans with both shop_id and consumer_id
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.shop_id,
  o.org_name as shop_org_name,
  o.branch,
  u.id as consumer_id,
  u.full_name as consumer_name,
  u.phone as consumer_phone,
  u.email as consumer_email,
  s.qr_code_id,
  q.product_id,
  p.product_name,
  q.variant_id,
  v.variant_name,
  s.points_amount,
  s.collected_points
from public.consumer_qr_scans s
left join public.organizations o on o.id = s.shop_id
left join public.users u on u.id = s.consumer_id
left join public.qr_codes q on q.id = s.qr_code_id
left join public.products p on p.id = q.product_id
left join public.product_variants v on v.id = q.variant_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is not null
  and s.consumer_id is not null
order by s.scanned_at desc
limit 100;

-- Sample shop-attributed scans with organization details
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.shop_id,
  o.org_name,
  o.branch,
  o.city,
  st.state_name,
  o.contact_phone,
  o.contact_email,
  s.consumer_id,
  s.qr_code_id,
  s.points_amount,
  s.collected_points
from public.consumer_qr_scans s
left join public.organizations o on o.id = s.shop_id
left join public.states st on st.id = o.state_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.shop_id is not null
order by s.scanned_at desc
limit 100;

-- Sample consumer-identified scans with profile details
select
  s.id,
  s.scanned_at,
  s.claim_lane,
  s.consumer_id,
  u.full_name,
  u.phone,
  u.email,
  s.shop_id,
  o.org_name as shop_org_name,
  s.qr_code_id,
  s.points_amount,
  s.collected_points
from public.consumer_qr_scans s
left join public.users u on u.id = s.consumer_id
left join public.organizations o on o.id = s.shop_id
where coalesce(s.is_manual_adjustment, false) = false
  and s.consumer_id is not null
order by s.scanned_at desc
limit 100;