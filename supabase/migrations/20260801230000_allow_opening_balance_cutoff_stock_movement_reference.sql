BEGIN;

-- ============================================================================
-- Fix: allow reference_type = 'opening_balance_cutoff' on stock_movements.
-- ----------------------------------------------------------------------------
-- The Opening Balance allocation resolver (20260801190000, freeze-aware in
-- 20260801220000) writes its audited deallocation movement with
--   reference_type = 'opening_balance_cutoff'
-- but that value is absent from the live closed allowlist
-- stock_movements_reference_type_check (last set by
-- 20260717_stock_config_08_initial_classification.sql). PostgreSQL therefore
-- rejects the INSERT with `stock_movements_reference_type_check`, and the whole
-- resolver transaction rolls back — verified live: quantity_on_hand=100,
-- quantity_allocated=1, average_cost=14.00 unchanged, zero opening_balance_cutoff
-- movements, zero idempotency-ledger rows, cutoff still 'counting'.
--
-- This forward-only migration replaces the CHECK with a SUPERSET that preserves
-- every currently allowed value (in the exact existing order) and additionally
-- allows 'opening_balance_cutoff'. No existing value is removed or renamed. The
-- new constraint is validated against existing rows on ADD; since it is a strict
-- superset of the live constraint, all existing rows already satisfy it.
--
-- Existing allowed values (preserved), from the live constraint:
--   manual, order, transfer, adjustment, purchase_order, return, campaign,
--   repack, order_config_change, order_cancel_reversal, stock_classification
-- Added:
--   opening_balance_cutoff
-- ============================================================================

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

COMMIT;
