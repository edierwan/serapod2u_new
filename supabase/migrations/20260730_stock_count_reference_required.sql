-- ============================================================================
-- Mandatory Reference / Batch Name for Stock Count draft sessions (backend guard)
-- ----------------------------------------------------------------------------
-- The client blocks Save / Excel / Import / Review & Post when the reference is
-- blank, but the rule must not be bypassable through a direct table write or
-- RPC. This BEFORE INSERT OR UPDATE trigger enforces the same rule server-side.
--
-- Scope / safety
--   * Only DRAFT rows of real count types are validated. Legacy read-only
--     `initial_configuration_classification` sessions are exempt (they are never
--     saved through the editor).
--   * Fires ON WRITE ONLY. Existing draft/posted/legacy rows that predate this
--     rule are left untouched and remain readable; they are only required to be
--     fixed if and when they are saved again (matches the UI flow that prompts
--     the operator to add a reference before continuing).
--   * Does NOT touch posting, movements or quantities. Archiving (status =
--     'archived') and posting (status = 'posted') are not blocked.
--   * Forward-only and idempotent (CREATE OR REPLACE + drop/create trigger).
--
-- Review before applying against any environment.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_stock_count_reference_required()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'draft'
     AND NEW.count_type <> 'initial_configuration_classification' THEN
    IF NEW.reference_name IS NULL OR btrim(NEW.reference_name) = '' THEN
      RAISE EXCEPTION 'Reference / Batch Name is required.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(btrim(NEW.reference_name)) > 120 THEN
      RAISE EXCEPTION 'Reference / Batch Name must be 120 characters or fewer.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_count_reference_required ON public.stock_count_sessions;
CREATE TRIGGER stock_count_reference_required
  BEFORE INSERT OR UPDATE OF status, count_type, reference_name
  ON public.stock_count_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_stock_count_reference_required();

COMMIT;
