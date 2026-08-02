begin;

-- ============================================================================
-- Phase 2 gap: explicit "Do Not Carry Forward / Exclude" decision for eligible
-- submitted D2H (and S2D) distributor orders at an Inventory Opening Balance
-- cut-off.
--
-- Forward-only, idempotent and non-destructive. Migrations 01–04 in this folder
-- are NOT edited (they may already be applied); this file re-declares the three
-- affected functions with CREATE OR REPLACE and widens one CHECK constraint.
--
-- Canonical database value: 'do_not_carry_forward'  (used verbatim in SQL,
-- TypeScript and the UI). Displayed as "Do Not Carry Forward".
--
-- Semantics of an explicit exclude on a submitted distributor order:
--   * It is a SAVED, AUDITED, RESOLVED decision — never treated as "undecided".
--   * It reserves / allocates / deducts / releases NOTHING.
--   * The original order keeps its status, quantity and history (not cancelled,
--     not deleted). Its lifecycle is completed or cancelled separately, later.
--   * The pre-cut-off reservation is simply not rebuilt into the new physical
--     opening baseline (the physical count is authoritative). No deallocation
--     movement is written and release_allocation_for_order is NOT called, so no
--     allocation is "released" by this decision.
--   * Posting writes exactly ONE immutable audit event per excluded order and,
--     being part of the single atomic/idempotent post, cannot be duplicated.
--   * Zero QR-table impact (this function references no QR tables).
--
-- Stale-posting protection is unchanged: an exclude decision is transaction_kind
-- 'distributor', so the existing status/quantity revalidation under row locks in
-- verify_and_post_inventory_opening_cutoff blocks a stale post automatically.
-- ============================================================================

-- 1) Widen the decision domain. Idempotent: drop-then-add the named constraint.
--    Existing rows already hold values inside the new superset, so ADD validates
--    without touching data.
alter table public.inventory_cutoff_decisions
  drop constraint if exists inventory_cutoff_decisions_decision_check;
alter table public.inventory_cutoff_decisions
  add constraint inventory_cutoff_decisions_decision_check
  check (decision in (
    'carry_forward', 'cancel_release', 'carry_forward_incoming', 'history_only',
    'do_not_carry_forward'
  ));

-- 2) Decision RPC — accept the explicit exclude for submitted distributor orders.
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
    if v_order.status <> 'submitted'
       or p_decision not in ('carry_forward','cancel_release','do_not_carry_forward') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    if public.order_inventory_organization(v_order.id) <> v_cutoff.warehouse_organization_id then
      raise exception 'organization_mismatch';
    end if;
    -- Carry Forward and Cancel & Release both act on a live allocation and so
    -- require one. Do Not Carry Forward touches no inventory, so it neither
    -- requires nor manipulates an allocation.
    if p_decision in ('carry_forward','cancel_release') then
      if not exists (
        select 1 from public.stock_movements sm
        where sm.reference_id=v_order.id and sm.variant_id=v_item.variant_id
          and sm.movement_type='allocation'
      ) or exists (
        select 1 from public.stock_movements sm
        where sm.reference_id=v_order.id and sm.variant_id=v_item.variant_id
          and sm.movement_type in ('deallocation','order_fulfillment')
      ) then raise exception 'inventory_cutoff_allocation_not_active'; end if;
    end if;
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
    if p_decision not in ('carry_forward_incoming','history_only')
       or v_order.status not in ('approved','closed') then
      raise exception 'inventory_cutoff_manufacturer_not_eligible';
    end if;
    if public.resolve_order_destination_warehouse(v_order.buyer_org_id)
       <> v_cutoff.warehouse_organization_id then raise exception 'organization_mismatch'; end if;
    select coalesce(sum(received_now),0)::integer into v_received
      from public.warehouse_receipt_items
      where order_id=v_order.id and variant_id=v_item.variant_id;
    if v_item.qty-v_received <= 0 then raise exception 'inventory_cutoff_no_outstanding_incoming'; end if;
    if (select count(*) from public.order_items oi where oi.order_id=v_order.id
      and oi.variant_id=v_item.variant_id) <> 1 then
      raise exception 'inventory_cutoff_manufacturer_variant_lines_conflicting';
    end if;
    v_config := v_item.stock_config_id;
    if p_decision='carry_forward_incoming' and not exists(select 1 from public.inventory_stock_configurations c
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

  -- A verification code approves an exact reviewed decision set. Changing any
  -- decision invalidates pending/active codes so a fresh review and OTP are
  -- required; direct table writes are not granted to authenticated users.
  update public.stock_count_verification_requests vr
  set status='invalidated',invalidated_at=now(),
    request_metadata=coalesce(request_metadata,'{}'::jsonb)
      || jsonb_build_object('invalidated_reason','inventory_cutoff_decision_changed')
  where vr.session_id=v_cutoff.stock_count_session_id
    and vr.status in ('pending_delivery','active');

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

-- 3) Preview — classify an explicit exclude as "Do Not Carry Forward", offer it
--    as an available action, and word the undecided blocker to include it. The
--    "resolved" test is unchanged (any recorded decision clears the blocker), so
--    an explicit exclude removes the order from the unresolved list.
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
      when o.status='submitted' and d.decision='do_not_carry_forward' then 'Do Not Carry Forward'
      when o.status='submitted' then 'Blocked'
      when o.status in ('approved','warehouse_packed') then 'Complete Before Cut-off'
      when o.status='shipped_distributor' then 'Stock in Transit'
      when o.status in ('closed','cancelled') then 'History Only'
      else 'Complete Before Cut-off' end,
    'available_actions',case when o.status='submitted'
      then jsonb_build_array('Carry Forward','Cancel & Release','Do Not Carry Forward') else '[]'::jsonb end
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
    'classification',case when x.decision='history_only' then 'History Only'
      when x.stock_config_id is null then 'Blocked'
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
    select format('Distributor order %s / %s requires a carry-forward, cancel-and-release, or do-not-carry-forward decision.',
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
      and not exists(select 1 from public.inventory_cutoff_decisions d
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
          and d.order_item_id=oi.id and (
            d.decision='history_only' or
            (d.decision='carry_forward_incoming' and oi.stock_config_id is not null)
          ))
    union all
    select format('Manufacturer order %s / %s has duplicate variant lines; outstanding quantity and configuration are ambiguous.',
      coalesce(o.display_doc_no,o.order_no),pv.variant_name)
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    where o.order_type='H2M' and o.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id
    group by o.id,o.display_doc_no,o.order_no,pv.id,pv.variant_name
    having count(*)>1
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
    union all
    select format('Distributor order %s is %s. Approval already posted order_fulfillment, but physical shipment is not confirmed; complete or safely reverse it before restarting cut-off.',
      coalesce(o.display_doc_no,o.order_no),o.status)
    from public.orders o where o.order_type in ('D2H','S2D')
      and o.status in ('approved','warehouse_packed')
      and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id
  ) b;

  select coalesce(jsonb_agg(message),'[]'::jsonb) into v_review from (
    select 'Review stock-in-transit distributor transactions; they are not cancellable by cut-off.' message
    where exists(select 1 from public.orders o where o.order_type in ('D2H','S2D')
      and o.status='shipped_distributor'
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

-- 4) Atomic posting — record ONE immutable audit event per explicitly excluded
--    distributor order. It performs NO inventory or order mutation: the order is
--    left submitted with its history, and its pre-cut-off reservation is simply
--    not rebuilt into the new physical baseline. Duplication is impossible: the
--    surrounding post flips the session/cut-off to 'posted' exactly once, so a
--    replay short-circuits before reaching this loop.
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
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
    group by d.order_id having count(distinct d.decision)>1
  ) then raise exception 'inventory_cutoff_mixed_manufacturer_order_decisions'; end if;

  -- Decisions contain server-derived quantities, never client quantities. Still
  -- recheck them under the order locks so edits/receipts after selection cannot
  -- turn a once-valid decision into a stale posting input. This covers the
  -- explicit do_not_carry_forward decision too (transaction_kind='distributor').
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

  -- Every live configured reservation at the warehouse must reconcile to an
  -- explicitly selected submitted order item. No unidentified allocation is
  -- reset. An excluded order's allocation is counted here (it is a recorded
  -- distributor decision) but is intentionally never rebuilt below.
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

  insert into public.inventory_cutoff_posting_context(
    backend_pid,transaction_id,cutoff_id,created_by
  ) values(pg_backend_pid(),txid_current(),v_cutoff.id,v_user);

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

  -- Explicit Do Not Carry Forward: leave the order and inventory completely
  -- untouched; write exactly one immutable audit event so the exclusion is
  -- permanently traceable to this Opening Balance session.
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

  -- A dedicated manufacturer History Only choice closes the whole H2M lifecycle
  -- object. Mixed choices on one order are rejected above. Existing receipts and
  -- history remain; cancelled status removes it from incoming views and the
  -- receiving RPC's approved/closed allowlist.
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
    update public.orders set status='cancelled',
      notes=concat_ws(E'\n',nullif(notes,''),
        'Marked History Only during Inventory Opening Balance Cut-off'),
      updated_by=v_user,updated_at=now()
      where id=v_order.id and status in ('approved','closed');
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'manufacturer_order_marked_history_only',v_user,v_order.id,
      jsonb_build_object('previous_status',v_order.status,
        'reason','History Only during Inventory Opening Balance Cut-off',
        'future_receiving_allowed',false));
    v_history_orders:=v_history_orders+1;
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
      'manufacturer_history_only_orders',v_history_orders,
      'excluded_do_not_carry_forward_orders',v_excluded,
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
$$;

-- CREATE OR REPLACE preserves privileges, but re-assert them so this migration
-- is self-contained and safe to run against a database that lacks them.
revoke all on function public.set_inventory_cutoff_decision(uuid,uuid,text) from public;
grant execute on function public.set_inventory_cutoff_decision(uuid,uuid,text) to authenticated;
grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;
revoke all on function public.verify_and_post_inventory_opening_cutoff(uuid,text) from public;
grant execute on function public.verify_and_post_inventory_opening_cutoff(uuid,text) to authenticated;

comment on function public.set_inventory_cutoff_decision(uuid,uuid,text) is
  'Records a cut-off decision. Distributor orders (submitted) accept carry_forward, cancel_release or do_not_carry_forward; the last leaves inventory and the order untouched.';

commit;
