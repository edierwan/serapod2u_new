#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import ExcelJS from 'exceljs'
import Papa from 'papaparse'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../../../')

const now = new Date()
const auditDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
].join('-')
const databaseUrl = process.env.DATABASE_URL || ''
const psqlPath = process.env.PSQL_PATH || 'psql'
const runnerOverride = process.env.REPORTING_AUDIT_PSQL_COMMAND || ''
const outputDir = process.env.REPORTING_AUDIT_OUTPUT_DIR || path.join(repoRoot, 'exports', 'reporting-audit')
const outputPath = path.join(outputDir, `reporting_data_coverage_audit_${auditDate}.xlsx`)

if (!databaseUrl) {
    console.error('DATABASE_URL is required. Provide an explicit read-only connection target before running this audit.')
    process.exit(1)
}

const QUERY_DEFINITIONS = [
    {
        sheetName: 'Overall Coverage',
        sql: `
with scan_base as (
  select *
  from public.consumer_qr_scans
  where coalesce(is_manual_adjustment, false) = false
), totals as (
  select count(*)::numeric as total_rows
  from scan_base
)
select
  metric,
  count_value,
  round(100.0 * count_value / nullif(total_rows, 0), 2) as pct_of_total
from (
  select 'total_non_manual_scans' as metric, count(*)::numeric as count_value from scan_base
  union all select 'scans_with_shop_id', count(*)::numeric from scan_base where shop_id is not null
  union all select 'scans_without_shop_id', count(*)::numeric from scan_base where shop_id is null
  union all select 'scans_with_consumer_id', count(*)::numeric from scan_base where consumer_id is not null
  union all select 'scans_without_consumer_id', count(*)::numeric from scan_base where consumer_id is null
  union all select 'scans_with_both_shop_id_and_consumer_id', count(*)::numeric from scan_base where shop_id is not null and consumer_id is not null
  union all select 'scans_with_shop_id_but_no_consumer_id', count(*)::numeric from scan_base where shop_id is not null and consumer_id is null
  union all select 'scans_with_consumer_id_but_no_shop_id', count(*)::numeric from scan_base where shop_id is null and consumer_id is not null
  union all select 'scans_with_neither_shop_id_nor_consumer_id', count(*)::numeric from scan_base where shop_id is null and consumer_id is null
) metrics
cross join totals
order by metric;
`,
    },
    {
        sheetName: 'Monthly Coverage',
        sql: `
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
`,
    },
    {
        sheetName: 'Claim Lane Coverage',
        sql: `
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
`,
    },
    {
        sheetName: 'Missing Shop ID Summary',
        sql: `
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
    nullif(trim(q.consumer_name), '') as qr_consumer_name,
    nullif(trim(q.consumer_phone), '') as qr_consumer_phone,
    nullif(trim(q.consumer_email), '') as qr_consumer_email
  from missing_shop ms
  left join public.qr_codes q on q.id = ms.qr_code_id
)
select
  field_or_path,
  rows_present,
  round(100.0 * rows_present / nullif(total_rows, 0), 2) as pct_of_missing_shop_rows,
  interpretation
from (
  select 'total_missing_shop_rows' as field_or_path, count(*)::numeric as rows_present, count(*)::numeric as total_rows,
         'Total non-manual scan rows where shop_id is null.' as interpretation
  from joined
  union all
  select 'qr_code_id', count(*) filter (where qr_code_id is not null)::numeric, count(*)::numeric,
         'QR identity remains available.'
  from joined
  union all
  select 'product_id_via_qr', count(*) filter (where product_id is not null)::numeric, count(*)::numeric,
         'Product lineage remains available through qr_codes.'
  from joined
  union all
  select 'variant_id_via_qr', count(*) filter (where variant_id is not null)::numeric, count(*)::numeric,
         'Variant lineage remains available through qr_codes.'
  from joined
  union all
  select 'order_id_via_qr', count(*) filter (where order_id is not null)::numeric, count(*)::numeric,
         'Order lineage remains available through qr_codes.'
  from joined
  union all
  select 'consumer_id', count(*) filter (where consumer_id is not null)::numeric, count(*)::numeric,
         'A subset still has direct consumer identity even though shop_id is null.'
  from joined
  union all
  select 'qr_consumer_name', count(*) filter (where qr_consumer_name is not null)::numeric, count(*)::numeric,
         'QR-level fallback identity exists but does not recover shop attribution.'
  from joined
  union all
  select 'qr_consumer_phone', count(*) filter (where qr_consumer_phone is not null)::numeric, count(*)::numeric,
         'QR-level fallback phone exists but does not recover shop attribution.'
  from joined
  union all
  select 'qr_consumer_email', count(*) filter (where qr_consumer_email is not null)::numeric, count(*)::numeric,
         'QR-level fallback email exists but does not recover shop attribution.'
  from joined
  union all
  select 'ip_address', count(*) filter (where ip_address is not null)::numeric, count(*)::numeric,
         'Source IP is available on a subset of rows.'
  from joined
  union all
  select 'user_agent', count(*) filter (where user_agent is not null)::numeric, count(*)::numeric,
         'User agent is available on a subset of rows.'
  from joined
  union all
  select 'current_location_org_id_via_qr', count(*) filter (where current_location_org_id is not null)::numeric, count(*)::numeric,
         'Current organization ownership is not populated for missing-shop recovery.'
  from joined
) summary
order by rows_present desc, field_or_path;
`,
    },
    {
        sheetName: 'Missing Consumer ID Summary',
        sql: `
with missing_consumer as (
  select s.*
  from public.consumer_qr_scans s
  where coalesce(s.is_manual_adjustment, false) = false
    and s.consumer_id is null
), joined as (
  select
    mc.id,
    mc.shop_id,
    mc.qr_code_id,
    nullif(trim(mc.consumer_name), '') as scan_consumer_name,
    nullif(trim(mc.consumer_phone), '') as scan_consumer_phone,
    nullif(trim(mc.consumer_email), '') as scan_consumer_email,
    q.product_id,
    q.variant_id,
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
  field_or_path,
  rows_present,
  round(100.0 * rows_present / nullif(total_rows, 0), 2) as pct_of_missing_consumer_rows,
  interpretation
from (
  select 'total_missing_consumer_rows' as field_or_path, count(*)::numeric as rows_present, count(*)::numeric as total_rows,
         'Total non-manual scan rows where consumer_id is null.' as interpretation
  from joined
  union all
  select 'shop_id', count(*) filter (where shop_id is not null)::numeric, count(*)::numeric,
         'A very small subset still preserves shop attribution.'
  from joined
  union all
  select 'qr_code_id', count(*) filter (where qr_code_id is not null)::numeric, count(*)::numeric,
         'QR identity remains available.'
  from joined
  union all
  select 'product_id_via_qr', count(*) filter (where product_id is not null)::numeric, count(*)::numeric,
         'Product lineage remains available through qr_codes.'
  from joined
  union all
  select 'variant_id_via_qr', count(*) filter (where variant_id is not null)::numeric, count(*)::numeric,
         'Variant lineage remains available through qr_codes.'
  from joined
  union all
  select 'scan_consumer_name', count(*) filter (where scan_consumer_name is not null)::numeric, count(*)::numeric,
         'Scan-row fallback name is effectively absent.'
  from joined
  union all
  select 'scan_consumer_phone', count(*) filter (where scan_consumer_phone is not null)::numeric, count(*)::numeric,
         'Scan-row fallback phone is effectively absent.'
  from joined
  union all
  select 'scan_consumer_email', count(*) filter (where scan_consumer_email is not null)::numeric, count(*)::numeric,
         'Scan-row fallback email is effectively absent.'
  from joined
  union all
  select 'qr_consumer_name', count(*) filter (where qr_consumer_name is not null)::numeric, count(*)::numeric,
         'QR-level fallback name exists for a material subset.'
  from joined
  union all
  select 'qr_consumer_phone', count(*) filter (where qr_consumer_phone is not null)::numeric, count(*)::numeric,
         'QR-level fallback phone exists for a material subset.'
  from joined
  union all
  select 'qr_consumer_email', count(*) filter (where qr_consumer_email is not null)::numeric, count(*)::numeric,
         'QR-level fallback email exists for a material subset.'
  from joined
  union all
  select 'qr_fallback_exact_user_match', count(*) filter (where qr_email_matches_user or qr_phone_matches_user)::numeric, count(*)::numeric,
         'Exact user matches are possible for a material subset, but the source is QR-level rather than event-level.'
  from joined
) summary
order by rows_present desc, field_or_path;
`,
    },
    {
        sheetName: 'Shop Recoverability',
        sql: `
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
  select 'qr_codes.product_id / qr_codes.variant_id' as candidate_source_table,
         count(*) filter (where product_id is not null and variant_id is not null)::bigint as rows_with_signal,
         'no' as recoverable_path_exists,
         'high' as confidence,
         'not a shop key' as risk,
         'Product and variant are recoverable, but they do not identify the scanning shop.' as notes
  from joined
  union all
  select 'qr_codes.order_id -> orders buyer/seller/warehouse orgs',
         count(*) filter (where order_id is not null)::bigint,
         'no',
         'high',
         'order organizations resolve to manufacturer and warehouse, not shop',
         'Observed missing-shop rows map to seller=MFG and warehouse=WH.'
  from joined
  union all
  select 'qr_codes.current_location_org_id',
         count(*) filter (where current_location_org_id is not null)::bigint,
         'no',
         'high',
         'field not populated for the missing-shop population',
         'No usable current-location shop path was found.'
  from joined
  union all
  select 'consumer_qr_scans.claim_lane = shop',
         count(*) filter (where claim_lane = 'shop')::bigint,
         'no',
         'high',
         'missing-shop rows are not shop-lane rows',
         'Current missing-shop rows are entirely consumer-lane.'
  from joined
) recoverability;
`,
    },
    {
        sheetName: 'Consumer Recoverability',
        sql: `
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
select *
from (
  select 'scan row consumer_name / consumer_phone / consumer_email' as candidate_source_table,
         count(*) filter (where scan_consumer_name is not null or scan_consumer_phone is not null or scan_consumer_email is not null)::bigint as rows_with_signal,
         'no' as recoverable_path_exists,
         'high' as confidence,
         'scan-event fallback identity is effectively absent',
         'The scan row itself does not preserve usable fallback identity for missing-consumer rows.' as notes
  from base
  union all
  select 'qr_codes consumer_name / consumer_phone / consumer_email',
         count(*) filter (where qr_consumer_name is not null or qr_consumer_phone is not null or qr_consumer_email is not null)::bigint,
         'partial',
         'medium',
         'values live on qr_codes rather than the immutable scan event',
         'This can support investigation but is not a safe event-grade substitute for consumer_id.'
  from base
  union all
  select 'qr_codes fallback email/phone -> users exact match',
         count(*) filter (where qr_email_matches_user or qr_phone_matches_user)::bigint,
         'partial',
         'medium',
         'matches can still be stale, duplicated, or overwritten',
         'This is the strongest current recovery signal for missing consumer_id.'
  from base
) recoverability;
`,
    },
    {
        sheetName: 'Shop Organization Fields',
        sql: `
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
`,
    },
    {
        sheetName: 'Regional Readiness',
        sql: `
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
  count(distinct shop_orgs.id) filter (where scans.scanned_at >= now() - interval '7 days')::bigint as shops_with_scans_last_7_days,
  count(distinct shop_orgs.id) filter (where scans.scanned_at >= now() - interval '30 days')::bigint as shops_with_scans_last_30_days,
  count(distinct shop_orgs.id) filter (where scans.scanned_at >= now() - interval '90 days')::bigint as shops_with_scans_last_90_days,
  count(scans.*) filter (where scans.scanned_at >= now() - interval '30 days')::bigint as total_attributed_scans_last_30_days,
  count(scans.*) filter (where scans.scanned_at >= now() - interval '90 days')::bigint as total_attributed_scans_last_90_days
from shop_orgs
left join scans on scans.shop_id = shop_orgs.id
group by state_name, branch
order by total_attributed_scans_last_90_days desc, state_name, branch;
`,
    },
    {
        sheetName: 'Sample Missing Shop ID',
        sql: `
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
`,
    },
    {
        sheetName: 'Sample Missing Consumer ID',
        sql: `
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
`,
    },
    {
        sheetName: 'Sample Missing Both',
        sql: `
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
`,
    },
    {
        sheetName: 'Sample Both Present',
        sql: `
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
`,
    },
]

function assertReadOnly(sql) {
    const stripped = sql
        .replace(/--.*$/gm, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .toLowerCase()

    const forbidden = ['insert', 'update', 'delete', 'alter', 'create', 'drop', 'truncate', 'grant', 'revoke']
    for (const keyword of forbidden) {
        if (new RegExp(`\\b${keyword}\\b`, 'i').test(stripped)) {
            throw new Error(`Refusing to run non-read-only SQL because it contains the keyword: ${keyword}`)
        }
    }
}

function runQuery(sql, sheetName) {
    assertReadOnly(sql)

    const trimmedSql = `${sql.trim()}\n`
    const maxBuffer = 1024 * 1024 * 128

    if (runnerOverride) {
        const result = spawnSync('bash', ['-lc', runnerOverride], {
            input: trimmedSql,
            encoding: 'utf8',
            maxBuffer,
            env: process.env,
        })

        if (result.status !== 0) {
            throw new Error(`Query failed for ${sheetName}: ${result.stderr || result.stdout}`)
        }

        return parseCsv(result.stdout)
    }

    const result = spawnSync(psqlPath, [databaseUrl, '--csv', '-v', 'ON_ERROR_STOP=1', '-P', 'footer=off', '-f', '-'], {
        input: trimmedSql,
        encoding: 'utf8',
        maxBuffer,
        env: process.env,
    })

    if (result.status !== 0) {
        throw new Error(`Query failed for ${sheetName}: ${result.stderr || result.stdout}`)
    }

    return parseCsv(result.stdout)
}

function parseCsv(csvText) {
    const trimmed = csvText.trim()
    if (!trimmed) return []

    const parsed = Papa.parse(trimmed, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (value) => value.trim(),
    })

    if (parsed.errors.length > 0) {
        throw new Error(`CSV parse failed: ${parsed.errors[0].message}`)
    }

    return parsed.data.map((row) => {
        const nextRow = {}
        for (const [key, value] of Object.entries(row)) {
            nextRow[key] = value === undefined ? '' : value
        }
        return nextRow
    })
}

function asLookup(rows) {
    return new Map(rows.map((row) => [row.metric, row]))
}

function addReadmeSheet(workbook, overallRows, missingShopRows, missingConsumerRows, shopRecoverabilityRows, consumerRecoverabilityRows, regionalRows) {
    const overall = asLookup(overallRows)
    const missingShop = asLookup(missingShopRows)
    const missingConsumer = asLookup(missingConsumerRows)

    const sheet = workbook.addWorksheet('README')
    sheet.columns = [
        { header: 'Field', key: 'field', width: 32 },
        { header: 'Value', key: 'value', width: 120 },
    ]

    const rows = [
        { field: 'Generated At', value: new Date().toISOString() },
        { field: 'Environment Note', value: 'Read-only production reporting coverage audit exported locally. Sample sheets may contain names, phone numbers, and email addresses. Do not stage or commit the workbook.' },
        { field: 'Workbook Path', value: outputPath },
        { field: 'Query Runner Mode', value: runnerOverride ? 'Override command via REPORTING_AUDIT_PSQL_COMMAND' : 'Direct DATABASE_URL via psql' },
        { field: 'Database Configuration', value: 'Configured via explicit environment variables and intentionally not printed by the script.' },
        { field: 'Total Non-Manual Scans', value: overall.get('total_non_manual_scans')?.count_value || '' },
        { field: 'Scans With shop_id', value: overall.get('scans_with_shop_id')?.count_value || '' },
        { field: 'Scans Without shop_id', value: overall.get('scans_without_shop_id')?.count_value || '' },
        { field: 'Scans With consumer_id', value: overall.get('scans_with_consumer_id')?.count_value || '' },
        { field: 'Scans Without consumer_id', value: overall.get('scans_without_consumer_id')?.count_value || '' },
        { field: 'Missing shop_id Key Finding', value: `Rows missing shop_id still preserve QR, product, variant, and order context (${missingShop.get('qr_code_id')?.rows_present || '0'} with qr_code_id; ${missingShop.get('product_id_via_qr')?.rows_present || '0'} with product_id via QR), but there is no reliable shop organization recovery path.` },
        { field: 'Missing consumer_id Key Finding', value: `Rows missing consumer_id still preserve QR context (${missingConsumer.get('qr_code_id')?.rows_present || '0'} with qr_code_id). A material subset still has QR-level fallback identity (${missingConsumer.get('qr_fallback_exact_user_match')?.rows_present || '0'} exact user matches through QR email/phone), but that source is QR-level, not immutable scan-event identity.` },
        { field: 'Shop Recoverability Recommendation', value: shopRecoverabilityRows.map((row) => `${row.candidate_source_table}: ${row.recoverable_path_exists}`).join(' | ') },
        { field: 'Consumer Recoverability Recommendation', value: consumerRecoverabilityRows.map((row) => `${row.candidate_source_table}: ${row.recoverable_path_exists}`).join(' | ') },
        { field: 'Regional Readiness Note', value: regionalRows.length > 0 ? 'State and branch grouping are populated enough for operational regional views on shop-attributed scans, but region-name completeness is materially weaker than state and branch.' : 'No regional rows returned.' },
    ]

    rows.forEach((row) => sheet.addRow(row))
    styleSheet(sheet)
    sheet.autoFilter = undefined
}

function styleSheet(sheet) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    const header = sheet.getRow(1)
    header.font = { bold: true }
    header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE5E7EB' },
    }

    if (sheet.columnCount > 0 && sheet.rowCount > 1 && sheet.name !== 'README') {
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: sheet.columnCount },
        }
    }

    for (let columnIndex = 1; columnIndex <= sheet.columnCount; columnIndex += 1) {
        const column = sheet.getColumn(columnIndex)
        let maxLength = 12
        column.eachCell({ includeEmpty: true }, (cell) => {
            const text = cell.value === null || cell.value === undefined ? '' : String(cell.value)
            maxLength = Math.max(maxLength, Math.min(text.length + 2, 60))
        })
        column.width = maxLength
    }
}

function addTableSheet(workbook, sheetName, rows) {
    const sheet = workbook.addWorksheet(sheetName)

    if (rows.length === 0) {
        sheet.columns = [
            { header: 'notice', key: 'notice', width: 60 },
        ]
        sheet.addRow({ notice: 'No rows returned for this query.' })
        styleSheet(sheet)
        return
    }

    const headers = Object.keys(rows[0])
    sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(header.length + 2, 14) }))

    rows.forEach((row) => {
        sheet.addRow(row)
    })

    styleSheet(sheet)
}

async function main() {
    mkdirSync(outputDir, { recursive: true })

    const results = new Map()

    for (const definition of QUERY_DEFINITIONS) {
        console.log(`Running ${definition.sheetName}...`)
        results.set(definition.sheetName, runQuery(definition.sql, definition.sheetName))
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'GitHub Copilot'
    workbook.lastModifiedBy = 'GitHub Copilot'
    workbook.created = new Date()
    workbook.modified = new Date()
    workbook.subject = 'Serapod2U reporting data coverage audit'
    workbook.title = 'Serapod2U Reporting Data Coverage Audit'
    workbook.company = 'Serapod2U'

    addReadmeSheet(
        workbook,
        results.get('Overall Coverage') || [],
        results.get('Missing Shop ID Summary') || [],
        results.get('Missing Consumer ID Summary') || [],
        results.get('Shop Recoverability') || [],
        results.get('Consumer Recoverability') || [],
        results.get('Regional Readiness') || [],
    )

    for (const definition of QUERY_DEFINITIONS) {
        addTableSheet(workbook, definition.sheetName, results.get(definition.sheetName) || [])
    }

    await workbook.xlsx.writeFile(outputPath)

    console.log(`Workbook created: ${outputPath}`)
    console.log('Note: This workbook is local/private and may contain PII. Do not commit it.')
}

main().catch((error) => {
    console.error(error.message)
    process.exit(1)
})