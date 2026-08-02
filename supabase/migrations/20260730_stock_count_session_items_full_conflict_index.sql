-- ============================================================================
-- Stock Count session items — non-partial unique key for ON CONFLICT upserts
-- ----------------------------------------------------------------------------
-- Save Draft for an Inventory Opening Balance persists the full configuration
-- snapshot (including not-yet-counted rows) with a single upsert:
--
--     supabase.from('stock_count_session_items')
--       .upsert(payload, { onConflict: 'session_id,stock_config_id' })
--
-- The only matching index shipped so far (20260717_stock_config_04_stock_count)
-- is PARTIAL:
--
--     CREATE UNIQUE INDEX stock_count_session_items_unique_config
--       ON public.stock_count_session_items (session_id, stock_config_id)
--       WHERE stock_config_id IS NOT NULL;
--
-- PostgreSQL cannot infer a partial unique index for ON CONFLICT unless the
-- statement repeats the index predicate, which PostgREST / supabase-js
-- `onConflict` cannot express. Every Save Draft therefore fails with:
--
--     "there is no unique or exclusion constraint matching the ON CONFLICT
--      specification"
--
-- and, because the writes are not one transaction, leaves an item-less draft
-- session behind (the phantom "existing Opening Balance draft" seen on reselect).
--
-- Fix: add a NON-partial unique index on the same business key so ON CONFLICT
-- inference succeeds. The key is scoped to a single session, which already ties
-- a session to exactly one warehouse, product category and count type, so it can
-- never merge rows across warehouses, sessions, categories or configurations.
-- Legacy rows with a NULL stock_config_id stay unconstrained (NULLs are
-- distinct), exactly as under the partial index. The partial index is retained;
-- ON CONFLICT with no predicate only infers the non-partial index, so there is
-- no ambiguity. Forward-only and idempotent.
-- ============================================================================

BEGIN;

-- Fail clearly before DDL if an environment predates the partial unique index
-- and already contains duplicate non-NULL business keys. Never delete, merge or
-- rewrite historical items implicitly; any such data requires a separate,
-- reviewed reconciliation.
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
