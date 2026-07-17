-- ============================================================================
-- Inventory Stock Configurations — Phase 6 / forward-only correction (07)
-- Stock movement reference and sign allowlist alignment
-- ----------------------------------------------------------------------------
-- Migrations 01-06 are already applied and remain immutable.
--
-- Audit result:
--   * Migration 05 legitimately writes reference_type values
--       order_config_change, order_cancel_reversal
--     but migration 03's allowlist does not include them.
--   * The active Spin Wheel campaign UI writes movement_type values
--       spin_wheel_in, spin_wheel_out
--     through record_stock_movement, but the existing sign allowlist does not
--     include them. Scratch Card equivalents are already allowed.
--
-- This migration changes constraints only. It does not update, classify, or
-- move any inventory balance or historical movement.
-- ============================================================================

BEGIN;

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
      'order_cancel_reversal'::text
    ])
  );

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS valid_quantity_change;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT valid_quantity_change CHECK (
    (
      movement_type = ANY (ARRAY[
        'addition'::text,
        'transfer_in'::text,
        'order_cancelled'::text,
        'manual_in'::text,
        'scratch_game_in'::text,
        'spin_wheel_in'::text,
        'allocation'::text,
        'warranty_bonus'::text,
        'repack_in'::text
      ])
      AND quantity_change > 0
    )
    OR (movement_type = 'adjustment'::text AND quantity_change <> 0)
    OR (
      movement_type = ANY (ARRAY[
        'transfer_out'::text,
        'order_fulfillment'::text,
        'manual_out'::text,
        'scratch_game_out'::text,
        'spin_wheel_out'::text,
        'deallocation'::text,
        'repack_out'::text
      ])
      AND quantity_change < 0
    )
  );

COMMENT ON CONSTRAINT stock_movements_reference_type_check ON public.stock_movements IS
  'Closed reference allowlist. Includes exact SO configuration change and cancellation reversal references introduced by stock configuration migration 05.';

COMMENT ON CONSTRAINT valid_quantity_change ON public.stock_movements IS
  'Closed movement/sign allowlist. Positive inbound, negative outbound, and nonzero adjustment movements only; includes active Scratch Card and Spin Wheel campaign flows.';

COMMIT;

