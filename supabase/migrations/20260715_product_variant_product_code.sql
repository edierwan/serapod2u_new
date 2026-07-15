-- Product Variant Product Code
--
-- Product Code is optional, normalized to uppercase, limited to five characters,
-- and unique per Brand. product_code_brand_id is an internal scope column kept
-- in sync from products.brand_id so PostgreSQL can enforce concurrent writes with
-- a real composite unique constraint.

BEGIN;

ALTER TABLE public.product_variants
  ADD COLUMN product_code text,
  ADD COLUMN product_code_brand_id uuid REFERENCES public.brands(id);

COMMENT ON COLUMN public.product_variants.product_code IS
  'Optional five-character variant Product Code, stored trimmed and uppercase.';

COMMENT ON COLUMN public.product_variants.product_code_brand_id IS
  'Internal Brand scope copied from the parent Product for Product Code uniqueness.';

CREATE OR REPLACE FUNCTION public.prepare_product_variant_product_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.product_code := NULLIF(UPPER(BTRIM(NEW.product_code)), '');

  SELECT p.brand_id
  INTO NEW.product_code_brand_id
  FROM public.products AS p
  WHERE p.id = NEW.product_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_variants_prepare_product_code
BEFORE INSERT OR UPDATE
ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.prepare_product_variant_product_code();

-- Backfill only the internal Brand scope. Existing records retain NULL product_code.
UPDATE public.product_variants AS pv
SET product_code_brand_id = p.brand_id
FROM public.products AS p
WHERE p.id = pv.product_id
  AND pv.product_code_brand_id IS DISTINCT FROM p.brand_id;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_product_code_format_check
  CHECK (
    product_code IS NULL
    OR (
      product_code = BTRIM(product_code)
      AND product_code = UPPER(product_code)
      AND CHAR_LENGTH(product_code) BETWEEN 1 AND 5
    )
  ),
  ADD CONSTRAINT product_variants_brand_product_code_key
  UNIQUE (product_code_brand_id, product_code);

CREATE OR REPLACE FUNCTION public.sync_product_variant_product_code_brand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.product_variants
  SET product_code_brand_id = NEW.brand_id
  WHERE product_id = NEW.id
    AND product_code_brand_id IS DISTINCT FROM NEW.brand_id;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'This Product Code is already used by another variant under this brand.',
      CONSTRAINT = 'product_variants_brand_product_code_key';
END;
$$;

CREATE TRIGGER products_sync_variant_product_code_brand
AFTER UPDATE OF brand_id
ON public.products
FOR EACH ROW
WHEN (OLD.brand_id IS DISTINCT FROM NEW.brand_id)
EXECUTE FUNCTION public.sync_product_variant_product_code_brand();

COMMIT;
