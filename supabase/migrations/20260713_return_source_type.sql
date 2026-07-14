-- Migration: Return Product — allow returns from Shop OR Distributor
-- ---------------------------------------------------------------------------
-- Adds a source-type discriminator + explicit source organization reference to
-- return_cases so a return may originate from either a Shop or a Distributor.
--
-- Backward-compatible & non-destructive:
--   * shop_org_id is PRESERVED and kept populated with the selected source
--     organization id (Shop OR Distributor) so existing RLS, queries, PDF,
--     Excel and reporting keep working unchanged. It is now a LEGACY
--     compatibility column — new logic reads return_source_organization_id.
--   * return_source_type / return_source_organization_id are the new source of
--     truth. Existing rows are backfilled as 'shop' from shop_org_id.
--
-- Idempotent: safe to run repeatedly on staging.
-- ---------------------------------------------------------------------------

-- 1. New columns -------------------------------------------------------------
ALTER TABLE public.return_cases
  ADD COLUMN IF NOT EXISTS return_source_type text NOT NULL DEFAULT 'shop',
  ADD COLUMN IF NOT EXISTS return_source_organization_id uuid REFERENCES public.organizations(id);

COMMENT ON COLUMN public.return_cases.return_source_type IS
  'Origin of the return: ''shop'' or ''distributor''. Primary source of truth (with return_source_organization_id).';
COMMENT ON COLUMN public.return_cases.return_source_organization_id IS
  'Organization the return originates from (Shop or Distributor). Primary source of truth.';
COMMENT ON COLUMN public.return_cases.shop_org_id IS
  'LEGACY compatibility column. Kept in sync with return_source_organization_id for both Shop and Distributor returns so existing RLS/queries keep working. Slated for removal in a future cleanup migration once all reads move to return_source_organization_id.';

-- 2. Backfill existing rows --------------------------------------------------
UPDATE public.return_cases
   SET return_source_organization_id = shop_org_id
 WHERE return_source_organization_id IS NULL
   AND shop_org_id IS NOT NULL;

-- All pre-existing returns are Shop returns (column default already applied
-- 'shop' to existing rows; this is an explicit safety net).
UPDATE public.return_cases
   SET return_source_type = 'shop'
 WHERE return_source_type IS NULL
    OR return_source_type NOT IN ('shop', 'distributor');

-- 3. Constraints -------------------------------------------------------------
-- Enum-style check on the discriminator.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'return_cases_source_type_check'
  ) THEN
    ALTER TABLE public.return_cases
      ADD CONSTRAINT return_cases_source_type_check
      CHECK (return_source_type IN ('shop', 'distributor'));
  END IF;
END$$;

-- Once backfilled, the source organization is always known.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.return_cases WHERE return_source_organization_id IS NULL
  ) THEN
    RAISE NOTICE 'Skipping NOT NULL on return_source_organization_id: % rows still NULL',
      (SELECT count(*) FROM public.return_cases WHERE return_source_organization_id IS NULL);
  ELSE
    ALTER TABLE public.return_cases
      ALTER COLUMN return_source_organization_id SET NOT NULL;
  END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_return_cases_source_type ON public.return_cases(return_source_type);
CREATE INDEX IF NOT EXISTS idx_return_cases_source_org  ON public.return_cases(return_source_organization_id);

-- 5. Source/organization-type integrity trigger ------------------------------
-- A CHECK constraint cannot subquery organizations, so a trigger enforces that
-- the referenced organization's type matches the declared source type:
--   return_source_type = 'shop'        -> org_type_code = 'SHOP'
--   return_source_type = 'distributor' -> org_type_code = 'DIST'
CREATE OR REPLACE FUNCTION public.return_cases_validate_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_type text;
BEGIN
  IF NEW.return_source_organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT org_type_code INTO v_org_type
    FROM public.organizations
   WHERE id = NEW.return_source_organization_id;

  IF v_org_type IS NULL THEN
    RAISE EXCEPTION 'Return source organization % does not exist', NEW.return_source_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.return_source_type = 'shop' AND v_org_type <> 'SHOP' THEN
    RAISE EXCEPTION 'Return source organization % is not a Shop (type %)', NEW.return_source_organization_id, v_org_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.return_source_type = 'distributor' AND v_org_type <> 'DIST' THEN
    RAISE EXCEPTION 'Return source organization % is not a Distributor (type %)', NEW.return_source_organization_id, v_org_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- Keep the legacy shop_org_id column in sync with the authoritative source org.
  NEW.shop_org_id := NEW.return_source_organization_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_cases_validate_source ON public.return_cases;
CREATE TRIGGER trg_return_cases_validate_source
  BEFORE INSERT OR UPDATE OF return_source_type, return_source_organization_id, shop_org_id
  ON public.return_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.return_cases_validate_source();
