-- ============================================================================
-- orders.order_date — the business / document date of an order
-- ----------------------------------------------------------------------------
-- Until now orders.created_at did two jobs: the real system/audit creation
-- timestamp AND the business date every SO view and report showed and
-- bucketed on. A D2H Sales Order keyed in on 21 Sep for goods ordered on
-- 15 Sep therefore could only ever be a 21 Sep order.
--
-- This migration separates the two:
--
--   order_date  date         business / SO date (may be backdated, never future)
--   created_at  timestamptz  actual system creation timestamp (never backdated)
--
-- Steps (additive; no existing column is changed):
--   1. add order_date (nullable while it is backfilled);
--   2. backfill every existing order with its Malaysia calendar date of
--      created_at — (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date — so a
--      legacy order stamped 2026-08-31 16:30 UTC (= 01 Sep 00:30 MYT) is a
--      1 Sep order, exactly the day every MYT report already bucketed it on;
--   3. default new rows to today's date in Asia/Kuala_Lumpur (NOT the UTC date,
--      which is yesterday between 00:00 and 08:00 MYT) and make it NOT NULL;
--   4. a guard trigger fills a NULL order_date with the MYT date and rejects a
--      future one on every write path, not only the dashboard's;
--   5. indexes for the reports that now filter on order_date.
--
-- created_at, updated_at and every other timestamp are left untouched. The
-- backfill UPDATE would otherwise fire the orders_updated_at trigger and
-- restamp updated_at on every historical order, so that one trigger is
-- disabled for the duration of the backfill only. No other orders trigger
-- fires for an UPDATE that only touches order_date (the rest are
-- UPDATE OF status / fulfillment_warehouse_id / seller_org_id or INSERT).
--
-- NOT applied automatically: run manually after review.
-- ============================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_date date;

ALTER TABLE public.orders DISABLE TRIGGER orders_updated_at;

UPDATE public.orders
   SET order_date = (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
 WHERE order_date IS NULL
   AND created_at IS NOT NULL;

-- created_at is nullable in the schema. An order without one has no system
-- date to derive from; it takes the migration day rather than blocking NOT NULL.
UPDATE public.orders
   SET order_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
 WHERE order_date IS NULL;

ALTER TABLE public.orders ENABLE TRIGGER orders_updated_at;

ALTER TABLE public.orders
  ALTER COLUMN order_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);

ALTER TABLE public.orders
  ALTER COLUMN order_date SET NOT NULL;

COMMENT ON COLUMN public.orders.order_date IS
  'Business/document date of the order (Asia/Kuala_Lumpur calendar date). Used for the SO date and all business/order reporting. May be backdated, never in the future. created_at remains the actual system/audit creation timestamp and is never backdated.';

-- ---------------------------------------------------------------------------
-- Guard: every write path gets a MYT order_date and none can set a future one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_order_date_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  IF NEW.order_date IS NULL THEN
    NEW.order_date := CASE
      WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.order_date, v_today)
      ELSE v_today
    END;
  END IF;

  IF NEW.order_date > v_today
     AND (TG_OP = 'INSERT' OR NEW.order_date IS DISTINCT FROM OLD.order_date) THEN
    RAISE EXCEPTION 'Order Date cannot be in the future.'
      USING ERRCODE = '22023',
            DETAIL = format('order_date %s is after today (%s, Asia/Kuala_Lumpur).', NEW.order_date, v_today);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_order_date_guard() IS
  'Fills a missing orders.order_date with today in Asia/Kuala_Lumpur and rejects a future order_date on insert or when it is changed.';

DROP TRIGGER IF EXISTS orders_order_date_guard ON public.orders;
CREATE TRIGGER orders_order_date_guard
  BEFORE INSERT OR UPDATE OF order_date ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_order_date_guard();

-- ---------------------------------------------------------------------------
-- Indexes. Monthly reports window on order_date; the distributor report and
-- the reporting-month lists additionally restrict to one order type.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_order_date
  ON public.orders USING btree (order_date DESC);

CREATE INDEX IF NOT EXISTS idx_orders_type_order_date
  ON public.orders USING btree (order_type, order_date);

COMMIT;
