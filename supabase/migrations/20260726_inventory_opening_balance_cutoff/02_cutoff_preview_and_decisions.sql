begin;

-- Read-only report and server-validated decision controls.

create or replace function public.set_inventory_cutoff_decision(
  p_cutoff_id uuid, p_order_item_id uuid, p_decision text
) returns public.inventory_cutoff_decisions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_config uuid;
  v_kind text;
  v_saved public.inventory_cutoff_decisions%rowtype;
  v_received integer;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  select * into v_cutoff from public.inventory_opening_cutoffs where id=p_cutoff_id for update;
  if not found or v_cutoff.status <> 'counting' then raise exception 'inventory_cutoff_not_active'; end if;
  select * into v_item from public.order_items where id=p_order_item_id;
  select * into v_order from public.orders where id=v_item.order_id;

  if v_order.order_type in ('D2H','S2D') then
    v_kind := 'distributor';
    if v_order.status <> 'submitted' or p_decision not in ('carry_forward','cancel_release') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    if public.order_inventory_organization(v_order.id) <> v_cutoff.warehouse_organization_id then
      raise exception 'organization_mismatch';
    end if;
    if not exists (
      select 1 from public.stock_movements sm
      where sm.reference_id=v_order.id and sm.variant_id=v_item.variant_id
        and sm.movement_type='allocation'
    ) or exists (
      select 1 from public.stock_movements sm
      where sm.reference_id=v_order.id and sm.variant_id=v_item.variant_id
        and sm.movement_type in ('deallocation','order_fulfillment')
    ) then raise exception 'inventory_cutoff_allocation_not_active'; end if;
    if p_decision='carry_forward' then
      select c.id into v_config from public.inventory_stock_configurations c
      where c.variant_id=v_item.variant_id and c.volume_ml=20 and c.packaging='new_box'
        and c.status='active' and c.allow_so
        and exists(select 1 from public.product_inventory pi
          where pi.organization_id=v_cutoff.warehouse_organization_id
            and pi.variant_id=v_item.variant_id and pi.stock_config_id=c.id and pi.is_active)
      order by c.sort_order,c.id limit 1;
      if v_config is null then raise exception 'inventory_cutoff_20ml_new_box_missing'; end if;
    else
      v_config := v_item.stock_config_id;
    end if;
  elsif v_order.order_type='H2M' then
    v_kind := 'manufacturer';
    if p_decision <> 'carry_forward_incoming'
       or v_order.status not in ('approved','closed') then
      raise exception 'inventory_cutoff_manufacturer_not_eligible';
    end if;
    if public.resolve_order_destination_warehouse(v_order.buyer_org_id)
       <> v_cutoff.warehouse_organization_id then raise exception 'organization_mismatch'; end if;
    select coalesce(sum(received_now),0)::integer into v_received
      from public.warehouse_receipt_items
      where order_id=v_order.id and variant_id=v_item.variant_id;
    if v_item.qty-v_received <= 0 then raise exception 'inventory_cutoff_no_outstanding_incoming'; end if;
    v_config := v_item.stock_config_id;
    if not exists(select 1 from public.inventory_stock_configurations c
      where c.id=v_config and c.variant_id=v_item.variant_id and c.status='active' and c.allow_ord)
    then raise exception 'inventory_cutoff_manufacturer_config_missing'; end if;
  else
    raise exception 'inventory_cutoff_order_type_not_supported';
  end if;

  insert into public.inventory_cutoff_decisions(
    cutoff_id,transaction_kind,order_id,order_item_id,decision,stock_config_id,quantity,decided_by
  ) values (
    v_cutoff.id,v_kind,v_order.id,v_item.id,p_decision,v_config,
    case when v_kind='manufacturer' then v_item.qty-v_received else v_item.qty end,v_user
  )
  on conflict(cutoff_id,transaction_kind,order_item_id) do update set
    decision=excluded.decision,stock_config_id=excluded.stock_config_id,
    quantity=excluded.quantity,decided_by=excluded.decided_by,
    decided_at=now(),updated_at=now()
  returning * into v_saved;

  insert into public.inventory_cutoff_audit_events(
    cutoff_id,event_type,actor_id,order_id,order_item_id,details
  ) values (
    v_cutoff.id,'decision_recorded',v_user,v_order.id,v_item.id,
    jsonb_build_object('kind',v_kind,'decision',p_decision,
      'quantity',v_saved.quantity,'stock_config_id',v_config)
  );
  return v_saved;
end;
$$;

create or replace function public.inventory_cutoff_preview(p_cutoff_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_inventory jsonb; v_distributor jsonb; v_manufacturer jsonb;
  v_activity jsonb; v_drafts jsonb; v_blockers jsonb; v_review jsonb;
  v_readiness text;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id=p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id',i.variant_id,'variant_name',pv.variant_name,
    'stock_config_id',i.stock_config_id,'stock_configuration',c.config_label,
    'config_code',c.config_code,'system_quantity',i.system_quantity,
    'physical_quantity',i.physical_quantity,
    'variance',case when i.physical_quantity is null then null
      else i.physical_quantity-i.system_quantity end,
    'allocated_quantity',coalesce(pi.quantity_allocated,0)
  ) order by pv.variant_name,c.sort_order),'[]'::jsonb) into v_inventory
  from public.stock_count_session_items i
  join public.inventory_stock_configurations c on c.id=i.stock_config_id and c.variant_id=i.variant_id
  join public.product_variants pv on pv.id=i.variant_id
  left join public.product_inventory pi on pi.organization_id=v_cutoff.warehouse_organization_id
    and pi.variant_id=i.variant_id and pi.stock_config_id=i.stock_config_id and pi.is_active
  where i.session_id=v_cutoff.stock_count_session_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',o.id,'order_item_id',oi.id,'order_number',coalesce(o.display_doc_no,o.order_no),
    'status',o.status,'customer',buyer.org_name,'warehouse',wh.org_name,
    'variant_id',oi.variant_id,'variant',pv.variant_name,'quantity',oi.qty,
    'current_stock_config_id',oi.stock_config_id,
    'decision',d.decision,'carry_stock_config_id',d.stock_config_id,
    'classification',case
      when o.status='submitted' and d.decision='carry_forward' then 'Carry Forward'
      when o.status='submitted' and d.decision='cancel_release' then 'Cancel & Release'
      when o.status='submitted' then 'Blocked'
      when o.status in ('approved','warehouse_packed','shipped_distributor') then 'Stock in Transit'
      when o.status in ('closed','cancelled') then 'History Only'
      else 'Complete Before Cut-off' end,
    'available_actions',case when o.status='submitted'
      then jsonb_build_array('Carry Forward','Cancel & Release') else '[]'::jsonb end
  ) order by o.created_at,o.id,oi.id),'[]'::jsonb) into v_distributor
  from public.orders o join public.order_items oi on oi.order_id=o.id
  join public.organizations buyer on buyer.id=o.buyer_org_id
  left join public.organizations wh on wh.id=public.order_inventory_organization(o.id)
  join public.product_variants pv on pv.id=oi.variant_id
  left join public.inventory_cutoff_decisions d on d.cutoff_id=v_cutoff.id
    and d.transaction_kind='distributor' and d.order_item_id=oi.id
  where o.order_type in ('D2H','S2D')
    and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id
    and (o.status <> 'draft' or exists(select 1 from public.stock_movements sm where sm.reference_id=o.id));

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',x.order_id,'order_item_id',x.order_item_id,'order_number',x.order_number,
    'status',x.status,'manufacturer',x.manufacturer,'variant_id',x.variant_id,
    'variant',x.variant,'ordered_quantity',x.ordered_qty,'received_quantity',x.received_qty,
    'remaining_incoming_quantity',x.remaining_qty,
    'stock_config_id',x.stock_config_id,'stock_configuration',x.stock_configuration,
    'decision',x.decision,
    'classification',case when x.stock_config_id is null then 'Blocked'
      when x.decision='carry_forward_incoming' then 'Carry Forward' else 'Blocked' end
  ) order by x.created_at,x.order_id,x.order_item_id),'[]'::jsonb) into v_manufacturer
  from (
    select o.id order_id,oi.id order_item_id,coalesce(o.display_doc_no,o.order_no) order_number,
      o.status,m.org_name manufacturer,oi.variant_id,pv.variant_name variant,oi.qty ordered_qty,
      coalesce(r.received_qty,0) received_qty,
      greatest(oi.qty-coalesce(r.received_qty,0),0) remaining_qty,
      oi.stock_config_id,c.config_label stock_configuration,d.decision,o.created_at
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.organizations m on m.id=o.seller_org_id
    join public.product_variants pv on pv.id=oi.variant_id
    left join public.inventory_stock_configurations c on c.id=oi.stock_config_id and c.variant_id=oi.variant_id
    left join (select order_id,variant_id,sum(received_now)::integer received_qty
      from public.warehouse_receipt_items group by order_id,variant_id) r
      on r.order_id=o.id and r.variant_id=oi.variant_id
    left join public.inventory_cutoff_decisions d on d.cutoff_id=v_cutoff.id
      and d.transaction_kind='manufacturer' and d.order_item_id=oi.id
    where o.order_type='H2M' and o.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id
  ) x where x.remaining_qty>0;

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_type',a.movement_type,'reference_type',a.reference_type,
    'reference_no',a.reference_no,'status',a.status,'quantity',a.quantity,
    'occurred_at',a.occurred_at,'classification',a.classification
  ) order by a.occurred_at desc),'[]'::jsonb) into v_activity
  from (
    select sm.movement_type,sm.reference_type,sm.reference_no,null::text status,
      sm.quantity_change quantity,sm.created_at occurred_at,'History Only'::text classification
    from public.stock_movements sm where
      (sm.from_organization_id=v_cutoff.warehouse_organization_id
        or sm.to_organization_id=v_cutoff.warehouse_organization_id)
      and sm.movement_type in ('transfer_out','transfer_in','repack_out','repack_in','adjustment','addition')
      and sm.created_at >= v_cutoff.started_at - interval '30 days'
    union all
    select 'stock_transfer', 'transfer',t.transfer_no,t.status,t.total_items,t.created_at,
      case when t.status='in_transit' then 'Stock in Transit'
        else 'Complete Before Cut-off' end
    from public.stock_transfers t
    where (t.from_organization_id=v_cutoff.warehouse_organization_id
      or t.to_organization_id=v_cutoff.warehouse_organization_id)
      and t.status in ('pending','pending_approval','ready_to_dispatch','in_transit')
    union all
    select 'return','return',r.return_no,r.status,0,r.created_at,'Complete Before Cut-off'
    from public.return_cases r where r.return_warehouse_id=v_cutoff.warehouse_organization_id
      and r.status in ('return_submitted','return_received','return_processing')
    union all
    select 'stock_adjustment','adjustment',a.id::text,a.status,0,a.created_at,'Complete Before Cut-off'
    from public.stock_adjustments a where a.organization_id=v_cutoff.warehouse_organization_id
      and coalesce(a.status,'completed')<>'completed'
  ) a;

  select coalesce(jsonb_agg(jsonb_build_object(
    'session_id',id,'count_type',count_type,'reference_name',reference_name,
    'created_at',created_at,'classification',
      case when id=v_cutoff.stock_count_session_id then 'Carry Forward' else 'Blocked' end
  ) order by created_at),'[]'::jsonb) into v_drafts
  from public.stock_count_sessions
  where warehouse_organization_id=v_cutoff.warehouse_organization_id and status='draft';

  select coalesce(jsonb_agg(message),'[]'::jsonb) into v_blockers from (
    select format('Physical count is missing for %s (%s).',pv.variant_name,c.config_label) message
    from public.stock_count_session_items i
    join public.product_variants pv on pv.id=i.variant_id
    join public.inventory_stock_configurations c on c.id=i.stock_config_id
    where i.session_id=v_cutoff.stock_count_session_id and i.physical_quantity is null
    union all
    select format('Distributor order %s / %s requires a carry-forward or cancel-and-release decision.',
      coalesce(o.display_doc_no,o.order_no),pv.variant_name)
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    where o.order_type in ('D2H','S2D') and o.status='submitted'
      and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id
      and exists(select 1 from public.stock_movements sm where sm.reference_id=o.id
        and sm.variant_id=oi.variant_id and sm.movement_type='allocation')
      and not exists(select 1 from public.inventory_cutoff_decisions d
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor' and d.order_item_id=oi.id)
    union all
    select format('Manufacturer order %s / %s requires an incoming decision and valid selected configuration.',
      coalesce(o.display_doc_no,o.order_no),pv.variant_name)
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    left join (select order_id,variant_id,sum(received_now)::integer qty from public.warehouse_receipt_items
      group by order_id,variant_id) r on r.order_id=o.id and r.variant_id=oi.variant_id
    where o.order_type='H2M' and o.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id
      and greatest(oi.qty-coalesce(r.qty,0),0)>0
      and (oi.stock_config_id is null or not exists(select 1 from public.inventory_cutoff_decisions d
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
          and d.order_item_id=oi.id and d.decision='carry_forward_incoming'))
    union all
    select format('Carried allocation exceeds physical opening quantity for %s (%s): physical %s, carried %s.',
      pv.variant_name,c.config_label,i.physical_quantity,sum(d.quantity))
    from public.inventory_cutoff_decisions d
    join public.inventory_stock_configurations c on c.id=d.stock_config_id
    join public.product_variants pv on pv.id=c.variant_id
    join public.stock_count_session_items i on i.session_id=v_cutoff.stock_count_session_id
      and i.stock_config_id=d.stock_config_id and i.variant_id=c.variant_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and d.decision='carry_forward'
    group by pv.variant_name,c.config_label,i.physical_quantity
    having sum(d.quantity)>i.physical_quantity
    union all
    select format('Distributor order %s has mixed carry-forward and cancel decisions. Choose one lifecycle action for every line on the order.',
      coalesce(o.display_doc_no,o.order_no))
    from public.inventory_cutoff_decisions d join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
    group by o.id,o.display_doc_no,o.order_no having count(distinct d.decision)>1
    union all
    select format('Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
      pv.variant_name,c.config_label,pi.quantity_allocated,coalesce(sum(d.quantity),0))
    from public.product_inventory pi
    join public.inventory_stock_configurations c on c.id=pi.stock_config_id and c.variant_id=pi.variant_id
    join public.product_variants pv on pv.id=pi.variant_id
    left join public.inventory_cutoff_decisions d on d.cutoff_id=v_cutoff.id
      and d.transaction_kind='distributor'
      and exists(select 1 from public.order_items oi where oi.id=d.order_item_id
        and oi.variant_id=pi.variant_id and oi.stock_config_id=pi.stock_config_id)
    where pi.organization_id=v_cutoff.warehouse_organization_id and pi.quantity_allocated>0
    group by pv.variant_name,c.config_label,pi.quantity_allocated
    having pi.quantity_allocated<>coalesce(sum(d.quantity),0)
    union all
    select format('Transfer %s is %s and must be completed or cancelled before cut-off.',t.transfer_no,t.status)
    from public.stock_transfers t where
      (t.from_organization_id=v_cutoff.warehouse_organization_id
        or t.to_organization_id=v_cutoff.warehouse_organization_id)
      and t.status in ('pending','pending_approval','ready_to_dispatch')
    union all
    select format('Return %s is %s and must be completed or cancelled before cut-off.',r.return_no,r.status)
    from public.return_cases r where r.return_warehouse_id=v_cutoff.warehouse_organization_id
      and r.status in ('return_submitted','return_received','return_processing')
    union all
    select format('Stock adjustment %s is %s and must be completed before cut-off.',a.id,a.status)
    from public.stock_adjustments a where a.organization_id=v_cutoff.warehouse_organization_id
      and coalesce(a.status,'completed')<>'completed'
  ) b;

  select coalesce(jsonb_agg(message),'[]'::jsonb) into v_review from (
    select 'Review stock-in-transit distributor transactions; they are not cancellable by cut-off.' message
    where exists(select 1 from public.orders o where o.order_type in ('D2H','S2D')
      and o.status in ('approved','warehouse_packed','shipped_distributor')
      and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id)
    union all
    select 'Another open Stock Count draft must be completed or archived before cut-off.'
    where exists(select 1 from public.stock_count_sessions s
      where s.warehouse_organization_id=v_cutoff.warehouse_organization_id
        and s.status='draft' and s.id<>v_cutoff.stock_count_session_id)
    union all
    select 'A warehouse transfer is in transit. It remains Stock in Transit and is not included in physical opening stock.'
    where exists(select 1 from public.stock_transfers t where
      (t.from_organization_id=v_cutoff.warehouse_organization_id
        or t.to_organization_id=v_cutoff.warehouse_organization_id)
      and t.status='in_transit')
  ) r;

  v_readiness := case when jsonb_array_length(v_blockers)>0 then 'Blocked'
    when jsonb_array_length(v_review)>0 then 'Review Required' else 'Ready' end;
  return jsonb_build_object(
    'cutoff_id',v_cutoff.id,'status',v_cutoff.status,
    'proposed_cutoff_at',v_cutoff.proposed_cutoff_at,
    'warehouse_organization_id',v_cutoff.warehouse_organization_id,
    'company_id',v_cutoff.company_id,'readiness',v_readiness,
    'inventory',v_inventory,'distributor_orders',v_distributor,
    'manufacturer_incoming',v_manufacturer,'warehouse_activity',v_activity,
    'stock_count_drafts',v_drafts,'blockers',v_blockers,'review_items',v_review,
    'freeze_active',v_cutoff.status='counting',
    'qr_status','Protected — No Impact',
    'notice','Preview only — no inventory, order, allocation, or QR data will be changed.'
  );
end;
$$;

revoke all on function public.set_inventory_cutoff_decision(uuid,uuid,text) from public;
grant execute on function public.set_inventory_cutoff_decision(uuid,uuid,text) to authenticated;
grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Strictly read-only opening cut-off report. It performs no INSERT, UPDATE, DELETE or QR operation.';

commit;
