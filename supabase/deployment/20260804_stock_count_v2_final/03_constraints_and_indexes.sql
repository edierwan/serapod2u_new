-- =============================================================================
-- 03_constraints_and_indexes.sql  [SCHEMA CHANGE]
-- =============================================================================
-- PURPOSE      : Widen two closed CHECK allowlists and add the non-partial upsert unique index.
-- PREREQUISITES: 02_schema_foundation.sql completed.
-- MUTATES      : SCHEMA ONLY. Both CHECKs are WIDENED (strictly more values accepted) so no existing row can become invalid. No data is written.
-- EXPECTED     : Both CHECKs accept the new values; the unique index exists.
-- VERIFY       : 08_post_deployment_verification.sql sections C and I.
-- LOCK IMPACT  : MEASURED read-only against production on 2026-08-04.
--                  stock_movements            2,945 rows / 864 kB
--                                             (2,256 kB incl. indexes)
--                  stock_count_session_items     416 rows
--                  rows violating the new CHECK      0
--                  duplicate (session_id, stock_config_id) groups  0
--                At this size, ALTER TABLE ... ADD CONSTRAINT takes an
--                ACCESS EXCLUSIVE lock for MILLISECONDS, not minutes. No
--                maintenance window is required for a table of ~3k rows.
--                An earlier draft of this pack over-warned about this; the
--                measurement above supersedes it.
-- NOT VALID?   : PostgreSQL's lower-lock pattern is
--                  ADD CONSTRAINT ... NOT VALID;   -- brief ACCESS EXCLUSIVE,
--                                                  -- no table scan
--                  VALIDATE CONSTRAINT ...;        -- SHARE UPDATE EXCLUSIVE,
--                                                  -- scans, allows read+write
--                It is DELIBERATELY NOT used here. It buys nothing on a 864 kB
--                table, and it adds a real hazard: if VALIDATE is skipped or
--                fails, the constraint stays NOT VALID and silently accepts
--                pre-existing bad rows -- a weaker final contract than the one
--                9a62556a requires. Revisit only if stock_movements grows past
--                roughly 10M rows, and then only as a two-step with an explicit
--                VALIDATE follow-up and a check that convalidated = true.
-- NOTE         : CREATE UNIQUE INDEX here is NOT CONCURRENTLY, so it runs inside
--                the transaction and briefly blocks writes to that one table
--                (416 rows). The pre-check DO block aborts if duplicates would
--                violate it.
-- -----------------------------------------------------------------------------
-- All SQL bodies below are copied verbatim from the authoritative migrations
-- listed per section. Only selection, ordering and idempotency guards are new.
-- Authoritative application commit: 9a62556aae6f64af3bc98f159196179669311b3f
-- =============================================================================

BEGIN;

-- ---- source (verbatim): supabase/migrations/20260726_inventory_opening_balance_cutoff/05_cutoff_do_not_carry_forward.sql

alter table public.inventory_cutoff_decisions
  drop constraint if exists inventory_cutoff_decisions_decision_check;

alter table public.inventory_cutoff_decisions
  add constraint inventory_cutoff_decisions_decision_check
  check (decision in (
    'carry_forward', 'cancel_release', 'carry_forward_incoming', 'history_only',
    'do_not_carry_forward'
  ));

-- ---- source (verbatim): supabase/migrations/20260801230000_allow_opening_balance_cutoff_stock_movement_reference.sql

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check CHECK (
    reference_type = ANY (ARRAY[
      'manual'::text,
      'order'::text,
      'transfer'::text,
      'adjustment'::text,
      'purchase_order'::text,
      'return'::text,
      'campaign'::text,
      'repack'::text,
      'order_config_change'::text,
      'order_cancel_reversal'::text,
      'stock_classification'::text,
      'opening_balance_cutoff'::text
    ])
  );

COMMENT ON CONSTRAINT stock_movements_reference_type_check ON public.stock_movements IS
  'Closed reference allowlist. Includes stock_classification (verify_and_post_stock_classification) and opening_balance_cutoff (Opening Balance allocation resolver resolve_inventory_cutoff_allocation exclude_and_release audited deallocation).';

-- ---- source (verbatim): supabase/migrations/20260730_stock_count_session_items_full_conflict_index.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items
    WHERE stock_config_id IS NOT NULL
    GROUP BY session_id, stock_config_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create stock_count_session_items_session_config_unique_full: duplicate (session_id, stock_config_id) rows exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS stock_count_session_items_session_config_unique_full
  ON public.stock_count_session_items (session_id, stock_config_id);

COMMENT ON INDEX public.stock_count_session_items_session_config_unique_full IS
  'Non-partial unique key on (session_id, stock_config_id) enabling ON CONFLICT upserts from Save Draft. NULL stock_config_id (legacy rows) stays distinct/unconstrained; scoped per session so warehouses/categories/configurations never merge.';

COMMIT;
