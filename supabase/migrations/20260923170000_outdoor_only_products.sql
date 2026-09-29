BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS outdoor_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.outdoor_only IS
  'Created from the Outdoor admin desk. Shown on Outdoor only, not the main store.';

COMMIT;
