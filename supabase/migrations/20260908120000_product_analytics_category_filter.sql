-- Product Analytics: report scoped to one Product Category, or consolidated.
--
-- Extends the monthly Product Analytics reporting function created in
-- 20260907120000_product_analytics_monthly_report.sql so the whole report --
-- every KPI, denominator, ranking, the current inventory snapshot and the new
-- Category Performance rows -- can be scoped to a single product category.
-- Category filtering happens here, in the reporting layer, never in the browser.
--
-- p_category_id NULL  -> consolidated report across every category, and the
--                        per-category `categories` array is populated.
-- p_category_id <uuid>-> drill-down into that category; `categories` is empty
--                        because comparing categories has nothing left to say.
--
-- The one-argument overload is dropped first ON PURPOSE. Adding
-- reporting_product_analytics(text, uuid DEFAULT NULL) alongside the existing
-- reporting_product_analytics(text) would make every single-argument call
-- ambiguous (42725), so the old signature is replaced rather than shadowed.
-- This drops a reporting-only function created by the migration above; it
-- touches no table, no row, no policy and no data.
--
-- Category comes from the canonical assignment products.category_id, resolved
-- through the variant's parent product. It is never inferred from product,
-- variant or brand names. A variant whose parent product cannot be resolved is
-- counted in the consolidated report but is excluded from every specific
-- category filter -- it is never silently assigned to one.
--
-- SECURITY INVOKER is unchanged: orders / order_items / products /
-- product_variants / product_inventory / product_categories RLS stays
-- authoritative.

DROP FUNCTION IF EXISTS public.reporting_product_analytics(text);

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
  v_start         timestamptz;
  v_end           timestamptz;
  v_prev_start    timestamptz;
  v_prev_end      timestamptz;
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

  v_start      := v_month_start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_end        := (v_month_start + v_day_count)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_prev_start := v_prev_month::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_prev_end   := (v_prev_month + v_cmp_days)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';

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
      o.created_at,
      (o.created_at >= v_start      AND o.created_at < v_end)      AS in_current,
      (o.created_at >= v_prev_start AND o.created_at < v_prev_end) AS in_previous
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN catalogue c ON c.id = oi.variant_id
    WHERE o.created_at IS NOT NULL
      AND o.status = ANY (v_statuses)
      AND o.created_at >= v_prev_start
      AND o.created_at <  v_end
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
        (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d,
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
    SELECT oi.variant_id, max(o.created_at) AS last_at
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.created_at IS NOT NULL
      AND o.status = ANY (v_statuses)
      AND o.created_at < v_end
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
      lo.last_at
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
        'lastOrderedAt',  v.last_at
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
  'Compact monthly Product Analytics report for one YYYY-MM reporting month in Asia/Kuala_Lumpur, optionally scoped to one product_categories.id (NULL = all categories, which also returns per-category totals); honors orders/order_items/product_inventory RLS.';
