-- Monthly Product Analytics management report, aggregated inside the database.
--
-- Replaces the previous browser-side model where ProductsTab pulled a rolling
-- 12 months of raw orders into React, then re-read order_items by batching
-- order ids 200 at a time, and computed every KPI client-side. That does not
-- survive Production order volume. This function returns one compact JSON
-- report per reporting month.
--
-- SECURITY INVOKER is intentional and matches reporting_consumer_analytics:
-- orders / order_items / products / product_variants / product_inventory RLS
-- stays authoritative, so the function can never widen what the signed-in
-- manager is already allowed to read.
--
-- Reporting model (identical to lib/reporting/product-analytics.ts):
--   * every boundary is a half-open interval in Asia/Kuala_Lumpur;
--   * the running month reports month-to-date and compares against the SAME
--     elapsed days of the previous month, clamped to that month's final day;
--   * a completed month reports in full and compares against the complete
--     previous calendar month;
--   * eligible order statuses are approved / closed / submitted, bucketed on
--     orders.created_at — unchanged from the report this replaces.
--
-- Additive and reporting-only: it creates two functions and touches no table,
-- no row, no policy and no grant beyond EXECUTE for authenticated.

CREATE OR REPLACE FUNCTION public.reporting_product_order_periods()
RETURNS TABLE(period_key text, transaction_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('month', o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') AS period_key,
    count(*)::bigint AS transaction_count
  FROM public.orders o
  WHERE o.created_at IS NOT NULL
    AND o.status = ANY (ARRAY['approved', 'closed', 'submitted']::public.order_status[])
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.reporting_product_order_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_product_order_periods() TO authenticated;

COMMENT ON FUNCTION public.reporting_product_order_periods() IS
  'Reporting months containing eligible product orders, in Asia/Kuala_Lumpur; honors orders RLS.';


CREATE OR REPLACE FUNCTION public.reporting_product_analytics(p_month text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_statuses      public.order_status[] := ARRAY['approved', 'closed', 'submitted']::public.order_status[];
  v_month_start   date;
  v_today         date;
  v_current_month date;
  v_prev_month    date;
  v_days_in_month integer;
  v_days_in_prev  integer;
  v_day_count     integer;
  v_cmp_days      integer;
  v_start         timestamptz;
  v_end           timestamptz;
  v_prev_start    timestamptz;
  v_prev_end      timestamptz;
  v_result        jsonb;
BEGIN
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid reporting month %, expected YYYY-MM', p_month
      USING ERRCODE = '22023';
  END IF;

  v_month_start   := (p_month || '-01')::date;
  v_today         := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_current_month := date_trunc('month', v_today)::date;
  v_prev_month    := (v_month_start - interval '1 month')::date;
  v_days_in_month := extract(day from (v_month_start + interval '1 month' - interval '1 day'))::integer;
  v_days_in_prev  := extract(day from (v_month_start - interval '1 day'))::integer;

  -- Month to date for the running month; the complete month once it is closed.
  v_day_count := CASE
    WHEN v_month_start > v_current_month THEN 0
    WHEN v_month_start = v_current_month THEN LEAST(extract(day from v_today)::integer, v_days_in_month)
    ELSE v_days_in_month
  END;

  -- Same elapsed days of the previous month while reporting MTD (clamped where
  -- that month is shorter); the complete previous month for a closed month.
  v_cmp_days := CASE
    WHEN v_month_start = v_current_month THEN LEAST(v_day_count, v_days_in_prev)
    ELSE v_days_in_prev
  END;

  v_start      := v_month_start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_end        := (v_month_start + v_day_count)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_prev_start := v_prev_month::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_prev_end   := (v_prev_month + v_cmp_days)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';

  WITH lines AS (
    -- One bounded pass over the report window and its comparison window. The
    -- two are adjacent, so this is a single index range on orders.created_at.
    SELECT
      oi.variant_id,
      oi.qty::numeric                                       AS qty,
      COALESCE(oi.line_total, oi.qty * oi.unit_price)       AS value,
      o.created_at,
      (o.created_at >= v_start      AND o.created_at < v_end)      AS in_current,
      (o.created_at >= v_prev_start AND o.created_at < v_prev_end) AS in_previous
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.created_at IS NOT NULL
      AND o.status = ANY (v_statuses)
      AND o.created_at >= v_prev_start
      AND o.created_at <  v_end
      AND v_day_count > 0
  ),
  totals AS (
    SELECT
      COALESCE(sum(qty)   FILTER (WHERE in_current), 0)::numeric  AS cur_units,
      COALESCE(sum(value) FILTER (WHERE in_current), 0)::numeric  AS cur_value,
      count(DISTINCT variant_id) FILTER (WHERE in_current)        AS cur_skus,
      COALESCE(sum(qty)   FILTER (WHERE in_previous), 0)::numeric AS prev_units,
      COALESCE(sum(value) FILTER (WHERE in_previous), 0)::numeric AS prev_value,
      count(DISTINCT variant_id) FILTER (WHERE in_previous)       AS prev_skus
    FROM lines
  ),
  daily AS (
    -- Exactly v_day_count rows: days that have not happened in the running
    -- month are never emitted as zero activity.
    SELECT
      g.d::date                          AS d,
      COALESCE(x.units, 0)::numeric      AS units,
      COALESCE(x.value, 0)::numeric      AS value
    FROM generate_series(v_month_start, v_month_start + (v_day_count - 1), interval '1 day') g(d)
    LEFT JOIN (
      SELECT
        (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d,
        sum(qty)   AS units,
        sum(value) AS value
      FROM lines
      WHERE in_current
      GROUP BY 1
    ) x ON x.d = g.d::date
    WHERE v_day_count > 0
  ),
  demand AS (
    SELECT
      variant_id,
      COALESCE(sum(qty)   FILTER (WHERE in_current), 0)::numeric  AS cur_units,
      COALESCE(sum(value) FILTER (WHERE in_current), 0)::numeric  AS cur_value,
      COALESCE(sum(qty)   FILTER (WHERE in_previous), 0)::numeric AS prev_units,
      COALESCE(sum(value) FILTER (WHERE in_previous), 0)::numeric AS prev_value
    FROM lines
    GROUP BY variant_id
  ),
  stock AS (
    SELECT
      pi.variant_id,
      COALESCE(sum(pi.quantity_on_hand), 0)::numeric   AS on_hand,
      COALESCE(sum(pi.quantity_available), 0)::numeric AS available,
      COALESCE(max(pi.reorder_point), 0)::numeric      AS reorder_point,
      COALESCE(max(pi.safety_stock), 0)::numeric       AS safety_stock,
      COALESCE(sum(pi.total_value), 0)::numeric        AS value,
      max(pi.updated_at)                               AS updated_at
    FROM public.product_inventory pi
    GROUP BY pi.variant_id
  ),
  last_ordered AS (
    -- Unbounded on purpose: "last ordered" must not be capped by the report
    -- window, or a dormant SKU would look as if it had never been ordered.
    SELECT oi.variant_id, max(o.created_at) AS last_at
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.created_at IS NOT NULL
      AND o.status = ANY (v_statuses)
      AND o.created_at < v_end
    GROUP BY oi.variant_id
  ),
  catalogue AS (
    SELECT pv.id, pv.product_id, pv.variant_name, pv.product_code, pv.is_active, p.product_name
    FROM public.product_variants pv
    -- LEFT JOIN: catalogue RLS may hide a product name, it must never silently
    -- drop a variant that carries demand or stock.
    LEFT JOIN public.products p ON p.id = pv.product_id
  ),
  variants AS (
    SELECT
      v.variant_id,
      c.product_id,
      c.product_name,
      c.variant_name,
      c.product_code,
      COALESCE(c.is_active, true) AS is_active,
      COALESCE(d.cur_units, 0)    AS cur_units,
      COALESCE(d.cur_value, 0)    AS cur_value,
      COALESCE(d.prev_units, 0)   AS prev_units,
      COALESCE(d.prev_value, 0)   AS prev_value,
      COALESCE(s.on_hand, 0)      AS on_hand,
      COALESCE(s.available, 0)    AS available,
      COALESCE(s.reorder_point, 0) AS reorder_point,
      COALESCE(s.safety_stock, 0)  AS safety_stock,
      COALESCE(s.value, 0)         AS stock_value,
      lo.last_at
    FROM (
      -- Every variant that traded in either window, holds stock, or is active
      -- master data.
      SELECT variant_id FROM demand
      UNION
      SELECT variant_id FROM stock
      UNION
      SELECT id FROM catalogue WHERE COALESCE(is_active, true)
    ) v
    LEFT JOIN catalogue    c  ON c.id = v.variant_id
    LEFT JOIN demand       d  ON d.variant_id = v.variant_id
    LEFT JOIN stock        s  ON s.variant_id = v.variant_id
    LEFT JOIN last_ordered lo ON lo.variant_id = v.variant_id
  )
  SELECT jsonb_build_object(
    'month', p_month,
    'current', (SELECT jsonb_build_object(
        'units', cur_units, 'orderValue', cur_value, 'skus', COALESCE(cur_skus, 0), 'orders', 0) FROM totals),
    'previous', (SELECT jsonb_build_object(
        'units', prev_units, 'orderValue', prev_value, 'skus', COALESCE(prev_skus, 0), 'orders', 0) FROM totals),
    'activeSkus', (SELECT count(*)::bigint FROM catalogue WHERE COALESCE(is_active, true)),
    'dailyTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d.d, 'YYYY-MM-DD'), 'units', d.units, 'orderValue', d.value
      ) ORDER BY d.d) FROM daily d), '[]'::jsonb),
    'variants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'variantId',     v.variant_id,
        'productId',     v.product_id,
        'productName',   v.product_name,
        'variantName',   v.variant_name,
        'productCode',   v.product_code,
        'isActive',      v.is_active,
        'currentUnits',  v.cur_units,
        'currentValue',  v.cur_value,
        'previousUnits', v.prev_units,
        'previousValue', v.prev_value,
        'stockOnHand',   v.on_hand,
        'stockAvailable', v.available,
        'reorderPoint',  v.reorder_point,
        'safetyStock',   v.safety_stock,
        'stockValue',    v.stock_value,
        'lastOrderedAt', v.last_at
      )) FROM variants v), '[]'::jsonb),
    'inventory', (SELECT jsonb_build_object(
        'totalValue',   COALESCE(sum(value), 0),
        'totalOnHand',  COALESCE(sum(on_hand), 0),
        'variantCount', count(*),
        'asOf',         max(updated_at)
      ) FROM stock)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_product_analytics(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_product_analytics(text) TO authenticated;

COMMENT ON FUNCTION public.reporting_product_analytics(text) IS
  'Compact monthly Product Analytics report (KPIs, daily trend, per-variant demand and stock) for one YYYY-MM reporting month in Asia/Kuala_Lumpur; honors orders/order_items/product_inventory RLS.';
