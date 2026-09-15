-- ============================================================================
-- H2M warehouse receipt — inventory destination resolution
-- ----------------------------------------------------------------------------
-- Problem (staging, ORD26000024 "Corn" line):
--   post_warehouse_receipt (20260726 cut-off version) requires an explicit
--   order_items.stock_config_id. H2M order creation never sets it; the only
--   writer was the 2026-08-01 opening-balance cut-off, and it only linked H2M
--   lines that still had remaining incoming quantity. Every other H2M line —
--   fully received legacy lines and every order created afterwards — fails with
--   warehouse_receipt_order_item_configuration_missing_or_conflicting, even
--   though master data has exactly one canonical destination for the variant.
--   20260904100000 repointed forward write paths at
--   resolve_operational_stock_config() but did not include this function.
--
-- Fix: resolve the destination with the existing rules, first match wins:
--   1. explicit order_items.stock_config_id            (unchanged)
--   2. continuity with previous posted receipts of the same order + variant
--      (receipt line, else its stock movement), ignoring configurations retired
--      by LEGACY-CONFIG-CUTOVER-2026 (legacy_cutover_config_codes())
--   3. resolve_operational_stock_config(variant)        (canonical resolver)
-- The chosen configuration must still be an active allow_ord configuration of
-- the variant. Conflicting explicit lines, several previous destinations, or
-- zero / several canonical candidates keep the receipt blocked.
--
-- Nothing else changes: same signature, permission check, idempotency, order /
-- cut-off / freeze guards, advisory lock, fully-received rule, extra handling,
-- movement posting and return shape (each item additionally reports
-- stock_config_source). Resolution is read-only: order_items are not modified.
-- The function body is copied from
-- 20260726_inventory_opening_balance_cutoff/03_cutoff_atomic_posting.sql,
-- which is identical to the installed definition.
-- No table, column, constraint or index change.
-- ============================================================================

begin;

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
  v_config_source text;
  v_order_item_rows integer;
  v_unit_cost numeric;
  v_movement uuid;
  v_total_received integer := 0;
  v_total_ordered integer := 0;
  v_order_previous integer := 0;
  v_total_extra_added integer := 0;
  v_items_out jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and (auth.uid() is null or p_received_by is distinct from auth.uid()) then
    raise exception 'permission_denied';
  end if;
  if p_receipt_type not in ('full','partial') then raise exception 'invalid_receipt_type'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception 'receipt_items_required'; end if;
  if jsonb_array_length(p_items) <> (
    select count(distinct value->>'variant_id') from jsonb_array_elements(p_items)
  ) then raise exception 'warehouse_receipt_duplicate_variant_items'; end if;

  -- A retry of an already committed receipt is always safe, including after a
  -- later cut-off marks the order History Only or freezes the warehouse.
  if nullif(trim(p_idempotency_key),'') is not null then
    select * into v_existing from public.warehouse_receipts
      where idempotency_key=p_idempotency_key limit 1;
    if found then return jsonb_build_object(
      'receipt_id',v_existing.id,'receipt_no',v_existing.receipt_no,
      'receipt_type',v_existing.receipt_type,'total_received',v_existing.total_received,
      'cumulative_received',v_existing.cumulative_received,
      'extra_received',v_existing.extra_received,'idempotent_replay',true); end if;
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.order_type<>'H2M' or v_order.status not in ('approved','closed')
     or v_order.company_id<>p_company_id or v_order.seller_org_id<>p_manufacturer_org_id
     or public.resolve_order_destination_warehouse(v_order.buyer_org_id)<>p_warehouse_org_id then
    raise exception 'warehouse_receipt_order_mismatch';
  end if;
  perform public.inventory_cutoff_assert_not_frozen(p_warehouse_org_id);

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

    -- Inventory destination (stock configuration), first match wins:
    --   1. order_item        explicit order_items.stock_config_id (unchanged rule)
    --   2. previous_receipt  continuity with earlier posted receipts of this
    --                        order + variant; configurations retired by
    --                        LEGACY-CONFIG-CUTOVER-2026 are not a signal
    --   3. canonical         resolve_operational_stock_config(variant)
    -- The result must still be an active allow_ord configuration of the variant.
    -- Conflicts, ambiguity or no match block the receipt; nothing is guessed.
    select count(*)::integer,min(oi.stock_config_id::text)::uuid,count(distinct oi.stock_config_id)
      into v_order_item_rows,v_config,v_config_count
    from public.order_items oi where oi.order_id=p_order_id and oi.variant_id=v_variant;
    v_config_source:='order_item';
    if v_order_item_rows=0 or v_config_count>1 then
      raise exception 'warehouse_receipt_order_item_configuration_missing_or_conflicting: variant %',v_variant;
    end if;

    if v_config is null then
      v_config_source:='previous_receipt';
      select min(prev.stock_config_id::text)::uuid,count(distinct prev.stock_config_id)
        into v_config,v_config_count
      from (
        select coalesce(ri.stock_config_id,sm.stock_config_id) stock_config_id
        from public.warehouse_receipt_items ri
        left join public.stock_movements sm on sm.id=ri.stock_movement_id
        where ri.order_id=p_order_id and ri.variant_id=v_variant and ri.received_now>0
      ) prev
      join public.inventory_stock_configurations pc on pc.id=prev.stock_config_id
      where pc.config_code<>all(public.legacy_cutover_config_codes());
      if v_config_count>1 then
        raise exception 'warehouse_receipt_order_item_configuration_missing_or_conflicting: variant % (previous receipts landed in more than one configuration)',v_variant;
      end if;
    end if;

    if v_config is null then
      v_config_source:='canonical';
      begin
        v_config:=public.resolve_operational_stock_config(v_variant);
      exception when no_data_found or cardinality_violation then
        raise exception 'warehouse_receipt_order_item_configuration_missing_or_conflicting: variant % (%)',v_variant,sqlerrm;
      end;
    end if;

    if v_config is null or not exists(
      select 1 from public.inventory_stock_configurations c
      where c.id=v_config and c.variant_id=v_variant and c.status='active' and c.allow_ord
    ) then raise exception 'warehouse_receipt_order_item_configuration_missing_or_conflicting: variant %',v_variant; end if;

    select coalesce(sum(qty),0)::integer,coalesce(max(unit_price),0)
      into v_ordered,v_unit_cost from public.order_items
      where order_id=p_order_id and variant_id=v_variant;
    if v_ordered<=0 then raise exception 'warehouse_receipt_variant_not_ordered'; end if;
    select coalesce(sum(received_now),0)::integer into v_previous
      from public.warehouse_receipt_items where order_id=p_order_id and variant_id=v_variant;
    if v_received>0 and v_previous>=v_ordered then
      raise exception 'warehouse_receipt_order_already_fully_received: variant %',v_variant;
    end if;
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
      'stock_movement_id',v_movement,'stock_config_source',v_config_source);
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
  'Posts only received_now for approved/closed H2M orders. Destination: explicit order-item configuration, else the configuration previous receipts of the same order line used (legacy cut-over codes excluded), else resolve_operational_stock_config(); it must be an active allow_ord configuration of the variant. Conflicting or ambiguous destinations block receiving; partial outstanding remains incoming.';

commit;
