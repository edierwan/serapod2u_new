-- ============================================================================
-- Security & Access Final Wave — C. Supply Chain, RoadTour, Customer & Growth,
--                                   E-Commerce and platform operations
-- ----------------------------------------------------------------------------
-- Requires migrations A (…100000) and B (…110000).
--
-- Purpose
--   1. Database backstops (sa_require_operation) injected into the remaining
--      Supply Chain / inventory / customer workflow RPCs that authenticated
--      clients call directly. No-op until each permission is NEW_ENFORCED.
--      Where the in-body legacy check is a pure ROLE check (is_hq_admin(),
--      role_level, sa_assert_staff_actor) it is kept for LEGACY/SHADOW and
--      skipped in NEW_ENFORCED, so S&A is the authority. Organization/tenant
--      checks (can_access_org, org equality) always remain.
--   2. Order maker/checker (existing business rule "you cannot approve an
--      order you created", until now enforced only in the browser) is
--      enforced inside orders_approve.
--   3. Direct-write guards for API roles (anon/authenticated) — the Stock
--      Count lesson applied to every protected workflow table:
--        ALWAYS (the application never performs these writes directly; each
--        is a workflow bypass):
--          * orders: status → 'approved' outside orders_approve()
--          * documents: status change of a PAYMENT_REQUEST outside
--            approve_payment_request()
--          * stock_transfers: any insert/update/delete (RPCs only)
--          * stock_movements: insert (movements are written by RPCs, and a
--            trigger applies them to inventory)
--          * return_cases / return_case_items: any write (server only)
--        NEW_ENFORCED only (the application performs these directly today;
--        in legacy modes the existing RLS decides):
--          * orders: submit / cancel / ship transitions
--          * documents: acknowledgement
--          * product_inventory: quantity changes
--          * points_transactions: manual points and redemption updates
--      SECURITY DEFINER workflow functions and the service role are not API
--      roles and are unaffected.
--
-- No migration mode is changed here.
--
-- Rollback guidance
--   * RPCs: execute sa_function_guard_injections.original_definition for the
--     signatures listed in this file.
--   * drop the sa_*_api_write_guard triggers and functions created here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
-- sa_api_require_any_org() is defined in migration B.

-- ---------------------------------------------------------------------------
-- 2. Workflow RPC backstops
-- ---------------------------------------------------------------------------
-- Orders --------------------------------------------------------------------
select public.sa_inject_operation_guard(
  'public.orders_approve(uuid)'::regprocedure, 'supply_chain.order.approve',
  $g$PERFORM public.sa_require_operation('supply_chain.order.approve', jsonb_build_object('organization_id', (SELECT CASE WHEN o.order_type::text = 'H2M' THEN o.buyer_org_id ELSE o.seller_org_id END FROM public.orders o WHERE o.id = p_order_id)), 'order', p_order_id::text);
  PERFORM public.sa_enforce_same_document_sod('order-maker-checker', p_order_id::text, auth.uid(), ARRAY(SELECT o.created_by FROM public.orders o WHERE o.id = p_order_id));$g$);

select public.sa_inject_operation_guard(
  'public.submit_and_allocate_d2h_order(uuid,uuid,uuid,uuid,jsonb,text,uuid,text,date)'::regprocedure, 'supply_chain.order.create',
  $g$PERFORM public.sa_require_operation('supply_chain.order.create', jsonb_build_object('organization_id', p_buyer_org_id), 'order', null);$g$);

select public.sa_inject_operation_guard(
  'public.allocate_inventory_for_order(uuid)'::regprocedure, 'supply_chain.order.create',
  $g$PERFORM public.sa_require_operation('supply_chain.order.create', jsonb_build_object('organization_id', (SELECT o.buyer_org_id FROM public.orders o WHERE o.id = p_order_id)), 'order', p_order_id::text);$g$);

-- Documents -------------------------------------------------------------------
select public.sa_inject_operation_guard(
  'public.po_acknowledge(uuid)'::regprocedure, 'supply_chain.document.acknowledge',
  $g$PERFORM public.sa_require_operation('supply_chain.document.acknowledge', jsonb_build_object('organization_id', (SELECT d.issued_to_org_id FROM public.documents d WHERE d.id = p_document_id)), 'document', p_document_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.invoice_acknowledge(uuid,text)'::regprocedure, 'supply_chain.document.acknowledge',
  $g$PERFORM public.sa_require_operation('supply_chain.document.acknowledge', jsonb_build_object('organization_id', (SELECT d.issued_to_org_id FROM public.documents d WHERE d.id = p_document_id)), 'document', p_document_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.payment_acknowledge(uuid)'::regprocedure, 'supply_chain.document.acknowledge',
  $g$PERFORM public.sa_require_operation('supply_chain.document.acknowledge', jsonb_build_object('organization_id', (SELECT d.issued_to_org_id FROM public.documents d WHERE d.id = p_document_id)), 'document', p_document_id::text);$g$);

-- Inventory adjustments, receipts, shipments, returns -----------------------
select public.sa_inject_operation_guard(
  'public.post_manual_stock_addition(uuid,uuid,jsonb,text,text,uuid,text,text,uuid,uuid)'::regprocedure, 'inventory.adjustment.post',
  $g$PERFORM public.sa_require_operation('inventory.adjustment.post', jsonb_build_object('organization_id', p_organization_id, 'warehouse_id', p_organization_id), 'stock_addition', p_request_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.wms_reverse_manual_movement(uuid,text,uuid)'::regprocedure, 'inventory.adjustment.post',
  $g$PERFORM public.sa_require_operation('inventory.adjustment.post', jsonb_build_object('organization_id', (SELECT coalesce(m.from_organization_id, m.to_organization_id) FROM public.stock_movements m WHERE m.id = p_movement_id), 'warehouse_id', (SELECT coalesce(m.from_organization_id, m.to_organization_id) FROM public.stock_movements m WHERE m.id = p_movement_id)), 'stock_movement', p_movement_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.post_warehouse_receipt(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text)'::regprocedure, 'warehouse.receipt.post',
  $g$PERFORM public.sa_require_operation('warehouse.receipt.post', jsonb_build_object('organization_id', p_warehouse_org_id, 'warehouse_id', p_warehouse_org_id), 'warehouse_receipt', p_batch_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.wms_ship_mixed(uuid,uuid,uuid,uuid,integer,jsonb,uuid,text,text)'::regprocedure, 'warehouse.shipment.manage',
  $g$PERFORM public.sa_require_operation('warehouse.shipment.manage', jsonb_build_object('organization_id', p_warehouse_id, 'warehouse_id', p_warehouse_id), 'shipment', null);$g$);
select public.sa_inject_operation_guard(
  'public.wms_ship_master_auto(uuid)'::regprocedure, 'warehouse.shipment.manage',
  $g$PERFORM public.sa_require_operation('warehouse.shipment.manage', jsonb_build_object('organization_id', (SELECT mc.warehouse_org_id FROM public.qr_master_codes mc WHERE mc.id = p_master_code_id), 'warehouse_id', (SELECT mc.warehouse_org_id FROM public.qr_master_codes mc WHERE mc.id = p_master_code_id)), 'qr_master_code', p_master_code_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.post_return_case_inventory(uuid)'::regprocedure, 'inventory.return.manage',
  $g$PERFORM public.sa_require_operation('inventory.return.manage', jsonb_build_object('organization_id', (SELECT rc.return_warehouse_id FROM public.return_cases rc WHERE rc.id = p_return_case_id), 'warehouse_id', (SELECT rc.return_warehouse_id FROM public.return_cases rc WHERE rc.id = p_return_case_id)), 'return_case', p_return_case_id::text);$g$);

-- Stock transfers (Wave 1 pilot permissions) --------------------------------
select public.sa_inject_operation_guard(
  'public.save_stock_transfer_draft(uuid,uuid,uuid,jsonb,text,date,uuid,uuid)'::regprocedure, 'inventory.transfer.request',
  $g$PERFORM public.sa_require_operation('inventory.transfer.request', jsonb_build_object('organization_id', p_from_organization_id, 'warehouse_id', p_from_organization_id), 'stock_transfer', null);$g$);
select public.sa_inject_operation_guard(
  'public.submit_stock_transfer_for_approval(uuid,uuid)'::regprocedure, 'inventory.transfer.request',
  $g$PERFORM public.sa_require_operation('inventory.transfer.request', jsonb_build_object('organization_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id), 'warehouse_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id)), 'stock_transfer', p_transfer_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.approve_stock_transfer(uuid,uuid)'::regprocedure, 'inventory.transfer.approve',
  $g$PERFORM public.sa_require_operation('inventory.transfer.approve', jsonb_build_object('organization_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id), 'warehouse_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id)), 'stock_transfer', p_transfer_id::text);$g$,
  jsonb_build_array(jsonb_build_array('IF NOT public\.is_hq_admin\(\) THEN',
    $r$IF public.sa_legacy_guard_unless_new('inventory.transfer.approve') AND NOT public.is_hq_admin() THEN$r$)));
select public.sa_inject_operation_guard(
  'public.reject_stock_transfer(uuid,uuid,text)'::regprocedure, 'inventory.transfer.approve',
  $g$PERFORM public.sa_require_operation('inventory.transfer.approve', jsonb_build_object('organization_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id), 'warehouse_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id)), 'stock_transfer', p_transfer_id::text);$g$,
  jsonb_build_array(jsonb_build_array('IF NOT public\.is_hq_admin\(\) THEN',
    $r$IF public.sa_legacy_guard_unless_new('inventory.transfer.approve') AND NOT public.is_hq_admin() THEN$r$)));
select public.sa_inject_operation_guard(
  'public.cancel_stock_transfer(uuid,uuid,text)'::regprocedure, 'inventory.transfer.cancel',
  $g$PERFORM public.sa_require_operation('inventory.transfer.cancel', jsonb_build_object('organization_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id), 'warehouse_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id)), 'stock_transfer', p_transfer_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.dispatch_stock_transfer(uuid,uuid)'::regprocedure, 'inventory.transfer.dispatch',
  $g$PERFORM public.sa_require_operation('inventory.transfer.dispatch', jsonb_build_object('organization_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id), 'warehouse_id', (SELECT t.from_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id)), 'stock_transfer', p_transfer_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.receive_stock_transfer(uuid,uuid)'::regprocedure, 'inventory.transfer.receive',
  $g$PERFORM public.sa_require_operation('inventory.transfer.receive', jsonb_build_object('organization_id', (SELECT t.to_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id), 'warehouse_id', (SELECT t.to_organization_id FROM public.stock_transfers t WHERE t.id = p_transfer_id)), 'stock_transfer', p_transfer_id::text);$g$);

-- Opening balance / cut-off ---------------------------------------------------
do $cutoff$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.cancel_inventory_opening_cutoff(uuid,text)',
    'public.set_inventory_cutoff_decision(uuid,uuid,text)',
    'public.apply_inventory_cutoff_d2h_policy(uuid,text,uuid[],text,uuid)',
    'public.apply_inventory_cutoff_h2m_bulk(uuid,text,uuid[],text,uuid)',
    'public.apply_inventory_cutoff_h2m_policy(uuid,text,uuid[],text,uuid)',
    'public.apply_inventory_cutoff_transactions_policy(uuid,text,jsonb,text,uuid)',
    'public.resolve_inventory_cutoff_allocation(uuid,uuid,uuid,text,uuid,integer,integer,text,uuid)',
    'public.resolve_inventory_cutoff_h2m_incoming(uuid,uuid[])',
    'public.bind_inventory_cutoff_verification_snapshot(uuid,uuid)'
  ] loop
    if to_regprocedure(v_sig) is null then raise notice '% not present, skipped', v_sig; continue; end if;
    perform public.sa_inject_operation_guard(v_sig::regprocedure, 'inventory.opening_balance.manage',
      $g$PERFORM public.sa_require_operation('inventory.opening_balance.manage', jsonb_build_object('organization_id', (SELECT c.warehouse_organization_id FROM public.inventory_opening_cutoffs c WHERE c.id = p_cutoff_id), 'warehouse_id', (SELECT c.warehouse_organization_id FROM public.inventory_opening_cutoffs c WHERE c.id = p_cutoff_id)), 'inventory_opening_cutoff', p_cutoff_id::text);$g$);
  end loop;
  if to_regprocedure('public.start_inventory_opening_cutoff(uuid,timestamp with time zone)') is not null then
    perform public.sa_inject_operation_guard('public.start_inventory_opening_cutoff(uuid,timestamp with time zone)'::regprocedure,
      'inventory.opening_balance.manage',
      $g$PERFORM public.sa_require_operation('inventory.opening_balance.manage', jsonb_build_object('organization_id', (SELECT s.warehouse_organization_id FROM public.stock_count_sessions s WHERE s.id = p_session_id), 'warehouse_id', (SELECT s.warehouse_organization_id FROM public.stock_count_sessions s WHERE s.id = p_session_id)), 'stock_count', p_session_id::text);$g$);
  end if;
end
$cutoff$;

-- Stock configurations and product catalogue (HQ-level operations) ------------
select public.sa_inject_operation_guard(
  'public.enable_variant_stock_configurations(uuid)'::regprocedure, 'inventory.stock_config.manage',
  $g$PERFORM public.sa_require_operation('inventory.stock_config.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'product_variant', p_variant_id::text);$g$,
  jsonb_build_array(jsonb_build_array('IF auth\.role\(\) = ''authenticated'' AND NOT public\.is_hq_admin\(\) THEN',
    $r$IF auth.role() = 'authenticated' AND public.sa_legacy_guard_unless_new('inventory.stock_config.manage') AND NOT public.is_hq_admin() THEN$r$)));
select public.sa_inject_operation_guard(
  'public.archive_product_variant(uuid)'::regprocedure, 'product.catalog.manage',
  $g$PERFORM public.sa_require_operation('product.catalog.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'product_variant', p_variant_id::text);$g$,
  jsonb_build_array(jsonb_build_array('IF NOT public\.is_hq_admin\(\) THEN',
    $r$IF public.sa_legacy_guard_unless_new('product.catalog.manage') AND NOT public.is_hq_admin() THEN$r$)));
do $cfg$
begin
  if to_regprocedure('public.enable_variant_stock_configurations_with_profile(uuid,text)') is not null then
    perform public.sa_inject_operation_guard('public.enable_variant_stock_configurations_with_profile(uuid,text)'::regprocedure,
      'inventory.stock_config.manage',
      $g$PERFORM public.sa_require_operation('inventory.stock_config.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'product_variant', p_variant_id::text);$g$);
  end if;
  if to_regprocedure('public.bulk_enable_variant_stock_configurations(uuid[])') is not null then
    perform public.sa_inject_operation_guard('public.bulk_enable_variant_stock_configurations(uuid[])'::regprocedure,
      'inventory.stock_config.manage',
      $g$PERFORM public.sa_require_operation('inventory.stock_config.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'product_variant', null);$g$);
  end if;
end
$cfg$;

-- QR and manufacturing -----------------------------------------------------
select public.sa_inject_operation_guard(
  'public.mark_batch_as_printed(uuid)'::regprocedure, 'qr.batch.manage',
  $g$PERFORM public.sa_require_operation('qr.batch.manage', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'qr_batch', p_batch_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(40\);',
    $r$IF public.sa_legacy_guard_unless_new('qr.batch.manage') THEN PERFORM public.sa_assert_staff_actor(40); END IF;$r$)));
select public.sa_inject_operation_guard(
  'public.manufacturer_acknowledge_adjustment(uuid,text)'::regprocedure, 'manufacturing.adjustment.manage',
  $g$PERFORM public.sa_require_operation('manufacturing.adjustment.manage', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'manufacturer_adjustment', p_adjustment_id::text);$g$);

-- Customer & Growth ---------------------------------------------------------
select public.sa_inject_operation_guard(
  'public.ellbow_admin_adjust_points(uuid,text,bigint,text,text)'::regprocedure, 'customer.loyalty.adjust',
  $g$PERFORM public.sa_require_operation('customer.loyalty.adjust', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'loyalty_wallet', p_owner_user_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.ellbow_update_redemption_status(uuid,text,text)'::regprocedure, 'customer.redemption.manage',
  $g$PERFORM public.sa_require_operation('customer.redemption.manage', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'redemption', p_redemption_id::text);$g$);
do $loyalty$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.loyalty_program_admin_update_user_membership(uuid,text,uuid,text,text)',
    'public.loyalty_program_admin_upsert_organization_membership(uuid,text,text,text)',
    'public.loyalty_program_admin_upsert_user_membership(uuid,text,uuid,text,text,text)'
  ] loop
    if to_regprocedure(v_sig) is null then continue; end if;
    perform public.sa_inject_operation_guard(v_sig::regprocedure, 'customer.program.manage',
      $g$PERFORM public.sa_require_operation('customer.program.manage', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'loyalty_membership', null);$g$);
  end loop;
end
$loyalty$;
select public.sa_inject_operation_guard(
  'public.process_referral_claim(uuid,text,uuid,text,text)'::regprocedure, 'customer.shop.manage',
  $g$PERFORM public.sa_require_operation('customer.shop.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'referral_claim', p_claim_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20, false, p_reviewer_id\);',
    $r$IF public.sa_legacy_guard_unless_new('customer.shop.manage') THEN PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id); ELSE PERFORM public.sa_assert_actor(p_reviewer_id); END IF;$r$)));
select public.sa_inject_operation_guard(
  'public.approve_reference_change(uuid,text,uuid,text)'::regprocedure, 'customer.shop.manage',
  $g$PERFORM public.sa_require_operation('customer.shop.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'reference_change', p_change_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20, false, p_reviewer_id\);',
    $r$IF public.sa_legacy_guard_unless_new('customer.shop.manage') THEN PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id); ELSE PERFORM public.sa_assert_actor(p_reviewer_id); END IF;$r$)));
select public.sa_inject_operation_guard(
  'public.bulk_reassign_reference(uuid,uuid,uuid,boolean)'::regprocedure, 'customer.shop.manage',
  $g$PERFORM public.sa_require_operation('customer.shop.manage', jsonb_build_object('organization_id', public.sa_actor_company_id()), 'reference', p_old_reference_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20, false, p_admin_id\);',
    $r$IF public.sa_legacy_guard_unless_new('customer.shop.manage') THEN PERFORM public.sa_assert_staff_actor(20, false, p_admin_id); ELSE PERFORM public.sa_assert_actor(p_admin_id); END IF;$r$)));

-- ---------------------------------------------------------------------------
-- 3. Direct-write guards for API roles
-- ---------------------------------------------------------------------------
create or replace function public.sa_orders_api_write_guard()
returns trigger language plpgsql
-- SECURITY INVOKER: current_user must be the caller's role.
set search_path = pg_catalog, pg_temp as $$
declare
  v_orgs uuid[];
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  v_orgs := array[new.buyer_org_id, new.seller_org_id];
  if tg_op = 'INSERT' then
    if new.status::text not in ('draft','submitted') then
      raise exception 'order_status_transition_not_allowed' using errcode = '42501';
    end if;
    perform public.sa_api_require_any_org('supply_chain.order.create', v_orgs);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status::text = 'approved' then
    -- Approval creates PO/SO/DO/invoice documents and allocates stock; it is
    -- only valid through orders_approve().
    raise exception 'order_approval_requires_workflow' using errcode = '42501';
  elsif new.status::text = 'submitted' then
    perform public.sa_api_require_any_org('supply_chain.order.create', v_orgs);
  elsif new.status::text = 'cancelled' then
    perform public.sa_api_require_any_org('supply_chain.order.cancel', v_orgs);
  elsif new.status::text = 'shipped_distributor' then
    perform public.sa_api_require_any_org('warehouse.shipment.manage', v_orgs);
  else
    perform public.sa_api_require_any_org('supply_chain.order.approve', v_orgs);
  end if;
  return new;
end $$;
revoke all on function public.sa_orders_api_write_guard() from public, anon, authenticated;
drop trigger if exists sa_orders_api_write_guard on public.orders;
create trigger sa_orders_api_write_guard before insert or update of status on public.orders
for each row execute function public.sa_orders_api_write_guard();

create or replace function public.sa_documents_api_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.doc_type::text = 'PAYMENT_REQUEST' and tg_op = 'UPDATE' then
    -- Approval creates the balance PAYMENT document; only through
    -- approve_payment_request().
    raise exception 'payment_request_approval_requires_workflow' using errcode = '42501';
  end if;
  if new.status::text in ('acknowledged','completed') then
    perform public.sa_api_require_any_org('supply_chain.document.acknowledge', array[new.issued_to_org_id]);
  end if;
  return new;
end $$;
revoke all on function public.sa_documents_api_write_guard() from public, anon, authenticated;
drop trigger if exists sa_documents_api_write_guard on public.documents;
create trigger sa_documents_api_write_guard before insert or update of status on public.documents
for each row execute function public.sa_documents_api_write_guard();

create or replace function public.sa_workflow_only_api_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if current_user not in ('anon','authenticated') then return coalesce(new, old); end if;
  raise exception '%_writes_require_workflow', tg_table_name using errcode = '42501';
end $$;
revoke all on function public.sa_workflow_only_api_write_guard() from public, anon, authenticated;

do $workflow_only$
declare t text;
begin
  foreach t in array array['stock_transfers','return_cases','return_case_items'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists sa_workflow_only_api_write_guard on public.%I', t);
    execute format('create trigger sa_workflow_only_api_write_guard before insert or update or delete on public.%I
                    for each row execute function public.sa_workflow_only_api_write_guard()', t);
    execute format('revoke truncate on table public.%I from anon, authenticated', t);
  end loop;
  if to_regclass('public.stock_movements') is not null then
    drop trigger if exists sa_workflow_only_api_write_guard on public.stock_movements;
    create trigger sa_workflow_only_api_write_guard before insert or update or delete on public.stock_movements
      for each row execute function public.sa_workflow_only_api_write_guard();
    revoke truncate on table public.stock_movements from anon, authenticated;
  end if;
end
$workflow_only$;

create or replace function public.sa_product_inventory_api_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if current_user not in ('anon','authenticated') then return coalesce(new, old); end if;
  if tg_op = 'UPDATE'
     -- quantity_available / total_value are GENERATED (null in BEFORE
     -- triggers); the stored quantities and cost are what matter.
     and new.quantity_on_hand is not distinct from old.quantity_on_hand
     and new.quantity_allocated is not distinct from old.quantity_allocated
     and new.average_cost is not distinct from old.average_cost
     and new.organization_id is not distinct from old.organization_id
     and new.variant_id is not distinct from old.variant_id
     and new.stock_config_id is not distinct from old.stock_config_id then
    return new; -- settings columns (reorder point, safety stock, ...) keep legacy RLS
  end if;
  perform public.sa_api_require_any_org('inventory.adjustment.post', array[coalesce(new.organization_id, old.organization_id)]);
  return coalesce(new, old);
end $$;
revoke all on function public.sa_product_inventory_api_write_guard() from public, anon, authenticated;
drop trigger if exists sa_product_inventory_api_write_guard on public.product_inventory;
create trigger sa_product_inventory_api_write_guard before insert or update or delete on public.product_inventory
for each row execute function public.sa_product_inventory_api_write_guard();
revoke truncate on table public.product_inventory from anon, authenticated;

create or replace function public.sa_points_api_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if current_user not in ('anon','authenticated') then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and new.transaction_type = 'redeem' and coalesce(new.points_amount, 0) < 0 then
    return new; -- consumer/shop redemption debit: existing RLS decides
  end if;
  if tg_op = 'INSERT' then
    perform public.sa_api_require_any_org('customer.loyalty.adjust', array[new.company_id, public.sa_actor_org_id()]);
  elsif tg_op = 'UPDATE' then
    perform public.sa_api_require_any_org('customer.redemption.manage', array[new.company_id, public.sa_actor_org_id()]);
  else
    perform public.sa_api_require_any_org('customer.loyalty.adjust', array[old.company_id, public.sa_actor_org_id()]);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.sa_points_api_write_guard() from public, anon, authenticated;
drop trigger if exists sa_points_api_write_guard on public.points_transactions;
create trigger sa_points_api_write_guard before insert or update or delete on public.points_transactions
for each row execute function public.sa_points_api_write_guard();
revoke truncate on table public.points_transactions from anon, authenticated;
revoke truncate on table public.orders, public.documents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(sig, ', ') into v_missing from unnest(array[
    'public.orders_approve(uuid)', 'public.approve_stock_transfer(uuid,uuid)', 'public.dispatch_stock_transfer(uuid,uuid)',
    'public.receive_stock_transfer(uuid,uuid)', 'public.post_warehouse_receipt(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text)',
    'public.post_manual_stock_addition(uuid,uuid,jsonb,text,text,uuid,text,text,uuid,uuid)',
    'public.ellbow_admin_adjust_points(uuid,text,bigint,text,text)', 'public.invoice_acknowledge(uuid,text)'
  ]) sig
  where not exists (select 1 from public.sa_function_guard_injections g where g.function_signature::regprocedure = sig::regprocedure);
  if v_missing is not null then raise exception 'postcondition: guard missing on %', v_missing; end if;

  if pg_get_functiondef('public.orders_approve(uuid)'::regprocedure) not like '%order-maker-checker%' then
    raise exception 'postcondition: order maker/checker not enforced in orders_approve';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'sa_orders_api_write_guard' and tgrelid = 'public.orders'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'sa_documents_api_write_guard' and tgrelid = 'public.documents'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'sa_workflow_only_api_write_guard' and tgrelid = 'public.stock_transfers'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'sa_workflow_only_api_write_guard' and tgrelid = 'public.stock_movements'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'sa_points_api_write_guard' and tgrelid = 'public.points_transactions'::regclass) then
    raise exception 'postcondition: direct-write guards missing';
  end if;

  if (select prosecdef from pg_proc where oid = 'public.sa_orders_api_write_guard()'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.sa_workflow_only_api_write_guard()'::regprocedure) then
    raise exception 'postcondition: write guards must be SECURITY INVOKER';
  end if;
end $$;
