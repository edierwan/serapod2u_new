-- Product Variant Alternative Name
--
-- Adds one optional distributor-facing alternative name per variant. Duplicate
-- active alternative names are prevented within the same parent Product after
-- case, whitespace, and common separator normalization.

BEGIN;

ALTER TABLE public.product_variants
  ADD COLUMN alternative_name text;

COMMENT ON COLUMN public.product_variants.alternative_name IS
  'Optional alternative variant name commonly used by distributors.';

CREATE OR REPLACE FUNCTION public.normalize_product_variant_alternative_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT UPPER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(BTRIM(value), '[-‐‑‒–—―−_/]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

CREATE UNIQUE INDEX product_variants_product_alternative_name_active_key
  ON public.product_variants (
    product_id,
    public.normalize_product_variant_alternative_name(alternative_name)
  )
  WHERE is_active IS TRUE
    AND alternative_name IS NOT NULL
    AND public.normalize_product_variant_alternative_name(alternative_name) <> '';

COMMIT;
