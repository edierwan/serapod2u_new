BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS outdoor_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.outdoor_hidden IS
  'Hidden from the Outdoor shop by an admin. The main store is unchanged.';

COMMIT;
