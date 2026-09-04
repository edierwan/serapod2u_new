-- ============================================================================
-- LEGACY-CONFIG-CUTOVER-2026 — approved blocker cleanup
-- ----------------------------------------------------------------------------
-- Clears the documents that block the cutover preflight, under the management
-- approval recorded in the runbook. It is STATUS-ONLY: no stock movement is
-- created, no balance changes, no quantity is posted or reversed.
--
-- The four approved actions, each expressed as a predicate rather than a list
-- of ids, so the script can only touch documents that actually qualify:
--
--   A  Unposted adjustments        -> cancelled
--      Only headers with NO adjustment movement. Their quantities are never
--      posted: management approved discarding them, not applying them.
--
--   B  Open stock count sessions   -> archived
--      posted_at stays NULL, so the posted-once constraint still holds and
--      the session is discarded rather than posted. A fresh count is taken
--      after the cutover.
--
--   C  Transfers with BOTH legs already posted -> received
--      transfer_out and transfer_in both exist and the movements net to zero,
--      i.e. the stock already moved and only the header status is stale. This
--      is reconciliation. It deliberately does NOT use the cancel path, which
--      would restore source inventory, nor the receive RPC, which would try to
--      post a second transfer_in (and would fail anyway: these legacy payloads
--      carry no stock_config_id).
--
--   D  Transfers that never posted anything -> cancelled
--      Abandoned. Closing them cannot move stock because nothing ever did.
--
-- The final DO block is fail-closed: it compares the movement count and the
-- total on-hand/allocated before and after inside the same transaction and
-- raises — rolling everything back — if either moved by a single unit.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE cleanup_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.stock_movements)                        AS movements,
       (SELECT COALESCE(sum(quantity_on_hand), 0) FROM public.product_inventory)   AS on_hand,
       (SELECT COALESCE(sum(quantity_allocated), 0) FROM public.product_inventory) AS allocated;

\echo '--- A: discard unposted adjustments (status only) ---'
UPDATE public.stock_adjustments a
   SET status = 'cancelled'
 WHERE a.status NOT IN ('posted', 'cancelled', 'rejected')
   AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm
                    WHERE sm.reference_type = 'adjustment' AND sm.reference_id = a.id);

\echo '--- B: discard open stock count sessions (draft -> archived) ---'
UPDATE public.stock_count_sessions s
   SET status = 'archived', archived_at = now()
 WHERE s.status NOT IN ('posted', 'archived', 'cancelled')
   AND s.posted_at IS NULL;

\echo '--- C: reconcile transfers whose both legs are already posted -> received ---'
UPDATE public.stock_transfers t
   SET status = 'received',
       received_at = COALESCE(t.received_at, now())
 WHERE t.status IN ('pending', 'pending_approval', 'in_transit')
   AND EXISTS (SELECT 1 FROM public.stock_movements sm
                WHERE sm.reference_type = 'transfer' AND sm.reference_id = t.id
                  AND sm.movement_type = 'transfer_out')
   AND EXISTS (SELECT 1 FROM public.stock_movements sm
                WHERE sm.reference_type = 'transfer' AND sm.reference_id = t.id
                  AND sm.movement_type = 'transfer_in')
   AND (SELECT COALESCE(sum(sm.quantity_change), 0) FROM public.stock_movements sm
         WHERE sm.reference_type = 'transfer' AND sm.reference_id = t.id) = 0;

\echo '--- D: close abandoned transfers that never posted anything -> cancelled ---'
UPDATE public.stock_transfers t
   SET status = 'cancelled', cancelled_at = COALESCE(t.cancelled_at, now())
 WHERE t.status IN ('draft', 'pending', 'pending_approval', 'in_transit')
   AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm
                    WHERE sm.reference_type = 'transfer' AND sm.reference_id = t.id);

\echo '--- FAIL-CLOSED: not one unit may have moved ---'
DO $$
DECLARE b record; a record;
BEGIN
  SELECT * INTO b FROM cleanup_before;
  SELECT (SELECT count(*) FROM public.stock_movements)                        AS movements,
         (SELECT COALESCE(sum(quantity_on_hand), 0) FROM public.product_inventory)   AS on_hand,
         (SELECT COALESCE(sum(quantity_allocated), 0) FROM public.product_inventory) AS allocated
    INTO a;

  IF a.movements <> b.movements THEN
    RAISE EXCEPTION 'ABORT: movement count changed % -> %', b.movements, a.movements;
  END IF;
  IF a.on_hand <> b.on_hand OR a.allocated <> b.allocated THEN
    RAISE EXCEPTION 'ABORT: inventory changed on_hand % -> %, allocated % -> %',
      b.on_hand, a.on_hand, b.allocated, a.allocated;
  END IF;

  RAISE NOTICE 'PASS: movements %, on_hand %, allocated % — all unchanged',
    a.movements, a.on_hand, a.allocated;
END; $$;

\echo '--- residual open documents (expect zero across the board) ---'
SELECT 'open transfers' AS document, count(*) AS remaining FROM public.stock_transfers
 WHERE status IN ('draft', 'pending', 'pending_approval', 'in_transit')
UNION ALL
SELECT 'unposted adjustments', count(*) FROM public.stock_adjustments
 WHERE status NOT IN ('posted', 'cancelled', 'rejected')
UNION ALL
SELECT 'open count sessions', count(*) FROM public.stock_count_sessions
 WHERE status NOT IN ('posted', 'archived', 'cancelled');

COMMIT;
