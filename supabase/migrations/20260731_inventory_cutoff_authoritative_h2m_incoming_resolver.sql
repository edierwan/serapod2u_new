begin;

-- ============================================================================
-- Opening Balance H2M Incoming — authoritative configuration resolver
-- ----------------------------------------------------------------------------
-- Forward-only correction for H2M order items that pre-date configuration
-- pinning. The immutable Opening Balance session scope is the warehouse-bound
-- candidate set. Configuration identity comes only from the exact order-item
-- variant UUID; product_inventory, physical quantity and display names are
-- intentionally not eligibility inputs.
-- ============================================================================

create or replace function public.resolve_inventory_cutoff_h2m_incoming(
  p_cutoff_id uuid,
  p_order_item_ids uuid[]
) returns table (
  order_id uuid,
  order_number text,
  order_item_id uuid,
  variant_id uuid,
  variant_name text,
  alternative_name text,
  variant_code text,
  product_code text,
  order_warehouse_organization_id uuid,
  cutoff_warehouse_organization_id uuid,
  session_warehouse_organization_id uuid,
  selected_stock_config_id uuid,
  stock_config_id uuid,
  config_variant_id uuid,
  config_label text,
  config_status text,
  allow_ord boolean,
  in_session_scope boolean,
  eligible boolean,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_item_id uuid;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_selected public.inventory_stock_configurations%rowtype;
  v_config public.inventory_stock_configurations%rowtype;
  v_received integer;
  v_variant_line_count integer;
  v_all_count integer;
  v_active_count integer;
  v_receiving_count integer;
  v_scoped_count integer;
  v_item_product_category_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found then raise exception 'inventory_cutoff_not_found'; end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_cutoff.stock_count_session_id;
  if v_session.id is null
     or v_cutoff.product_category_id is null
     or v_session.product_category_id is distinct from v_cutoff.product_category_id
     or not exists (
       select 1
       from public.product_categories category_row
       where category_row.id = v_cutoff.product_category_id
         and category_row.is_active = true
     ) then
    raise exception 'stock_count_active_product_category_required';
  end if;

  foreach v_item_id in array coalesce(p_order_item_ids, array[]::uuid[])
  loop
    order_id := null;
    order_number := null;
    order_item_id := v_item_id;
    variant_id := null;
    variant_name := null;
    alternative_name := null;
    variant_code := null;
    product_code := null;
    order_warehouse_organization_id := null;
    cutoff_warehouse_organization_id := v_cutoff.warehouse_organization_id;
    session_warehouse_organization_id := v_session.warehouse_organization_id;
    selected_stock_config_id := null;
    stock_config_id := null;
    config_variant_id := null;
    config_label := null;
    config_status := null;
    allow_ord := null;
    in_session_scope := false;
    eligible := false;
    reason_code := null;
    v_item_product_category_id := null;

    select * into v_item from public.order_items where id = v_item_id;
    if not found then
      reason_code := 'inventory_cutoff_order_item_not_found';
      return next;
      continue;
    end if;

    select * into v_order from public.orders where id = v_item.order_id;
    order_id := v_order.id;
    order_number := coalesce(v_order.display_doc_no, v_order.order_no);
    order_item_id := v_item.id;
    variant_id := v_item.variant_id;
    selected_stock_config_id := v_item.stock_config_id;

    select pv.variant_name, pv.alternative_name, pv.variant_code,
           coalesce(to_jsonb(pv)->>'product_code', p.product_code),
           p.category_id
      into variant_name, alternative_name, variant_code, product_code,
           v_item_product_category_id
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_item.variant_id;

    if v_cutoff.status <> 'counting' then
      reason_code := 'inventory_cutoff_not_active';
      return next;
      continue;
    end if;
    if v_item_product_category_id is distinct from
       v_cutoff.product_category_id then
      reason_code := 'inventory_cutoff_product_category_scope_mismatch';
      return next;
      continue;
    end if;
    if v_order.order_type <> 'H2M'
       or v_order.status not in ('approved', 'closed') then
      reason_code := 'inventory_cutoff_manufacturer_not_eligible';
      return next;
      continue;
    end if;

    order_warehouse_organization_id :=
      public.resolve_order_destination_warehouse(v_order.buyer_org_id);
    if order_warehouse_organization_id is distinct from
       v_cutoff.warehouse_organization_id then
      reason_code := 'inventory_cutoff_configuration_wrong_warehouse';
      return next;
      continue;
    end if;
    if v_session.id is null
       or v_session.warehouse_organization_id is distinct from
          v_cutoff.warehouse_organization_id then
      reason_code := 'inventory_cutoff_session_wrong_warehouse';
      return next;
      continue;
    end if;

    select coalesce(sum(received_now), 0)::integer into v_received
    from public.warehouse_receipt_items receipt_item
    where receipt_item.order_id = v_order.id
      and receipt_item.variant_id = v_item.variant_id;
    if v_item.qty - v_received <= 0 then
      reason_code := 'inventory_cutoff_no_outstanding_incoming';
      return next;
      continue;
    end if;

    select count(*)::integer into v_variant_line_count
    from public.order_items oi
    where oi.order_id = v_order.id and oi.variant_id = v_item.variant_id;
    if v_variant_line_count <> 1 then
      reason_code := 'inventory_cutoff_manufacturer_variant_lines_conflicting';
      return next;
      continue;
    end if;

    -- A legacy selected ID that belongs to another exact variant must never be
    -- silently replaced; surface the identity defect explicitly.
    if v_item.stock_config_id is not null then
      select * into v_selected
      from public.inventory_stock_configurations c
      where c.id = v_item.stock_config_id;
      if found and v_selected.variant_id is distinct from v_item.variant_id then
        config_variant_id := v_selected.variant_id;
        config_label := v_selected.config_label;
        config_status := v_selected.status;
        allow_ord := v_selected.allow_ord;
        reason_code := 'inventory_cutoff_configuration_wrong_variant';
        return next;
        continue;
      end if;
    end if;

    select count(*)::integer into v_all_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id;
    if v_all_count = 0 then
      reason_code := 'inventory_cutoff_configuration_missing';
      return next;
      continue;
    end if;

    select count(*)::integer into v_active_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id and c.status = 'active';
    if v_active_count = 0 then
      reason_code := 'inventory_cutoff_configuration_inactive';
      return next;
      continue;
    end if;

    select count(*)::integer into v_receiving_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id
      and c.status = 'active'
      and c.allow_ord;
    if v_receiving_count = 0 then
      reason_code := 'inventory_cutoff_configuration_not_receiving_eligible';
      return next;
      continue;
    end if;

    select count(*)::integer into v_scoped_count
    from public.inventory_stock_configurations c
    join public.stock_count_session_scope scope_row
      on scope_row.stock_config_id = c.id
     and scope_row.session_id = v_cutoff.stock_count_session_id
    where c.variant_id = v_item.variant_id
      and c.status = 'active'
      and c.allow_ord;
    if v_scoped_count = 0 then
      reason_code := 'inventory_cutoff_configuration_not_in_session_scope';
      return next;
      continue;
    end if;
    if v_scoped_count > 1 then
      reason_code := 'inventory_cutoff_configuration_ambiguous';
      return next;
      continue;
    end if;

    select c.* into v_config
    from public.inventory_stock_configurations c
    join public.stock_count_session_scope scope_row
      on scope_row.stock_config_id = c.id
     and scope_row.session_id = v_cutoff.stock_count_session_id
    where c.variant_id = v_item.variant_id
      and c.status = 'active'
      and c.allow_ord;

    stock_config_id := v_config.id;
    config_variant_id := v_config.variant_id;
    config_label := v_config.config_label;
    config_status := v_config.status;
    allow_ord := v_config.allow_ord;
    in_session_scope := true;
    eligible := true;
    reason_code := 'eligible';
    return next;
  end loop;
end;
$$;

revoke all on function
  public.resolve_inventory_cutoff_h2m_incoming(uuid, uuid[])
  from public;
grant execute on function
  public.resolve_inventory_cutoff_h2m_incoming(uuid, uuid[])
  to authenticated, service_role;

comment on function
  public.resolve_inventory_cutoff_h2m_incoming(uuid, uuid[]) is
  'Read-only authoritative H2M Incoming resolver. Requires products.category_id to equal the Opening Balance product_category_id, then resolves one exact-variant active allow_ord configuration from the cutoff session immutable scope. Product inventory, physical quantity and display names are not eligibility inputs.';

-- Preserve the established D2H, physical-count and transaction preview logic,
-- then replace only the H2M slice with the immutable Product Category scope.
-- This keeps the correction forward-only without duplicating the large existing
-- preview implementation or moving the category boundary into the client.
alter function public.inventory_cutoff_preview(uuid)
  rename to inventory_cutoff_preview_h2m_unscoped_legacy;

revoke all on function
  public.inventory_cutoff_preview_h2m_unscoped_legacy(uuid)
  from public;

create function public.inventory_cutoff_preview(p_cutoff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_category_name text;
  v_report jsonb;
  v_manufacturer jsonb;
  v_non_h2m_blockers jsonb;
  v_h2m_blockers jsonb;
  v_blockers jsonb;
  v_readiness text;
begin
  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_cutoff.stock_count_session_id;
  select category_row.category_name into v_category_name
  from public.product_categories category_row
  where category_row.id = v_cutoff.product_category_id
    and category_row.is_active = true;
  if v_session.id is null
     or v_cutoff.product_category_id is null
     or v_session.product_category_id is distinct from v_cutoff.product_category_id
     or v_category_name is null then
    raise exception 'stock_count_active_product_category_required';
  end if;

  v_report := public.inventory_cutoff_preview_h2m_unscoped_legacy(p_cutoff_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', scoped.order_id,
    'order_item_id', scoped.order_item_id,
    'order_number', scoped.order_number,
    'status', scoped.status,
    'manufacturer', scoped.manufacturer,
    'variant_id', scoped.variant_id,
    'variant', scoped.variant,
    'ordered_quantity', scoped.ordered_qty,
    'received_quantity', scoped.received_qty,
    'remaining_incoming_quantity', scoped.remaining_qty,
    'stock_config_id', scoped.stock_config_id,
    'stock_configuration', scoped.stock_configuration,
    'decision', scoped.decision,
    'order_created_at', scoped.created_at,
    'order_sequence', scoped.base_seq,
    'product_category_id', scoped.product_category_id,
    'classification', case
      when scoped.decision = 'history_only' then 'History Only'
      when scoped.stock_config_id is null then 'Blocked'
      when scoped.decision = 'carry_forward_incoming' then 'Carry Forward'
      else 'Blocked'
    end
  ) order by
    scoped.created_at desc,
    scoped.base_seq desc nulls last,
    scoped.order_id desc,
    scoped.order_item_id),'[]'::jsonb)
  into v_manufacturer
  from (
    select
      order_row.id order_id,
      order_item.id order_item_id,
      coalesce(order_row.display_doc_no, order_row.order_no) order_number,
      order_row.status,
      manufacturer.org_name manufacturer,
      order_item.variant_id,
      variant.variant_name variant,
      order_item.qty ordered_qty,
      coalesce(receipt.received_qty, 0) received_qty,
      greatest(order_item.qty - coalesce(receipt.received_qty, 0), 0) remaining_qty,
      order_item.stock_config_id,
      config.config_label stock_configuration,
      decision_row.decision,
      order_row.created_at,
      order_row.base_seq,
      product.category_id product_category_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.organizations manufacturer on manufacturer.id = order_row.seller_org_id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    left join public.inventory_stock_configurations config
      on config.id = order_item.stock_config_id
     and config.variant_id = order_item.variant_id
    left join (
      select receipt_item.order_id, receipt_item.variant_id,
             sum(receipt_item.received_now)::integer received_qty
      from public.warehouse_receipt_items receipt_item
      group by receipt_item.order_id, receipt_item.variant_id
    ) receipt
      on receipt.order_id = order_row.id
     and receipt.variant_id = order_item.variant_id
    left join public.inventory_cutoff_decisions decision_row
      on decision_row.cutoff_id = v_cutoff.id
     and decision_row.transaction_kind = 'manufacturer'
     and decision_row.order_item_id = order_item.id
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
  ) scoped
  where scoped.remaining_qty > 0;

  -- Remove the unscoped legacy H2M blocker messages and rebuild them from the
  -- exact same item relation as the displayed/category-scoped list.
  select coalesce(jsonb_agg(blocker.value order by blocker.ordinality), '[]'::jsonb)
  into v_non_h2m_blockers
  from jsonb_array_elements_text(coalesce(v_report->'blockers', '[]'::jsonb))
       with ordinality blocker(value, ordinality)
  where blocker.value not like 'Manufacturer order %';

  select coalesce(jsonb_agg(scoped_blocker.message order by
    scoped_blocker.created_at desc,
    scoped_blocker.base_seq desc nulls last,
    scoped_blocker.order_id desc,
    scoped_blocker.order_item_id desc
  ), '[]'::jsonb)
  into v_h2m_blockers
  from (
    select
      format(
        'Manufacturer order %s / %s requires an incoming decision and valid selected configuration.',
        coalesce(order_row.display_doc_no, order_row.order_no),
        variant.variant_name
      ) message,
      order_row.created_at,
      order_row.base_seq,
      order_row.id order_id,
      order_item.id order_item_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    left join (
      select receipt_item.order_id, receipt_item.variant_id,
             sum(receipt_item.received_now)::integer qty
      from public.warehouse_receipt_items receipt_item
      group by receipt_item.order_id, receipt_item.variant_id
    ) receipt
      on receipt.order_id = order_row.id
     and receipt.variant_id = order_item.variant_id
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
      and greatest(order_item.qty - coalesce(receipt.qty, 0), 0) > 0
      and not exists (
        select 1
        from public.inventory_cutoff_decisions decision_row
        where decision_row.cutoff_id = v_cutoff.id
          and decision_row.transaction_kind = 'manufacturer'
          and decision_row.order_item_id = order_item.id
          and (
            decision_row.decision = 'history_only'
            or (
              decision_row.decision = 'carry_forward_incoming'
              and order_item.stock_config_id is not null
            )
          )
      )
    union all
    select
      format(
        'Manufacturer order %s / %s has duplicate variant lines; outstanding quantity and configuration are ambiguous.',
        coalesce(order_row.display_doc_no, order_row.order_no),
        variant.variant_name
      ) message,
      order_row.created_at,
      order_row.base_seq,
      order_row.id order_id,
      min(order_item.id::text)::uuid order_item_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
    group by
      order_row.id, order_row.display_doc_no, order_row.order_no,
      order_row.created_at, order_row.base_seq, variant.id, variant.variant_name
    having count(*) > 1
  ) scoped_blocker;

  v_blockers := v_non_h2m_blockers || v_h2m_blockers;
  v_readiness := case
    when jsonb_array_length(v_blockers) > 0 then 'Blocked'
    when jsonb_array_length(coalesce(v_report->'review_items', '[]'::jsonb)) > 0
      then 'Review Required'
    else 'Ready'
  end;

  return v_report || jsonb_build_object(
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'manufacturer_incoming', v_manufacturer,
    'blockers', v_blockers,
    'readiness', v_readiness
  );
end;
$$;

grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Opening Balance preview with H2M display, counts, blockers and deterministic newest-first ordering scoped by inventory_opening_cutoffs.product_category_id through order_items.variant_id -> product_variants.product_id -> products.category_id.';

-- Preserve every D2H and History Only rule from the preceding forward migration.
-- H2M Incoming alone consumes the new resolver and atomically pins its result to
-- the order item before the saved decision is returned.
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
  v_resolution record;
  v_kind text;
  v_saved public.inventory_cutoff_decisions%rowtype;
  v_received integer;
  v_item_product_category_id uuid;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  select * into v_cutoff from public.inventory_opening_cutoffs where id=p_cutoff_id for update;
  if not found or v_cutoff.status <> 'counting' then raise exception 'inventory_cutoff_not_active'; end if;
  select * into v_item from public.order_items where id=p_order_item_id for update;
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
      select * into v_resolution
      from public.resolve_inventory_cutoff_d2h_carry_forward(
        v_cutoff.id, array[v_item.id]
      );
      if not coalesce(v_resolution.eligible, false) then
        raise exception using message = coalesce(
          v_resolution.reason_code, 'inventory_cutoff_configuration_missing'
        );
      end if;
      v_config := v_resolution.stock_config_id;
    else
      v_config := v_item.stock_config_id;
    end if;
  elsif v_order.order_type='H2M' then
    v_kind := 'manufacturer';
    if v_cutoff.product_category_id is null
       or not exists (
         select 1
         from public.stock_count_sessions session_row
         join public.product_categories category_row
           on category_row.id = session_row.product_category_id
          and category_row.is_active = true
         where session_row.id = v_cutoff.stock_count_session_id
           and session_row.product_category_id = v_cutoff.product_category_id
       ) then
      raise exception 'stock_count_active_product_category_required';
    end if;
    select product.category_id into v_item_product_category_id
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = v_item.variant_id;
    if v_item_product_category_id is distinct from v_cutoff.product_category_id then
      raise exception 'inventory_cutoff_product_category_scope_mismatch';
    end if;
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

    if p_decision='carry_forward_incoming' then
      select * into v_resolution
      from public.resolve_inventory_cutoff_h2m_incoming(
        v_cutoff.id, array[v_item.id]
      );
      if not coalesce(v_resolution.eligible, false) then
        raise exception using message = coalesce(
          v_resolution.reason_code, 'inventory_cutoff_configuration_missing'
        );
      end if;
      v_config := v_resolution.stock_config_id;
      update public.order_items
      set stock_config_id = v_config,
          stock_config_confirmed_at = now(),
          stock_config_confirmed_by = v_user,
          updated_at = now()
      where id = v_item.id;
    else
      v_config := v_item.stock_config_id;
    end if;
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

revoke all on function public.set_inventory_cutoff_decision(uuid,uuid,text)
  from public;
grant execute on function public.set_inventory_cutoff_decision(uuid,uuid,text)
  to authenticated;

-- Replace the D2H wrapper installed by the preceding migration. The established
-- legacy posting function still owns OTP consumption, locks, posting, audit and
-- idempotency; this wrapper only adds authoritative H2M revalidation.
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
  v_cutoff_id uuid;
  v_warehouse_id uuid;
  v_session_id uuid;
  v_category_id uuid;
  v_session_category_id uuid;
  v_resolution record;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;

  select
    cutoff.id,
    cutoff.warehouse_organization_id,
    cutoff.stock_count_session_id,
    cutoff.product_category_id,
    session_row.product_category_id
    into
      v_cutoff_id,
      v_warehouse_id,
      v_session_id,
      v_category_id,
      v_session_category_id
  from public.stock_count_verification_requests request_row
  join public.inventory_opening_cutoffs cutoff
    on cutoff.stock_count_session_id = request_row.session_id
  join public.stock_count_sessions session_row
    on session_row.id = cutoff.stock_count_session_id
  where request_row.id = p_request_id
    and request_row.requesting_user_id = v_user;

  if v_cutoff_id is not null then
    if v_category_id is null
       or v_session_category_id is distinct from v_category_id
       or not exists (
         select 1 from public.product_categories category_row
         where category_row.id = v_category_id
           and category_row.is_active = true
       ) then
      raise exception 'stock_count_active_product_category_required';
    end if;
    if exists (
      select 1
      from public.inventory_cutoff_decisions decision_row
      join public.order_items order_item
        on order_item.id = decision_row.order_item_id
      join public.product_variants variant
        on variant.id = order_item.variant_id
      join public.products product
        on product.id = variant.product_id
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.transaction_kind = 'manufacturer'
        and product.category_id is distinct from v_category_id
    ) then
      raise exception 'inventory_cutoff_product_category_scope_mismatch';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory-opening-cutoff:' || v_warehouse_id::text, 0
    ));
    perform 1
    from public.product_inventory inventory_row
    where inventory_row.organization_id = v_warehouse_id
    order by inventory_row.stock_config_id
    for update;
    perform 1
    from public.stock_count_session_scope scope_row
    where scope_row.session_id = v_session_id
    order by scope_row.stock_config_id
    for share;
    perform 1
    from public.inventory_stock_configurations config
    join public.stock_count_session_scope scope_row
      on scope_row.stock_config_id = config.id
    where scope_row.session_id = v_session_id
    order by config.id
    for share of config, scope_row;
    perform 1
    from public.orders order_row
    where exists (
      select 1 from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_id = order_row.id
        and decision_row.decision in ('carry_forward','carry_forward_incoming')
    )
    order by order_row.id
    for update;
    perform 1
    from public.order_items order_item
    where exists (
      select 1 from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_item_id = order_item.id
        and decision_row.transaction_kind = 'manufacturer'
        and decision_row.decision = 'carry_forward_incoming'
    )
    order by order_item.id
    for update;
  end if;

  for v_resolution in
    select resolution.*
    from public.inventory_cutoff_decisions decision_row
    cross join lateral public.resolve_inventory_cutoff_d2h_carry_forward(
      decision_row.cutoff_id, array[decision_row.order_item_id]
    ) resolution
    where decision_row.cutoff_id = v_cutoff_id
      and decision_row.transaction_kind = 'distributor'
      and decision_row.decision = 'carry_forward'
    order by decision_row.order_id, decision_row.order_item_id
  loop
    if not v_resolution.eligible then
      raise exception using message = v_resolution.reason_code;
    end if;
    if v_resolution.stock_config_id is distinct from (
      select decision_row.stock_config_id
      from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_item_id = v_resolution.order_item_id
        and decision_row.transaction_kind = 'distributor'
    ) then
      raise exception 'inventory_cutoff_stale_preflight_data';
    end if;
  end loop;

  for v_resolution in
    select resolution.*
    from public.inventory_cutoff_decisions decision_row
    cross join lateral public.resolve_inventory_cutoff_h2m_incoming(
      decision_row.cutoff_id, array[decision_row.order_item_id]
    ) resolution
    where decision_row.cutoff_id = v_cutoff_id
      and decision_row.transaction_kind = 'manufacturer'
      and decision_row.decision = 'carry_forward_incoming'
    order by decision_row.order_id, decision_row.order_item_id
  loop
    if not v_resolution.eligible then
      raise exception using message = v_resolution.reason_code;
    end if;
    if v_resolution.stock_config_id is distinct from (
      select decision_row.stock_config_id
      from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_item_id = v_resolution.order_item_id
        and decision_row.transaction_kind = 'manufacturer'
    ) or v_resolution.stock_config_id is distinct from
      v_resolution.selected_stock_config_id then
      raise exception 'inventory_cutoff_stale_preflight_data';
    end if;
  end loop;

  return public.verify_and_post_inventory_opening_cutoff_scoped_legacy(
    p_request_id, p_code_hash
  );
end;
$$;

revoke all on function
  public.verify_and_post_inventory_opening_cutoff(uuid,text)
  from public;
grant execute on function
  public.verify_and_post_inventory_opening_cutoff(uuid,text)
  to authenticated;

comment on function
  public.verify_and_post_inventory_opening_cutoff(uuid,text) is
  'Atomic Opening Balance posting entry point. Revalidates D2H and H2M carry-forward decisions through their immutable-session-scope resolvers, then delegates to the established locked/idempotent posting implementation in the same transaction.';

-- One request record makes a confirmed batch replay-safe without weakening the
-- existing per-item decision/audit contract. No operational quantity is stored.
create table if not exists public.inventory_cutoff_h2m_bulk_requests (
  cutoff_id uuid not null references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  action text not null check (action in (
    'selected_incoming','selected_not_incoming','all_remaining_not_incoming'
  )),
  scope_fingerprint text not null,
  requested_order_ids uuid[] not null default '{}',
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);
alter table public.inventory_cutoff_h2m_bulk_requests enable row level security;
revoke all on public.inventory_cutoff_h2m_bulk_requests from public, anon, authenticated;

-- Read-only authoritative count/scope snapshot used both by the confirmation
-- dialog and, under lock, immediately before apply.
create or replace function public.inventory_cutoff_h2m_bulk_preflight(
  p_cutoff_id uuid,
  p_action text,
  p_order_ids uuid[] default '{}'
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_category_name text;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;
  if p_action not in (
    'selected_incoming','selected_not_incoming','all_remaining_not_incoming'
  ) then raise exception 'inventory_cutoff_h2m_bulk_action_invalid'; end if;
  if p_action <> 'all_remaining_not_incoming'
     and coalesce(cardinality(p_order_ids), 0) = 0 then
    raise exception 'inventory_cutoff_h2m_bulk_selection_required';
  end if;

  select cutoff.* into v_cutoff
  from public.inventory_opening_cutoffs cutoff
  where cutoff.id = p_cutoff_id and cutoff.status = 'counting';
  if not found then raise exception 'inventory_cutoff_not_active'; end if;
  select category_row.category_name into v_category_name
  from public.stock_count_sessions session_row
  join public.product_categories category_row
    on category_row.id = session_row.product_category_id
   and category_row.is_active = true
  where session_row.id = v_cutoff.stock_count_session_id
    and session_row.product_category_id = v_cutoff.product_category_id;
  if v_cutoff.product_category_id is null or v_category_name is null then
    raise exception 'stock_count_active_product_category_required';
  end if;

  with scoped as (
    select
      order_row.id order_id,
      order_item.id order_item_id,
      decision_row.decision,
      resolution.eligible incoming_eligible,
      resolution.reason_code,
      resolution.stock_config_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    left join (
      select receipt_item.order_id, receipt_item.variant_id,
             sum(receipt_item.received_now)::integer received_qty
      from public.warehouse_receipt_items receipt_item
      group by receipt_item.order_id, receipt_item.variant_id
    ) receipt on receipt.order_id = order_row.id
             and receipt.variant_id = order_item.variant_id
    left join public.inventory_cutoff_decisions decision_row
      on decision_row.cutoff_id = v_cutoff.id
     and decision_row.transaction_kind = 'manufacturer'
     and decision_row.order_item_id = order_item.id
    cross join lateral public.resolve_inventory_cutoff_h2m_incoming(
      v_cutoff.id, array[order_item.id]
    ) resolution
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
      and greatest(order_item.qty - coalesce(receipt.received_qty, 0), 0) > 0
  ), targeted as (
    select scoped.*,
      scoped.decision is null unresolved,
      case
        when scoped.decision is not null then false
        when p_action = 'selected_not_incoming' then true
        else scoped.incoming_eligible
      end eligible
    from scoped
    where p_action = 'all_remaining_not_incoming'
       or scoped.order_id = any(coalesce(p_order_ids, '{}'))
  ), aggregate_row as (
    select
      count(*) filter (where targeted.eligible)::integer eligible_item_count,
      count(distinct order_id) filter (where targeted.eligible)::integer affected_order_count,
      count(*) filter (where not targeted.unresolved)::integer resolved_item_count,
      count(*) filter (where decision = 'carry_forward_incoming')::integer saved_incoming_count,
      count(*) filter (where decision = 'history_only')::integer saved_not_incoming_count,
      count(*) filter (
        where targeted.unresolved and not targeted.incoming_eligible
      )::integer blocked_item_count,
      coalesce(array_agg(distinct order_id order by order_id)
        filter (where targeted.eligible), '{}') eligible_order_ids,
      coalesce(array_agg(order_item_id order by order_item_id)
        filter (where targeted.eligible), '{}') eligible_order_item_ids,
      coalesce(array_agg(order_item_id order by order_item_id)
        filter (where targeted.unresolved and not targeted.incoming_eligible), '{}')
        blocked_order_item_ids,
      md5(concat_ws('|',
        v_cutoff.id::text, v_cutoff.product_category_id::text, p_action,
        coalesce(string_agg(
          concat_ws(':', order_item_id::text, coalesce(decision, ''),
                    incoming_eligible::text, coalesce(stock_config_id::text, ''))
          , ',' order by order_item_id), '')
      )) fingerprint
    from targeted
  )
  select jsonb_build_object(
    'action', p_action,
    'fingerprint', aggregate_row.fingerprint,
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'eligible_item_count', aggregate_row.eligible_item_count,
    'affected_order_count', aggregate_row.affected_order_count,
    'resolved_item_count', aggregate_row.resolved_item_count,
    'saved_incoming_count', aggregate_row.saved_incoming_count,
    'saved_not_incoming_count', aggregate_row.saved_not_incoming_count,
    'blocked_item_count', aggregate_row.blocked_item_count,
    'eligible_order_ids', to_jsonb(aggregate_row.eligible_order_ids),
    'eligible_order_item_ids', to_jsonb(aggregate_row.eligible_order_item_ids),
    'blocked_order_item_ids', to_jsonb(aggregate_row.blocked_order_item_ids)
  ) into v_result from aggregate_row;
  return v_result;
end;
$$;

revoke all on function public.inventory_cutoff_h2m_bulk_preflight(uuid,text,uuid[])
  from public, anon;
grant execute on function public.inventory_cutoff_h2m_bulk_preflight(uuid,text,uuid[])
  to authenticated, service_role;

create or replace function public.apply_inventory_cutoff_h2m_bulk(
  p_cutoff_id uuid,
  p_action text,
  p_order_ids uuid[],
  p_expected_fingerprint text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_summary jsonb;
  v_existing public.inventory_cutoff_h2m_bulk_requests%rowtype;
  v_order_item_id uuid;
  v_decision text;
  v_result jsonb;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if p_idempotency_key is null then
    raise exception 'inventory_cutoff_h2m_bulk_idempotency_key_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-cutoff-h2m-bulk:' || p_cutoff_id::text, 0
  ));
  -- Serialize with the existing single-item writer, which takes this same
  -- cutoff row lock before changing any decision.
  perform 1 from public.inventory_opening_cutoffs
  where id = p_cutoff_id
  for update;

  select * into v_existing
  from public.inventory_cutoff_h2m_bulk_requests
  where cutoff_id = p_cutoff_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.action <> p_action
       or v_existing.requested_order_ids is distinct from coalesce(p_order_ids, '{}')
       or v_existing.scope_fingerprint <> p_expected_fingerprint then
      raise exception 'inventory_cutoff_h2m_bulk_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_summary := public.inventory_cutoff_h2m_bulk_preflight(
    p_cutoff_id, p_action, coalesce(p_order_ids, '{}')
  );
  if coalesce(v_summary->>'fingerprint', '') <> coalesce(p_expected_fingerprint, '') then
    raise exception 'inventory_cutoff_h2m_bulk_scope_changed';
  end if;
  if coalesce((v_summary->>'eligible_item_count')::integer, 0) = 0 then
    raise exception 'inventory_cutoff_h2m_bulk_no_eligible_items';
  end if;

  v_decision := case when p_action = 'selected_incoming'
    then 'carry_forward_incoming' else 'history_only' end;
  for v_order_item_id in
    select value::text::uuid
    from jsonb_array_elements_text(v_summary->'eligible_order_item_ids') value
    order by value::text
  loop
    perform public.set_inventory_cutoff_decision(
      p_cutoff_id, v_order_item_id, v_decision
    );
  end loop;

  v_result := v_summary || jsonb_build_object(
    'applied_item_count', (v_summary->>'eligible_item_count')::integer,
    'decision', v_decision,
    'idempotent_replay', false
  );
  insert into public.inventory_cutoff_h2m_bulk_requests(
    cutoff_id,idempotency_key,action,scope_fingerprint,requested_order_ids,
    result,created_by
  ) values (
    p_cutoff_id,p_idempotency_key,p_action,p_expected_fingerprint,
    coalesce(p_order_ids, '{}'),v_result,v_user
  );
  return v_result;
end;
$$;

revoke all on function public.apply_inventory_cutoff_h2m_bulk(
  uuid,text,uuid[],text,uuid
) from public, anon;
grant execute on function public.apply_inventory_cutoff_h2m_bulk(
  uuid,text,uuid[],text,uuid
) to authenticated;

-- The new RPCs must be rediscovered immediately after this pending migration
-- commits. This is not a substitute for applying the migration itself.
notify pgrst, 'reload schema';

commit;
