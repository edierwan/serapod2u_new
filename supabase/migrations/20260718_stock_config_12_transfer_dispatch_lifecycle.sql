-- ============================================================================
-- Inventory Stock Configurations — Phase 12:
-- Stock Transfer dispatch lifecycle (reservation → approve → dispatch → receive)
-- ----------------------------------------------------------------------------
-- Migrations 01-11 are immutable. This forward-only migration:
--   * Adds ready_to_dispatch status between pending_approval and in_transit.
--   * Adds submitted_by / dispatched_by audit columns.
--   * Revises approve to keep reservations and NOT post transfer_out.
--   * Adds dispatch_stock_transfer to post source transfer_out once and
--     consume the reservation exactly once.
--   * Restricts normal cancel so In Transit / Received cannot reverse stock.
--   * Does not rewrite historical transfer or movement rows.
--
-- Final stock timing (authoritative):
--   draft              : editable; no reservation; no ledger movement
--   pending_approval   : quantity_allocated reserved; on_hand unchanged
--   ready_to_dispatch  : reservation remains; Transfer Note available; no out
--   in_transit         : reservation consumed; transfer_out posted once
--   received           : transfer_in posted once at destination
--   cancelled/rejected : reservations released when still reserved; no out/in
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema: audit columns + status check
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS dispatched_by uuid REFERENCES public.users(id);

ALTER TABLE public.stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_status_check;

ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_status_check CHECK (
    status = ANY (ARRAY[
      'draft'::text,
      'pending'::text,
      'pending_approval'::text,
      'ready_to_dispatch'::text,
      'in_transit'::text,
      'received'::text,
      'cancelled'::text,
      'rejected'::text
    ])
  );

COMMENT ON COLUMN public.stock_transfers.status IS
  'Lifecycle: draft → pending_approval → ready_to_dispatch → in_transit → received. Terminal: cancelled, rejected. Legacy pending retained for historical rows.';
COMMENT ON COLUMN public.stock_transfers.submitted_by IS
  'User who submitted the draft for approval (reservation created).';
COMMENT ON COLUMN public.stock_transfers.dispatched_by IS
  'User who confirmed physical dispatch (source transfer_out posted).';

CREATE INDEX IF NOT EXISTS idx_stock_transfers_ready_to_dispatch
  ON public.stock_transfers (company_id, from_organization_id)
  WHERE status = 'ready_to_dispatch';

-- ---------------------------------------------------------------------------
-- 2. Reservation integrity helper (approve / dispatch revalidation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._stock_transfer_assert_reservation_integrity(
  p_transfer public.stock_transfers
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_on integer;
  v_alloc integer;
  v_has_alloc boolean;
  v_has_dealloc boolean;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer.id
         AND sm.movement_type = 'allocation'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
    ), EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer.id
         AND sm.movement_type = 'deallocation'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
    )
      INTO v_has_alloc, v_has_dealloc;

    IF NOT v_has_alloc OR v_has_dealloc THEN
      RAISE EXCEPTION 'Transfer reservation integrity failed for configuration %', v_cfg;
    END IF;

    SELECT quantity_on_hand, quantity_allocated
      INTO v_on, v_alloc
      FROM public.product_inventory
     WHERE organization_id = p_transfer.from_organization_id
       AND variant_id = v_variant
       AND stock_config_id = v_cfg
       AND is_active = true
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source inventory missing for reserved configuration %', v_cfg;
    END IF;
    IF COALESCE(v_alloc, 0) < v_qty THEN
      RAISE EXCEPTION 'Reserved quantity missing for configuration % (need %, allocated %)',
        v_cfg, v_qty, COALESCE(v_alloc, 0);
    END IF;
    IF COALESCE(v_on, 0) < v_qty THEN
      RAISE EXCEPTION 'On-hand insufficient for reserved configuration % (need %, on_hand %)',
        v_cfg, v_qty, COALESCE(v_on, 0);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._stock_transfer_assert_reservation_integrity(public.stock_transfers)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. submit: persist submitted_by (reservation behaviour unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_stock_transfer_for_approval(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status = 'pending_approval' THEN
    RETURN v_transfer;
  END IF;
  IF v_transfer.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft transfers can be submitted for approval';
  END IF;

  PERFORM public._stock_transfer_assert_route_access(
    v_transfer.from_organization_id, v_transfer.to_organization_id
  );
  IF NOT (
    public.is_hq_admin()
    OR v_transfer.created_by = v_actor
  ) THEN
    RAISE EXCEPTION 'Not authorized to submit this transfer';
  END IF;

  v_transfer.items := public._stock_transfer_normalize_items(v_transfer.items);
  PERFORM public._stock_transfer_reserve_items(v_transfer);

  UPDATE public.stock_transfers
     SET status = 'pending_approval',
         items = v_transfer.items,
         submitted_at = COALESCE(submitted_at, now()),
         submitted_by = COALESCE(submitted_by, v_actor),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_stock_transfer_for_approval(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_transfer_for_approval(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_stock_transfer_for_approval(uuid, uuid) IS
  'Submit a draft for approval and reserve source available stock via quantity_allocated. No on_hand deduction.';

-- ---------------------------------------------------------------------------
-- 4. approve → ready_to_dispatch (reservation kept; no transfer_out)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  -- Idempotent: already approved and waiting for physical dispatch.
  IF v_transfer.status = 'ready_to_dispatch' THEN
    RETURN v_transfer;
  END IF;

  -- Historical Phase-11 approvals already posted transfer_out into in_transit.
  -- Leave those rows alone (readable / receivable) without re-posting.
  IF v_transfer.status = 'in_transit' THEN
    RETURN v_transfer;
  END IF;

  IF v_transfer.status IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending-approval transfers can be approved';
  END IF;

  -- Canonical HQ authority: is_hq_admin() <=> get_my_role_level() <= 10
  -- (Super Admin level 1 and HQ Admin level 10). No silent requester bypass.
  IF NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Unauthorized approval: HQ inventory approval authority is required';
  END IF;

  PERFORM public._stock_transfer_assert_reservation_integrity(v_transfer);

  UPDATE public.stock_transfers
     SET status = 'ready_to_dispatch',
         approved_by = v_actor,
         approved_at = COALESCE(approved_at, now()),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stock_transfer(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_stock_transfer(uuid, uuid) IS
  'HQ approval only: revalidate reservation integrity, keep reservation, enable Transfer Note. Status becomes ready_to_dispatch. Does not post transfer_out or change on_hand.';

-- ---------------------------------------------------------------------------
-- 5. dispatch → in_transit (consume reservation + post transfer_out once)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_out_count integer;
  v_expected integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  SELECT count(*) INTO v_expected FROM jsonb_array_elements(v_transfer.items);
  SELECT count(*) INTO v_out_count
    FROM public.stock_movements sm
   WHERE sm.reference_type = 'transfer'
     AND sm.reference_id = p_transfer_id
     AND sm.movement_type = 'transfer_out';

  -- Idempotent: already dispatched (includes historical Phase-11 in_transit rows).
  IF v_transfer.status = 'in_transit' AND v_out_count >= v_expected AND v_expected > 0 THEN
    RETURN v_transfer;
  END IF;

  IF v_transfer.status IS DISTINCT FROM 'ready_to_dispatch' THEN
    RAISE EXCEPTION 'Only ready-to-dispatch transfers can be dispatched';
  END IF;

  -- Source warehouse confirms physical dispatch; HQ admin may act as override.
  IF NOT (
    public.is_hq_admin()
    OR public.can_access_org(v_transfer.from_organization_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized dispatch: source warehouse access is required';
  END IF;

  PERFORM public._stock_transfer_assert_reservation_integrity(v_transfer);
  PERFORM public._stock_transfer_release_reservations(v_transfer);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_cost := NULLIF(v_item->>'cost', '')::numeric;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer_id
         AND sm.movement_type = 'transfer_out'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.record_stock_movement(
      p_movement_type := 'transfer_out',
      p_variant_id := v_variant,
      p_organization_id := v_transfer.from_organization_id,
      p_quantity_change := -v_qty,
      p_unit_cost := v_cost,
      p_reason := 'Warehouse transfer dispatched',
      p_notes := v_transfer.notes,
      p_reference_type := 'transfer',
      p_reference_id := v_transfer.id,
      p_reference_no := v_transfer.transfer_no,
      p_company_id := v_transfer.company_id,
      p_created_by := v_actor,
      p_stock_config_id := v_cfg
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'in_transit',
         dispatched_by = COALESCE(dispatched_by, v_actor),
         shipped_at = COALESCE(shipped_at, now()),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_stock_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_stock_transfer(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.dispatch_stock_transfer(uuid, uuid) IS
  'Source warehouse dispatch: consume reservation once and post exact-configuration transfer_out once. Status becomes in_transit. Destination stock is not posted.';

-- ---------------------------------------------------------------------------
-- 6. receive → received (in_transit only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_in_count integer;
  v_expected integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status = 'received' THEN
    RETURN v_transfer;
  END IF;

  IF v_transfer.status = 'ready_to_dispatch' THEN
    RAISE EXCEPTION 'Transfer must be dispatched before it can be received';
  END IF;

  IF v_transfer.status IS DISTINCT FROM 'in_transit' THEN
    RAISE EXCEPTION 'Only in-transit transfers can be received';
  END IF;

  -- Destination warehouse confirms receipt; HQ admin may act as override.
  IF NOT (
    public.is_hq_admin()
    OR public.can_access_org(v_transfer.to_organization_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized receipt: destination warehouse access is required';
  END IF;

  SELECT count(*) INTO v_expected FROM jsonb_array_elements(v_transfer.items);
  SELECT count(*) INTO v_in_count
    FROM public.stock_movements sm
   WHERE sm.reference_type = 'transfer'
     AND sm.reference_id = p_transfer_id
     AND sm.movement_type = 'transfer_in'
     AND sm.to_organization_id = v_transfer.to_organization_id;

  -- Historical creates already posted destination transfer_in; mark received without double-post.
  IF v_in_count >= v_expected AND v_expected > 0 THEN
    UPDATE public.stock_transfers
       SET status = 'received',
           received_by = COALESCE(received_by, v_actor),
           received_at = COALESCE(received_at, now()),
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_cost := NULLIF(v_item->>'cost', '')::numeric;

    IF v_cfg IS NULL THEN
      RAISE EXCEPTION 'Historical unclassified transfer lines cannot be received through the normal flow';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer_id
         AND sm.movement_type = 'transfer_in'
         AND sm.to_organization_id = v_transfer.to_organization_id
         AND sm.variant_id = v_variant
         AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.record_stock_movement(
      p_movement_type := 'transfer_in',
      p_variant_id := v_variant,
      p_organization_id := v_transfer.to_organization_id,
      p_quantity_change := v_qty,
      p_unit_cost := v_cost,
      p_reason := 'Warehouse transfer received',
      p_notes := v_transfer.notes,
      p_reference_type := 'transfer',
      p_reference_id := v_transfer.id,
      p_reference_no := v_transfer.transfer_no,
      p_company_id := v_transfer.company_id,
      p_created_by := v_actor,
      p_stock_config_id := v_cfg
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received',
         received_by = v_actor,
         received_at = COALESCE(received_at, now()),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.receive_stock_transfer(uuid, uuid) IS
  'Destination receipt: post transfer_in exactly once per configuration line after dispatch, or mark received when historical destination post already exists.';

-- ---------------------------------------------------------------------------
-- 7. cancel / reject (In Transit normal cancel prohibited)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status IN ('cancelled', 'rejected', 'received') THEN
    RETURN v_transfer;
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    RAISE EXCEPTION 'In-transit transfers cannot be cancelled through the normal flow; use a separately controlled return/reversal workflow';
  END IF;

  IF NOT (
    public.is_hq_admin()
    OR v_transfer.created_by = v_actor
    OR public.can_access_org(v_transfer.from_organization_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to cancel this transfer';
  END IF;

  IF v_transfer.status = 'draft' THEN
    UPDATE public.stock_transfers
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           notes = CASE
             WHEN NULLIF(btrim(p_reason), '') IS NULL THEN notes
             ELSE trim(both FROM coalesce(notes, '') || E'\nCancel: ' || btrim(p_reason))
           END,
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  IF v_transfer.status IN ('pending_approval', 'ready_to_dispatch') THEN
    PERFORM public._stock_transfer_release_reservations(v_transfer);
    UPDATE public.stock_transfers
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           notes = CASE
             WHEN NULLIF(btrim(p_reason), '') IS NULL THEN notes
             ELSE trim(both FROM coalesce(notes, '') || E'\nCancel: ' || btrim(p_reason))
           END,
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  RAISE EXCEPTION 'Transfer status % cannot be cancelled', v_transfer.status;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_stock_transfer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status = 'rejected' THEN
    RETURN v_transfer;
  END IF;
  IF v_transfer.status IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending-approval transfers can be rejected';
  END IF;
  IF NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Unauthorized rejection: HQ inventory approval authority is required';
  END IF;

  PERFORM public._stock_transfer_release_reservations(v_transfer);

  UPDATE public.stock_transfers
     SET status = 'rejected',
         rejected_by = v_actor,
         rejected_at = COALESCE(rejected_at, now()),
         rejection_reason = NULLIF(btrim(p_reason), ''),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_stock_transfer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_transfer(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_stock_transfer(uuid, uuid, text) IS
  'Cancel draft (no stock), pending_approval or ready_to_dispatch (release reservation once). In-transit and received cannot be cancelled through this flow.';
COMMENT ON FUNCTION public.reject_stock_transfer(uuid, uuid, text) IS
  'HQ reject of pending_approval transfer; releases source reservation exactly once.';

NOTIFY pgrst, 'reload schema';

COMMIT;
