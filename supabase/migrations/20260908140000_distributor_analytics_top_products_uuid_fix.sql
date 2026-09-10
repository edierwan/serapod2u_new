-- reporting_distributor_analytics never ran: its top_products CTE aggregated
-- product_variants.product_id with max(), and Postgres has no max(uuid), so the
-- whole report raised 42883 "function max(uuid) does not exist". The Distributor
-- Analytics API surfaced that as a 500 rather than degrading, because its
-- fallback only recognises a MISSING function (PGRST202 / schema cache), not a
-- function that exists and fails.
--
-- pv joins 1:1 on oi.variant_id and the group is that same variant_id, so every
-- row in a group carries the same product_id and the aggregate only has to pick
-- one. array_agg(...)[1] does that for a uuid; the sibling text columns keep
-- max() because it is valid for text and the value is likewise constant.
--
-- Recreating the function wholesale is how this repo already revises these
-- reports - see 20260908120000, which recreates reporting_product_analytics.
-- Behaviour is otherwise identical to 20260908130000.

CREATE OR REPLACE FUNCTION public.reporting_distributor_analytics(
  p_month          text,
  p_distributor_id uuid DEFAULT NULL,
  p_status         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
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
  v_scope_name    text;
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

  SELECT o.org_name INTO v_scope_name
    FROM public.organizations o
   WHERE p_distributor_id IS NOT NULL
     AND o.id = p_distributor_id;

  WITH scope AS (
    -- The distributor universe: every DIST organisation the caller can read,
    -- narrowed to one when the report is scoped to a single distributor.
    SELECT b.id, b.org_name, b.org_code, b.is_active
      FROM public.organizations b
     WHERE b.org_type_code = 'DIST'
       AND (p_distributor_id IS NULL OR b.id = p_distributor_id)
  ),
  eligible AS (
    -- Every eligible order across ALL history for the scoped distributors.
    -- The status scope is applied here, so it reaches the report window, the
    -- comparison window and the lifetime history identically — the previous
    -- report filtered the current period and the comparison period separately.
    SELECT o.id, o.buyer_org_id, o.created_at, o.status, o.order_no, o.display_doc_no
      FROM public.orders o
      JOIN scope s ON s.id = o.buyer_org_id
     WHERE o.created_at IS NOT NULL
       AND o.order_type = 'D2H'
       AND (p_status IS NULL OR o.status = p_status::public.order_status)
  ),
  lifetime AS (
    -- What makes "New Distributor" mean first-ever rather than merely absent
    -- last month, and what dormancy is measured from.
    SELECT e.buyer_org_id,
           min(e.created_at)  AS first_order_at,
           max(e.created_at)  AS last_order_at,
           count(*)::bigint   AS lifetime_orders
      FROM eligible e
     GROUP BY e.buyer_org_id
  ),
  windowed AS (
    -- The report window and its comparison window are adjacent, so this is one
    -- index range on orders.created_at rather than two separate scans.
    SELECT e.*,
           (e.created_at >= v_start      AND e.created_at < v_end)      AS in_current,
           (e.created_at >= v_prev_start AND e.created_at < v_prev_end) AS in_previous
      FROM eligible e
     WHERE v_day_count > 0
       AND e.created_at >= v_prev_start
       AND e.created_at <  v_end
  ),
  order_values AS (
    SELECT oi.order_id,
           sum(COALESCE(oi.line_total, oi.qty * oi.unit_price))::numeric AS order_value,
           count(*)::bigint                                              AS item_count
      FROM public.order_items oi
      JOIN windowed w ON w.id = oi.order_id
     GROUP BY oi.order_id
  ),
  window_orders AS (
    -- An order with no lines still counts as an order and carries zero value,
    -- which is how the previous report counted it.
    SELECT w.*,
           COALESCE(ov.order_value, 0)::numeric AS order_value,
           COALESCE(ov.item_count, 0)::bigint   AS item_count
      FROM windowed w
      LEFT JOIN order_values ov ON ov.order_id = w.id
  ),
  per_distributor AS (
    SELECT s.id                                                                        AS distributor_id,
           s.org_name,
           s.org_code,
           s.is_active,
           COALESCE(count(*) FILTER (WHERE w.in_current), 0)::bigint                   AS current_orders,
           COALESCE(sum(w.order_value) FILTER (WHERE w.in_current), 0)::numeric        AS current_value,
           COALESCE(count(*) FILTER (WHERE w.in_previous), 0)::bigint                  AS previous_orders,
           COALESCE(sum(w.order_value) FILTER (WHERE w.in_previous), 0)::numeric       AS previous_value,
           l.first_order_at,
           l.last_order_at,
           COALESCE(l.lifetime_orders, 0)::bigint                                      AS lifetime_orders
      FROM scope s
      LEFT JOIN lifetime l      ON l.buyer_org_id = s.id
      LEFT JOIN window_orders w ON w.buyer_org_id = s.id
     -- Distributors that have never placed an eligible order carry no history
     -- and no activity; they are master data, not a management concern.
     WHERE l.buyer_org_id IS NOT NULL
     GROUP BY s.id, s.org_name, s.org_code, s.is_active,
              l.first_order_at, l.last_order_at, l.lifetime_orders
  ),
  totals AS (
    SELECT
      COALESCE(count(*) FILTER (WHERE in_current), 0)::bigint                            AS current_orders,
      COALESCE(sum(order_value) FILTER (WHERE in_current), 0)::numeric                   AS current_value,
      COALESCE(count(DISTINCT buyer_org_id) FILTER (WHERE in_current), 0)::bigint        AS current_active,
      COALESCE(count(*) FILTER (WHERE in_previous), 0)::bigint                           AS previous_orders,
      COALESCE(sum(order_value) FILTER (WHERE in_previous), 0)::numeric                  AS previous_value,
      COALESCE(count(DISTINCT buyer_org_id) FILTER (WHERE in_previous), 0)::bigint       AS previous_active
      FROM window_orders
  ),
  day_series AS (
    -- Every day of the report window, including days with no trading, and no
    -- day beyond it — the running month stops at today.
    SELECT to_char(v_month_start + gs, 'YYYY-MM-DD') AS day_key
      FROM generate_series(0, GREATEST(v_day_count - 1, 0)) AS gs
     WHERE v_day_count > 0
  ),
  daily AS (
    SELECT to_char((w.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD') AS day_key,
           count(*)::bigint          AS orders,
           sum(w.order_value)::numeric AS order_value
      FROM window_orders w
     WHERE w.in_current
     GROUP BY 1
  ),
  status_mix AS (
    SELECT w.status::text          AS status,
           count(*)::bigint        AS orders,
           sum(w.order_value)::numeric AS order_value
      FROM window_orders w
     WHERE w.in_current
     GROUP BY 1
  ),
  top_products AS (
    SELECT oi.variant_id,
           (array_agg(pv.product_id))[1] AS product_id,
           max(p.product_name)     AS product_name,
           max(pv.variant_name)    AS variant_name,
           max(pv.product_code)    AS product_code,
           sum(oi.qty)::numeric    AS units,
           sum(COALESCE(oi.line_total, oi.qty * oi.unit_price))::numeric AS order_value
      FROM public.order_items oi
      JOIN window_orders w ON w.id = oi.order_id AND w.in_current
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN public.products p          ON p.id = pv.product_id
     GROUP BY oi.variant_id
     ORDER BY order_value DESC NULLS LAST
     LIMIT 10
  ),
  recent AS (
    SELECT w.id, w.order_no, w.display_doc_no, w.created_at, w.status,
           w.buyer_org_id, w.order_value, w.item_count, s.org_name
      FROM window_orders w
      JOIN scope s ON s.id = w.buyer_org_id
     WHERE w.in_current
     ORDER BY w.created_at DESC
     LIMIT 20
  )
  SELECT jsonb_build_object(
    'month', p_month,
    'distributorId', COALESCE(p_distributor_id::text, 'all'),
    'distributorName', COALESCE(v_scope_name, 'All Distributors'),
    'status', COALESCE(p_status, 'all'),
    'current', jsonb_build_object(
      'orders', t.current_orders,
      'orderValue', round(t.current_value, 2),
      'activeDistributors', t.current_active
    ),
    'previous', jsonb_build_object(
      'orders', t.previous_orders,
      'orderValue', round(t.previous_value, 2),
      'activeDistributors', t.previous_active
    ),
    'dailyTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'date', ds.day_key,
               'orders', COALESCE(d.orders, 0),
               'orderValue', round(COALESCE(d.order_value, 0), 2)
             ) ORDER BY ds.day_key)
        FROM day_series ds
        LEFT JOIN daily d ON d.day_key = ds.day_key
    ), '[]'::jsonb),
    'distributors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'distributorId', pd.distributor_id,
               'name', pd.org_name,
               'orgCode', pd.org_code,
               'isActive', COALESCE(pd.is_active, true),
               'currentOrders', pd.current_orders,
               'currentValue', round(pd.current_value, 2),
               'previousOrders', pd.previous_orders,
               'previousValue', round(pd.previous_value, 2),
               'firstOrderAt', pd.first_order_at,
               'lastOrderAt', pd.last_order_at,
               'lifetimeOrders', pd.lifetime_orders
             ))
        FROM per_distributor pd
    ), '[]'::jsonb),
    'statusBreakdown', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'status', sm.status,
               'orders', sm.orders,
               'orderValue', round(COALESCE(sm.order_value, 0), 2)
             ))
        FROM status_mix sm
    ), '[]'::jsonb),
    'topProducts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'variantId', tp.variant_id,
               'productId', tp.product_id,
               'productName', tp.product_name,
               'variantName', tp.variant_name,
               'productCode', tp.product_code,
               'units', COALESCE(tp.units, 0),
               'orderValue', round(COALESCE(tp.order_value, 0), 2)
             ))
        FROM top_products tp
    ), '[]'::jsonb),
    'recentOrders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'orderId', r.id,
               'orderNo', COALESCE(r.display_doc_no, r.order_no),
               'createdAt', r.created_at,
               'status', r.status::text,
               'distributorId', r.buyer_org_id,
               'distributorName', r.org_name,
               'orderValue', round(r.order_value, 2),
               'itemCount', r.item_count
             ) ORDER BY r.created_at DESC)
        FROM recent r
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM totals t;

  RETURN COALESCE(v_result, jsonb_build_object(
    'month', p_month,
    'distributorId', COALESCE(p_distributor_id::text, 'all'),
    'distributorName', COALESCE(v_scope_name, 'All Distributors'),
    'status', COALESCE(p_status, 'all'),
    'current', jsonb_build_object('orders', 0, 'orderValue', 0, 'activeDistributors', 0),
    'previous', jsonb_build_object('orders', 0, 'orderValue', 0, 'activeDistributors', 0),
    'dailyTrend', '[]'::jsonb,
    'distributors', '[]'::jsonb,
    'statusBreakdown', '[]'::jsonb,
    'topProducts', '[]'::jsonb,
    'recentOrders', '[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_distributor_analytics(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_distributor_analytics(text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.reporting_distributor_analytics(text, uuid, text) IS
  'Monthly distributor management report (MTD vs same elapsed days, or full month vs full previous month) in Asia/Kuala_Lumpur. D2H orders with DIST buyers; Order Value from order_items. Honors orders / order_items / organizations RLS.';
