BEGIN;

-- Outdoor / storefront shipping + channel fields (non-breaking defaults).
ALTER TABLE public.storefront_orders
  ADD COLUMN IF NOT EXISTS sales_channel text NOT NULL DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS shipping_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_service_id text,
  ADD COLUMN IF NOT EXISTS shipping_courier_name text,
  ADD COLUMN IF NOT EXISTS shipping_tracking_no text,
  ADD COLUMN IF NOT EXISTS easyparcel_order_no text;

COMMENT ON COLUMN public.storefront_orders.sales_channel IS
  'store | outdoor — which storefront created the order';

CREATE INDEX IF NOT EXISTS storefront_orders_sales_channel_created_idx
  ON public.storefront_orders (sales_channel, created_at DESC);

COMMIT;
