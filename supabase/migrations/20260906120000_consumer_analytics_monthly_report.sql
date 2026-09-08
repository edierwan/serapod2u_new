-- Monthly Consumer Analytics management report, aggregated inside the database.
--
-- Replaces the previous browser-side model where ConsumerAnalyticsTab pulled a
-- rolling 12 months of raw consumer_qr_scans (plus paged qr_codes lookups) into
-- React and computed every KPI client-side. That does not survive Production
-- scan volume. This function returns one compact JSON report per month.
--
-- SECURITY INVOKER is intentional and matches reporting_shop_scan_periods:
-- consumer_qr_scans / users / products / product_variants RLS stays
-- authoritative, so the function can never widen what the signed-in manager is
-- already allowed to read.
--
-- Every month boundary is a half-open interval [monthStart, nextMonthStart) in
-- Asia/Kuala_Lumpur, the business reporting timezone.

-- Reporting months that actually contain consumer scan activity. Unlike
-- reporting_shop_scan_periods this deliberately does NOT require shop_id, since
-- consumer scans are valid reporting events even when no shop is attached.
CREATE OR REPLACE FUNCTION public.reporting_consumer_scan_periods()
RETURNS TABLE(period_key text, transaction_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('month', cqs.scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') AS period_key,
    count(*)::bigint AS transaction_count
  FROM public.consumer_qr_scans cqs
  WHERE COALESCE(cqs.is_manual_adjustment, false) = false
    AND cqs.scanned_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.reporting_consumer_scan_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_consumer_scan_periods() TO authenticated;

COMMENT ON FUNCTION public.reporting_consumer_scan_periods() IS
  'Reporting months containing eligible consumer scans, in Asia/Kuala_Lumpur; honors consumer_qr_scans RLS.';


CREATE OR REPLACE FUNCTION public.reporting_consumer_analytics(p_month text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_month_start     date;
  v_prev_month      date;
  v_twelve_start    date;
  v_cohort_start    date;
  v_start           timestamptz;
  v_end             timestamptz;
  v_prev_start      timestamptz;
  v_twelve_start_ts timestamptz;
  v_days            integer;
  v_result          jsonb;
BEGIN
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid reporting month %, expected YYYY-MM', p_month
      USING ERRCODE = '22023';
  END IF;

  v_month_start     := (p_month || '-01')::date;
  v_prev_month      := (v_month_start - interval '1 month')::date;
  v_twelve_start    := (v_month_start - interval '11 month')::date;
  v_cohort_start    := (v_month_start - interval '5 month')::date;
  v_start           := v_month_start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_end             := (v_month_start + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_prev_start      := v_prev_month::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_twelve_start_ts := v_twelve_start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_days            := extract(day from (v_month_start + interval '1 month' - interval '1 day'))::integer;

  WITH hist AS (
    -- One bounded pass over the 12 reporting months ending at the selected
    -- month. Feeds the 12-month trend, the retention cohort and the
    -- previous-month comparison.
    SELECT
      date_trunc('month', s.scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS bucket,
      s.consumer_id
    FROM public.consumer_qr_scans s
    WHERE COALESCE(s.is_manual_adjustment, false) = false
      AND s.scanned_at IS NOT NULL
      AND s.scanned_at >= v_twelve_start_ts
      AND s.scanned_at <  v_end
  ),
  month_totals AS (
    SELECT
      bucket,
      count(*)::bigint                     AS scans,
      count(consumer_id)::bigint           AS identified_scans,
      count(DISTINCT consumer_id)::bigint  AS consumers
    FROM hist
    GROUP BY bucket
  ),
  month_consumers AS (
    SELECT DISTINCT bucket, consumer_id
    FROM hist
    WHERE consumer_id IS NOT NULL
  ),
  cur AS (
    -- Selected month only: powers daily trend, heatmap, top consumers and
    -- top products.
    SELECT s.consumer_id, s.scanned_at, s.qr_code_id
    FROM public.consumer_qr_scans s
    WHERE COALESCE(s.is_manual_adjustment, false) = false
      AND s.scanned_at IS NOT NULL
      AND s.scanned_at >= v_start
      AND s.scanned_at <  v_end
  ),
  returning_current AS (
    -- Returning = identified in the selected month AND has an eligible scan
    -- strictly before the month started. History is unbounded on purpose: a
    -- consumer must never be relabelled "new" just because their first scan
    -- falls outside a rolling window.
    SELECT count(*)::bigint AS n
    FROM month_consumers mc
    WHERE mc.bucket = v_month_start
      AND EXISTS (
        SELECT 1 FROM public.consumer_qr_scans p
        WHERE p.consumer_id = mc.consumer_id
          AND COALESCE(p.is_manual_adjustment, false) = false
          AND p.scanned_at IS NOT NULL
          AND p.scanned_at < v_start
      )
  ),
  returning_previous AS (
    SELECT count(*)::bigint AS n
    FROM month_consumers mc
    WHERE mc.bucket = v_prev_month
      AND EXISTS (
        SELECT 1 FROM public.consumer_qr_scans p
        WHERE p.consumer_id = mc.consumer_id
          AND COALESCE(p.is_manual_adjustment, false) = false
          AND p.scanned_at IS NOT NULL
          AND p.scanned_at < v_prev_start
      )
  ),
  daily AS (
    SELECT
      g.d::date                     AS d,
      COALESCE(x.scans, 0)::bigint     AS scans,
      COALESCE(x.consumers, 0)::bigint AS consumers
    FROM generate_series(
      v_month_start,
      (v_month_start + interval '1 month' - interval '1 day')::date,
      interval '1 day'
    ) g(d)
    LEFT JOIN (
      SELECT
        (c.scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d,
        count(*)::bigint                                      AS scans,
        count(DISTINCT c.consumer_id)::bigint                 AS consumers
      FROM cur c
      GROUP BY 1
    ) x ON x.d = g.d::date
  ),
  twelve AS (
    SELECT
      to_char(g.bucket, 'YYYY-MM')          AS month,
      COALESCE(mt.scans, 0)::bigint         AS scans,
      COALESCE(mt.consumers, 0)::bigint     AS consumers
    FROM generate_series(v_twelve_start, v_month_start, interval '1 month') g(bucket)
    LEFT JOIN month_totals mt ON mt.bucket = g.bucket::date
  ),
  heatmap AS (
    SELECT
      extract(dow  from c.scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur')::int AS day_of_week,
      extract(hour from c.scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur')::int AS hour,
      count(*)::bigint                                                      AS scans
    FROM cur c
    GROUP BY 1, 2
  ),
  cohort AS (
    -- Row for month M = identified consumers active in M, and how many of them
    -- were active again in M+1. The selected month's own row has no M+1 inside
    -- the report window, so it is reported as pending.
    SELECT
      to_char(g.bucket, 'YYYY-MM') AS month,
      (
        SELECT count(*)::bigint FROM month_consumers mc
        WHERE mc.bucket = g.bucket::date
      ) AS consumers,
      (
        SELECT count(*)::bigint FROM month_consumers mc
        WHERE mc.bucket = g.bucket::date
          AND EXISTS (
            SELECT 1 FROM month_consumers nx
            WHERE nx.consumer_id = mc.consumer_id
              AND nx.bucket = (g.bucket + interval '1 month')::date
          )
      ) AS retained
    FROM generate_series(v_cohort_start, v_month_start, interval '1 month') g(bucket)
  ),
  top_consumers AS (
    SELECT
      c.consumer_id,
      count(*)::bigint  AS scans,
      max(c.scanned_at) AS last_scan
    FROM cur c
    WHERE c.consumer_id IS NOT NULL
    GROUP BY c.consumer_id
    ORDER BY scans DESC, last_scan DESC
    LIMIT 15
  ),
  top_products AS (
    SELECT q.product_id, q.variant_id, count(*)::bigint AS scans
    FROM cur c
    JOIN public.qr_codes q ON q.id = c.qr_code_id
    GROUP BY q.product_id, q.variant_id
    ORDER BY scans DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'month',       p_month,
    'daysInMonth', v_days,
    'current', COALESCE(
      (SELECT jsonb_build_object(
         'totalScans',          mt.scans,
         'identifiedScans',     mt.identified_scans,
         'identifiedConsumers', mt.consumers)
       FROM month_totals mt WHERE mt.bucket = v_month_start),
      jsonb_build_object('totalScans', 0, 'identifiedScans', 0, 'identifiedConsumers', 0)
    ),
    'previous', COALESCE(
      (SELECT jsonb_build_object(
         'totalScans',          mt.scans,
         'identifiedScans',     mt.identified_scans,
         'identifiedConsumers', mt.consumers)
       FROM month_totals mt WHERE mt.bucket = v_prev_month),
      jsonb_build_object('totalScans', 0, 'identifiedScans', 0, 'identifiedConsumers', 0)
    ),
    'returningCurrent',  (SELECT n FROM returning_current),
    'returningPrevious', (SELECT n FROM returning_previous),
    'dailyTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d.d, 'YYYY-MM-DD'), 'scans', d.scans, 'consumers', d.consumers
      ) ORDER BY d.d) FROM daily d), '[]'::jsonb),
    'twelveMonthTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month', t.month, 'scans', t.scans, 'consumers', t.consumers
      ) ORDER BY t.month) FROM twelve t), '[]'::jsonb),
    'activityHeatmap', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'dayOfWeek', h.day_of_week, 'hour', h.hour, 'scans', h.scans
      ) ORDER BY h.day_of_week, h.hour) FROM heatmap h), '[]'::jsonb),
    'cohort', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month', c.month, 'consumers', c.consumers, 'retained', c.retained
      ) ORDER BY c.month) FROM cohort c), '[]'::jsonb),
    'topConsumers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'consumerId', tc.consumer_id,
        'scans',      tc.scans,
        'lastScan',   tc.last_scan,
        'name',       u.full_name,
        'phone',      u.phone
      ) ORDER BY tc.scans DESC, tc.last_scan DESC)
      FROM top_consumers tc
      -- LEFT JOIN: users RLS must never drop a ranked consumer row, it may only
      -- blank the display name.
      LEFT JOIN public.users u ON u.id = tc.consumer_id), '[]'::jsonb),
    'topProducts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId',   tp.product_id,
        'variantId',   tp.variant_id,
        'productName', p.product_name,
        'variantName', pv.variant_name,
        'scans',       tp.scans
      ) ORDER BY tp.scans DESC)
      FROM top_products tp
      -- LEFT JOIN for the same reason: catalogue RLS may hide a name, it must
      -- never silently reduce reported scan volume.
      LEFT JOIN public.products         p  ON p.id  = tp.product_id
      LEFT JOIN public.product_variants pv ON pv.id = tp.variant_id), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_consumer_analytics(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_consumer_analytics(text) TO authenticated;

COMMENT ON FUNCTION public.reporting_consumer_analytics(text) IS
  'Compact monthly Consumer Analytics report (KPIs, trends, cohort, top lists) for one YYYY-MM reporting month in Asia/Kuala_Lumpur; honors consumer_qr_scans RLS.';
