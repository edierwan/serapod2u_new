begin;

-- ============================================================================
-- Opening Balance — server-authoritative allocation reconciliation resolver
-- ----------------------------------------------------------------------------
-- Context (5th Initial cut-off): a residual product_inventory.quantity_allocated
-- of 1 for "Zero Edition Novella [ Potato ]" on the "Unclassified (pending stock
-- take)" configuration produced an allocation-reconciliation blocker
-- (difference = 1) with NO source order surfaced by the preview — the owning
-- order item carries stock_config_id = NULL, so the preview's source-order
-- lateral (which matches order_items.stock_config_id) could not link it. The
-- allocation is in fact owned by a GENUINE ACTIVE (submitted) D2H order. Blindly
-- releasing it would corrupt a live order, so release must be refused while an
-- active owner exists.
--
-- This forward-only migration adds an explicit, user-confirmed resolver with
-- four actions and the safety envelope required by the spec:
--
--   1. select_related_order      — link the blocker to its genuine owning order
--                                  (read-only; records the association only).
--   2. carry_forward_related     — record a carry-forward decision for the owning
--                                  order via the authoritative D2H resolver
--                                  (fails closed if no valid target config).
--   3. exclude_and_release       — release the allocation, ONLY when no genuine
--                                  active order owns it (orphan/stale/historical).
--   4. mark_manual_investigation — audit-only; never mutates, never clears.
--
-- Safety: HQ-admin only; cut-off / inventory / order rows locked and revalidated;
-- stale preview quantities rejected; release refused while an active owner
-- exists; idempotent + double-submit safe; immutable audit event with
-- before/after values, actor, cut-off, variant, stock configuration, reason and
-- related order; physical count/import rows and QR data are never touched; the
-- preview is re-run after a successful resolution.
--
-- It ALSO hardens the OTP-binding RPC to independently recompute readiness and
-- refuse to bind a verification snapshot while any blocker remains (the posting
-- RPC already re-checks readiness under locks).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Idempotency / audit-of-request ledger (no operational data; HQ path only).
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_cutoff_allocation_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  action text not null check (action in (
    'select_related_order', 'carry_forward_related',
    'exclude_and_release', 'mark_manual_investigation'
  )),
  product_variant_id uuid not null references public.product_variants(id),
  stock_config_id uuid not null references public.inventory_stock_configurations(id),
  related_order_id uuid references public.orders(id),
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

alter table public.inventory_cutoff_allocation_requests enable row level security;
revoke all on public.inventory_cutoff_allocation_requests
  from public, anon, authenticated;

comment on table public.inventory_cutoff_allocation_requests is
  'Idempotency + request audit ledger for the Opening Balance allocation resolver. Only the SECURITY DEFINER resolver writes here. Holds no operational inventory/order data.';

-- ---------------------------------------------------------------------------
-- resolve_inventory_cutoff_allocation
-- ---------------------------------------------------------------------------
create or replace function public.resolve_inventory_cutoff_allocation(
  p_cutoff_id uuid,
  p_product_variant_id uuid,
  p_stock_config_id uuid,
  p_action text,
  p_related_order_id uuid,
  p_expected_allocated integer,
  p_expected_selected integer,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_existing public.inventory_cutoff_allocation_requests%rowtype;
  v_pi public.product_inventory%rowtype;
  v_allocated_before integer;
  v_selected_before integer;
  v_allocated_after integer;
  v_selected_after integer;
  v_owner_id uuid;
  v_owner_no text;
  v_owner_status text;
  v_has_active_owner boolean := false;
  v_related_no text;
  v_release_qty integer;
  v_after_alloc integer;
  v_item record;
  v_event_type text;
  v_mutated boolean := false;
  v_blocker_cleared boolean := false;
  v_preview jsonb;
  v_result jsonb;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if p_idempotency_key is null then
    raise exception 'inventory_cutoff_allocation_idempotency_key_required';
  end if;
  if p_action not in ('select_related_order', 'carry_forward_related',
                      'exclude_and_release', 'mark_manual_investigation') then
    raise exception 'inventory_cutoff_allocation_action_invalid';
  end if;

  -- Cut-off-scoped advisory lock. Never invokes the Opening Balance cancel RPC.
  perform pg_advisory_xact_lock(
    hashtextextended('inventory-cutoff-allocation:' || p_cutoff_id::text, 0)
  );

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id
  for update;
  if not found then
    raise exception 'inventory_cutoff_not_found';
  end if;
  if not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'permission_denied';
  end if;
  if v_cutoff.status <> 'counting' then
    raise exception 'inventory_cutoff_not_active';
  end if;

  -- Idempotent replay: identical request returns the stored result unchanged.
  select * into v_existing
  from public.inventory_cutoff_allocation_requests
  where cutoff_id = p_cutoff_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.action <> p_action
       or v_existing.product_variant_id <> p_product_variant_id
       or v_existing.stock_config_id <> p_stock_config_id
       or v_existing.related_order_id is distinct from p_related_order_id then
      raise exception 'inventory_cutoff_allocation_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Lock the exact allocation row and recompute the reconciliation under lock.
  select * into v_pi
  from public.product_inventory
  where organization_id = v_cutoff.warehouse_organization_id
    and variant_id = p_product_variant_id
    and stock_config_id = p_stock_config_id
  for update;
  if not found then
    raise exception 'inventory_cutoff_allocation_row_not_found';
  end if;
  v_allocated_before := coalesce(v_pi.quantity_allocated, 0);

  select coalesce(sum(d.quantity), 0) into v_selected_before
  from public.inventory_cutoff_decisions d
  where d.cutoff_id = p_cutoff_id
    and d.transaction_kind = 'distributor'
    and exists (
      select 1 from public.order_items oi
      where oi.id = d.order_item_id
        and oi.variant_id = p_product_variant_id
        and oi.stock_config_id = p_stock_config_id);

  -- Stale-preview guard: refuse when the client's quantities no longer match.
  if p_expected_allocated is not null and p_expected_allocated <> v_allocated_before then
    raise exception 'inventory_cutoff_stale_preview';
  end if;
  if p_expected_selected is not null and p_expected_selected <> v_selected_before then
    raise exception 'inventory_cutoff_stale_preview';
  end if;

  -- Authoritative owner detection: a genuine active D2H/S2D order that still
  -- holds a reservation on quantity_allocated for this variant at this warehouse.
  -- Only 'submitted' orders qualify: approval runs fulfill_order_inventory which
  -- decrements quantity_allocated (so approved/packed/shipped orders no longer
  -- own the counter), and cancellation writes a deallocation. This is evidence-
  -- based (movement + submitted order), NOT the preview's source_order_id (which
  -- is null here because the owning order item has a null stock configuration).
  select o.id, coalesce(o.display_doc_no, o.order_no), o.status
    into v_owner_id, v_owner_no, v_owner_status
  from public.orders o
  where o.order_type in ('D2H', 'S2D')
    and o.status = 'submitted'
    and public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id
    and exists (
      select 1 from public.order_items oi
      where oi.order_id = o.id and oi.variant_id = p_product_variant_id)
    and exists (
      select 1 from public.stock_movements sm
      where sm.reference_id = o.id and sm.variant_id = p_product_variant_id
        and sm.movement_type = 'allocation')
    and not exists (
      select 1 from public.stock_movements sm2
      where sm2.reference_id = o.id and sm2.variant_id = p_product_variant_id
        and sm2.movement_type = 'deallocation')
  order by o.created_at desc
  limit 1;
  v_has_active_owner := v_owner_id is not null;

  -- ---- Action dispatch ----------------------------------------------------
  if p_action = 'mark_manual_investigation' then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'inventory_cutoff_allocation_reason_required';
    end if;
    v_event_type := 'allocation_marked_for_investigation';
    v_blocker_cleared := false;

  elsif p_action = 'select_related_order' then
    if p_related_order_id is null then
      raise exception 'inventory_cutoff_allocation_related_order_required';
    end if;
    -- Validate the nominated order genuinely owns the allocation (lock it too).
    perform 1 from public.orders o where o.id = p_related_order_id for update;
    select coalesce(o.display_doc_no, o.order_no) into v_related_no
    from public.orders o
    where o.id = p_related_order_id
      and o.order_type in ('D2H', 'S2D')
      and o.status = 'submitted'
      and public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id
      and exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.variant_id = p_product_variant_id)
      and exists (select 1 from public.stock_movements sm
                  where sm.reference_id = o.id and sm.variant_id = p_product_variant_id
                    and sm.movement_type = 'allocation');
    if v_related_no is null then
      raise exception 'inventory_cutoff_allocation_order_not_owner';
    end if;
    v_owner_id := p_related_order_id;
    v_owner_no := v_related_no;
    v_event_type := 'allocation_related_order_selected';
    v_blocker_cleared := false; -- linking only; the order still needs a decision

  elsif p_action = 'carry_forward_related' then
    if p_related_order_id is null then
      raise exception 'inventory_cutoff_allocation_related_order_required';
    end if;
    perform 1 from public.orders o where o.id = p_related_order_id for update;
    select coalesce(o.display_doc_no, o.order_no) into v_related_no
    from public.orders o
    where o.id = p_related_order_id
      and o.order_type in ('D2H', 'S2D')
      and o.status = 'submitted'
      and public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id
      and exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.variant_id = p_product_variant_id)
      and exists (select 1 from public.stock_movements sm
                  where sm.reference_id = o.id and sm.variant_id = p_product_variant_id
                    and sm.movement_type = 'allocation');
    if v_related_no is null then
      raise exception 'inventory_cutoff_allocation_order_not_owner';
    end if;
    -- Delegate to the authoritative D2H carry-forward. set_inventory_cutoff_decision
    -- validates the target configuration and raises a precise reason when none is
    -- valid (e.g. an unclassified variant), so nothing is forced.
    for v_item in
      select oi.id from public.order_items oi
      where oi.order_id = p_related_order_id
        and oi.variant_id = p_product_variant_id
    loop
      perform public.set_inventory_cutoff_decision(p_cutoff_id, v_item.id, 'carry_forward');
    end loop;
    v_mutated := true;
    v_owner_id := p_related_order_id;
    v_owner_no := v_related_no;
    v_event_type := 'allocation_carry_forward_recorded';

  else -- exclude_and_release
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'inventory_cutoff_allocation_reason_required';
    end if;
    -- Refuse release while a genuine active order still owns the allocation.
    if v_has_active_owner then
      raise exception 'inventory_cutoff_allocation_active_owner: order % (%) still owns this allocation',
        v_owner_no, v_owner_status;
    end if;
    v_release_qty := v_allocated_before - v_selected_before;
    if v_release_qty <= 0 then
      raise exception 'inventory_cutoff_allocation_nothing_to_release';
    end if;
    v_after_alloc := greatest(0, v_allocated_before - v_release_qty);

    update public.product_inventory
    set quantity_allocated = v_after_alloc,
        updated_at = now()
    where id = v_pi.id;

    insert into public.stock_movements (
      movement_type, reference_type, reference_id, reference_no,
      variant_id, stock_config_id, from_organization_id, to_organization_id,
      quantity_change, quantity_before, quantity_after, unit_cost,
      company_id, created_by, created_at, notes, reason
    ) values (
      'deallocation', 'opening_balance_cutoff', p_cutoff_id, null,
      p_product_variant_id, p_stock_config_id, v_cutoff.warehouse_organization_id, null,
      -(v_allocated_before - v_after_alloc), v_allocated_before, v_after_alloc,
      coalesce(v_pi.average_cost, 0),
      v_cutoff.company_id, v_user, now(),
      'opening_balance_orphan_allocation_release', btrim(p_reason)
    );
    v_mutated := true;
    v_event_type := 'allocation_excluded_and_released';
  end if;

  -- Recompute the reconciliation under the same lock after any mutation.
  select coalesce(quantity_allocated, 0) into v_allocated_after
  from public.product_inventory where id = v_pi.id;
  select coalesce(sum(d.quantity), 0) into v_selected_after
  from public.inventory_cutoff_decisions d
  where d.cutoff_id = p_cutoff_id
    and d.transaction_kind = 'distributor'
    and exists (
      select 1 from public.order_items oi
      where oi.id = d.order_item_id
        and oi.variant_id = p_product_variant_id
        and oi.stock_config_id = p_stock_config_id);
  v_blocker_cleared := (v_allocated_after - v_selected_after) = 0;

  -- Immutable audit event: before/after, actor, cut-off, variant, stock config,
  -- reason and related order. No QR / physical-count impact.
  insert into public.inventory_cutoff_audit_events (
    cutoff_id, event_type, actor_id, order_id, details
  ) values (
    p_cutoff_id, v_event_type, v_user, v_owner_id,
    jsonb_build_object(
      'product_variant_id', p_product_variant_id,
      'stock_config_id', p_stock_config_id,
      'allocated_before', v_allocated_before,
      'selected_before', v_selected_before,
      'difference_before', v_allocated_before - v_selected_before,
      'allocated_after', v_allocated_after,
      'selected_after', v_selected_after,
      'difference_after', v_allocated_after - v_selected_after,
      'has_active_owner', v_has_active_owner,
      'related_order_id', v_owner_id,
      'related_order_number', v_owner_no,
      'related_order_status', v_owner_status,
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'mutated', v_mutated,
      'blocker_cleared', v_blocker_cleared,
      'physical_count_impact', 'none',
      'qr_impact', 'none'
    )
  );

  -- Re-run the authoritative preview so the caller gets fresh readiness/blockers.
  v_preview := public.inventory_cutoff_preview(p_cutoff_id);

  v_result := jsonb_build_object(
    'action', p_action,
    'cutoff_id', p_cutoff_id,
    'product_variant_id', p_product_variant_id,
    'stock_config_id', p_stock_config_id,
    'allocated_before', v_allocated_before,
    'selected_before', v_selected_before,
    'allocated_after', v_allocated_after,
    'selected_after', v_selected_after,
    'difference_after', v_allocated_after - v_selected_after,
    'has_active_owner', v_has_active_owner,
    'related_order_id', v_owner_id,
    'related_order_number', v_owner_no,
    'mutated', v_mutated,
    'blocker_cleared', v_blocker_cleared,
    'readiness', v_preview->>'readiness',
    'blocker_details', coalesce(v_preview->'blocker_details', '[]'::jsonb),
    'idempotent_replay', false,
    'qr_impact', 'none'
  );

  insert into public.inventory_cutoff_allocation_requests (
    cutoff_id, idempotency_key, action, product_variant_id,
    stock_config_id, related_order_id, result, created_by
  ) values (
    p_cutoff_id, p_idempotency_key, p_action, p_product_variant_id,
    p_stock_config_id, v_owner_id, v_result, v_user
  );

  return v_result;
end;
$$;

revoke all on function public.resolve_inventory_cutoff_allocation(
  uuid, uuid, uuid, text, uuid, integer, integer, text, uuid
) from public, anon;
grant execute on function public.resolve_inventory_cutoff_allocation(
  uuid, uuid, uuid, text, uuid, integer, integer, text, uuid
) to authenticated;

comment on function public.resolve_inventory_cutoff_allocation(
  uuid, uuid, uuid, text, uuid, integer, integer, text, uuid
) is
  'Server-authoritative Opening Balance allocation reconciliation resolver. Four explicit user-confirmed actions (select_related_order, carry_forward_related, exclude_and_release, mark_manual_investigation). HQ-admin only; locks and revalidates cut-off/inventory/order rows; rejects stale preview quantities; refuses release while a genuine active order owns the allocation; idempotent + double-submit safe; writes an immutable audit event with before/after values; never touches physical count/import rows or QR data; re-runs the preview after resolution.';

-- ---------------------------------------------------------------------------
-- Harden the OTP-binding RPC to independently reject unresolved blockers.
-- Forward-only create-or-replace; does not rename the function.
-- ---------------------------------------------------------------------------
create or replace function public.bind_inventory_cutoff_verification_snapshot(
  p_request_id uuid, p_cutoff_id uuid
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_hash text;
  v_preview jsonb;
begin
  if v_user is null then raise exception 'unauthorized'; end if;
  select * into v_cutoff from public.inventory_opening_cutoffs
    where id = p_cutoff_id for update;
  if not found or v_cutoff.status <> 'counting' then raise exception 'inventory_cutoff_not_active'; end if;
  if not exists (select 1 from public.stock_count_verification_requests vr
    where vr.id = p_request_id and vr.session_id = v_cutoff.stock_count_session_id
      and vr.requesting_user_id = v_user and vr.status = 'pending_delivery')
  then raise exception 'inventory_cutoff_verification_request_invalidated'; end if;
  -- Independent server-side readiness gate: never bind an OTP snapshot while any
  -- blocker remains, even if a client bypassed the app-layer readiness check.
  v_preview := public.inventory_cutoff_preview(v_cutoff.id);
  if coalesce(v_preview->>'readiness', '') <> 'Ready' then
    raise exception 'inventory_cutoff_not_ready: %', coalesce((v_preview->'blockers')::text, '[]');
  end if;
  v_hash := public.inventory_cutoff_snapshot_hash(v_cutoff.id);
  update public.stock_count_verification_requests
    set snapshot_hash = v_hash where id = p_request_id and status = 'pending_delivery';
  return v_hash;
end;
$$;

revoke all on function public.bind_inventory_cutoff_verification_snapshot(uuid, uuid) from public;
grant execute on function public.bind_inventory_cutoff_verification_snapshot(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
