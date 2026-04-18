-- Usage in psql:
-- \set phone '0198546311'
-- \i scripts/inspect_consumer_ledger_by_phone.sql

WITH input_phone AS (
    SELECT
        :'phone'::text AS raw_phone,
        regexp_replace(:'phone'::text, '\D', '', 'g') AS digits_only,
        CASE
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '60%' THEN regexp_replace(:'phone'::text, '\D', '', 'g')
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '0%' THEN '6' || regexp_replace(:'phone'::text, '\D', '', 'g')
            ELSE regexp_replace(:'phone'::text, '\D', '', 'g')
        END AS normalized_phone
),
matched_users AS (
    SELECT
        u.id,
        u.full_name,
        u.call_name,
        u.email,
        u.phone,
        u.role_code,
        u.shop_name,
        u.referral_phone,
        u.organization_id,
        org.org_name AS organization_name,
        org.org_type_code,
        ip.raw_phone,
        ip.normalized_phone
    FROM public.users u
    CROSS JOIN input_phone ip
    LEFT JOIN public.organizations org ON org.id = u.organization_id
    WHERE regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') IN (
        ip.digits_only,
        ip.normalized_phone,
        regexp_replace(ip.normalized_phone, '^60', '0')
    )
)
SELECT
    'matched_user' AS section,
    mu.*
FROM matched_users mu;

WITH input_phone AS (
    SELECT
        :'phone'::text AS raw_phone,
        regexp_replace(:'phone'::text, '\D', '', 'g') AS digits_only,
        CASE
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '60%' THEN regexp_replace(:'phone'::text, '\D', '', 'g')
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '0%' THEN '6' || regexp_replace(:'phone'::text, '\D', '', 'g')
            ELSE regexp_replace(:'phone'::text, '\D', '', 'g')
        END AS normalized_phone
),
matched_users AS (
    SELECT u.id, u.phone, u.email
    FROM public.users u
    CROSS JOIN input_phone ip
    WHERE regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') IN (
        ip.digits_only,
        ip.normalized_phone,
        regexp_replace(ip.normalized_phone, '^60', '0')
    )
)
SELECT
    'consumer_balance_view' AS section,
    v.user_id,
    v.user_name,
    v.user_phone,
    v.current_balance,
    v.total_collected_system,
    v.total_collected_manual,
    v.total_migration,
    v.total_redeemed,
    v.transaction_count,
    v.last_transaction_date
FROM public.v_consumer_points_balance v
JOIN matched_users mu ON mu.id = v.user_id;

WITH input_phone AS (
    SELECT
        :'phone'::text AS raw_phone,
        regexp_replace(:'phone'::text, '\D', '', 'g') AS digits_only,
        CASE
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '60%' THEN regexp_replace(:'phone'::text, '\D', '', 'g')
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '0%' THEN '6' || regexp_replace(:'phone'::text, '\D', '', 'g')
            ELSE regexp_replace(:'phone'::text, '\D', '', 'g')
        END AS normalized_phone
),
matched_users AS (
    SELECT u.id, u.phone, u.email
    FROM public.users u
    CROSS JOIN input_phone ip
    WHERE regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') IN (
        ip.digits_only,
        ip.normalized_phone,
        regexp_replace(ip.normalized_phone, '^60', '0')
    )
)
SELECT
    'qr_scan_summary' AS section,
    mu.id AS user_id,
    count(*) FILTER (WHERE cqs.collected_points = true) AS scan_count,
    count(*) FILTER (WHERE cqs.collected_points = true AND COALESCE(cqs.claim_lane, 'consumer') = 'consumer') AS consumer_lane_scan_count,
    count(*) FILTER (WHERE cqs.collected_points = true AND cqs.claim_lane = 'shop') AS shop_lane_scan_count,
    coalesce(sum(cqs.points_amount) FILTER (WHERE cqs.collected_points = true), 0) AS scan_points_total,
    max(cqs.points_collected_at) AS last_scan_at
FROM matched_users mu
LEFT JOIN public.consumer_qr_scans cqs ON cqs.consumer_id = mu.id
GROUP BY mu.id;

WITH input_phone AS (
    SELECT
        :'phone'::text AS raw_phone,
        regexp_replace(:'phone'::text, '\D', '', 'g') AS digits_only,
        CASE
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '60%' THEN regexp_replace(:'phone'::text, '\D', '', 'g')
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '0%' THEN '6' || regexp_replace(:'phone'::text, '\D', '', 'g')
            ELSE regexp_replace(:'phone'::text, '\D', '', 'g')
        END AS normalized_phone
),
matched_users AS (
    SELECT u.id, u.phone, u.email
    FROM public.users u
    CROSS JOIN input_phone ip
    WHERE regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') IN (
        ip.digits_only,
        ip.normalized_phone,
        regexp_replace(ip.normalized_phone, '^60', '0')
    )
)
SELECT
    'points_transaction_summary' AS section,
    mu.id AS user_id,
    count(*) AS txn_count,
    coalesce(sum(pt.points_amount) FILTER (WHERE pt.points_amount > 0), 0) AS earned_points_total,
    coalesce(sum(abs(pt.points_amount)) FILTER (WHERE pt.points_amount < 0), 0) AS deducted_points_total,
    max(pt.transaction_date) AS last_transaction_at
FROM matched_users mu
LEFT JOIN public.points_transactions pt
    ON pt.user_id = mu.id
    OR regexp_replace(COALESCE(pt.consumer_phone, ''), '\D', '', 'g') = regexp_replace(COALESCE(mu.phone, ''), '\D', '', 'g')
    OR (mu.email IS NOT NULL AND pt.consumer_email = mu.email)
GROUP BY mu.id;

WITH input_phone AS (
    SELECT
        :'phone'::text AS raw_phone,
        regexp_replace(:'phone'::text, '\D', '', 'g') AS digits_only,
        CASE
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '60%' THEN regexp_replace(:'phone'::text, '\D', '', 'g')
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '0%' THEN '6' || regexp_replace(:'phone'::text, '\D', '', 'g')
            ELSE regexp_replace(:'phone'::text, '\D', '', 'g')
        END AS normalized_phone
),
matched_users AS (
    SELECT u.id, u.phone, u.email
    FROM public.users u
    CROSS JOIN input_phone ip
    WHERE regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') IN (
        ip.digits_only,
        ip.normalized_phone,
        regexp_replace(ip.normalized_phone, '^60', '0')
    )
)
SELECT
    'recent_qr_scans' AS section,
    cqs.id,
    cqs.qr_code_id,
    cqs.shop_id,
    cqs.consumer_id,
    cqs.claim_lane,
    cqs.points_amount,
    cqs.points_collected_at
FROM public.consumer_qr_scans cqs
JOIN matched_users mu ON mu.id = cqs.consumer_id
WHERE cqs.collected_points = true
ORDER BY cqs.points_collected_at DESC
LIMIT 20;

WITH input_phone AS (
    SELECT
        :'phone'::text AS raw_phone,
        regexp_replace(:'phone'::text, '\D', '', 'g') AS digits_only,
        CASE
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '60%' THEN regexp_replace(:'phone'::text, '\D', '', 'g')
            WHEN regexp_replace(:'phone'::text, '\D', '', 'g') LIKE '0%' THEN '6' || regexp_replace(:'phone'::text, '\D', '', 'g')
            ELSE regexp_replace(:'phone'::text, '\D', '', 'g')
        END AS normalized_phone
),
matched_users AS (
    SELECT u.id, u.phone, u.email
    FROM public.users u
    CROSS JOIN input_phone ip
    WHERE regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') IN (
        ip.digits_only,
        ip.normalized_phone,
        regexp_replace(ip.normalized_phone, '^60', '0')
    )
)
SELECT
    'recent_points_transactions' AS section,
    pt.id,
    pt.user_id,
    pt.consumer_phone,
    pt.consumer_email,
    pt.transaction_type,
    pt.points_amount,
    pt.balance_after,
    pt.transaction_date,
    pt.description
FROM public.points_transactions pt
JOIN matched_users mu
    ON pt.user_id = mu.id
    OR regexp_replace(COALESCE(pt.consumer_phone, ''), '\D', '', 'g') = regexp_replace(COALESCE(mu.phone, ''), '\D', '', 'g')
    OR (mu.email IS NOT NULL AND pt.consumer_email = mu.email)
ORDER BY pt.transaction_date DESC
LIMIT 20;
