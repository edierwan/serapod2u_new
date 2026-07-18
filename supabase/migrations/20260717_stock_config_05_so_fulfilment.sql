-- Inventory Stock Configurations - Phase 4: SO allocation, fulfilment and WMS
-- Forward-only correction. Migrations 01-04 are intentionally untouched.
BEGIN;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_config_id uuid,
  ADD COLUMN IF NOT EXISTS stock_config_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_config_confirmed_by uuid REFERENCES public.users(id);

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_stock_config_variant_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_stock_config_variant_fkey
  FOREIGN KEY (stock_config_id, variant_id)
  REFERENCES public.inventory_stock_configurations(id, variant_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS order_items_stock_config_idx
  ON public.order_items(stock_config_id) WHERE stock_config_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.distributor_stock_config_eligibility (
  distributor_org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  allow_50ml_new_box boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.distributor_stock_config_eligibility ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsce_internal_read ON public.distributor_stock_config_eligibility;
CREATE POLICY dsce_internal_read ON public.distributor_stock_config_eligibility
  FOR SELECT TO authenticated USING (
    public.is_hq_admin() OR EXISTS (
      SELECT 1 FROM public.users u JOIN public.organizations own ON own.id=u.organization_id
      WHERE u.id=auth.uid() AND own.org_type_code IN ('HQ','WH')
        AND public.can_access_org(distributor_org_id)
    )
  );
DROP POLICY IF EXISTS dsce_hq_manage ON public.distributor_stock_config_eligibility;
CREATE POLICY dsce_hq_manage ON public.distributor_stock_config_eligibility
  TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());

DROP TRIGGER IF EXISTS set_dsce_updated_at ON public.distributor_stock_config_eligibility;
CREATE TRIGGER set_dsce_updated_at BEFORE UPDATE ON public.distributor_stock_config_eligibility
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.order_inventory_organization(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v_seller uuid; v_type text; v_wh uuid;
BEGIN
  SELECT o.seller_org_id, org.org_type_code INTO v_seller, v_type
  FROM public.orders o JOIN public.organizations org ON org.id=o.seller_org_id
  WHERE o.id=p_order_id;
  IF v_seller IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF v_type='HQ' THEN
    SELECT id INTO v_wh FROM public.organizations
    WHERE parent_org_id=v_seller AND org_type_code='WH' AND is_active=true
    ORDER BY created_at,id LIMIT 1;
  END IF;
  RETURN COALESCE(v_wh,v_seller);
END $$;

CREATE OR REPLACE FUNCTION public.distributor_can_receive_stock_config(
  p_distributor_org_id uuid, p_stock_config_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT CASE
    WHEN c.id IS NULL OR c.status <> 'active' OR NOT c.allow_so
      OR c.requires_repacking_before_sale OR c.packaging='old_box' THEN false
    WHEN c.volume_ml=50 AND c.packaging='new_box' THEN COALESCE(e.allow_50ml_new_box,false)
    WHEN c.volume_ml=20 AND c.packaging='new_box' THEN true
    WHEN c.volume_ml IS NULL AND c.packaging IS NULL THEN true
    ELSE false END
  FROM public.inventory_stock_configurations c
  LEFT JOIN public.distributor_stock_config_eligibility e
    ON e.distributor_org_id=p_distributor_org_id
  WHERE c.id=p_stock_config_id
$$;

CREATE OR REPLACE FUNCTION public.resolve_so_stock_config(
  p_variant_id uuid, p_inventory_org_id uuid, p_distributor_org_id uuid, p_quantity integer)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'SO quantity must be positive'; END IF;
  SELECT c.id INTO v_id
  FROM public.inventory_stock_configurations c
  JOIN public.product_inventory pi ON pi.variant_id=c.variant_id AND pi.stock_config_id=c.id
    AND pi.organization_id=p_inventory_org_id AND pi.is_active=true
  WHERE c.variant_id=p_variant_id AND c.status='active' AND c.allow_so
    AND NOT c.requires_repacking_before_sale AND c.packaging IS DISTINCT FROM 'old_box'
    AND public.distributor_can_receive_stock_config(p_distributor_org_id,c.id)
    AND (pi.quantity_on_hand-pi.quantity_allocated) >= p_quantity
  ORDER BY CASE WHEN c.volume_ml=20 AND c.packaging='new_box' THEN 0
                WHEN c.volume_ml=50 AND c.packaging='new_box' THEN 1
                WHEN c.volume_ml IS NULL THEN 2 ELSE 9 END, c.sort_order, c.id
  LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No eligible sellable stock configuration has % available units for variant %', p_quantity,p_variant_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.allocate_inventory_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_order public.orders%ROWTYPE; v_item record; v_org uuid; v_cfg uuid; v_on int; v_alloc int; v_cost numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found: %',p_order_id; END IF;
  IF v_order.order_type NOT IN ('D2H','S2D') THEN RETURN; END IF;
  v_org:=public.order_inventory_organization(p_order_id);
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id FOR UPDATE LOOP
    IF EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.reference_id=p_order_id
      AND sm.variant_id=v_item.variant_id AND sm.movement_type='allocation') THEN CONTINUE; END IF;
    v_cfg:=public.resolve_so_stock_config(v_item.variant_id,v_org,v_order.buyer_org_id,v_item.qty);
    SELECT quantity_on_hand,quantity_allocated,COALESCE(average_cost,0) INTO v_on,v_alloc,v_cost
      FROM public.product_inventory WHERE variant_id=v_item.variant_id AND organization_id=v_org
      AND stock_config_id=v_cfg AND is_active=true FOR UPDATE;
    IF v_on-v_alloc < v_item.qty THEN RAISE EXCEPTION 'Insufficient configuration stock'; END IF;
    UPDATE public.order_items SET stock_config_id=v_cfg,stock_config_confirmed_at=NULL,
      stock_config_confirmed_by=NULL,updated_at=now() WHERE id=v_item.id;
    UPDATE public.product_inventory SET quantity_allocated=quantity_allocated+v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_cfg;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,
      stock_config_id,from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,
      unit_cost,company_id,created_by,created_at,notes)
    VALUES('allocation','order',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,v_org,v_order.buyer_org_id,
      v_item.qty,0,v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),now(),
      'SO allocation; configuration requires internal confirmation');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.release_allocation_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_order public.orders%ROWTYPE; v_item record; v_org uuid; v_alloc int; v_cost numeric; v_wh_on int; v_buyer_on int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found: %',p_order_id; END IF;
  IF v_order.order_type NOT IN ('D2H','S2D') THEN RETURN; END IF;
  v_org:=public.order_inventory_organization(p_order_id);
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id LOOP
    IF v_item.stock_config_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_id=p_order_id AND variant_id=v_item.variant_id AND movement_type='allocation')
      THEN RAISE EXCEPTION 'Allocated order item % has no stock configuration',v_item.id; ELSE CONTINUE; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type='order' AND reference_id=p_order_id AND variant_id=v_item.variant_id
      AND stock_config_id=v_item.stock_config_id AND movement_type='deallocation') THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type='order' AND reference_id=p_order_id
      AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id AND movement_type='order_fulfillment') THEN
      IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type='order_cancel_reversal' AND reference_id=p_order_id
        AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id) THEN CONTINUE; END IF;
      SELECT quantity_on_hand,COALESCE(average_cost,0) INTO v_wh_on,v_cost FROM public.product_inventory
        WHERE organization_id=v_org AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id FOR UPDATE;
      SELECT quantity_on_hand INTO v_buyer_on FROM public.product_inventory WHERE organization_id=v_order.buyer_org_id
        AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id FOR UPDATE;
      IF v_buyer_on IS NULL OR v_buyer_on<v_item.qty THEN RAISE EXCEPTION 'Buyer no longer has exact configuration stock required to cancel item %',v_item.id; END IF;
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand-v_item.qty,updated_at=now()
        WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id;
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand+v_item.qty,updated_at=now()
        WHERE organization_id=v_org AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id;
      INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
        from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
      VALUES('transfer_out','order_cancel_reversal',p_order_id,v_order.order_no,v_item.variant_id,v_item.stock_config_id,
        v_order.buyer_org_id,v_org,-v_item.qty,v_buyer_on,v_buyer_on-v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),'Buyer credit reversed on cancellation'),
       ('order_cancelled','order_cancel_reversal',p_order_id,v_order.order_no,v_item.variant_id,v_item.stock_config_id,
        v_order.buyer_org_id,v_org,v_item.qty,v_wh_on,v_wh_on+v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),'Exact configuration restored on cancellation');
      CONTINUE;
    END IF;
    SELECT quantity_allocated,COALESCE(average_cost,0) INTO v_alloc,v_cost FROM public.product_inventory
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_item.stock_config_id FOR UPDATE;
    IF NOT FOUND OR v_alloc < v_item.qty THEN RAISE EXCEPTION 'Cannot safely release item % configuration allocation',v_item.id; END IF;
    UPDATE public.product_inventory SET quantity_allocated=quantity_allocated-v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_item.stock_config_id;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
    VALUES('deallocation','order',p_order_id,v_order.order_no,v_item.variant_id,v_item.stock_config_id,
      v_order.buyer_org_id,v_org,-v_item.qty,v_item.qty,0,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),
      CASE WHEN v_order.status='cancelled' THEN 'Order cancelled' ELSE 'Allocation released' END);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_order_item_stock_config(p_order_item_id uuid,p_stock_config_id uuid)
RETURNS public.order_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_item public.order_items%ROWTYPE; v_order public.orders%ROWTYPE; v_org uuid; v_old_alloc int; v_new_on int; v_new_alloc int;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id=p_order_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order item not found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_item.order_id FOR UPDATE;
  IF v_order.status <> 'submitted' OR v_order.order_type NOT IN ('D2H','S2D') THEN
    RAISE EXCEPTION 'Configuration can only be confirmed on submitted sales orders'; END IF;
  IF NOT (public.is_hq_admin() OR public.can_access_org(v_order.seller_org_id)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_stock_configurations c WHERE c.id=p_stock_config_id
    AND c.variant_id=v_item.variant_id AND public.distributor_can_receive_stock_config(v_order.buyer_org_id,c.id))
  THEN RAISE EXCEPTION 'Configuration is not sellable to this distributor'; END IF;
  v_org:=public.order_inventory_organization(v_order.id);
  IF v_item.stock_config_id IS DISTINCT FROM p_stock_config_id THEN
    SELECT quantity_allocated INTO v_old_alloc FROM public.product_inventory WHERE variant_id=v_item.variant_id
      AND organization_id=v_org AND stock_config_id=v_item.stock_config_id FOR UPDATE;
    SELECT quantity_on_hand,quantity_allocated INTO v_new_on,v_new_alloc FROM public.product_inventory
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=p_stock_config_id FOR UPDATE;
    IF v_item.stock_config_id IS NULL OR v_old_alloc < v_item.qty THEN RAISE EXCEPTION 'Existing allocation is missing or inconsistent'; END IF;
    IF NOT FOUND OR v_new_on-v_new_alloc < v_item.qty THEN RAISE EXCEPTION 'Insufficient stock in selected configuration'; END IF;
    UPDATE public.product_inventory SET quantity_allocated=quantity_allocated-v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_item.stock_config_id;
    UPDATE public.product_inventory SET quantity_allocated=quantity_allocated+v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=p_stock_config_id;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,company_id,created_by,notes)
    VALUES('deallocation','order_config_change',v_order.id,v_order.order_no,v_item.variant_id,v_item.stock_config_id,
      v_order.buyer_org_id,v_org,-v_item.qty,v_item.qty,0,v_order.company_id,auth.uid(),'Internal SO configuration change'),
      ('allocation','order_config_change',v_order.id,v_order.order_no,v_item.variant_id,p_stock_config_id,
      v_org,v_order.buyer_org_id,v_item.qty,0,v_item.qty,v_order.company_id,auth.uid(),'Internal SO configuration confirmation');
  END IF;
  UPDATE public.order_items SET stock_config_id=p_stock_config_id,stock_config_confirmed_at=now(),
    stock_config_confirmed_by=auth.uid(),updated_at=now() WHERE id=p_order_item_id RETURNING * INTO v_item;
  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION public.fulfill_order_inventory(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_order public.orders%ROWTYPE; v_item record; v_org uuid; v_on int; v_alloc int; v_cost numeric; v_buyer_on int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  v_org:=public.order_inventory_organization(p_order_id);
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id LOOP
    IF v_item.stock_config_id IS NULL OR v_item.stock_config_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'Order item % stock configuration is not confirmed',v_item.id; END IF;
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type='order' AND reference_id=p_order_id
      AND variant_id=v_item.variant_id AND stock_config_id=v_item.stock_config_id AND movement_type='order_fulfillment') THEN CONTINUE; END IF;
    SELECT quantity_on_hand,quantity_allocated,COALESCE(average_cost,0) INTO v_on,v_alloc,v_cost
      FROM public.product_inventory WHERE variant_id=v_item.variant_id AND organization_id=v_org
      AND stock_config_id=v_item.stock_config_id FOR UPDATE;
    IF NOT FOUND OR v_on<v_item.qty OR v_alloc<v_item.qty THEN RAISE EXCEPTION 'Insufficient confirmed configuration stock'; END IF;
    UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand-v_item.qty,
      quantity_allocated=quantity_allocated-v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_item.stock_config_id;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
    VALUES('order_fulfillment','order',p_order_id,v_order.order_no,v_item.variant_id,v_item.stock_config_id,v_org,
      v_order.buyer_org_id,-v_item.qty,v_on,v_on-v_item.qty,v_cost,v_order.company_id,auth.uid(),'Order fulfilled from confirmed configuration');
    INSERT INTO public.product_inventory(organization_id,variant_id,stock_config_id,quantity_on_hand,quantity_allocated)
      VALUES(v_order.buyer_org_id,v_item.variant_id,v_item.stock_config_id,0,0)
      ON CONFLICT(variant_id,organization_id,stock_config_id) DO NOTHING;
    SELECT quantity_on_hand INTO v_buyer_on FROM public.product_inventory
      WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id
      AND stock_config_id=v_item.stock_config_id FOR UPDATE;
    UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand+v_item.qty,updated_at=now()
      WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id
      AND stock_config_id=v_item.stock_config_id;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
    VALUES('transfer_in','order',p_order_id,v_order.order_no,v_item.variant_id,v_item.stock_config_id,v_org,
      v_order.buyer_org_id,v_item.qty,v_buyer_on,v_buyer_on+v_item.qty,v_cost,v_order.company_id,auth.uid(),
      'Buyer inventory credited from confirmed configuration');
  END LOOP;
END $$;

-- Approval keeps the established approval/document workflow, but delegates all
-- inventory mutation to the exact-config fulfilment function.
CREATE OR REPLACE FUNCTION public.orders_approve(p_order_id uuid)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.orders; v_user_org uuid; v_user_type text; v_creator_level int; v_user_level int; v_authority boolean; v_can boolean:=false;
BEGIN
  SELECT * INTO v FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v.status<>'submitted' THEN RAISE EXCEPTION 'Order must be in submitted'; END IF;
  SELECT organization_id INTO v_user_org FROM public.users WHERE id=auth.uid(); v_user_type:=public.get_org_type(v_user_org);
  SELECT r.role_level INTO v_creator_level FROM public.users u JOIN public.roles r ON r.role_code=u.role_code WHERE u.id=v.created_by;
  SELECT r.role_level INTO v_user_level FROM public.users u JOIN public.roles r ON r.role_code=u.role_code WHERE u.id=auth.uid();
  v_creator_level:=COALESCE(v_creator_level,999); v_user_level:=COALESCE(v_user_level,999);
  v_authority:=CASE WHEN v_creator_level=10 THEN v_user_level IN (10,20) ELSE v_user_level<v_creator_level END;
  IF v.order_type='H2M' THEN v_can:=v_user_type='HQ' AND v_authority;
  ELSIF v.order_type='D2H' THEN v_can:=v_user_type='HQ' AND (v_authority OR public.is_hq_admin());
  ELSIF v.order_type='S2D' THEN v_can:=v_user_org=v.seller_org_id AND v_authority; END IF;
  IF NOT v_can THEN RAISE EXCEPTION 'User lacks permission to approve this order type'; END IF;
  IF v.parent_order_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=v.parent_order_id AND status='approved') THEN RAISE EXCEPTION 'Parent order must be approved first'; END IF;
    PERFORM public.validate_child_quantities(p_order_id,v.parent_order_id);
  END IF;
  IF v.order_type IN ('D2H','S2D') THEN PERFORM public.fulfill_order_inventory(p_order_id); END IF;
  IF v.order_type IN ('D2H','S2D') THEN
    INSERT INTO public.documents(company_id,order_id,doc_type,doc_no,status,issued_by_org_id,issued_to_org_id,created_by)
    VALUES(v.company_id,v.id,'SO',v.order_no,'pending',v.seller_org_id,v.buyer_org_id,auth.uid()),
      (v.company_id,v.id,'DO','DO-'||v.order_no,'pending',v.seller_org_id,v.buyer_org_id,auth.uid()),
      (v.company_id,v.id,'INVOICE','INV-'||v.order_no,'pending',v.seller_org_id,v.buyer_org_id,auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.documents WHERE order_id=v.id AND doc_type='PO') THEN
      INSERT INTO public.documents(company_id,order_id,doc_type,doc_no,status,issued_by_org_id,issued_to_org_id,created_by)
      VALUES(v.company_id,v.id,'PO','PO-'||v.order_no,'pending',v.buyer_org_id,v.seller_org_id,auth.uid());
    END IF;
  END IF;
  UPDATE public.orders SET status='approved',approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid(),updated_at=now()
    WHERE id=p_order_id RETURNING * INTO v; RETURN v;
END $$;

-- QR identity remains variant-level, but every unit must resolve through its
-- order_item_id. No default configuration or variant-only fallback exists.
CREATE OR REPLACE FUNCTION public.wms_from_unique_codes(p_qr_code_ids uuid[],p_from_org_id uuid,p_to_org_id uuid,
  p_order_id uuid,p_shipped_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; v_items jsonb:='[]'::jsonb; v_before int; v_after int; v_expected int;
BEGIN
  IF p_qr_code_ids IS NULL OR array_length(p_qr_code_ids,1) IS NULL THEN RAISE EXCEPTION 'QR code ids must not be empty'; END IF;
  SELECT count(*) INTO v_expected FROM unnest(p_qr_code_ids) x;
  IF (SELECT count(*) FROM public.qr_codes qc JOIN public.order_items oi ON oi.id=qc.order_item_id
      WHERE qc.id=ANY(p_qr_code_ids) AND oi.order_id=p_order_id AND qc.variant_id=oi.variant_id
      AND oi.stock_config_id IS NOT NULL AND oi.stock_config_confirmed_at IS NOT NULL) <> v_expected
  THEN RAISE EXCEPTION 'Every QR code must resolve to a confirmed order item configuration'; END IF;
  FOR r IN SELECT qc.variant_id,oi.stock_config_id,count(*)::int units
    FROM public.qr_codes qc JOIN public.order_items oi ON oi.id=qc.order_item_id
    WHERE qc.id=ANY(p_qr_code_ids) AND oi.order_id=p_order_id
    GROUP BY qc.variant_id,oi.stock_config_id
  LOOP
    SELECT quantity_on_hand INTO v_before FROM public.product_inventory WHERE variant_id=r.variant_id
      AND organization_id=p_from_org_id AND stock_config_id=r.stock_config_id FOR UPDATE;
    IF NOT FOUND OR v_before<r.units THEN RAISE EXCEPTION 'Insufficient exact configuration stock for WMS shipment'; END IF;
    -- Approval may already have posted the exact outbound. Never deduct twice.
    IF EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_type='order' AND reference_id=p_order_id
      AND variant_id=r.variant_id AND stock_config_id=r.stock_config_id AND movement_type='order_fulfillment') THEN
      v_after:=v_before;
    ELSE
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand-r.units,updated_at=now()
       WHERE variant_id=r.variant_id AND organization_id=p_from_org_id AND stock_config_id=r.stock_config_id;
      v_after:=v_before-r.units;
    END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('variant_id',r.variant_id,'stock_config_id',r.stock_config_id,
      'from_org',p_from_org_id,'to_org',p_to_org_id,'order_id',p_order_id,'units',r.units,'before',v_before,
      'after',v_after,'shipped_at',p_shipped_at,'inventory_already_posted',v_after=v_before));
  END LOOP;
  RETURN jsonb_build_object('items',v_items);
END $$;

CREATE OR REPLACE FUNCTION public.wms_record_movement_from_summary(p_summary jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_variant uuid:=(p_summary->>'variant_id')::uuid; v_cfg uuid:=(p_summary->>'stock_config_id')::uuid;
 v_from uuid:=(p_summary->>'from_org')::uuid; v_to uuid:=(p_summary->>'to_org')::uuid; v_order uuid:=(p_summary->>'order_id')::uuid;
 v_units int:=(p_summary->>'units')::int; v_before int:=(p_summary->>'before')::int; v_after int:=(p_summary->>'after')::int;
 v_when timestamptz:=COALESCE((p_summary->>'shipped_at')::timestamptz,now()); v_id uuid; v_key text; v_creator uuid:=auth.uid(); v_company uuid;
BEGIN
  IF v_variant IS NULL OR v_cfg IS NULL OR v_from IS NULL OR v_units<=0 THEN RAISE EXCEPTION 'Invalid config-aware WMS summary'; END IF;
  v_key:=encode(digest(concat_ws('|',v_variant,v_cfg,v_from,v_to,v_order,v_units,to_char(v_when::date,'YYYY-MM-DD')),'sha256'),'hex');
  SELECT movement_id INTO v_id FROM public.wms_movement_dedup WHERE dedup_key=v_key; IF FOUND THEN RETURN v_id; END IF;
  IF COALESCE((p_summary->>'inventory_already_posted')::boolean,false) THEN
    SELECT id INTO v_id FROM public.stock_movements WHERE reference_type='order' AND reference_id=v_order
      AND variant_id=v_variant AND stock_config_id=v_cfg AND movement_type='order_fulfillment' ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Expected exact outbound posting is missing'; END IF;
  ELSE
    IF v_creator IS NULL THEN SELECT created_by INTO v_creator FROM public.orders WHERE id=v_order; END IF;
    v_company:=public.get_company_id(v_from);
    INSERT INTO public.stock_movements(variant_id,stock_config_id,from_organization_id,to_organization_id,movement_type,
      quantity_change,quantity_before,quantity_after,reference_type,reference_id,company_id,created_by,created_at,notes)
    VALUES(v_variant,v_cfg,v_from,NULLIF(v_to,v_from),'order_fulfillment',-v_units,v_before,v_after,'order',v_order,
      v_company,v_creator,v_when,'WMS QR shipment resolved through order item configuration') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.wms_movement_dedup(dedup_key,movement_id) VALUES(v_key,v_id) ON CONFLICT DO NOTHING;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.wms_ship_master_auto(p_master_code_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_master record; v_qr_ids uuid[]; v_order uuid; v_to uuid;
BEGIN
  SELECT qmc.*,COALESCE(qmc.shipment_order_id,qb.order_id) resolved_order_id
    INTO v_master FROM public.qr_master_codes qmc
    LEFT JOIN public.qr_batches qb ON qb.id=qmc.batch_id WHERE qmc.id=p_master_code_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Master code not found'; END IF;
  v_order:=v_master.resolved_order_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'Master code is not linked to an order'; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_qr_ids FROM public.qr_codes
    WHERE master_code_id=p_master_code_id AND status<>'shipped_distributor';
  IF v_qr_ids IS NULL THEN RAISE EXCEPTION 'Master has no unshipped child QR codes'; END IF;
  SELECT COALESCE(v_master.shipped_to_distributor_id,o.buyer_org_id) INTO v_to
    FROM public.orders o WHERE o.id=v_order;
  IF v_master.warehouse_org_id IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'Master shipment organizations are incomplete'; END IF;
  RETURN public.wms_ship_unique_auto(v_qr_ids,v_master.warehouse_org_id,v_to,v_order,COALESCE(v_master.shipped_at,now()));
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_duplicate_outbound() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.movement_type IN ('manual_out','shipment','transfer_out','order_fulfillment') THEN
  IF NEW.stock_config_id IS NULL THEN
    SELECT c.id INTO NEW.stock_config_id FROM public.inventory_stock_configurations c
    WHERE c.variant_id=NEW.variant_id AND c.status='active' AND c.volume_ml IS NULL AND c.packaging IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.inventory_stock_configurations x WHERE x.variant_id=NEW.variant_id
        AND x.status='active' AND (x.volume_ml IS NOT NULL OR x.packaging IS NOT NULL));
    IF NEW.stock_config_id IS NULL THEN RAISE EXCEPTION 'Configured outbound requires explicit stock_config_id'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.movement_type=NEW.movement_type
    AND m.variant_id=NEW.variant_id AND m.stock_config_id=NEW.stock_config_id
    AND m.from_organization_id IS NOT DISTINCT FROM NEW.from_organization_id
    AND m.to_organization_id IS NOT DISTINCT FROM NEW.to_organization_id
    AND m.reference_id IS NOT DISTINCT FROM NEW.reference_id
    AND COALESCE(m.reference_no,'')=COALESCE(NEW.reference_no,''))
  THEN RAISE EXCEPTION 'Duplicate configuration outbound detected'; END IF;
 END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.wms_ship_manual(p_company_id uuid,p_warehouse_id uuid,p_distributor_id uuid,
 p_variant_id uuid,p_qty integer,p_user_id uuid,p_reference_no text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS TABLE(movement_id uuid,quantity_before integer,quantity_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 v_result:=public.wms_ship_mixed(p_company_id,p_warehouse_id,p_distributor_id,p_variant_id,p_qty,NULL,
   p_user_id,p_reference_no,p_notes);
 movement_id:=(v_result->>'manual_movement_id')::uuid;
 SELECT sm.quantity_before,sm.quantity_after INTO quantity_before,quantity_after
   FROM public.stock_movements sm WHERE sm.id=movement_id;
 RETURN NEXT;
END $$;

-- Manual variant-only WMS issues are safe only for dimensionless products.
CREATE OR REPLACE FUNCTION public.wms_ship_mixed(p_company_id uuid,p_warehouse_id uuid,p_distributor_id uuid,p_variant_id uuid,
 p_manual_qty integer DEFAULT 0,p_qr_codes jsonb DEFAULT NULL,p_user_id uuid DEFAULT NULL,p_reference_no text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_cfg uuid; v_id uuid;
BEGIN
 IF COALESCE(p_manual_qty,0)<0 THEN RAISE EXCEPTION 'Manual quantity cannot be negative'; END IF;
 IF COALESCE(p_manual_qty,0)=0 THEN RETURN jsonb_build_object('success',true,'manual_quantity',0); END IF;
 SELECT id INTO v_cfg FROM public.inventory_stock_configurations WHERE variant_id=p_variant_id AND status='active'
   AND allow_so AND volume_ml IS NULL AND packaging IS NULL;
 IF v_cfg IS NULL THEN RAISE EXCEPTION 'Configured stock cannot be shipped by variant-only manual entry; use order-linked QR units'; END IF;
 v_id:=public.record_stock_movement(p_movement_type:='manual_out',p_variant_id:=p_variant_id,p_organization_id:=p_warehouse_id,
   p_quantity_change:=-p_manual_qty,p_reason:='Manual Out to Distributor',p_notes:=p_notes,p_reference_type:='manual',
   p_reference_id:=p_distributor_id,p_reference_no:=p_reference_no,p_company_id:=p_company_id,p_created_by:=p_user_id,p_stock_config_id:=v_cfg);
 UPDATE public.stock_movements SET to_organization_id=p_distributor_id WHERE id=v_id;
 RETURN jsonb_build_object('success',true,'manual_quantity',p_manual_qty,'manual_movement_id',v_id);
END $$;

-- The legacy administrative delete swallows allocation-release errors. Keep
-- its mature dependency cleanup body, but put an exact-config, fail-closed
-- release in front of it so deletion can never orphan configured allocation.
ALTER FUNCTION public.hard_delete_order(uuid) RENAME TO hard_delete_order_phase4_legacy;
CREATE FUNCTION public.hard_delete_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='300s' AS $$
DECLARE v_type text; v_status text;
BEGIN
 SELECT order_type::text,status::text INTO v_type,v_status FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Order not found'); END IF;
 IF v_type IN ('D2H','S2D') AND v_status NOT IN ('completed','shipped','shipped_distributor','fulfilled','approved') THEN
   PERFORM public.release_allocation_for_order(p_order_id);
 END IF;
 RETURN public.hard_delete_order_phase4_legacy(p_order_id);
END $$;

REVOKE ALL ON FUNCTION public.set_order_item_stock_config(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_order_item_stock_config(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.hard_delete_order(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_order(uuid) TO service_role,postgres,supabase_admin;
REVOKE ALL ON TABLE public.distributor_stock_config_eligibility FROM anon;
GRANT SELECT ON TABLE public.distributor_stock_config_eligibility TO authenticated;

COMMIT;
