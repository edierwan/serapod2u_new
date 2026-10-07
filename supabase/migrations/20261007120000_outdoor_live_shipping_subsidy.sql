-- Outdoor checkout: live EasyParcel delivery rate with a company subsidy.
-- Each product gets a parcel weight. When every product in the bag has one,
-- checkout quotes EasyParcel for the address and the customer pays their share
-- (70% by default). The order keeps what the courier charges and what the
-- company covered.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS outdoor_shipping_weight_kg numeric(8,3);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_outdoor_shipping_weight_kg_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_outdoor_shipping_weight_kg_check
  CHECK (outdoor_shipping_weight_kg IS NULL OR outdoor_shipping_weight_kg > 0);

COMMENT ON COLUMN public.products.outdoor_shipping_weight_kg IS
  'Packed parcel weight in kg for one unit. Set on every product in the bag to use the live EasyParcel rate at Outdoor checkout. Empty keeps the fixed delivery price.';

ALTER TABLE public.storefront_orders
  ADD COLUMN IF NOT EXISTS shipping_actual_cost numeric(10,2),
  ADD COLUMN IF NOT EXISTS shipping_subsidy_amount numeric(10,2);

COMMENT ON COLUMN public.storefront_orders.shipping_actual_cost IS
  'Live EasyParcel rate quoted at checkout. Empty when the order used a fixed delivery price.';
COMMENT ON COLUMN public.storefront_orders.shipping_subsidy_amount IS
  'Part of shipping_actual_cost the company covers. shipping_amount is what the customer paid.';

COMMIT;
