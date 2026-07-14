-- ============================================================================
-- Return Product Worksheet v2
-- ----------------------------------------------------------------------------
-- Additive, backward-compatible upgrade for the worksheet-style Return Product
-- entry form. It:
--
--   1. Adds Case / Loose Pcs / Units-per-Case / Total Pcs columns to
--      return_case_items, plus historical snapshot columns.
--   2. Adds reported_date + program/category snapshot columns to return_cases.
--   3. Replaces generate_return_no() with the new RET<YY>-###### format using a
--      yearly-resetting counter. Existing RTN-YYYYMM-##### numbers are preserved
--      (already-generated return_no values never change).
--
-- No existing rows are rewritten or deleted. All existing return records remain
-- valid: the legacy `quantity` column is kept and is mirrored by `total_units`.
--
-- Idempotent: safe to run multiple times.
--
-- ROLLBACK NOTES (manual):
--   ALTER TABLE public.return_case_items
--     DROP COLUMN IF EXISTS case_qty,
--     DROP COLUMN IF EXISTS loose_piece_qty,
--     DROP COLUMN IF EXISTS units_per_case_snapshot,
--     DROP COLUMN IF EXISTS total_units;
--   ALTER TABLE public.return_cases
--     DROP COLUMN IF EXISTS reported_date,
--     DROP COLUMN IF EXISTS program_snapshot,
--     DROP COLUMN IF EXISTS category_snapshot;
--   DROP FUNCTION IF EXISTS public.generate_return_no();
--   DROP TABLE IF EXISTS public.return_no_counters;
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Worksheet quantity + snapshot columns on line items.
--    `quantity` (legacy, CHECK quantity > 0) stays as the total-pieces value
--    and is kept in sync with `total_units` by the application layer.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.return_case_items
  ADD COLUMN IF NOT EXISTS case_qty                numeric NOT NULL DEFAULT 0 CHECK (case_qty >= 0),
  ADD COLUMN IF NOT EXISTS loose_piece_qty         numeric NOT NULL DEFAULT 0 CHECK (loose_piece_qty >= 0),
  ADD COLUMN IF NOT EXISTS units_per_case_snapshot numeric,
  ADD COLUMN IF NOT EXISTS total_units             numeric NOT NULL DEFAULT 0 CHECK (total_units >= 0);

-- Backfill total_units from the legacy quantity for existing rows so historical
-- cases keep a correct Total Pcs value.
UPDATE public.return_case_items
   SET total_units = quantity
 WHERE total_units = 0
   AND quantity IS NOT NULL
   AND quantity > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Reported date + program / category snapshots on the case header.
--    reported_date allows a historical date (WhatsApp cases entered later).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.return_cases
  ADD COLUMN IF NOT EXISTS reported_date     date,
  ADD COLUMN IF NOT EXISTS program_snapshot  text,
  ADD COLUMN IF NOT EXISTS category_snapshot text;

-- Default reported_date for existing rows to the day they were created.
UPDATE public.return_cases
   SET reported_date = created_at::date
 WHERE reported_date IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. New return number generator: RET<YY>-###### with a yearly-resetting
--    counter. Generated on INSERT (i.e. first successful Save Draft); once set
--    the return_no never changes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.return_no_counters (
  year      smallint PRIMARY KEY,
  last_seq  integer  NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.generate_return_no()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_year smallint := extract(year FROM now())::smallint;
  v_yy   text     := to_char(now(), 'YY');
  v_seq  integer;
BEGIN
  -- Atomic per-year increment (row lock on conflict).
  INSERT INTO public.return_no_counters (year, last_seq)
       VALUES (v_year, 1)
  ON CONFLICT (year)
    DO UPDATE SET last_seq = public.return_no_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  RETURN 'RET' || v_yy || '-' || lpad(v_seq::text, 6, '0');
END;
$$;

COMMIT;
