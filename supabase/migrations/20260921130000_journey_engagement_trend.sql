-- ============================================================================
-- Journey Builder: QR Engagement Trend aggregated server-side
-- ----------------------------------------------------------------------------
-- The dashboard trend previously ran in /api/journey/dashboard-summary:
--   journey orders -> qr_codes .limit(50000) -> chunked consumer_qr_scans IN (...)
-- and selected consumer_qr_scans.redeemed_at, a column that does not exist
-- (redeemed_at lives on qr_codes). Every chunk failed, the error was ignored
-- and the chart showed "No engagement data yet" while the KPI showed 101k+.
--
-- This function replaces that with one aggregate query.
--
-- SEMANTICS (kept identical to the Total Scans KPI / journey card "Scanned",
-- both of which come from get_consumer_scan_stats()):
--   scans    = number of QR codes whose FIRST consumer scan
--              (qr_codes.first_consumer_scan_at) falls on that day.
--              Unique QR codes, not scan rows: re-scans of the same code are
--              not counted again. Summed over all time this equals the KPI.
--              Includes shop-lane and consumer-lane scans and any
--              consumer_qr_scans row tied to a QR code, exactly like the KPI
--              (trigger update_qr_code_consumer_scan sets the timestamp).
--   redeemed = number of QR codes with is_redeemed = true whose
--              qr_codes.redeemed_at falls on that day (the redemption
--              moment, not the scan day). Matches the "redemptions" figure.
--   failed   = NOT returned: there is no persisted failed-scan source.
--
-- DAY BUCKETS: Asia/Kuala_Lumpur calendar dates. p_start_date / p_end_date
-- are inclusive MYT dates; the window is the half-open instant range
-- [p_start_date 00:00 MYT, p_end_date + 1 00:00 MYT).
--
-- AUTHORIZATION: SECURITY INVOKER. The organization is resolved from
-- auth.uid() (public.users.organization_id); no org id parameter is accepted,
-- so a caller cannot ask for another organization's journeys. Only orders
-- linked (journey_order_links) to that organization's journey_configurations
-- are included, the same scope as dashboard-summary.
--
-- INDEXES: existing idx_qr_codes_order (order_id) and
-- idx_qr_codes_first_consumer_scan (first_consumer_scan_at, partial) cannot
-- serve "order_id = X AND first_consumer_scan_at in range" without reading
-- every QR code of the order (1M+ rows). Two narrow partial composite indexes
-- are added so each order resolves with a range scan over scanned / redeemed
-- codes only. On a busy production table consider running the two CREATE
-- INDEX statements separately with CONCURRENTLY (outside a transaction).
--
-- NOT applied automatically: run manually after review.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qr_codes_order_first_consumer_scan
    ON public.qr_codes USING btree (order_id, first_consumer_scan_at)
    WHERE (first_consumer_scan_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_qr_codes_order_redeemed_at
    ON public.qr_codes USING btree (order_id, redeemed_at)
    WHERE (is_redeemed = true AND redeemed_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.get_journey_engagement_trend(
    p_start_date date,
    p_end_date date
)
RETURNS TABLE(day date, scans bigint, redeemed bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH caller_org AS (
        SELECT u.organization_id
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.organization_id IS NOT NULL
    ),
    journey_orders AS (
        SELECT DISTINCT jol.order_id
        FROM public.journey_order_links jol
        JOIN public.journey_configurations jc ON jc.id = jol.journey_config_id
        JOIN caller_org co ON co.organization_id = jc.org_id
    ),
    bounds AS (
        SELECT
            (p_start_date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur') AS start_ts,
            ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur') AS end_ts
        WHERE p_start_date IS NOT NULL
          AND p_end_date IS NOT NULL
          AND p_start_date <= p_end_date
          AND p_end_date - p_start_date <= 400
    ),
    scan_days AS (
        SELECT (qc.first_consumer_scan_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS day,
               count(*) AS n
        FROM public.qr_codes qc
        JOIN journey_orders jo ON jo.order_id = qc.order_id
        CROSS JOIN bounds b
        WHERE qc.first_consumer_scan_at IS NOT NULL
          AND qc.first_consumer_scan_at >= b.start_ts
          AND qc.first_consumer_scan_at < b.end_ts
        GROUP BY 1
    ),
    redeem_days AS (
        SELECT (qc.redeemed_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS day,
               count(*) AS n
        FROM public.qr_codes qc
        JOIN journey_orders jo ON jo.order_id = qc.order_id
        CROSS JOIN bounds b
        WHERE qc.is_redeemed = true
          AND qc.redeemed_at IS NOT NULL
          AND qc.redeemed_at >= b.start_ts
          AND qc.redeemed_at < b.end_ts
        GROUP BY 1
    )
    SELECT d.day,
           COALESCE(s.n, 0)::bigint AS scans,
           COALESCE(r.n, 0)::bigint AS redeemed
    FROM bounds b
    CROSS JOIN LATERAL (
        SELECT gs::date AS day
        FROM generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') gs
    ) d
    LEFT JOIN scan_days s ON s.day = d.day
    LEFT JOIN redeem_days r ON r.day = d.day
    ORDER BY d.day;
$$;

COMMENT ON FUNCTION public.get_journey_engagement_trend(date, date) IS
    'Journey Builder QR Engagement Trend: per Asia/Kuala_Lumpur day, unique QR codes first scanned (scans) and QR codes redeemed (redeemed) for the caller''s organization journeys. SECURITY INVOKER; org from auth.uid().';

REVOKE ALL ON FUNCTION public.get_journey_engagement_trend(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_journey_engagement_trend(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_journey_engagement_trend(date, date) TO authenticated;
