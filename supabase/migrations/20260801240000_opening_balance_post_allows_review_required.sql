BEGIN;

-- ============================================================================
-- Fix: Opening Balance posting must be blocked ONLY by real blockers, never by
-- advisory review_items.
-- ----------------------------------------------------------------------------
-- Server contract (inventory_cutoff_preview): readiness = 'Blocked' when
-- v_blockers is non-empty; 'Review Required' when there are ZERO blockers but
-- non-blocking advisory review_items exist (stock-in-transit distributor/warehouse
-- transfers, another open Stock Count draft note, historical-excluded transactions);
-- else 'Ready'. v_blockers is the hard-stop set; v_review is advisory.
--
-- Defect: both posting gates required readiness = 'Ready' EXACTLY, so a cut-off
-- with zero blockers but any advisory review item ('Review Required') could never
-- request an OTP or post — the OTP/Post button reached a dead, unexplained
-- disabled state. Verified live on the 5th Initial cut-off 9752dcfe: readiness
-- 'Review Required', blockers [], the sole review item an in-transit warehouse
-- transfer advisory.
--   * bind_inventory_cutoff_verification_snapshot (OTP snapshot bind)
--   * verify_and_post_inventory_opening_cutoff_scoped_legacy (final atomic post,
--     reached via verify_and_post_inventory_opening_cutoff ->
--     ..._pre_transactions_policy -> ..._scoped_legacy)
--
-- Fix: reject posting ONLY when readiness = 'Blocked' (real blockers). 'Ready' and
-- 'Review Required' both post; the advisory review_items are surfaced in the UI
-- for acknowledgement but never block. This matches the server's own
-- blocker/advisory split and the app-layer gate (canExecuteInventoryCutoff), which
-- is relaxed to the same rule. A genuine blocker still raises
-- 'inventory_cutoff_not_ready'.
--
-- Forward-only CREATE OR REPLACE of the two functions, reproduced verbatim from
-- the live definitions with ONLY the readiness gate changed. No other behaviour,
-- signature, SECURITY DEFINER attribute, search_path or grant is altered.
-- ============================================================================

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

  if exists (
    select 1 from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and (o.status<>'submitted' or o.order_type not in ('D2H','S2D')
        or d.quantity<>oi.qty)
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
    if v_order.status<>'submitted' or v_order.order_type not in ('D2H','S2D') then
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

NOTIFY pgrst, 'reload schema';

COMMIT;
