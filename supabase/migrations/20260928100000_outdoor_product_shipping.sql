BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS outdoor_shipping_title text,
  ADD COLUMN IF NOT EXISTS outdoor_shipping_note text,
  ADD COLUMN IF NOT EXISTS outdoor_shipping_price numeric(10,2);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_outdoor_shipping_price_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_outdoor_shipping_price_check
  CHECK (outdoor_shipping_price IS NULL OR outdoor_shipping_price >= 0);

COMMENT ON COLUMN public.products.outdoor_shipping_title IS
  'Outdoor checkout delivery title. Empty uses Standard delivery.';
COMMENT ON COLUMN public.products.outdoor_shipping_note IS
  'Outdoor checkout delivery text. Empty uses the standard note.';
COMMENT ON COLUMN public.products.outdoor_shipping_price IS
  'Outdoor checkout delivery price in RM. Empty uses RM 2. Zero shows Free shipping.';

COMMIT;
