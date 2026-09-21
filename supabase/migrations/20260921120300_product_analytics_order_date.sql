-- ============================================================================
-- Product Analytics buckets on the business date orders.order_date
-- ----------------------------------------------------------------------------
-- Requires 20260921120000_add_orders_order_date.sql.
--
-- Product Analytics measures the same orders' Order Value as Distributor
-- Analytics. Once Distributor Analytics moved to orders.order_date
-- (20260921120200), leaving this report on orders.created_at would put a
-- backdated D2H SO (dated 31 Aug, keyed in 21 Sep) in August on one report and
-- in September on the other. Both now use the business date:
--   * reporting months (reporting_product_order_periods);
--   * report / comparison windows (MTD rule unchanged);
--   * Daily trend buckets (order_date directly, no tz conversion);
--   * Last Ordered per SKU (lastOrderedAt = MYT midnight of the date, plus
--     lastOrderedDate).
-- The inventory snapshot is unaffected (current stock, not an order date).
--
-- For every order whose order_date is the MYT date of created_at (all legacy
-- rows, and every non-backdated order) the figures are unchanged: the previous
-- timestamptz windows were exactly the MYT midnights of these dates.
--
-- Same signature, grants and SECURITY INVOKER model as 20260908120000, which
-- stays untouched.
--
-- NOT applied automatically: run manually after review.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reporting_product_order_periods()
RETURNS TABLE(period_key text, transaction_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    to_char(o.order_date, 'YYYY-MM') AS period_key,
    count(*)::bigint AS transaction_count
  FROM public.orders o
  WHERE o.order_date IS NOT NULL
    AND o.status = ANY (ARRAY['approved', 'closed', 'submitted']::public.order_status[])
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.reporting_product_order_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_product_order_periods() TO authenticated;

COMMENT ON FUNCTION public.reporting_product_order_periods() IS
  'Reporting months (by business date orders.order_date) containing eligible product orders; honors orders RLS.';


CREATE OR REPLACE FUNCTION public.reporting_product_analytics(
  p_month       text,
  p_category_id uuid DEFAULT NULL
)
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
  v_end_date      date;
  v_prev_end_date date;
  v_all           boolean := p_category_id IS NULL;
  v_cat_name      text;
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

  -- Half-open business-date windows over orders.order_date (a Malaysia
  -- calendar date — no time-zone conversion is applied to it below).
  v_end_date      := v_month_start + v_day_count;
  v_prev_end_date := v_prev_month + v_cmp_days;

  SELECT pc.category_name INTO v_cat_name
  FROM public.product_categories pc WHERE pc.id = p_category_id;

  WITH catalogue AS (
    -- Canonical variant -> product -> category assignment.
    SELECT
      pv.id, pv.product_id, pv.variant_name, pv.product_code, pv.is_active,
      p.product_name, p.category_id, pc.category_name
    FROM public.product_variants pv
    -- LEFT JOINs: catalogue RLS may hide a name, it must never silently drop a
    -- variant that carries demand or stock.
    LEFT JOIN public.products           p  ON p.id  = pv.product_id
    LEFT JOIN public.product_categories pc ON pc.id = p.category_id
  ),
  lines AS (
    -- One bounded pass over the report window and its comparison window, with
    -- each line's canonical category attached.
    SELECT
      oi.variant_id,
      c.category_id,
      oi.qty::numeric                                 AS qty,
      COALESCE(oi.line_total, oi.qty * oi.unit_price) AS value,
      o.order_date,
      (o.order_date >= v_month_start AND o.order_date < v_end_date)      AS in_current,
      (o.order_date >= v_prev_month  AND o.order_date < v_prev_end_date) AS in_previous
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN catalogue c ON c.id = oi.variant_id
    WHERE o.order_date IS NOT NULL
      AND o.status = ANY (v_statuses)
      AND o.order_date >= v_prev_month
      AND o.order_date <  v_end_date
      AND v_day_count > 0
  ),
  scoped AS (
    -- Everything downstream of here is already inside the selected scope.
    SELECT * FROM lines
    WHERE v_all OR category_id = p_category_id
  ),
  cat_totals AS (
    -- Per-category totals for Category Performance. Accumulated across every
    -- category and surfaced only on the consolidated report.
    SELECT
      l.category_id,
      COALESCE(sum(l.qty)   FILTER (WHERE l.in_current), 0)::numeric  AS cur_units,
      COALESCE(sum(l.value) FILTER (WHERE l.in_current), 0)::numeric  AS cur_value,
      count(DISTINCT l.variant_id) FILTER (WHERE l.in_current)        AS cur_skus,
      COALESCE(sum(l.qty)   FILTER (WHERE l.in_previous), 0)::numeric AS prev_units,
      COALESCE(sum(l.value) FILTER (WHERE l.in_previous), 0)::numeric AS prev_value,
      count(DISTINCT l.variant_id) FILTER (WHERE l.in_previous)       AS prev_skus
    FROM lines l
    WHERE v_all AND l.category_id IS NOT NULL
    GROUP BY l.category_id
  ),
  active_by_cat AS (
    SELECT c.category_id, count(*)::bigint AS active_skus
    FROM catalogue c
    WHERE COALESCE(c.is_active, true) AND c.category_id IS NOT NULL
    GROUP BY c.category_id
  ),
  totals AS (
    SELECT
      COALESCE(sum(qty)   FILTER (WHERE in_current), 0)::numeric  AS cur_units,
      COALESCE(sum(value) FILTER (WHERE in_current), 0)::numeric  AS cur_value,
      count(DISTINCT variant_id) FILTER (WHERE in_current)        AS cur_skus,
      COALESCE(sum(qty)   FILTER (WHERE in_previous), 0)::numeric AS prev_units,
      COALESCE(sum(value) FILTER (WHERE in_previous), 0)::numeric AS prev_value,
      count(DISTINCT variant_id) FILTER (WHERE in_previous)       AS prev_skus
    FROM scoped
  ),
  daily AS (
    -- Exactly v_day_count rows, scoped to the selected category.
    SELECT
      g.d::date                     AS d,
      COALESCE(x.units, 0)::numeric AS units,
      COALESCE(x.value, 0)::numeric AS value
    FROM generate_series(v_month_start, v_month_start + (v_day_count - 1), interval '1 day') g(d)
    LEFT JOIN (
      SELECT
        order_date AS d,
        sum(qty)   AS units,
        sum(value) AS value
      FROM scoped
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
    FROM scoped
    GROUP BY variant_id
  ),
  stock AS (
    -- The snapshot stays CURRENT; only its category scope follows the filter.
    SELECT
      pi.variant_id,
      COALESCE(sum(pi.quantity_on_hand), 0)::numeric   AS on_hand,
      COALESCE(sum(pi.quantity_available), 0)::numeric AS available,
      COALESCE(max(pi.reorder_point), 0)::numeric      AS reorder_point,
      COALESCE(max(pi.safety_stock), 0)::numeric       AS safety_stock,
      COALESCE(sum(pi.total_value), 0)::numeric        AS value,
      max(pi.updated_at)                               AS updated_at
    FROM public.product_inventory pi
    JOIN catalogue c ON c.id = pi.variant_id
    WHERE v_all OR c.category_id = p_category_id
    GROUP BY pi.variant_id
  ),
  last_ordered AS (
    -- Unbounded on purpose: "last ordered" must not be capped by the report
    -- window, or a dormant SKU would look as if it had never been ordered.
    -- Business date of the last order; last_at is that date's 00:00 MYT so
    -- the existing lastOrderedAt consumers keep rendering the same day.
    SELECT oi.variant_id,
           max(o.order_date) AS last_date,
           max(o.order_date)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur' AS last_at
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.order_date IS NOT NULL
      AND o.status = ANY (v_statuses)
      AND o.order_date < v_end_date
    GROUP BY oi.variant_id
  ),
  variants AS (
    SELECT
      v.variant_id,
      c.product_id, c.product_name, c.variant_name, c.product_code,
      c.category_id, c.category_name,
      COALESCE(c.is_active, true)  AS is_active,
      COALESCE(d.cur_units, 0)     AS cur_units,
      COALESCE(d.cur_value, 0)     AS cur_value,
      COALESCE(d.prev_units, 0)    AS prev_units,
      COALESCE(d.prev_value, 0)    AS prev_value,
      COALESCE(s.on_hand, 0)       AS on_hand,
      COALESCE(s.available, 0)     AS available,
      COALESCE(s.reorder_point, 0) AS reorder_point,
      COALESCE(s.safety_stock, 0)  AS safety_stock,
      COALESCE(s.value, 0)         AS stock_value,
      lo.last_at,
      lo.last_date
    FROM (
      SELECT variant_id FROM demand
      UNION
      SELECT variant_id FROM stock
      UNION
      SELECT id FROM catalogue
       WHERE COALESCE(is_active, true)
         AND (v_all OR category_id = p_category_id)
    ) v
    LEFT JOIN catalogue    c  ON c.id = v.variant_id
    LEFT JOIN demand       d  ON d.variant_id = v.variant_id
    LEFT JOIN stock        s  ON s.variant_id = v.variant_id
    LEFT JOIN last_ordered lo ON lo.variant_id = v.variant_id
  )
  SELECT jsonb_build_object(
    'month',        p_month,
    'categoryId',   COALESCE(p_category_id::text, 'all'),
    'categoryName', CASE WHEN v_all THEN 'All Categories'
                         ELSE COALESCE(v_cat_name, 'Unknown category') END,
    'dateField',    'orders.order_date',
    'current', (SELECT jsonb_build_object(
        'units', cur_units, 'orderValue', cur_value, 'skus', COALESCE(cur_skus, 0), 'orders', 0) FROM totals),
    'previous', (SELECT jsonb_build_object(
        'units', prev_units, 'orderValue', prev_value, 'skus', COALESCE(prev_skus, 0), 'orders', 0) FROM totals),
    -- Denominator follows the scope: "6 of 18 active Vape SKUs".
    'activeSkus', (
      SELECT count(*)::bigint FROM catalogue
      WHERE COALESCE(is_active, true) AND (v_all OR category_id = p_category_id)),
    'dailyTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d.d, 'YYYY-MM-DD'), 'units', d.units, 'orderValue', d.value
      ) ORDER BY d.d) FROM daily d), '[]'::jsonb),
    'variants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'variantId',      v.variant_id,
        'productId',      v.product_id,
        'categoryId',     v.category_id,
        'categoryName',   v.category_name,
        'productName',    v.product_name,
        'variantName',    v.variant_name,
        'productCode',    v.product_code,
        'isActive',       v.is_active,
        'currentUnits',   v.cur_units,
        'currentValue',   v.cur_value,
        'previousUnits',  v.prev_units,
        'previousValue',  v.prev_value,
        'stockOnHand',    v.on_hand,
        'stockAvailable', v.available,
        'reorderPoint',   v.reorder_point,
        'safetyStock',    v.safety_stock,
        'stockValue',     v.stock_value,
        'lastOrderedAt',  v.last_at,
        'lastOrderedDate', to_char(v.last_date, 'YYYY-MM-DD')
      )) FROM variants v), '[]'::jsonb),
    'inventory', (SELECT jsonb_build_object(
        'totalValue',   COALESCE(sum(value), 0),
        'totalOnHand',  COALESCE(sum(on_hand), 0),
        'variantCount', count(*),
        'asOf',         max(updated_at)
      ) FROM stock),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'categoryId',    ct.category_id,
        'categoryName',  COALESCE(pc.category_name, 'Uncategorised'),
        'currentUnits',  ct.cur_units,
        'currentValue',  ct.cur_value,
        'currentSkus',   ct.cur_skus,
        'previousUnits', ct.prev_units,
        'previousValue', ct.prev_value,
        'previousSkus',  ct.prev_skus,
        'activeSkus',    COALESCE(ab.active_skus, 0)
      ) ORDER BY ct.cur_value DESC)
      FROM cat_totals ct
      LEFT JOIN public.product_categories pc ON pc.id = ct.category_id
      LEFT JOIN active_by_cat ab ON ab.category_id = ct.category_id), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_product_analytics(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_product_analytics(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.reporting_product_analytics(text, uuid) IS
  'Compact monthly Product Analytics report for one YYYY-MM reporting month in Asia/Kuala_Lumpur, bucketed on the business date orders.order_date, optionally scoped to one product_categories.id (NULL = all categories, which also returns per-category totals); honors orders/order_items/product_inventory RLS.';
