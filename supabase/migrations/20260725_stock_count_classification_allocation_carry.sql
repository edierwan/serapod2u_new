-- Initial Physical Count & Configuration Classification:
-- carry an explicitly selected Legacy reservation to a counted target
-- configuration in the same atomic OTP posting transaction.
--
-- Safety properties:
--   * no reservation is released or guessed;
--   * the user must persist one target choice per allocated flavour;
--   * the final target physical count must cover existing + carried allocation;
--   * every Legacy allocation must reconcile to an active submitted order;
--   * target stock is posted before allocation moves, then Legacy is cleared;
--   * order item identity and allocation/deallocation movements are updated
--     together with the Stock Count, or the entire transaction rolls back.

begin;

create table if not exists public.stock_count_classification_allocation_resolutions (
  session_id uuid not null references public.stock_count_sessions(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  target_stock_config_id uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, variant_id),
  constraint stock_count_classification_allocation_target_fk
    foreign key (target_stock_config_id, variant_id)
    references public.inventory_stock_configurations(id, variant_id)
);

comment on table public.stock_count_classification_allocation_resolutions is
  'Explicit per-flavour destination for carrying live Legacy order allocations during an atomic Initial Physical Count & Configuration Classification post.';

alter table public.stock_count_classification_allocation_resolutions enable row level security;

drop policy if exists stock_count_classification_allocation_resolutions_manage_org
  on public.stock_count_classification_allocation_resolutions;
create policy stock_count_classification_allocation_resolutions_manage_org
  on public.stock_count_classification_allocation_resolutions
  to authenticated
  using (
    exists (
      select 1
      from public.stock_count_sessions sessions
      where sessions.id = stock_count_classification_allocation_resolutions.session_id
        and sessions.status = 'draft'
        and (
          public.can_access_org(sessions.warehouse_organization_id)
          or public.is_hq_admin()
        )
    )
  )
  with check (
    exists (
      select 1
      from public.stock_count_sessions sessions
      where sessions.id = stock_count_classification_allocation_resolutions.session_id
        and sessions.status = 'draft'
        and sessions.count_type = 'initial_configuration_classification'
        and (
          public.can_access_org(sessions.warehouse_organization_id)
          or public.is_hq_admin()
        )
    )
  );

grant select, insert, update, delete
  on public.stock_count_classification_allocation_resolutions
  to authenticated;

comment on column public.stock_count_sessions.count_type is
  'full_count/cycle_count/spot_check are ordinary counts. initial_configuration_classification is an Initial Physical Count & Configuration Classification: it clears a positive per-warehouse Legacy balance into explicit 20NB/50NB/50OB physical balances and posts the resulting +/- variance atomically.';

comment on function public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) is
  'Hashes and freezes a Stock Count session before an OTP is issued. Initial classification must clear Legacy, count every target, permit genuine +/- physical variance, and either have no Legacy allocation or persist an explicit validated reservation target.';

create or replace function public.stock_count_assert_classification_postable(
  p_session_id uuid,
  p_warehouse_id uuid
) returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_flavour text;
  v_unit_label text;
  v_target_id uuid;
  v_target_code text;
  v_target_physical integer;
  v_target_allocated integer;
  v_owner_quantity integer;
  v_order_refs text;
begin
  for v_row in
    select
      i.variant_id,
      i.stock_config_id as legacy_stock_config_id,
      coalesce(nullif(btrim(p.product_name), ''), 'Unknown product') as product_name,
      coalesce(nullif(btrim(pv.variant_name), ''), 'Unknown flavour') as variant_name,
      coalesce(pi.quantity_on_hand, 0) as live_on_hand,
      coalesce(pi.quantity_allocated, 0) as live_allocated
    from public.stock_count_session_items i
    join public.inventory_stock_configurations c
      on c.id = i.stock_config_id
     and c.variant_id = i.variant_id
    join public.product_variants pv on pv.id = i.variant_id
    join public.products p on p.id = pv.product_id
    left join public.product_inventory pi
      on pi.variant_id = i.variant_id
     and pi.stock_config_id = i.stock_config_id
     and pi.organization_id = p_warehouse_id
     and pi.is_active = true
    where i.session_id = p_session_id
      and c.config_code = 'UNCLASSIFIED'
      and i.physical_quantity is not null
    order by p.product_name, pv.variant_name
  loop
    v_flavour := format('%s [%s]', v_row.product_name, v_row.variant_name);

    if v_row.live_on_hand <= 0 then
      raise exception 'stock_count_already_fully_classified: %',
        format(
          'This product has already been fully classified (%s). Download a new Initial Physical Count template or use Full Count to update its quantity.',
          v_flavour
        );
    end if;

    if v_row.live_allocated <= 0 then
      continue;
    end if;

    v_unit_label := case when v_row.live_allocated = 1 then 'unit' else 'units' end;

    select r.target_stock_config_id, c.config_code, i.physical_quantity,
           coalesce(pi.quantity_allocated, 0)
      into v_target_id, v_target_code, v_target_physical, v_target_allocated
    from public.stock_count_classification_allocation_resolutions r
    join public.inventory_stock_configurations c
      on c.id = r.target_stock_config_id
     and c.variant_id = r.variant_id
    join public.stock_count_session_items i
      on i.session_id = r.session_id
     and i.variant_id = r.variant_id
     and i.stock_config_id = r.target_stock_config_id
     and i.physical_quantity is not null
    left join public.product_inventory pi
      on pi.organization_id = p_warehouse_id
     and pi.variant_id = r.variant_id
     and pi.stock_config_id = r.target_stock_config_id
     and pi.is_active = true
    where r.session_id = p_session_id
      and r.variant_id = v_row.variant_id;

    if v_target_id is null then
      select string_agg(
        distinct coalesce(o.display_doc_no || ' / ' || o.order_no, o.order_no),
        ', ' order by coalesce(o.display_doc_no || ' / ' || o.order_no, o.order_no)
      )
        into v_order_refs
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.variant_id = v_row.variant_id
        and o.status = 'submitted'
        and o.order_type in ('D2H', 'S2D')
        and public.order_inventory_organization(o.id) = p_warehouse_id
        and (oi.stock_config_id is null or oi.stock_config_id = v_row.legacy_stock_config_id)
        and exists (
          select 1 from public.stock_movements sm
          where sm.reference_type = 'order'
            and sm.reference_id = o.id
            and sm.variant_id = oi.variant_id
            and sm.movement_type = 'allocation'
        )
        and not exists (
          select 1 from public.stock_movements sm
          where sm.reference_id = o.id
            and sm.variant_id = oi.variant_id
            and sm.movement_type in ('deallocation', 'order_fulfillment')
        );

      raise exception 'stock_count_allocation_target_required: %',
        format(
          '%s has %s reserved %s%s. Select the counted target configuration that should inherit the reservation, or ask Order Management to release/cancel the transaction before posting.',
          v_flavour,
          v_row.live_allocated,
          v_unit_label,
          case when v_order_refs is null then '' else format(' (%s)', v_order_refs) end
        );
    end if;

    if v_target_code not in ('20NB', '50NB', '50OB') then
      raise exception 'stock_count_allocation_target_invalid: %',
        format('The reservation target for %s is not a supported counted configuration.', v_flavour);
    end if;

    if v_target_physical < v_target_allocated + v_row.live_allocated then
      raise exception 'stock_count_allocation_target_insufficient: %',
        format(
          '%s must have a final Physical Count of at least %s in %s to cover %s existing/carried reserved %s.',
          v_flavour,
          v_target_allocated + v_row.live_allocated,
          v_target_code,
          v_target_allocated + v_row.live_allocated,
          case when v_target_allocated + v_row.live_allocated = 1 then 'unit' else 'units' end
        );
    end if;

    select coalesce(sum(oi.qty), 0)::integer,
           string_agg(
             distinct coalesce(o.display_doc_no || ' / ' || o.order_no, o.order_no),
             ', ' order by coalesce(o.display_doc_no || ' / ' || o.order_no, o.order_no)
           )
      into v_owner_quantity, v_order_refs
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.variant_id = v_row.variant_id
      and o.status = 'submitted'
      and o.order_type in ('D2H', 'S2D')
      and public.order_inventory_organization(o.id) = p_warehouse_id
      and (oi.stock_config_id is null or oi.stock_config_id = v_row.legacy_stock_config_id)
      and exists (
        select 1 from public.stock_movements sm
        where sm.reference_type = 'order'
          and sm.reference_id = o.id
          and sm.variant_id = oi.variant_id
          and sm.movement_type = 'allocation'
      )
      and not exists (
        select 1 from public.stock_movements sm
        where sm.reference_id = o.id
          and sm.variant_id = oi.variant_id
          and sm.movement_type in ('deallocation', 'order_fulfillment')
      );

    if v_owner_quantity is distinct from v_row.live_allocated then
      raise exception 'stock_count_allocation_owner_unresolved: %',
        format(
          '%s has %s reserved %s, but active order ownership reconciles to %s%s. No reservation was moved. Ask Order Management to resolve the historical allocation before posting.',
          v_flavour,
          v_row.live_allocated,
          v_unit_label,
          coalesce(v_owner_quantity, 0),
          case when v_order_refs is null then '' else format(' (%s)', v_order_refs) end
        );
    end if;

    if exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.variant_id = v_row.variant_id
        and o.status = 'submitted'
        and o.order_type in ('D2H', 'S2D')
        and public.order_inventory_organization(o.id) = p_warehouse_id
        and (oi.stock_config_id is null or oi.stock_config_id = v_row.legacy_stock_config_id)
        and exists (
          select 1 from public.stock_movements sm
          where sm.reference_type = 'order'
            and sm.reference_id = o.id
            and sm.variant_id = oi.variant_id
            and sm.movement_type = 'allocation'
        )
        and not public.distributor_can_receive_stock_config(o.buyer_org_id, v_target_id)
    ) then
      raise exception 'stock_count_allocation_target_not_sellable: %',
        format(
          'The selected target for %s cannot be supplied to one of the owning orders%s. Choose an allowed configuration or ask Order Management to resolve the order.',
          v_flavour,
          case when v_order_refs is null then '' else format(' (%s)', v_order_refs) end
        );
    end if;
  end loop;
end;
$$;

comment on function public.stock_count_assert_classification_postable(uuid, uuid) is
  'Initial physical-count/classification safety: permits genuine +/- variance, blocks already-classified stock, and requires every live Legacy allocation to reconcile to active orders plus an explicit counted target that can inherit it atomically.';

create or replace function public.stock_count_snapshot_hash(p_session_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'session', jsonb_build_object(
      'warehouse', s.warehouse_organization_id,
      'count_date', s.count_date,
      'count_type', s.count_type,
      'reference', coalesce(s.reference_name, ''),
      'posting_note', coalesce(s.notes, ''),
      'status', s.status
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stock_config_id', i.stock_config_id,
        'variant_id', i.variant_id,
        'stock_sku_snapshot', coalesce(i.sku, ''),
        'current_stock_sku', coalesce(c.stock_sku, ''),
        'current_volume_ml', c.volume_ml,
        'current_packaging', c.packaging,
        'system_quantity', i.system_quantity,
        'current_system_quantity', coalesce(pi.quantity_on_hand, 0),
        'current_allocated_quantity', coalesce(pi.quantity_allocated, 0),
        'physical_quantity', i.physical_quantity,
        'adjustment_quantity', i.adjustment_quantity,
        'unit_cost_snapshot', i.unit_cost,
        'current_variant_base_cost', pv.base_cost,
        'note', coalesce(i.note, '')
      ) order by i.stock_config_id, i.variant_id)
      from public.stock_count_session_items i
      join public.product_variants pv on pv.id = i.variant_id
      left join public.inventory_stock_configurations c
        on c.id = i.stock_config_id
       and c.variant_id = i.variant_id
      left join public.product_inventory pi
        on pi.variant_id = i.variant_id
       and pi.organization_id = s.warehouse_organization_id
       and pi.stock_config_id = i.stock_config_id
       and pi.is_active = true
      where i.session_id = s.id
    ), '[]'::jsonb),
    'allocation_resolutions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_id', r.variant_id,
        'target_stock_config_id', r.target_stock_config_id,
        'target_stock_sku', c.stock_sku
      ) order by r.variant_id, r.target_stock_config_id)
      from public.stock_count_classification_allocation_resolutions r
      join public.inventory_stock_configurations c
        on c.id = r.target_stock_config_id
       and c.variant_id = r.variant_id
      where r.session_id = s.id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.stock_count_sessions s
  where s.id = p_session_id
$$;

comment on function public.stock_count_snapshot_hash(uuid) is
  'Hashes Stock Count session data, exact balances including allocated quantities, and explicit Initial Classification reservation targets so any post-approval change invalidates the OTP.';

create or replace function public.stock_count_carry_classification_allocations(
  p_session_id uuid,
  p_warehouse_id uuid,
  p_user_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_order_item record;
  v_source_allocated integer;
  v_target_allocated integer;
  v_carried integer;
  v_movement_count integer := 0;
  v_company_id uuid;
begin
  v_company_id := public.get_company_id(p_warehouse_id);
  if v_company_id is null then
    raise exception 'organization_mismatch';
  end if;

  for v_row in
    select
      legacy.variant_id,
      legacy.stock_config_id as source_stock_config_id,
      r.target_stock_config_id,
      coalesce(source_pi.quantity_allocated, 0) as quantity_to_carry
    from public.stock_count_session_items legacy
    join public.inventory_stock_configurations source_cfg
      on source_cfg.id = legacy.stock_config_id
     and source_cfg.variant_id = legacy.variant_id
     and source_cfg.config_code = 'UNCLASSIFIED'
    join public.stock_count_classification_allocation_resolutions r
      on r.session_id = legacy.session_id
     and r.variant_id = legacy.variant_id
    join public.product_inventory source_pi
      on source_pi.organization_id = p_warehouse_id
     and source_pi.variant_id = legacy.variant_id
     and source_pi.stock_config_id = legacy.stock_config_id
     and source_pi.is_active = true
    where legacy.session_id = p_session_id
      and legacy.physical_quantity is not null
      and source_pi.quantity_allocated > 0
    order by legacy.variant_id
  loop
    select quantity_allocated
      into v_source_allocated
    from public.product_inventory
    where organization_id = p_warehouse_id
      and variant_id = v_row.variant_id
      and stock_config_id = v_row.source_stock_config_id
      and is_active = true
    for update;

    select quantity_allocated
      into v_target_allocated
    from public.product_inventory
    where organization_id = p_warehouse_id
      and variant_id = v_row.variant_id
      and stock_config_id = v_row.target_stock_config_id
      and is_active = true
    for update;

    if v_source_allocated is distinct from v_row.quantity_to_carry
       or v_target_allocated is null then
      raise exception 'stock_count_snapshot_changed';
    end if;

    v_carried := 0;
    for v_order_item in
      select
        oi.id as order_item_id,
        oi.qty,
        o.id as order_id,
        o.order_no,
        o.display_doc_no,
        o.buyer_org_id
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.variant_id = v_row.variant_id
        and o.status = 'submitted'
        and o.order_type in ('D2H', 'S2D')
        and public.order_inventory_organization(o.id) = p_warehouse_id
        and (oi.stock_config_id is null or oi.stock_config_id = v_row.source_stock_config_id)
        and exists (
          select 1 from public.stock_movements sm
          where sm.reference_type = 'order'
            and sm.reference_id = o.id
            and sm.variant_id = oi.variant_id
            and sm.movement_type = 'allocation'
        )
        and not exists (
          select 1 from public.stock_movements sm
          where sm.reference_id = o.id
            and sm.variant_id = oi.variant_id
            and sm.movement_type in ('deallocation', 'order_fulfillment')
        )
      order by o.created_at, o.id, oi.id
      for update of oi, o
    loop
      insert into public.stock_movements (
        movement_type, reference_type, reference_id, reference_no, variant_id,
        stock_config_id, from_organization_id, to_organization_id,
        quantity_change, quantity_before, quantity_after, company_id, created_by, notes
      ) values (
        'deallocation', 'order_config_change', v_order_item.order_id,
        coalesce(v_order_item.display_doc_no, v_order_item.order_no), v_row.variant_id,
        v_row.source_stock_config_id, v_order_item.buyer_org_id, p_warehouse_id,
        -v_order_item.qty, v_source_allocated - v_carried,
        v_source_allocated - v_carried - v_order_item.qty,
        v_company_id, p_user_id,
        'Initial Physical Count: reservation removed from Legacy/Unclassified'
      );

      insert into public.stock_movements (
        movement_type, reference_type, reference_id, reference_no, variant_id,
        stock_config_id, from_organization_id, to_organization_id,
        quantity_change, quantity_before, quantity_after, company_id, created_by, notes
      ) values (
        'allocation', 'order_config_change', v_order_item.order_id,
        coalesce(v_order_item.display_doc_no, v_order_item.order_no), v_row.variant_id,
        v_row.target_stock_config_id, p_warehouse_id, v_order_item.buyer_org_id,
        v_order_item.qty, v_target_allocated + v_carried,
        v_target_allocated + v_carried + v_order_item.qty,
        v_company_id, p_user_id,
        'Initial Physical Count: reservation carried to explicit counted configuration'
      );

      update public.order_items
      set stock_config_id = v_row.target_stock_config_id,
          stock_config_confirmed_at = now(),
          stock_config_confirmed_by = p_user_id,
          updated_at = now()
      where id = v_order_item.order_item_id;

      v_carried := v_carried + v_order_item.qty;
      v_movement_count := v_movement_count + 2;
    end loop;

    if v_carried is distinct from v_source_allocated then
      raise exception 'stock_count_allocation_owner_unresolved: %',
        format(
          'Expected to carry %s reserved units for variant %s, but active order ownership reconciled to %s. No inventory was changed.',
          v_source_allocated, v_row.variant_id, v_carried
        );
    end if;

    update public.product_inventory
    set quantity_allocated = 0,
        updated_at = now()
    where organization_id = p_warehouse_id
      and variant_id = v_row.variant_id
      and stock_config_id = v_row.source_stock_config_id
      and quantity_allocated = v_source_allocated;
    if not found then
      raise exception 'stock_count_snapshot_changed';
    end if;

    update public.product_inventory
    set quantity_allocated = quantity_allocated + v_carried,
        updated_at = now()
    where organization_id = p_warehouse_id
      and variant_id = v_row.variant_id
      and stock_config_id = v_row.target_stock_config_id
      and quantity_allocated = v_target_allocated;
    if not found then
      raise exception 'stock_count_snapshot_changed';
    end if;
  end loop;

  return v_movement_count;
end;
$$;

revoke all on function public.stock_count_carry_classification_allocations(uuid, uuid, uuid) from public;

create or replace function public.verify_and_post_stock_classification(
  p_request_id uuid,
  p_code_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '300s'
set lock_timeout = '30s'
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.stock_count_verification_requests%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_item record;
  v_current_snapshot text;
  v_adjustment_id uuid;
  v_reason_id uuid;
  v_company_id uuid;
  v_counted integer;
  v_variances integer;
  v_net integer;
  v_value numeric(15,2);
  v_allocation_movements integer := 0;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  select * into v_request
  from public.stock_count_verification_requests
  where id = p_request_id
  for update;
  if not found or v_request.requesting_user_id <> v_user_id then
    raise exception 'invalid_verification_code';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_request.session_id
  for update;
  if v_session.status = 'posted' then raise exception 'stock_count_already_posted'; end if;
  if v_session.count_type <> 'initial_configuration_classification' then
    raise exception 'stock_count_wrong_posting_function';
  end if;
  if v_request.status = 'posted' or v_request.consumed_at is not null then
    raise exception 'verification_code_already_used';
  end if;
  if v_request.status = 'expired' or v_request.expires_at <= now() then
    update public.stock_count_verification_requests
    set status = 'expired'
    where id = p_request_id and status <> 'expired';
    return jsonb_build_object('error_code', 'verification_code_expired');
  end if;
  if v_request.status <> 'active' then raise exception 'invalid_verification_code'; end if;
  if not public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) then
    raise exception 'permission_lost';
  end if;

  if exists (
    select 1
    from public.stock_count_session_items i
    join public.inventory_stock_configurations c
      on c.id = i.stock_config_id and c.variant_id = i.variant_id
    where i.session_id = v_session.id
      and c.config_code = 'UNCLASSIFIED'
      and i.physical_quantity is distinct from 0
  ) then raise exception 'stock_count_classification_legacy_not_cleared'; end if;

  if exists (
    select 1
    from public.stock_count_session_items i
    join public.inventory_stock_configurations c
      on c.id = i.stock_config_id and c.variant_id = i.variant_id
    where i.session_id = v_session.id
      and c.config_code = 'UNCLASSIFIED'
      and exists (
        select 1
        from public.inventory_stock_configurations target
        where target.variant_id = i.variant_id
          and target.config_code in ('20NB', '50NB', '50OB')
          and not exists (
            select 1
            from public.stock_count_session_items ti
            where ti.session_id = v_session.id
              and ti.variant_id = i.variant_id
              and ti.stock_config_id = target.id
              and ti.physical_quantity is not null
          )
      )
  ) then raise exception 'stock_count_classification_incomplete'; end if;

  v_company_id := public.get_company_id(v_session.warehouse_organization_id);
  if v_company_id is null then raise exception 'organization_mismatch'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, v_session.warehouse_organization_id::text,
              i.variant_id::text, i.stock_config_id::text), 0
  ))
  from public.stock_count_session_items i
  where i.session_id = v_session.id
    and i.physical_quantity is not null
  order by i.stock_config_id, i.variant_id;

  perform 1
  from public.product_inventory pi
  join public.stock_count_session_items i
    on i.variant_id = pi.variant_id
   and i.stock_config_id = pi.stock_config_id
  where i.session_id = v_session.id
    and pi.organization_id = v_session.warehouse_organization_id
    and pi.is_active = true
    and i.physical_quantity is not null
  order by i.stock_config_id, i.variant_id
  for update of pi;

  perform public.stock_count_assert_classification_postable(
    v_session.id, v_session.warehouse_organization_id
  );

  v_current_snapshot := public.stock_count_snapshot_hash(v_session.id);
  if v_current_snapshot is distinct from v_request.snapshot_hash then
    update public.stock_count_verification_requests
    set status = 'invalidated', invalidated_at = now(), snapshot_mismatch = true
    where id = p_request_id;
    return jsonb_build_object('error_code', 'stock_count_snapshot_changed');
  end if;

  if p_code_hash is distinct from v_request.code_hash then
    update public.stock_count_verification_requests
    set failed_attempt_count = least(failed_attempt_count + 1, 5),
        status = case when failed_attempt_count + 1 >= 5 then 'too_many_attempts' else status end,
        invalidated_at = case when failed_attempt_count + 1 >= 5 then now() else invalidated_at end
    where id = p_request_id;
    return jsonb_build_object('error_code', 'invalid_verification_code');
  end if;

  if exists (
    select 1 from public.stock_count_session_items
    where session_id = v_session.id
      and physical_quantity is not null
      and stock_config_id is null
  ) then raise exception 'stock_count_config_identity_missing'; end if;

  select
    count(*) filter (where physical_quantity is not null),
    count(*) filter (where coalesce(adjustment_quantity, 0) <> 0),
    coalesce(sum(adjustment_quantity) filter (where physical_quantity is not null), 0),
    coalesce(sum(adjustment_quantity * unit_cost) filter (where physical_quantity is not null), 0)
  into v_counted, v_variances, v_net, v_value
  from public.stock_count_session_items
  where session_id = v_session.id;

  -- Establish every target final physical balance first. This guarantees that
  -- an explicitly carried reservation never points to zero/insufficient stock.
  for v_item in
    select i.*, pi.warehouse_location
    from public.stock_count_session_items i
    join public.inventory_stock_configurations c
      on c.id = i.stock_config_id and c.variant_id = i.variant_id
    left join public.product_inventory pi
      on pi.variant_id = i.variant_id
     and pi.organization_id = v_session.warehouse_organization_id
     and pi.stock_config_id = i.stock_config_id
     and pi.is_active = true
    where i.session_id = v_session.id
      and c.config_code <> 'UNCLASSIFIED'
      and coalesce(i.adjustment_quantity, 0) <> 0
    order by i.stock_config_id, i.variant_id
  loop
    perform public.record_stock_movement(
      p_movement_type => 'adjustment',
      p_variant_id => v_item.variant_id,
      p_organization_id => v_session.warehouse_organization_id,
      p_quantity_change => v_item.adjustment_quantity,
      p_unit_cost => v_item.unit_cost,
      p_manufacturer_id => null,
      p_warehouse_location => v_item.warehouse_location,
      p_reason => 'Initial Physical Count & Configuration Classification',
      p_notes => coalesce(v_item.note, 'Final counted configuration balance'),
      p_reference_type => 'stock_classification',
      p_reference_id => v_session.id,
      p_reference_no => coalesce(v_session.reference_name, 'Initial Physical Count ' || v_session.count_date::text),
      p_company_id => v_request.organization_id,
      p_created_by => v_user_id,
      p_evidence_urls => null,
      p_stock_config_id => v_item.stock_config_id
    );
  end loop;

  v_allocation_movements := public.stock_count_carry_classification_allocations(
    v_session.id, v_session.warehouse_organization_id, v_user_id
  );

  -- Legacy can now safely reach zero because any reservation has already moved.
  for v_item in
    select i.*, pi.warehouse_location
    from public.stock_count_session_items i
    join public.inventory_stock_configurations c
      on c.id = i.stock_config_id and c.variant_id = i.variant_id
    left join public.product_inventory pi
      on pi.variant_id = i.variant_id
     and pi.organization_id = v_session.warehouse_organization_id
     and pi.stock_config_id = i.stock_config_id
     and pi.is_active = true
    where i.session_id = v_session.id
      and c.config_code = 'UNCLASSIFIED'
      and coalesce(i.adjustment_quantity, 0) <> 0
    order by i.stock_config_id, i.variant_id
  loop
    perform public.record_stock_movement(
      p_movement_type => 'adjustment',
      p_variant_id => v_item.variant_id,
      p_organization_id => v_session.warehouse_organization_id,
      p_quantity_change => v_item.adjustment_quantity,
      p_unit_cost => v_item.unit_cost,
      p_manufacturer_id => null,
      p_warehouse_location => v_item.warehouse_location,
      p_reason => 'Initial Physical Count & Configuration Classification',
      p_notes => coalesce(v_item.note, 'Legacy/Unclassified balance cleared after classification'),
      p_reference_type => 'stock_classification',
      p_reference_id => v_session.id,
      p_reference_no => coalesce(v_session.reference_name, 'Initial Physical Count ' || v_session.count_date::text),
      p_company_id => v_request.organization_id,
      p_created_by => v_user_id,
      p_evidence_urls => null,
      p_stock_config_id => v_item.stock_config_id
    );
  end loop;

  select id into v_reason_id
  from public.stock_adjustment_reasons
  where is_active = true and reason_name ilike '%count%'
  order by created_at
  limit 1;

  insert into public.stock_adjustments (
    organization_id, reason_id, notes, status, created_by, manufacturer_status
  ) values (
    v_session.warehouse_organization_id, v_reason_id, v_session.notes,
    'completed', v_user_id, 'draft'
  )
  returning id into v_adjustment_id;

  insert into public.stock_adjustment_items (
    adjustment_id, variant_id, stock_config_id, system_quantity,
    physical_quantity, adjustment_quantity, unit_cost
  )
  select
    v_adjustment_id, variant_id, stock_config_id, system_quantity,
    physical_quantity, adjustment_quantity, unit_cost
  from public.stock_count_session_items
  where session_id = v_session.id
    and coalesce(adjustment_quantity, 0) <> 0;

  update public.stock_count_sessions
  set status = 'posted',
      posted_by = v_user_id,
      posted_at = now(),
      total_variants_counted = v_counted,
      variance_items = v_variances,
      net_quantity_adjustment = v_net,
      estimated_adjustment_value = v_value,
      updated_by = v_user_id,
      updated_at = now()
  where id = v_session.id and status = 'draft';
  if not found then raise exception 'stock_count_already_posted'; end if;

  update public.stock_count_verification_requests
  set status = 'posted',
      verified_by = v_user_id,
      verified_at = now(),
      consumed_at = now(),
      code_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'),
      posting_result = jsonb_build_object(
        'status', 'posted',
        'adjustment_movement_count', v_variances,
        'allocation_movement_count', v_allocation_movements,
        'movement_count', v_variances + v_allocation_movements,
        'adjustment_id', v_adjustment_id
      )
  where id = p_request_id;

  update public.stock_count_verification_requests
  set status = 'invalidated', invalidated_at = now()
  where session_id = v_session.id
    and id <> p_request_id
    and status in ('pending_delivery', 'active');

  return jsonb_build_object(
    'status', 'posted',
    'session_id', v_session.id,
    'adjustment_movement_count', v_variances,
    'allocation_movement_count', v_allocation_movements,
    'movement_count', v_variances + v_allocation_movements
  );
end;
$$;

comment on function public.verify_and_post_stock_classification(uuid, text) is
  'Atomically posts Initial physical-count variance, establishes exact target balances, carries explicitly mapped active order reservations to their counted configurations, clears Legacy, and records adjustment/order audit movements. Single-use OTP, snapshot, row locks and draft-only update keep the operation idempotent.';

revoke all on function public.verify_and_post_stock_classification(uuid, text) from public;
grant execute on function public.verify_and_post_stock_classification(uuid, text) to authenticated;

commit;
