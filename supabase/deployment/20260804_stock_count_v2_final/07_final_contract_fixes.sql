-- =============================================================================
-- 07_final_contract_fixes.sql  [SCHEMA CHANGE]
-- =============================================================================
-- PURPOSE      : Install the TERMINAL definition of the six entry-point contract functions.
-- PREREQUISITES: 02-05 completed. 06 may run before or after this file.
-- MUTATES      : SCHEMA ONLY (function definitions). No business row is modified.
-- EXPECTED     : The six functions below are the last writers in the whole migration history.
-- VERIFY       : 08_post_deployment_verification.sql sections F and X.
-- WHY SEPARATE : these six converge the entire migration history. Several were
--                redefined up to TEN times across development; only the versions
--                below are current. Installing them last makes the terminal
--                contract explicit and auditable.
--                  inventory_cutoff_preview                      <- 20260801180000
--                  verify_and_post_inventory_opening_cutoff      <- 20260801140000
--                  ..._scoped_legacy                             <- 20260801250000
--                  bind_inventory_cutoff_verification_snapshot   <- 20260801240000
--                  resolve_inventory_cutoff_allocation           <- 20260801220000
--                  release_allocation_for_order                  <- 20260801210000
-- NO RENAMES   : unlike the historical migrations, nothing here renames a live
--                function to *_pre_*. CREATE OR REPLACE keeps the OID, so
--                dependent views/grants are undisturbed and the file is rerunnable.
-- -----------------------------------------------------------------------------
-- All SQL bodies below are copied verbatim from the authoritative migrations
-- listed per section. Only selection, ordering and idempotency guards are new.
-- Authoritative application commit: 9a62556aae6f64af3bc98f159196179669311b3f
-- =============================================================================

BEGIN;

-- ---- source (verbatim): supabase/migrations/20260801180000_inventory_cutoff_preview_nested_aggregate_fix.sql

create or replace function public.inventory_cutoff_preview(p_cutoff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_report jsonb;
  v_blockers jsonb;
  v_alloc_details jsonb;
  v_other_details jsonb;
  v_details jsonb;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  v_report := public.inventory_cutoff_preview_pre_blocker_details(p_cutoff_id);
  v_blockers := coalesce(v_report->'blockers', '[]'::jsonb);

  -- Structured detail for every ALLOCATION-OWNERSHIP blocker, rebuilt from the
  -- SAME reconciliation the base preview uses so the reason string is identical
  -- and the detail set mirrors blockers[] 1:1 (same category scope, same
  -- variant/config ownership, same mismatch predicate).
  --
  -- Two-level design (fixes the nested-aggregate failure):
  --   * inner `alloc_recon` groups per (variant, stock config) and computes the
  --     single scalar `selected_quantity` = coalesce(sum(d.quantity), 0);
  --   * the outer jsonb_agg() consumes only scalar columns — no aggregate is
  --     nested inside it.
  --
  -- Quantity multiplication is prevented by construction:
  --   * one `product_inventory` row per (variant, stock config);
  --   * the source-order enrichment is a `left join lateral (... limit 1)`, so a
  --     variant with many order_items / stock_movements yields at most one `src`
  --     row and never fans out the `d.quantity` sum;
  --   * decision rows are matched by EXACT variant + stock-config ownership via
  --     the `order_items` EXISTS predicate, so unrelated order lines cannot leak
  --     into the sum.
  with alloc_recon as (
    select
      pv.id                              as product_variant_id,
      pv.variant_name                    as variant_name,
      c.id                               as stock_config_id,
      c.config_label                     as config_label,
      pi.quantity_allocated              as allocated_quantity,
      coalesce(sum(d.quantity), 0)       as selected_quantity,
      pi.quantity_allocated - coalesce(sum(d.quantity), 0) as difference,
      (coalesce(sum(d.quantity), 0) = 0) as orphan,
      v_cutoff.warehouse_organization_id as warehouse_organization_id,
      v_cutoff.product_category_id       as product_category_id,
      v_cutoff.id                        as cutoff_id,
      src.order_id                       as source_order_id,
      src.order_number                   as source_order_number
    from public.product_inventory pi
    join public.inventory_stock_configurations c
      on c.id = pi.stock_config_id and c.variant_id = pi.variant_id
    join public.product_variants pv on pv.id = pi.variant_id
    join public.products p on p.id = pv.product_id
    left join public.inventory_cutoff_decisions d on d.cutoff_id = v_cutoff.id
      and d.transaction_kind = 'distributor'
      and exists (
        select 1 from public.order_items oi
        where oi.id = d.order_item_id
          and oi.variant_id = pi.variant_id
          and oi.stock_config_id = pi.stock_config_id)
    -- Best-effort link to the distributor order that owns an allocation movement
    -- for this variant/config in this warehouse (read-only; may be null/orphan).
    -- `limit 1` keeps this single-valued so it never multiplies the sum above.
    left join lateral (
      select o.id as order_id, coalesce(o.display_doc_no, o.order_no) as order_number
      from public.orders o
      join public.order_items oi2 on oi2.order_id = o.id
      join public.stock_movements sm on sm.reference_id = o.id
        and sm.variant_id = pi.variant_id and sm.movement_type = 'allocation'
      where o.order_type in ('D2H', 'S2D')
        and oi2.variant_id = pi.variant_id
        and oi2.stock_config_id = pi.stock_config_id
        and public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id
      order by o.created_at desc
      limit 1
    ) src on true
    where pi.organization_id = v_cutoff.warehouse_organization_id
      and pi.quantity_allocated > 0
      and p.category_id = v_cutoff.product_category_id
    group by pv.id, pv.variant_name, c.id, c.config_label, pi.quantity_allocated,
      src.order_id, src.order_number
    having pi.quantity_allocated <> coalesce(sum(d.quantity), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'allocation_reconciliation:' || ar.product_variant_id::text || ':' || ar.stock_config_id::text,
    'code', 'allocation_reconciliation',
    'category', 'allocation_reconciliation',
    'step', 'transactions',
    'reason', format(
      'Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
      ar.variant_name, ar.config_label, ar.allocated_quantity, ar.selected_quantity),
    'action_label', 'Review Allocation',
    'product_variant_id', ar.product_variant_id,
    'variant_name', ar.variant_name,
    'stock_config_id', ar.stock_config_id,
    'config_label', ar.config_label,
    'warehouse_organization_id', ar.warehouse_organization_id,
    'product_category_id', ar.product_category_id,
    'cutoff_id', ar.cutoff_id,
    'allocated_quantity', ar.allocated_quantity,
    'selected_quantity', ar.selected_quantity,
    'difference', ar.difference,
    'orphan', ar.orphan,
    'allocation_status', 'allocated',
    'before_cutoff', true,
    'source_order_id', ar.source_order_id,
    'source_order_number', ar.source_order_number
  )), '[]'::jsonb)
  into v_alloc_details
  from alloc_recon ar;

  -- Every OTHER blocker becomes a `{ reason }` detail; the client classifies its
  -- step/category/action label from the reason text. Allocation-ownership strings
  -- are excluded here because they are emitted (enriched) above — this keeps each
  -- allocation blocker from being counted once as a generic blocker and again as
  -- a structured blocker.
  select coalesce(jsonb_agg(jsonb_build_object('reason', msg.value)
    order by msg.ordinality), '[]'::jsonb)
  into v_other_details
  from jsonb_array_elements_text(v_blockers) with ordinality msg(value, ordinality)
  where msg.value not like 'Allocation ownership does not reconcile for %';

  v_details := v_other_details || v_alloc_details;

  return v_report || jsonb_build_object('blocker_details', v_details);
end;
$$;

grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Opening Balance preview with a structured, authoritative blocker_details[] contract. Allocation reconciliation is computed in two query levels (inner CTE aggregates sum(d.quantity); outer jsonb_agg consumes only scalar columns) so no aggregate is nested inside another. Mirrors blockers[] 1:1 (category-scoped) so Step 4 (Transactions) and Step 5 (Review & Post) consume the same blocker collection with a stable, non-text identity. Read-only: no inventory, allocation, order, movement, QR or transaction data is modified.';

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create or replace function public.verify_and_post_inventory_opening_cutoff(
  p_request_id uuid, p_code_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '300s'
set lock_timeout = '30s'
as $$
declare
  v_user uuid := auth.uid();
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_policy public.inventory_cutoff_transactions_policies%rowtype;
  v_eligible_count integer := 0;
  v_result jsonb;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;

  select cutoff.* into v_cutoff
  from public.stock_count_verification_requests request_row
  join public.inventory_opening_cutoffs cutoff
    on cutoff.stock_count_session_id = request_row.session_id
  where request_row.id = p_request_id
    and request_row.requesting_user_id = v_user;

  if v_cutoff.id is not null then
    select count(*) into v_eligible_count
    from public.inventory_cutoff_transactions_scoped(v_cutoff.id)
    where eligibility = 'eligible';

    select * into v_policy
    from public.inventory_cutoff_transactions_policies
    where cutoff_id = v_cutoff.id;

    if not found then
      if v_eligible_count > 0 then
        raise exception 'inventory_cutoff_transactions_policy_required';
      end if;
    else
      if v_policy.product_category_id is distinct from v_cutoff.product_category_id
         or v_policy.warehouse_organization_id is distinct from v_cutoff.warehouse_organization_id then
        raise exception 'inventory_cutoff_transactions_policy_scope_mismatch';
      end if;
      -- Re-derive current authoritative eligibility; reject stale drift.
      if v_policy.confirmation_fingerprint is distinct from (
        public.inventory_cutoff_transactions_policy_preflight(
          v_cutoff.id, v_policy.policy, v_policy.carried_refs
        )->>'confirmation_fingerprint'
      ) then
        raise exception 'inventory_cutoff_transactions_policy_scope_changed';
      end if;
    end if;
  end if;

  -- Inner posting performs all inventory/order work (transactions contribute none).
  v_result := public.verify_and_post_inventory_opening_cutoff_pre_transactions_policy(
    p_request_id, p_code_hash
  );

  -- Only stamp exclusion markers on a genuinely successful post (no error_code)
  -- and only once the cutoff is posted. Metadata-only; original transactions and
  -- their statuses are never touched.
  if v_cutoff.id is not null
     and (v_result is null or not (v_result ? 'error_code'))
     and exists (
       select 1 from public.inventory_opening_cutoffs c
       where c.id = v_cutoff.id and c.status = 'posted'
     )
     and v_policy.cutoff_id is not null then
    insert into public.inventory_cutoff_excluded_transactions(
      cutoff_id, transaction_type, transaction_id,
      warehouse_organization_id, product_category_id, excluded_by
    )
    select
      v_cutoff.id,
      ref->>'type',
      (ref->>'id')::uuid,
      v_cutoff.warehouse_organization_id,
      v_cutoff.product_category_id,
      v_user
    from jsonb_array_elements(v_policy.excluded_refs) ref
    where ref ? 'type' and ref ? 'id'
    on conflict (cutoff_id, transaction_type, transaction_id) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.verify_and_post_inventory_opening_cutoff(uuid, text) from public;

grant execute on function public.verify_and_post_inventory_opening_cutoff(uuid, text)
  to authenticated;

-- ---- source (verbatim): supabase/migrations/20260801250000_opening_balance_post_excluded_d2h_order_status_tolerance.sql

CREATE OR REPLACE FUNCTION public.verify_and_post_inventory_opening_cutoff_scoped_legacy(p_request_id uuid, p_code_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
 SET lock_timeout TO '30s'
AS $function$
declare
  v_user uuid := auth.uid();
  v_request public.stock_count_verification_requests%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_preview jsonb;
  v_current_snapshot text;
  v_item record;
  v_order record;
  v_old_on integer;
  v_old_alloc integer;
  v_target_alloc integer;
  v_variances integer := 0;
  v_cancelled integer := 0;
  v_carried integer := 0;
  v_incoming integer := 0;
  v_history_orders integer := 0;
  v_excluded integer := 0;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  select * into v_request from public.stock_count_verification_requests
    where id=p_request_id for update;
  if not found or v_request.requesting_user_id<>v_user then raise exception 'invalid_verification_code'; end if;
  select * into v_session from public.stock_count_sessions
    where id=v_request.session_id for update;
  if v_session.count_type<>'opening_balance_cutoff' then raise exception 'stock_count_wrong_posting_function'; end if;
  if v_session.status='posted' then raise exception 'stock_count_already_posted'; end if;
  select * into v_cutoff from public.inventory_opening_cutoffs
    where stock_count_session_id=v_session.id for update;
  if not found or v_cutoff.status<>'counting' then raise exception 'inventory_cutoff_not_active'; end if;
  if v_request.status='posted' or v_request.consumed_at is not null then
    raise exception 'verification_code_already_used';
  end if;
  if v_request.status='expired' or v_request.expires_at<=now() then
    update public.stock_count_verification_requests set status='expired'
      where id=p_request_id and status<>'expired';
    return jsonb_build_object('error_code','verification_code_expired');
  end if;
  if v_request.status<>'active' then raise exception 'invalid_verification_code'; end if;

  v_current_snapshot := public.inventory_cutoff_snapshot_hash(v_cutoff.id);
  if v_current_snapshot is distinct from v_request.snapshot_hash then
    update public.stock_count_verification_requests set status='invalidated',
      invalidated_at=now(),snapshot_mismatch=true where id=p_request_id;
    return jsonb_build_object('error_code','stock_count_snapshot_changed');
  end if;
  if p_code_hash is distinct from v_request.code_hash then
    update public.stock_count_verification_requests
      set failed_attempt_count=least(failed_attempt_count+1,5),
        status=case when failed_attempt_count+1>=5 then 'too_many_attempts' else status end,
        invalidated_at=case when failed_attempt_count+1>=5 then now() else invalidated_at end
      where id=p_request_id;
    return jsonb_build_object('error_code','invalid_verification_code');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-opening-cutoff:'||v_cutoff.warehouse_organization_id::text,0));
  perform 1 from public.product_inventory
    where organization_id=v_cutoff.warehouse_organization_id
    order by stock_config_id for update;
  perform 1 from public.orders o where
    (o.order_type in ('D2H','S2D') and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id)
    or (o.order_type='H2M' and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id)
    order by o.id for update;

  v_preview := public.inventory_cutoff_preview(v_cutoff.id);
  -- Advisory review_items are NOT blockers; reject posting ONLY on real blockers.
  if v_preview->>'readiness'='Blocked' then
    raise exception 'inventory_cutoff_not_ready: %',coalesce((v_preview->'blockers')::text,'[]');
  end if;

  if exists (
    select 1 from public.inventory_cutoff_decisions d
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
    group by d.order_id having count(distinct d.decision)>1
  ) then raise exception 'inventory_cutoff_mixed_order_decisions'; end if;
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
    group by d.order_id having count(distinct d.decision)>1
  ) then raise exception 'inventory_cutoff_mixed_manufacturer_order_decisions'; end if;

  -- Staleness is scoped to what each decision actually DOES.
  --   carry_forward / cancel_release MUTATE the order and its allocation, so the
  --     order must still be an open submitted D2H/S2D order.
  --   do_not_carry_forward is metadata-only (audit event; zero inventory, zero
  --     allocation, zero order mutation). An order that has since been cancelled
  --     or closed is MORE excluded, not less, so its status must not veto posting.
  -- Order type and decision-quantity integrity are still enforced for every kind.
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and (
        d.quantity<>oi.qty
        or o.order_type not in ('D2H','S2D')
        or (d.decision in ('carry_forward','cancel_release') and o.status<>'submitted')
      )
  ) then raise exception 'inventory_cutoff_distributor_decision_stale'; end if;
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    left join (
      select order_id,variant_id,sum(received_now)::integer received_qty
      from public.warehouse_receipt_items group by order_id,variant_id
    ) r on r.order_id=o.id and r.variant_id=oi.variant_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
      and (o.status not in ('approved','closed') or o.order_type<>'H2M'
        or d.quantity<>greatest(oi.qty-coalesce(r.received_qty,0),0))
  ) then raise exception 'inventory_cutoff_manufacturer_decision_stale'; end if;

  -- Category-scoped allocation ownership only. Out-of-category allocations are
  -- intentionally ignored so a Vape Opening Balance cannot be blocked by Pet Food.
  if exists (
    select 1 from public.product_inventory pi
    join public.product_variants pv on pv.id = pi.variant_id
    join public.products p on p.id = pv.product_id
    where pi.organization_id=v_cutoff.warehouse_organization_id
      and pi.quantity_allocated>0
      and p.category_id = v_cutoff.product_category_id
      and pi.quantity_allocated <> coalesce((
        select sum(d.quantity) from public.inventory_cutoff_decisions d
        join public.order_items oi on oi.id=d.order_item_id
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
          and oi.variant_id=pi.variant_id and oi.stock_config_id=pi.stock_config_id
      ),0)
  ) then raise exception 'inventory_cutoff_allocation_owner_unresolved'; end if;

  insert into public.inventory_cutoff_posting_context(
    backend_pid,transaction_id,cutoff_id,created_by
  ) values(pg_backend_pid(),txid_current(),v_cutoff.id,v_user);

  for v_order in
    select o.* from public.orders o
    where exists(select 1 from public.inventory_cutoff_decisions d
      where d.cutoff_id=v_cutoff.id and d.order_id=o.id and d.decision='cancel_release')
    order by o.id for update
  loop
    if v_order.status<>'submitted' or v_order.order_type not in ('D2H','S2D') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    update public.orders set status='cancelled',
      notes=concat_ws(E'\n',nullif(notes,''),'Cancelled during Inventory Opening Balance Cut-off'),
      updated_by=v_user,updated_at=now() where id=v_order.id and status='submitted';
    perform public.release_allocation_for_order(v_order.id);
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'order_cancelled_and_allocation_released',v_user,v_order.id,
      jsonb_build_object('reason','Cancelled during Inventory Opening Balance Cut-off'));
    v_cancelled:=v_cancelled+1;
  end loop;

  for v_order in
    select o.* from public.orders o
    where exists(select 1 from public.inventory_cutoff_decisions d
      where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
        and d.order_id=o.id and d.decision='do_not_carry_forward')
    order by o.id for update
  loop
    -- Metadata-only exclusion: never require 'submitted'. The order's real status
    -- at posting time is recorded verbatim in order_status_preserved below.
    if v_order.order_type not in ('D2H','S2D') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'distributor_order_excluded_do_not_carry_forward',v_user,v_order.id,
      jsonb_build_object(
        'reason','Do Not Carry Forward during Inventory Opening Balance Cut-off',
        'order_status_preserved',v_order.status,
        'allocation_released',false,'inventory_impact','none','qr_impact','none'));
    v_excluded:=v_excluded+1;
  end loop;

  for v_item in
    select i.*,pi.quantity_on_hand live_on_hand,pi.quantity_allocated live_allocated,
      pi.warehouse_location,pi.average_cost
    from public.stock_count_session_items i
    left join public.product_inventory pi
      on pi.organization_id=v_cutoff.warehouse_organization_id
      and pi.variant_id=i.variant_id and pi.stock_config_id=i.stock_config_id and pi.is_active
    where i.session_id=v_session.id and i.physical_quantity is not null
    order by i.stock_config_id,i.variant_id
  loop
    v_old_on:=coalesce(v_item.live_on_hand,0);
    v_old_alloc:=coalesce(v_item.live_allocated,0);
    insert into public.product_inventory(
      variant_id,organization_id,stock_config_id,quantity_on_hand,quantity_allocated,
      average_cost,warehouse_location,is_active,last_counted_at,last_counted_by
    ) values(
      v_item.variant_id,v_cutoff.warehouse_organization_id,v_item.stock_config_id,
      v_item.physical_quantity,0,v_item.average_cost,v_item.warehouse_location,true,now(),v_user
    ) on conflict(organization_id,variant_id,stock_config_id) do update set
      quantity_on_hand=excluded.quantity_on_hand,quantity_allocated=0,
      last_counted_at=now(),last_counted_by=v_user,updated_at=now(),is_active=true;
    if v_item.physical_quantity<>v_old_on then
      insert into public.stock_movements(
        movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
        from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,
        unit_cost,company_id,created_by,reason,notes
      ) values(
        'adjustment','adjustment',v_session.id,
        coalesce(v_session.reference_name,'Inventory Opening Balance Cut-off'),
        v_item.variant_id,v_item.stock_config_id,
        v_cutoff.warehouse_organization_id,v_cutoff.warehouse_organization_id,
        v_item.physical_quantity-v_old_on,v_old_on,v_item.physical_quantity,
        v_item.unit_cost,v_cutoff.company_id,v_user,'inventory_opening_balance_cutoff',
        'Physical opening quantity established; pre-cut-off history retained'
      );
      v_variances:=v_variances+1;
    end if;
  end loop;

  -- Carry-forward only. Historical order_fulfillment movements are never replayed.
  for v_item in
    select d.*,oi.variant_id,oi.stock_config_id old_stock_config_id,
      o.order_no,o.display_doc_no,o.buyer_org_id
    from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and d.decision='carry_forward'
    order by d.stock_config_id,d.order_id,d.order_item_id for update of oi,o
  loop
    if not exists(select 1 from public.inventory_stock_configurations c
      where c.id=v_item.stock_config_id and c.variant_id=v_item.variant_id
        and c.volume_ml=20 and c.packaging='new_box' and c.status='active' and c.allow_so)
    then raise exception 'inventory_cutoff_20ml_new_box_missing'; end if;
    select quantity_allocated into v_target_alloc from public.product_inventory
      where organization_id=v_cutoff.warehouse_organization_id
        and variant_id=v_item.variant_id and stock_config_id=v_item.stock_config_id for update;
    update public.product_inventory set quantity_allocated=quantity_allocated+v_item.quantity,
      updated_at=now()
      where organization_id=v_cutoff.warehouse_organization_id
        and variant_id=v_item.variant_id and stock_config_id=v_item.stock_config_id
        and quantity_on_hand-quantity_allocated>=v_item.quantity;
    if not found then raise exception 'inventory_cutoff_carried_allocation_shortage: order %, config %, quantity %',
      coalesce(v_item.display_doc_no,v_item.order_no),v_item.stock_config_id,v_item.quantity; end if;
    update public.order_items set stock_config_id=v_item.stock_config_id,
      stock_config_confirmed_at=now(),stock_config_confirmed_by=v_user,updated_at=now()
      where id=v_item.order_item_id;
    insert into public.stock_movements(
      movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,
      company_id,created_by,reason,notes
    ) values(
      'allocation','order_config_change',v_item.order_id,
      coalesce(v_item.display_doc_no,v_item.order_no),v_item.variant_id,v_item.stock_config_id,
      v_cutoff.warehouse_organization_id,v_item.buyer_org_id,v_item.quantity,
      coalesce(v_target_alloc,0),coalesce(v_target_alloc,0)+v_item.quantity,
      v_cutoff.company_id,v_user,'inventory_opening_balance_cutoff',
      'Explicit distributor allocation carried forward to 20ml New Box'
    );
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,order_item_id,details
    ) values(v_cutoff.id,'distributor_allocation_carried_forward',v_user,
      v_item.order_id,v_item.order_item_id,jsonb_build_object(
        'quantity',v_item.quantity,'stock_config_id',v_item.stock_config_id));
    v_carried:=v_carried+v_item.quantity;
  end loop;

  -- H2M history_only / excluded: preserve original order status. Do not cancel,
  -- delete or reverse H2M orders. Receiving via the carried-forward incoming path
  -- is blocked by inventory_cutoff_h2m_excluded_blocks_receipt after posting.
  for v_order in
    select o.* from public.orders o
    where exists(select 1 from public.inventory_cutoff_decisions d
      where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
        and d.order_id=o.id and d.decision='history_only')
    order by o.id for update
  loop
    if v_order.order_type<>'H2M' or v_order.status not in ('approved','closed') then
      raise exception 'inventory_cutoff_manufacturer_not_eligible';
    end if;
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'manufacturer_order_excluded_history_only',v_user,v_order.id,
      jsonb_build_object(
        'previous_status',v_order.status,
        'order_status_preserved',v_order.status,
        'reason','Historical excluded during Inventory Opening Balance Cut-off',
        'orders_cancelled',false,
        'orders_deleted',false,
        'inventory_impact','none',
        'qr_impact','none',
        'future_receiving_via_cutoff_incoming',false,
        'manual_receiving_required_for_genuine_arrival',true));
    v_history_orders:=v_history_orders+1;
  end loop;

  for v_item in select * from public.inventory_cutoff_decisions
    where cutoff_id=v_cutoff.id and transaction_kind='manufacturer'
      and decision='carry_forward_incoming'
  loop
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,order_item_id,details
    ) values(v_cutoff.id,'manufacturer_incoming_carried_forward',v_user,
      v_item.order_id,v_item.order_item_id,jsonb_build_object(
        'remaining_incoming_quantity',v_item.quantity,'stock_config_id',v_item.stock_config_id,
        'inventory_posted',false));
    v_incoming:=v_incoming+v_item.quantity;
  end loop;

  update public.stock_count_sessions set status='posted',posted_by=v_user,posted_at=now(),
    total_variants_counted=(select count(*) from public.stock_count_session_items
      where session_id=v_session.id and physical_quantity is not null),
    variance_items=v_variances,
    net_quantity_adjustment=(select coalesce(sum(physical_quantity-system_quantity),0)
      from public.stock_count_session_items where session_id=v_session.id and physical_quantity is not null),
    estimated_adjustment_value=(select coalesce(sum((physical_quantity-system_quantity)*unit_cost),0)
      from public.stock_count_session_items where session_id=v_session.id and physical_quantity is not null),
    updated_by=v_user,updated_at=now()
    where id=v_session.id and status='draft';
  if not found then raise exception 'stock_count_already_posted'; end if;

  insert into public.inventory_cutoff_reports(
    cutoff_id,report_kind,readiness,report_payload,generated_by
  ) values(v_cutoff.id,'posted','Ready',v_preview,v_user);
  update public.inventory_opening_cutoffs set status='posted',posted_by=v_user,
    posted_at=now(),updated_at=now() where id=v_cutoff.id and status='counting';
  insert into public.inventory_cutoff_audit_events(cutoff_id,event_type,actor_id,details)
    values(v_cutoff.id,'cutoff_posted_and_warehouse_reopened',v_user,jsonb_build_object(
      'variance_movements',v_variances,'cancelled_orders',v_cancelled,
      'carried_distributor_quantity',v_carried,'carried_manufacturer_incoming',v_incoming,
      'manufacturer_history_only_orders',v_history_orders,
      'excluded_do_not_carry_forward_orders',v_excluded,
      'd2h_policy', coalesce(v_preview->'d2h_policy'->>'policy', null),
      'qr_impact','none'));

  update public.stock_count_verification_requests set status='posted',verified_by=v_user,
    verified_at=now(),consumed_at=now(),
    code_hash=encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),
    posting_result=jsonb_build_object('status','posted','cutoff_id',v_cutoff.id,
      'cancelled_orders',v_cancelled,'carried_distributor_quantity',v_carried,
      'carried_manufacturer_incoming',v_incoming,
      'manufacturer_history_only_orders',v_history_orders,
      'excluded_do_not_carry_forward_orders',v_excluded,'variance_movements',v_variances)
    where id=p_request_id;
  update public.stock_count_verification_requests set status='invalidated',invalidated_at=now()
    where session_id=v_session.id and id<>p_request_id and status in ('pending_delivery','active');
  delete from public.inventory_cutoff_posting_context
    where backend_pid=pg_backend_pid() and transaction_id=txid_current()
      and cutoff_id=v_cutoff.id and created_by=v_user;
  return jsonb_build_object('status','posted','cutoff_id',v_cutoff.id,
    'session_id',v_session.id,'cancelled_orders',v_cancelled,
    'carried_distributor_quantity',v_carried,
    'carried_manufacturer_incoming',v_incoming,
    'manufacturer_history_only_orders',v_history_orders,
    'excluded_do_not_carry_forward_orders',v_excluded,'variance_movements',v_variances,
    'qr_impact','none');
end;
$function$;

-- ---- source (verbatim): supabase/migrations/20260801240000_opening_balance_post_allows_review_required.sql

CREATE OR REPLACE FUNCTION public.bind_inventory_cutoff_verification_snapshot(p_request_id uuid, p_cutoff_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Advisory review_items (stock-in-transit, historical-excluded) are NOT
  -- blockers and must not prevent posting. Reject ONLY on real blockers.
  if v_preview->>'readiness' = 'Blocked' then
    raise exception 'inventory_cutoff_not_ready: %', coalesce((v_preview->'blockers')::text, '[]');
  end if;
  v_hash := public.inventory_cutoff_snapshot_hash(v_cutoff.id);
  update public.stock_count_verification_requests
    set snapshot_hash = v_hash where id = p_request_id and status = 'pending_delivery';
  return v_hash;
end;
$function$;

-- ---- source (verbatim): supabase/migrations/20260801220000_fix_inventory_cutoff_allocation_resolver_frozen_release.sql

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

    -- Scoped, transaction-local freeze exemption. This warehouse is frozen
    -- by its OWN active opening-balance cutoff; only authorized cutoff
    -- operations may mutate it. Register the exact posting context that
    -- inventory_cutoff_assert_not_frozen honours: (cutoff_id, this backend_pid,
    -- this txid, this HQ-admin user). It is created immediately before and
    -- deleted immediately after the two frozen writes below, so no general or
    -- persistent bypass exists -- a leftover row can never match a future txid,
    -- and ordinary order/inventory/manual writes stay blocked.
    insert into public.inventory_cutoff_posting_context(
      backend_pid, transaction_id, cutoff_id, created_by
    ) values (pg_backend_pid(), txid_current(), p_cutoff_id, v_user)
    on conflict (backend_pid, transaction_id, cutoff_id) do nothing;

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
    -- Close the freeze exemption the instant the frozen writes are done.
    delete from public.inventory_cutoff_posting_context
    where backend_pid = pg_backend_pid() and transaction_id = txid_current()
      and cutoff_id = p_cutoff_id and created_by = v_user;
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
  'Opening Balance allocation reconciliation resolver (freeze-aware). exclude_and_release registers a transaction-scoped inventory_cutoff_posting_context around its two frozen writes so this exact backend+txid+HQ-admin may decrement quantity_allocated while the cutoff freezes the warehouse; the context is removed before commit and ordinary order/inventory/manual writes stay blocked. HQ-admin only; exact cutoff/warehouse/variant/config; locks and revalidates; rejects stale quantities; refuses release while a submitted owner exists; decreases quantity_allocated only by the verified residual; never touches quantity_on_hand/average_cost; one audited deallocation movement; idempotent; never affects physical counts, imported rows, QR data or another warehouse.';

-- ---- source (verbatim): supabase/migrations/20260801210000_fix_d2h_cancel_null_config_movement_variant_default.sql

CREATE OR REPLACE FUNCTION public.release_allocation_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_item    record;
  v_org     uuid;
  v_alloc   int;
  v_cost    numeric;
  v_wh_on   int;
  v_buyer_on int;
  v_cfgs    uuid[];
  v_cfg     uuid;
  v_has_alloc boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found: %',p_order_id; END IF;
  IF v_order.order_type NOT IN ('D2H','S2D') THEN RETURN; END IF;
  v_org:=public.order_inventory_organization(p_order_id);

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id LOOP
    -- Distinct EXPLICIT configurations recorded on the allocation ledger for
    -- THIS order + variant (config-aware modern allocations).
    SELECT array_agg(DISTINCT sm.stock_config_id)
      INTO v_cfgs
    FROM public.stock_movements sm
    WHERE sm.reference_type='order'
      AND sm.reference_id=p_order_id
      AND sm.variant_id=v_item.variant_id
      AND sm.movement_type='allocation'
      AND sm.stock_config_id IS NOT NULL;

    -- Was this item allocated at all (including legacy null-config movements)?
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_type='order'
        AND sm.reference_id=p_order_id
        AND sm.variant_id=v_item.variant_id
        AND sm.movement_type='allocation'
    ) INTO v_has_alloc;

    IF v_cfgs IS NOT NULL AND array_length(v_cfgs,1) > 1 THEN
      RAISE EXCEPTION
        'Ambiguous allocation for order % variant %: % distinct stock configurations; refusing to release',
        v_order.order_no, v_item.variant_id, array_length(v_cfgs,1);
    ELSIF v_cfgs IS NOT NULL AND array_length(v_cfgs,1) = 1 THEN
      v_cfg := v_cfgs[1];
    ELSIF v_has_alloc THEN
      -- Legacy allocation whose movement did not record a configuration. The
      -- reservation was placed on the variant's default sink (is_variant_default),
      -- so reverse against that exact configuration.
      v_cfg := COALESCE(v_item.stock_config_id, public.resolve_default_stock_config(v_item.variant_id));
      IF v_cfg IS NULL THEN
        RAISE EXCEPTION
          'Cannot resolve stock configuration to release for order % variant % (legacy null-config allocation and no variant default)',
          v_order.order_no, v_item.variant_id;
      END IF;
    ELSE
      -- Never allocated. Nothing to release unless a confirmed config exists.
      IF v_item.stock_config_id IS NULL THEN CONTINUE; END IF;
      v_cfg := v_item.stock_config_id;
    END IF;

    -- Idempotent / double-click safe: this exact configuration is already released.
    IF EXISTS (SELECT 1 FROM public.stock_movements
      WHERE reference_type='order' AND reference_id=p_order_id
        AND variant_id=v_item.variant_id AND stock_config_id=v_cfg
        AND movement_type='deallocation') THEN CONTINUE; END IF;

    -- Fulfilled-order cancellation: approval already shipped the exact config out
    -- of the warehouse into the buyer (quantity_allocated was cleared then).
    -- Reverse the buyer credit and restore the warehouse on-hand.
    IF EXISTS (SELECT 1 FROM public.stock_movements
      WHERE reference_type='order' AND reference_id=p_order_id
        AND variant_id=v_item.variant_id AND stock_config_id=v_cfg
        AND movement_type='order_fulfillment') THEN
      IF EXISTS (SELECT 1 FROM public.stock_movements
        WHERE reference_type='order_cancel_reversal' AND reference_id=p_order_id
          AND variant_id=v_item.variant_id AND stock_config_id=v_cfg) THEN CONTINUE; END IF;
      SELECT quantity_on_hand,COALESCE(average_cost,0) INTO v_wh_on,v_cost FROM public.product_inventory
        WHERE organization_id=v_org AND variant_id=v_item.variant_id AND stock_config_id=v_cfg FOR UPDATE;
      SELECT quantity_on_hand INTO v_buyer_on FROM public.product_inventory
        WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id AND stock_config_id=v_cfg FOR UPDATE;
      IF v_buyer_on IS NULL OR v_buyer_on<v_item.qty THEN
        RAISE EXCEPTION 'Buyer no longer has exact configuration stock required to cancel item %',v_item.id; END IF;
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand-v_item.qty,updated_at=now()
        WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id AND stock_config_id=v_cfg;
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand+v_item.qty,updated_at=now()
        WHERE organization_id=v_org AND variant_id=v_item.variant_id AND stock_config_id=v_cfg;
      INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
        from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
      VALUES('transfer_out','order_cancel_reversal',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,
        v_order.buyer_org_id,v_org,-v_item.qty,v_buyer_on,v_buyer_on-v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),'Buyer credit reversed on cancellation'),
       ('order_cancelled','order_cancel_reversal',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,
        v_order.buyer_org_id,v_org,v_item.qty,v_wh_on,v_wh_on+v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),'Exact configuration restored on cancellation');
      CONTINUE;
    END IF;

    -- Plain-allocation path: release EXACTLY qty from quantity_allocated at the
    -- warehouse for the resolved configuration. quantity_on_hand is untouched.
    SELECT quantity_allocated,COALESCE(average_cost,0) INTO v_alloc,v_cost FROM public.product_inventory
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_cfg FOR UPDATE;
    IF NOT FOUND OR v_alloc < v_item.qty THEN
      RAISE EXCEPTION 'Cannot safely release item % configuration allocation',v_item.id; END IF;
    UPDATE public.product_inventory SET quantity_allocated=quantity_allocated-v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_cfg;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
    VALUES('deallocation','order',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,
      v_order.buyer_org_id,v_org,-v_item.qty,v_item.qty,0,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),
      CASE WHEN v_order.status='cancelled' THEN 'Order cancelled' ELSE 'Allocation released' END);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.release_allocation_for_order(uuid) IS
  'Releases D2H/S2D order allocation. Resolves the configuration from the allocation ledger; when the ledger carries no explicit configuration (legacy null-config movement) it falls back to the variant default sink (resolve_default_stock_config / is_variant_default), which is where such allocations were placed. Unambiguous match required (fails closed on multiple configs or an under-covered reservation); releases exactly qty from quantity_allocated without touching quantity_on_hand; emits exactly one deallocation movement per item; idempotent; preserves the fulfilled-order reversal path; never mutates the order item, physical counts or QR data.';

NOTIFY pgrst, 'reload schema';


-- ===========================================================================
-- LEAST-PRIVILEGE HARDENING -- final client-role grants for the Stock Count V2
-- / Inventory Opening Balance surface
-- ---------------------------------------------------------------------------
-- TARGET STATE (enforced by 08_post_deployment_verification.sql):
--   PUBLIC          no EXECUTE on anything in this surface
--   anon            no EXECUTE on anything in this surface
--   authenticated   EXECUTE on APPLICATION ENTRY POINTS only
--   service_role    EXECUTE on APPLICATION ENTRY POINTS only
--   *_pre_* layers  no direct client execution
--   trigger fns     no direct client execution
--   helpers/guards  no direct client execution
--
-- WHY THIS IS NEEDED
--   Supabase's platform bootstrap grants EXECUTE on public functions to
--   anon/authenticated/service_role. The historical migrations revoked PUBLIC
--   only from the *renamed legacy copies*, never from the newly created
--   function, so anon inherited EXECUTE on the whole surface -- including the
--   Opening Balance posting entry point. The grant is explicit in
--   pg_proc.proacl (anon=X), so "REVOKE ... FROM PUBLIC" alone does NOT remove
--   it: anon must be named.
--
-- NOT CURRENTLY EXPLOITABLE, STILL WORTH CLOSING
--   Every function here is SECURITY DEFINER and gates on auth.uid() (directly,
--   or via can_access_org / inventory_cutoff_is_hq_admin /
--   stock_count_user_can_post). For an anonymous caller auth.uid() is NULL, so
--   each raises rather than returning data. This is defence in depth: that
--   internal check is otherwise the ONLY barrier in front of posting.
--
-- ENTRY POINTS WERE DERIVED FROM THE APPLICATION SOURCE, NOT GUESSED
--   Every name in v_entry_points below is reached by an actual client call:
--   a literal .rpc('<name>') or a route variable resolved to a literal. Two
--   were nearly misclassified and are called out because getting them wrong
--   would break the workflow:
--     * verify_and_post_inventory_opening_cutoff -- selected dynamically in
--       app/src/app/api/inventory/stock-count/verification/verify/route.ts
--       ("postingFunction"), so it never appears as a literal .rpc() argument.
--     * archive_product_variant -- called through the ARCHIVE_PRODUCT_VARIANT_RPC
--       constant in app/src/lib/products/variant-deletion.ts.
--
-- FUNCTIONS DELIBERATELY LEFT WITH NO CLIENT GRANT
--   The posting chain is
--     verify_and_post_inventory_opening_cutoff              <- entry point
--       -> ..._pre_transactions_polic                       <- internal
--            -> ..._scoped_legacy                           <- internal, terminal
--   Only the first is called by a client; the lower two are invoked from inside
--   a SECURITY DEFINER function and therefore run as its owner. The same is true
--   of the seven inventory_cutoff_preview_* delegation layers and of
--   archive_stock_count_draft (reached only via discard_stock_count_drafts).
--
-- VERIFIED SAFE BEFORE WRITING THIS
--   * No RLS policy references any of these helpers. RLS predicates are
--     evaluated with the CALLER's privileges, so a helper used in a policy would
--     still need EXECUTE -- none is.
--   * No column default references them.
--   * service_role holds its own explicit grant, so revoking anon cannot
--     disturb it; it is re-granted explicitly below regardless.
--   * Trigger functions need no grant at all: triggers execute as the table
--     owner, not as the connected role.
--
-- REVERSIBLE?  Yes -- see ROLLBACK_AND_RECOVERY.md section 3.
-- IDENTITY  :  must be run as the function OWNER (supabase_admin). REVOKE/GRANT
--              on someone else's function requires ownership; running as
--              `postgres` fails with "must be owner of function ...".
-- ===========================================================================

DO $harden$
DECLARE
  r record;
  -- APPLICATION ENTRY POINTS: reached by a real client call. These keep
  -- EXECUTE for authenticated and service_role. Everything else in the surface
  -- loses all client execution.
  v_entry_points text[] := ARRAY[
    -- Opening Balance workflow
    'inventory_cutoff_preview',
    'start_inventory_opening_cutoff',
    'cancel_inventory_opening_cutoff',
    'set_inventory_cutoff_decision',
    'bind_inventory_cutoff_verification_snapshot',
    'verify_and_post_inventory_opening_cutoff',
    'release_allocation_for_order',
    'resolve_inventory_cutoff_allocation',
    'resolve_inventory_cutoff_d2h_carry_forward',
    'resolve_inventory_cutoff_h2m_incoming',
    -- policy preflight / apply pairs (called via a route variable)
    'inventory_cutoff_d2h_policy_preflight',
    'inventory_cutoff_h2m_policy_preflight',
    'inventory_cutoff_transactions_policy_preflight',
    'inventory_cutoff_h2m_bulk_preflight',
    'apply_inventory_cutoff_d2h_policy',
    'apply_inventory_cutoff_h2m_policy',
    'apply_inventory_cutoff_transactions_policy',
    'apply_inventory_cutoff_h2m_bulk',
    -- Stock Count V2 verification / discard boundary
    'prepare_stock_count_verification',
    'discard_stock_count_drafts',
    'finalize_stock_count_verification_delivery',
    -- Master Data
    'archive_product_variant'
  ];
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           p.oid::regprocedure::text AS sig,
           p.prorettype = 'pg_catalog.trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
            p.proname ~ ('(inventory_cutoff|opening_cutoff|archive_stock_count_draft'
                        '|archive_product_variant|release_allocation_for_order'
                        '|enforce_stock_count_reference|stock_count_discard_posting'
                        '|assert_h2m_receipt_allowed_after_cutoff'
                        '|trg_warehouse_receipt_h2m_excluded_guard)')
            -- Stock Count V2 verification / discard boundary: same security
            -- boundary as the cut-off itself, so it must not be left behind.
            OR p.proname IN ('prepare_stock_count_verification',
                             'discard_stock_count_drafts',
                             'finalize_stock_count_verification_delivery')
          )
  LOOP
    -- Step 1: strip ALL client execution, unconditionally.
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      r.sig);

    -- Step 2: hand back EXECUTE to the two roles the application actually uses,
    -- and only for genuine entry points. Trigger functions never qualify.
    IF NOT r.is_trigger AND r.proname = ANY (v_entry_points) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END IF;
  END LOOP;
END
$harden$;

NOTIFY pgrst, 'reload schema';

COMMIT;
