-- ============================================================================
-- LEGACY-CONFIG-CUTOVER-2026 — remove the auto-generated adjustment artifacts
-- ----------------------------------------------------------------------------
-- Before migration 20260904140000, auto_create_stock_adjustment_from_movement
-- fell through a NULL comparison and created one pending stock_adjustments
-- header (plus its item) for every cutover retirement movement. Those headers
-- are not documents anyone raised; they are a side effect of a defect, and they
-- block the cutover's own deactivation step through the preflight.
--
-- This removes ONLY artifacts that are provably attributable to the cutover.
-- The link is exact rather than heuristic: the cutover writes its notes as
--
--   LEGACY-CONFIG-CUTOVER-2026; request=<uuid>; config=<code>; quantity_before=…
--
-- and the trigger copies NEW.notes verbatim onto the header it creates. So an
-- artifact carries the cutover reference AND the specific request id in its own
-- notes, and every one is matched back to a real retirement movement with the
-- same variant, organization and quantity before it is touched.
--
-- Five conditions must hold for every candidate, and the script aborts the
-- whole transaction if any of them fails:
--
--   1. its notes carry this cutover reference and request id
--   2. it is still pending — never posted
--   3. it has no stock movement of its own
--   4. reason_id IS NULL — the trigger found no reason row, which is precisely
--      the defect path; a user-raised adjustment always carries a reason
--   5. it matches a LEGACY-CONFIG-CUTOVER-2026 movement on variant,
--      organization and quantity
--
-- Deletes are used rather than a status change because these rows should never
-- have existed. Nothing references them: they have no movements, and their
-- items cascade with the header.
--
-- Usage:  psql … -v request_id="'<cutover request uuid>'" -f this-file
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE artifact_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.stock_movements)                               AS movements,
       (SELECT COALESCE(sum(quantity_on_hand), 0) FROM public.product_inventory)    AS on_hand,
       (SELECT COALESCE(sum(quantity_allocated), 0) FROM public.product_inventory)  AS allocated,
       (SELECT count(*) FROM public.stock_adjustments)                              AS adjustments,
       (SELECT count(*) FROM public.stock_adjustment_items)                         AS adjustment_items;

-- The provable set. Every predicate below is one of the five conditions.
CREATE TEMP TABLE artifact_candidates ON COMMIT DROP AS
SELECT a.id
FROM public.stock_adjustments a
WHERE a.notes LIKE 'LEGACY-CONFIG-CUTOVER-2026; request=' || :request_id || '%'   -- 1
  AND a.status = 'pending'                                                        -- 2
  AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm                         -- 3
                   WHERE sm.reference_type = 'adjustment' AND sm.reference_id = a.id)
  AND a.reason_id IS NULL                                                         -- 4
  AND EXISTS (                                                                    -- 5
        SELECT 1
          FROM public.stock_adjustment_items ai
          JOIN public.stock_movements sm
            ON sm.reference_type = 'legacy_config_cutover'
           AND sm.reference_id = :request_id::uuid
           AND sm.variant_id = ai.variant_id
           AND sm.from_organization_id = a.organization_id
           AND sm.quantity_change = ai.adjustment_quantity
         WHERE ai.adjustment_id = a.id
      );

\echo '--- proof: candidates vs cutover movements ---'
SELECT (SELECT count(*) FROM artifact_candidates)                                   AS candidates,
       (SELECT count(*) FROM public.stock_movements
         WHERE reference_type = 'legacy_config_cutover' AND reference_id = :request_id::uuid) AS cutover_movements,
       (SELECT count(*) FROM public.stock_adjustments
         WHERE notes LIKE 'LEGACY-CONFIG-CUTOVER-2026; request=' || :request_id || '%')       AS all_bearing_this_reference;

\echo '--- proof: no candidate is a user-raised document ---'
SELECT count(*) FILTER (WHERE reason_id IS NOT NULL) AS with_reason,
       count(*) FILTER (WHERE status <> 'pending')   AS not_pending,
       count(*)                                      AS total
FROM public.stock_adjustments
WHERE id IN (SELECT id FROM artifact_candidates);

DO $$
DECLARE v_candidates integer; v_movements integer; v_bearing integer;
BEGIN
  SELECT count(*) INTO v_candidates FROM artifact_candidates;
  SELECT count(*) INTO v_movements FROM public.stock_movements
   WHERE reference_type = 'legacy_config_cutover';
  SELECT count(*) INTO v_bearing FROM public.stock_adjustments
   WHERE notes LIKE 'LEGACY-CONFIG-CUTOVER-2026;%';

  -- Every artifact bearing the cutover reference must have qualified. If one
  -- did not, something about it is unlike the others and it must be looked at
  -- by a person, not swept up here.
  IF v_candidates <> v_bearing THEN
    RAISE EXCEPTION 'ABORT: % adjustments carry the cutover reference but only % qualified as artifacts',
      v_bearing, v_candidates;
  END IF;
  IF v_candidates > v_movements THEN
    RAISE EXCEPTION 'ABORT: % candidates exceed % cutover movements', v_candidates, v_movements;
  END IF;
  RAISE NOTICE 'PROVEN: % artifacts, all matched to cutover movements', v_candidates;
END; $$;

\echo '--- removing the proven artifacts ---'
DELETE FROM public.stock_adjustment_items WHERE adjustment_id IN (SELECT id FROM artifact_candidates);
DELETE FROM public.stock_adjustments      WHERE id            IN (SELECT id FROM artifact_candidates);

\echo '--- FAIL-CLOSED: no movement, no quantity, no allocation may have changed ---'
DO $$
DECLARE b record; a record;
BEGIN
  SELECT * INTO b FROM artifact_before;
  SELECT (SELECT count(*) FROM public.stock_movements)                              AS movements,
         (SELECT COALESCE(sum(quantity_on_hand), 0) FROM public.product_inventory)   AS on_hand,
         (SELECT COALESCE(sum(quantity_allocated), 0) FROM public.product_inventory) AS allocated,
         (SELECT count(*) FROM public.stock_adjustments)                             AS adjustments,
         (SELECT count(*) FROM public.stock_adjustment_items)                        AS adjustment_items
    INTO a;

  IF a.movements <> b.movements THEN
    RAISE EXCEPTION 'ABORT: movement count changed % -> %', b.movements, a.movements;
  END IF;
  IF a.on_hand <> b.on_hand OR a.allocated <> b.allocated THEN
    RAISE EXCEPTION 'ABORT: inventory changed on_hand % -> %, allocated % -> %',
      b.on_hand, a.on_hand, b.allocated, a.allocated;
  END IF;

  RAISE NOTICE 'PASS: movements % unchanged, on_hand % unchanged, allocated % unchanged',
    a.movements, a.on_hand, a.allocated;
  RAISE NOTICE 'adjustments % -> %, items % -> %',
    b.adjustments, a.adjustments, b.adjustment_items, a.adjustment_items;
END; $$;

COMMIT;
