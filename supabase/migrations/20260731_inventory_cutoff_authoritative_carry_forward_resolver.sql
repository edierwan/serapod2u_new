begin;

-- ============================================================================
-- Opening Balance D2H Carry Forward — authoritative target resolver
-- ----------------------------------------------------------------------------
-- Forward-only correction for the false "20ml New Box missing" result.
--
-- Opening Balance deliberately snapshots configuration rows before a warehouse
-- product_inventory row exists. The immutable stock_count_session_scope is the
-- authoritative warehouse/session eligibility boundary during this workflow.
-- Configuration identity is always resolved from the exact order-item variant;
-- physical quantity is never read and never participates in target selection.
-- ============================================================================

create or replace function public.resolve_inventory_cutoff_d2h_carry_forward(
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
  stock_config_id uuid,
  config_variant_id uuid,
  config_status text,
  allow_so boolean,
  default_for_ord boolean,
  packaging text,
  volume_ml smallint,
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
  v_config public.inventory_stock_configurations%rowtype;
  v_candidate_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;

  if not found then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_cutoff.stock_count_session_id;

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
    stock_config_id := null;
    config_variant_id := null;
    config_status := null;
    allow_so := null;
    default_for_ord := null;
    packaging := null;
    volume_ml := null;
    in_session_scope := false;
    eligible := false;
    reason_code := null;

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

    select pv.variant_name, pv.alternative_name, pv.variant_code,
           coalesce(to_jsonb(pv)->>'product_code', p.product_code)
      into variant_name, alternative_name, variant_code, product_code
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_item.variant_id;

    if v_cutoff.status <> 'counting' then
      reason_code := 'inventory_cutoff_not_active';
      return next;
      continue;
    end if;
    if v_order.order_type not in ('D2H', 'S2D')
       or v_order.status <> 'submitted' then
      reason_code := 'inventory_cutoff_distributor_not_eligible';
      return next;
      continue;
    end if;

    order_warehouse_organization_id :=
      public.order_inventory_organization(v_order.id);
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

    select count(*)::integer into v_candidate_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id
      and c.volume_ml = 20
      and c.packaging = 'new_box';

    if v_candidate_count = 0 then
      reason_code := 'inventory_cutoff_configuration_missing';
      return next;
      continue;
    end if;
    if v_candidate_count > 1 then
      reason_code := 'inventory_cutoff_configuration_ambiguous';
      return next;
      continue;
    end if;

    select * into v_config
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id
      and c.volume_ml = 20
      and c.packaging = 'new_box';

    stock_config_id := v_config.id;
    config_variant_id := v_config.variant_id;
    config_status := v_config.status;
    allow_so := v_config.allow_so;
    default_for_ord := v_config.default_for_ord;
    packaging := v_config.packaging;
    volume_ml := v_config.volume_ml;
    in_session_scope := exists (
      select 1
      from public.stock_count_session_scope scope_row
      where scope_row.session_id = v_cutoff.stock_count_session_id
        and scope_row.stock_config_id = v_config.id
    );

    -- Defence in depth: the candidate query is variant-scoped, but retain an
    -- explicit identity reason if legacy/corrupt data ever violates that fact.
    if v_config.variant_id is distinct from v_item.variant_id then
      reason_code := 'inventory_cutoff_configuration_wrong_variant';
    elsif v_config.status <> 'active' then
      reason_code := 'inventory_cutoff_configuration_inactive';
    elsif not v_config.allow_so then
      reason_code := 'inventory_cutoff_configuration_not_order_eligible';
    elsif not in_session_scope then
      reason_code := 'inventory_cutoff_configuration_not_in_session_scope';
    else
      eligible := true;
      reason_code := 'eligible';
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function
  public.resolve_inventory_cutoff_d2h_carry_forward(uuid, uuid[])
  from public;
grant execute on function
  public.resolve_inventory_cutoff_d2h_carry_forward(uuid, uuid[])
  to authenticated, service_role;

comment on function
  public.resolve_inventory_cutoff_d2h_carry_forward(uuid, uuid[]) is
  'Read-only authoritative D2H Carry Forward resolver. Matches exact order-item variant to active allow_so 20ml New Box within the cutoff session immutable scope; product_inventory and physical quantity are intentionally not eligibility inputs.';

-- Decision application consumes the authoritative resolver. All allocation,
-- audit, OTP invalidation and non-Carry-Forward behaviour remains unchanged.
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
        raise exception using
          message = coalesce(
            v_resolution.reason_code,
            'inventory_cutoff_configuration_missing'
          );
      end if;
      v_config := v_resolution.stock_config_id;
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

-- Keep the already-deployed posting implementation intact and wrap it with the
-- same authoritative resolver. Both calls execute in this one PostgreSQL
-- transaction. The legacy implementation still takes its established locks and
-- rechecks mutable status/allow_so fields before applying allocations.
alter function public.verify_and_post_inventory_opening_cutoff(uuid,text)
  rename to verify_and_post_inventory_opening_cutoff_scoped_legacy;

revoke all on function
  public.verify_and_post_inventory_opening_cutoff_scoped_legacy(uuid,text)
  from public;

create function public.verify_and_post_inventory_opening_cutoff(
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
  v_resolution record;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;

  select cutoff.id, cutoff.warehouse_organization_id, cutoff.stock_count_session_id
    into v_cutoff_id, v_warehouse_id, v_session_id
  from public.stock_count_verification_requests request_row
  join public.inventory_opening_cutoffs cutoff
    on cutoff.stock_count_session_id = request_row.session_id
  where request_row.id = p_request_id
    and request_row.requesting_user_id = v_user;

  -- Lock the immutable scope, its configuration rows, and affected orders
  -- before resolving. This closes the race between authoritative validation and
  -- the established posting implementation's own locked revalidation.
  if v_cutoff_id is not null then
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
      select 1
      from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_id = order_row.id
        and decision_row.transaction_kind = 'distributor'
        and decision_row.decision = 'carry_forward'
    )
    order by order_row.id
    for update;
  end if;

  for v_resolution in
    select resolution.*
    from public.inventory_cutoff_decisions decision_row
    cross join lateral
      public.resolve_inventory_cutoff_d2h_carry_forward(
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
  'Atomic Opening Balance posting entry point. Revalidates D2H Carry Forward decisions through the immutable-session-scope resolver, then delegates to the established locked/idempotent posting implementation in the same transaction.';

commit;
