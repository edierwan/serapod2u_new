begin;

-- Atomic OTP-protected posting. The function deliberately contains no QR table
-- references: cut-off decisions affect inventory/order records only.

create or replace function public.verify_and_post_inventory_opening_cutoff(
  p_request_id uuid, p_code_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '300s' set lock_timeout = '30s' as $$
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
  v_old_cfg uuid;
  v_target_alloc integer;
  v_variances integer := 0;
  v_cancelled integer := 0;
  v_carried integer := 0;
  v_incoming integer := 0;
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

  v_current_snapshot := public.stock_count_snapshot_hash(v_session.id);
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

  -- Recompute the report under the same locks. Client readiness is never trusted.
  v_preview := public.inventory_cutoff_preview(v_cutoff.id);
  if v_preview->>'readiness'<>'Ready' then
    raise exception 'inventory_cutoff_not_ready: %',coalesce((v_preview->'blockers')::text,'[]');
  end if;

  -- An order is one lifecycle object: it cannot be partially cancelled.
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
    group by d.order_id having count(distinct d.decision)>1
  ) then raise exception 'inventory_cutoff_mixed_order_decisions'; end if;

  -- Every live configured reservation at the warehouse must reconcile to an
  -- explicitly selected submitted order item. No unidentified allocation is reset.
  if exists (
    select 1 from public.product_inventory pi
    where pi.organization_id=v_cutoff.warehouse_organization_id and pi.quantity_allocated>0
      and pi.quantity_allocated <> coalesce((
        select sum(d.quantity) from public.inventory_cutoff_decisions d
        join public.order_items oi on oi.id=d.order_item_id
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
          and oi.variant_id=pi.variant_id and oi.stock_config_id=pi.stock_config_id
      ),0)
  ) then raise exception 'inventory_cutoff_allocation_owner_unresolved'; end if;

  perform set_config('app.inventory_cutoff_bypass',v_cutoff.id::text,true);

  -- Cancel whole eligible submitted orders and release their allocations through
  -- the established audited deallocation function. History is retained.
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

  -- Physical quantity becomes the official on-hand. Allocations are rebuilt only
  -- from explicit carry-forward decisions after every count row is established.
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

  -- Carry only selected distributor allocations, always into the existing active
  -- 20ml New Box configuration resolved and saved by the decision RPC.
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

  -- Manufacturer carry-forward is intentionally non-posting. The existing order
  -- and item configuration remain the source for later partial receiving.
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
      'qr_impact','none'));

  update public.stock_count_verification_requests set status='posted',verified_by=v_user,
    verified_at=now(),consumed_at=now(),
    code_hash=encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),
    posting_result=jsonb_build_object('status','posted','cutoff_id',v_cutoff.id,
      'cancelled_orders',v_cancelled,'carried_distributor_quantity',v_carried,
      'carried_manufacturer_incoming',v_incoming,'variance_movements',v_variances)
    where id=p_request_id;
  update public.stock_count_verification_requests set status='invalidated',invalidated_at=now()
    where session_id=v_session.id and id<>p_request_id and status in ('pending_delivery','active');
  return jsonb_build_object('status','posted','cutoff_id',v_cutoff.id,
    'session_id',v_session.id,'cancelled_orders',v_cancelled,
    'carried_distributor_quantity',v_carried,
    'carried_manufacturer_incoming',v_incoming,'variance_movements',v_variances,
    'qr_impact','none');
end;
$$;

revoke all on function public.verify_and_post_inventory_opening_cutoff(uuid,text) from public;
grant execute on function public.verify_and_post_inventory_opening_cutoff(uuid,text) to authenticated;

comment on function public.verify_and_post_inventory_opening_cutoff(uuid,text) is
  'HQ-admin-only, OTP-protected, atomic and idempotent opening-balance post. Rechecks readiness under locks, posts physical quantities, carries selected allocations, cancels/releases selected submitted orders, records incoming decisions without receiving them, then removes the warehouse freeze.';

-- Keep the established receipt contract, but make the H2M order-item selection
-- authoritative. Missing or conflicting configurations fail closed instead of
-- falling back to a variant default. received_now remains the sole quantity
-- posted, preserving partial-receipt behaviour.
create or replace function public.post_warehouse_receipt(
  p_batch_id uuid,
  p_order_id uuid,
  p_company_id uuid,
  p_warehouse_org_id uuid,
  p_manufacturer_org_id uuid,
  p_receipt_type text,
  p_received_by uuid,
  p_items jsonb,
  p_idempotency_key text default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.warehouse_receipts%rowtype;
  v_order public.orders%rowtype;
  v_receipt_id uuid;
  v_receipt_no text;
  v_item jsonb;
  v_variant uuid;
  v_product uuid;
  v_received integer;
  v_ordered integer;
  v_previous integer;
  v_cumulative integer;
  v_extra integer;
  v_previous_extra integer;
  v_config uuid;
  v_config_count integer;
  v_unit_cost numeric;
  v_movement uuid;
  v_total_received integer := 0;
  v_total_ordered integer := 0;
  v_order_previous integer := 0;
  v_total_extra_added integer := 0;
  v_items_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or p_received_by is distinct from auth.uid() then
    raise exception 'permission_denied';
  end if;
  if p_receipt_type not in ('full','partial') then raise exception 'invalid_receipt_type'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception 'receipt_items_required'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.order_type<>'H2M' or v_order.status not in ('approved','closed')
     or v_order.company_id<>p_company_id or v_order.seller_org_id<>p_manufacturer_org_id
     or public.resolve_order_destination_warehouse(v_order.buyer_org_id)<>p_warehouse_org_id then
    raise exception 'warehouse_receipt_order_mismatch';
  end if;
  perform public.inventory_cutoff_assert_not_frozen(p_warehouse_org_id);

  if nullif(trim(p_idempotency_key),'') is not null then
    select * into v_existing from public.warehouse_receipts
      where idempotency_key=p_idempotency_key limit 1;
    if found then return jsonb_build_object(
      'receipt_id',v_existing.id,'receipt_no',v_existing.receipt_no,
      'receipt_type',v_existing.receipt_type,'total_received',v_existing.total_received,
      'cumulative_received',v_existing.cumulative_received,
      'extra_received',v_existing.extra_received,'idempotent_replay',true); end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('warehouse-receipt:'||p_batch_id::text,0));
  select coalesce(sum(received_now),0)::integer into v_order_previous
    from public.warehouse_receipt_items where order_id=p_order_id;
  v_receipt_no:=public.next_warehouse_receipt_no(p_batch_id);
  insert into public.warehouse_receipts(
    company_id,order_id,batch_id,receipt_no,receipt_type,posting_status,
    notes,idempotency_key,received_by,received_at
  ) values(
    p_company_id,p_order_id,p_batch_id,v_receipt_no,p_receipt_type,'posted',
    p_notes,nullif(trim(p_idempotency_key),''),p_received_by,now()
  ) returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_variant:=nullif(v_item->>'variant_id','')::uuid;
    v_product:=nullif(v_item->>'product_id','')::uuid;
    v_received:=coalesce((v_item->>'received_now')::integer,0);
    if v_variant is null or v_received<0 then raise exception 'invalid_receipt_item'; end if;

    select min(oi.stock_config_id::text)::uuid,count(distinct oi.stock_config_id)
      into v_config,v_config_count
    from public.order_items oi where oi.order_id=p_order_id and oi.variant_id=v_variant;
    if v_config is null or v_config_count<>1 or not exists(
      select 1 from public.inventory_stock_configurations c
      where c.id=v_config and c.variant_id=v_variant and c.status='active' and c.allow_ord
    ) then raise exception 'warehouse_receipt_order_item_configuration_missing_or_conflicting: variant %',v_variant; end if;

    select coalesce(sum(qty),0)::integer,coalesce(max(unit_price),0)
      into v_ordered,v_unit_cost from public.order_items
      where order_id=p_order_id and variant_id=v_variant;
    if v_ordered<=0 then raise exception 'warehouse_receipt_variant_not_ordered'; end if;
    select coalesce(sum(received_now),0)::integer into v_previous
      from public.warehouse_receipt_items where order_id=p_order_id and variant_id=v_variant;
    v_cumulative:=v_previous+v_received;
    v_extra:=greatest(v_cumulative-v_ordered,0);
    v_previous_extra:=greatest(v_previous-v_ordered,0);
    v_movement:=null;

    if v_received>0 then
      select public.record_stock_movement(
        p_movement_type=>'addition',p_variant_id=>v_variant,
        p_organization_id=>p_warehouse_org_id,p_quantity_change=>v_received,
        p_unit_cost=>v_unit_cost,p_manufacturer_id=>p_manufacturer_org_id,
        p_reason=>'warehouse_receive',
        p_notes=>'Warehouse receipt '||v_receipt_no||' ('||p_receipt_type||')',
        p_reference_type=>'order',p_reference_id=>p_order_id,
        p_reference_no=>v_order.order_no,p_company_id=>p_company_id,
        p_created_by=>p_received_by,p_stock_config_id=>v_config
      ) into v_movement;
    end if;
    insert into public.warehouse_receipt_items(
      receipt_id,company_id,order_id,batch_id,product_id,variant_id,stock_config_id,
      ordered_qty,previously_received,received_now,cumulative_received,
      extra_received,stock_movement_id
    ) values(
      v_receipt_id,p_company_id,p_order_id,p_batch_id,v_product,v_variant,v_config,
      v_ordered,v_previous,v_received,v_cumulative,v_extra,v_movement
    );
    v_total_received:=v_total_received+v_received;
    v_total_ordered:=v_total_ordered+v_ordered;
    v_total_extra_added:=v_total_extra_added+greatest(v_extra-v_previous_extra,0);
    v_items_out:=v_items_out||jsonb_build_object(
      'variant_id',v_variant,'stock_config_id',v_config,'ordered_qty',v_ordered,
      'previously_received',v_previous,'received_now',v_received,
      'cumulative_received',v_cumulative,'extra_received',v_extra,
      'stock_movement_id',v_movement);
  end loop;

  update public.warehouse_receipts set total_received=v_total_received,
    cumulative_received=v_order_previous+v_total_received,ordered_total=v_total_ordered,
    extra_received=v_total_extra_added,updated_at=now() where id=v_receipt_id;
  return jsonb_build_object(
    'receipt_id',v_receipt_id,'receipt_no',v_receipt_no,'receipt_type',p_receipt_type,
    'total_received',v_total_received,
    'cumulative_received',v_order_previous+v_total_received,
    'extra_received',v_total_extra_added,'items',v_items_out,'idempotent_replay',false);
end;
$$;

revoke all on function public.post_warehouse_receipt(
  uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text
) from public;
grant execute on function public.post_warehouse_receipt(
  uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text
) to authenticated;

comment on function public.post_warehouse_receipt(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text) is
  'Posts only received_now for approved/closed H2M orders into the exact active allow_ord stock configuration already selected on the order item. Missing/conflicting configuration blocks receiving; partial outstanding remains incoming.';

commit;
