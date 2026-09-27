-- S&A Final Wave — Supply Chain / Customer direct-write and RPC backstops (K)
BEGIN;

-- Order created by HQ admin A in submitted state (D2H style: HQ sells to distributor).
INSERT INTO public.orders(id, order_no, order_type, company_id, buyer_org_id, seller_org_id, status, created_by)
VALUES ('00000000-0000-0000-0000-0000000e0001', 'SAF-ORD-1', 'D2H', saf.org('hq_a'), saf.org('dist_a'), saf.org('hq_a'), 'submitted', saf.uid('hq_a'));

-- ALWAYS: direct approval bypass is closed (even in legacy modes).
SELECT saf.expect_err('K: order cannot be approved by a direct table update', 'authenticated', saf.uid('dist_a'),
  $$UPDATE public.orders SET status = 'approved' WHERE id = '00000000-0000-0000-0000-0000000e0001'$$, 'order_approval_requires_workflow');
SELECT saf.expect_err('K: orders cannot be inserted already approved', 'authenticated', saf.uid('dist_a'),
  format($$INSERT INTO public.orders(order_no, order_type, company_id, buyer_org_id, seller_org_id, status, created_by) VALUES ('SAF-ORD-X','D2H',%L,%L,%L,'approved',%L)$$,
         saf.org('hq_a'), saf.org('dist_a'), saf.org('hq_a'), saf.uid('dist_a')), 'order_status_transition_not_allowed');
SELECT saf.expect_eq('order still submitted', (SELECT status::text FROM public.orders WHERE id = '00000000-0000-0000-0000-0000000e0001'), 'submitted');

-- Maker/checker inside orders_approve (existing rule, now server-side).
SELECT saf.expect_err('J/K: order creator cannot approve their own order', 'authenticated', saf.uid('hq_a'),
  $$SELECT public.orders_approve('00000000-0000-0000-0000-0000000e0001')$$, 'sod_violation');

-- NEW_ENFORCED: order approval requires S&A order.approve in scope.
SELECT saf.set_mode('supply_chain.order.approve', 'NEW_ENFORCED');
SELECT saf.expect_err('NEW: other tenant cannot approve', 'authenticated', saf.uid('hq_b'),
  $$SELECT public.orders_approve('00000000-0000-0000-0000-0000000e0001')$$, 'sa_authorization_required');
SELECT saf.expect_err('NEW: employee without order.approve cannot approve', 'authenticated', saf.uid('emp_a'),
  $$SELECT public.orders_approve('00000000-0000-0000-0000-0000000e0001')$$, 'sa_authorization_required');
SELECT saf.expect_eq('NEW: authorized approver passes S&A and SoD (workflow validation may continue)',
  saf.try_as('authenticated', saf.uid('pu_a'), $$SELECT public.orders_approve('00000000-0000-0000-0000-0000000e0001')$$) !~ '(sa_authorization_required|sod_violation)', true);

-- Direct order transitions in NEW_ENFORCED.
INSERT INTO public.orders(id, order_no, order_type, company_id, buyer_org_id, seller_org_id, status, created_by)
VALUES ('00000000-0000-0000-0000-0000000e0002', 'SAF-ORD-2', 'D2H', saf.org('hq_a'), saf.org('dist_a'), saf.org('hq_a'), 'draft', saf.uid('dist_a'));
SELECT saf.set_mode('supply_chain.order.create', 'NEW_ENFORCED');
SELECT saf.set_mode('supply_chain.order.cancel', 'NEW_ENFORCED');
SELECT saf.try_as('authenticated', saf.uid('hq_b'),
  $$UPDATE public.orders SET status = 'submitted' WHERE id = '00000000-0000-0000-0000-0000000e0002'$$);
SELECT saf.expect_eq('order untouched by other tenant', (SELECT status::text FROM public.orders WHERE id = '00000000-0000-0000-0000-0000000e0002'), 'draft');

-- ALWAYS: stock transfers / stock movements / return cases are workflow-only.
INSERT INTO public.stock_transfers(id, transfer_no, from_organization_id, to_organization_id, company_id, created_by, status)
VALUES ('00000000-0000-0000-0000-0000000e0101', 'SAF-TR-1', saf.org('wh_a1'), saf.org('dist_a'), saf.org('hq_a'), saf.uid('hq_a'), 'pending_approval');
SELECT saf.expect_err('K: transfer cannot be approved by direct update', 'authenticated', saf.uid('hq_a'),
  $$UPDATE public.stock_transfers SET status = 'ready_to_dispatch' WHERE id = '00000000-0000-0000-0000-0000000e0101'$$, 'stock_transfers_writes_require_workflow');
SELECT saf.expect_err('K: stock movements cannot be fabricated directly', 'authenticated', saf.uid('hq_a'),
  format($$INSERT INTO public.stock_movements(movement_type, variant_id, to_organization_id, quantity_change, company_id, created_by) VALUES ('adjustment', gen_random_uuid(), %L, 100, %L, %L)$$,
         saf.org('wh_a1'), saf.org('hq_a'), saf.uid('hq_a')), '42501');
INSERT INTO public.return_cases(id, return_no, shop_org_id, status, created_by, return_source_type, return_source_organization_id)
VALUES ('00000000-0000-0000-0000-0000000e0201', 'SAF-RET-1', saf.org('shop_a'), 'return_draft', saf.uid('hq_a'), 'shop', saf.org('shop_a'));
SELECT saf.expect_err('K: return cases are server-only (manager cannot rewrite status)', 'authenticated', saf.uid('sa'),
  $$UPDATE public.return_cases SET notes = 'rewritten' WHERE id = '00000000-0000-0000-0000-0000000e0201'$$, 'return_cases_writes_require_workflow');

-- NEW_ENFORCED: transfer approval via RPC needs inventory.transfer.approve.
SELECT saf.set_mode('inventory.transfer.approve', 'NEW_ENFORCED');
SELECT saf.expect_err('NEW: warehouse manager without transfer approval denied', 'authenticated', saf.uid('whm_a1'),
  $$SELECT public.approve_stock_transfer('00000000-0000-0000-0000-0000000e0101', null)$$, 'sa_authorization_required');

-- Manual points (customer.loyalty.adjust) and redemption updates.
SELECT saf.set_mode('customer.loyalty.adjust', 'NEW_ENFORCED');
-- Legacy lets every staff member (role_level <= 40) insert points. In
-- NEW_ENFORCED, removing the S&A grant removes the ability although the
-- employee's role_level is unchanged.
DELETE FROM public.sa_business_role_permissions WHERE role_id = saf.role('legacy-user')
  AND permission_id = (SELECT id FROM public.sa_permissions WHERE permission_key = 'customer.loyalty.adjust');
SELECT saf.expect_err('NEW: staff without S&A loyalty.adjust cannot inject points', 'authenticated', saf.uid('emp_a'),
  format($$INSERT INTO public.points_transactions(company_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, '+60123456789', 'adjust', 1000, 1000)$$, saf.org('hq_a')),
  'sa_authorization_required');
SELECT saf.expect_eq('no points injected', (SELECT count(*) FROM public.points_transactions WHERE consumer_phone = '+60123456789')::int, 0);
SELECT saf.expect_ok('NEW: staff holding loyalty.adjust may record an adjustment', 'authenticated', saf.uid('pu_a'),
  format($$INSERT INTO public.points_transactions(company_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, '+60123450000', 'adjust', 10, 10)$$, saf.org('hq_a')));
SELECT saf.try_as('authenticated', saf.uid('hq_b'),
  format($$INSERT INTO public.points_transactions(company_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, '+60123451111', 'adjust', 10, 10)$$, saf.org('hq_a')));
SELECT saf.expect_eq('other tenant injected nothing', (SELECT count(*) FROM public.points_transactions WHERE consumer_phone = '+60123451111')::int, 0);

-- Inventory quantity changes need inventory.adjustment.post in NEW_ENFORCED;
-- settings columns keep legacy behaviour.
SELECT saf.set_mode('inventory.adjustment.post', 'NEW_ENFORCED');
INSERT INTO public.product_categories(id, category_code, category_name) VALUES ('00000000-0000-0000-0000-0000000c0001', 'SAF-CAT', 'SAF');
INSERT INTO public.products(id, category_id, product_code, product_name) VALUES ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000c0001', 'SAF-P', 'SAF');
INSERT INTO public.product_variants(id, product_id, variant_code, variant_name, base_cost) VALUES ('00000000-0000-0000-0000-0000000e0901', '00000000-0000-0000-0000-0000000d0001', 'SAF-V', 'SAF', 1);
INSERT INTO public.product_inventory(id, variant_id, organization_id, stock_config_id, quantity_on_hand, quantity_allocated, is_active)
VALUES ('00000000-0000-0000-0000-0000000e0902', '00000000-0000-0000-0000-0000000e0901', saf.org('wh_a1'),
        (SELECT id FROM public.inventory_stock_configurations WHERE variant_id = '00000000-0000-0000-0000-0000000e0901' ORDER BY created_at LIMIT 1), 10, 0, true);
SELECT saf.try_as('authenticated', saf.uid('emp_a'),
  $$UPDATE public.product_inventory SET quantity_on_hand = 999 WHERE id = '00000000-0000-0000-0000-0000000e0902'$$);
SELECT saf.expect_eq('quantity unchanged', (SELECT quantity_on_hand FROM public.product_inventory WHERE id = '00000000-0000-0000-0000-0000000e0902'), 10);
SELECT saf.expect_ok('NEW: warehouse manager may still edit reorder settings', 'authenticated', saf.uid('whm_a1'),
  $$UPDATE public.product_inventory SET reorder_point = 5 WHERE id = '00000000-0000-0000-0000-0000000e0902'$$);

ROLLBACK;
