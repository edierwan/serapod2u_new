-- When HQ approves a Serapp D2H order from Current Orders, close any active
-- Serapp hold so the distributor can no longer Cancel Hold after approval.

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
    IF NOT EXISTS(SELECT 1 FROM public.documents WHERE order_id=v.id AND doc_type='SO') THEN
      INSERT INTO public.documents(company_id,order_id,doc_type,doc_no,status,issued_by_org_id,issued_to_org_id,created_by)
      VALUES(v.company_id,v.id,'SO',v.order_no,'pending',v.seller_org_id,v.buyer_org_id,auth.uid());
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.documents WHERE order_id=v.id AND doc_type='DO') THEN
      INSERT INTO public.documents(company_id,order_id,doc_type,doc_no,status,issued_by_org_id,issued_to_org_id,created_by)
      VALUES(v.company_id,v.id,'DO','DO-'||v.order_no,'pending',v.seller_org_id,v.buyer_org_id,auth.uid());
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.documents WHERE order_id=v.id AND doc_type='INVOICE') THEN
      INSERT INTO public.documents(company_id,order_id,doc_type,doc_no,status,issued_by_org_id,issued_to_org_id,created_by)
      VALUES(v.company_id,v.id,'INVOICE','INV-'||v.order_no,'pending',v.seller_org_id,v.buyer_org_id,auth.uid());
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.documents WHERE order_id=v.id AND doc_type='PO') THEN
      INSERT INTO public.documents(company_id,order_id,doc_type,doc_no,status,issued_by_org_id,issued_to_org_id,created_by)
      VALUES(v.company_id,v.id,'PO','PO-'||v.order_no,'pending',v.buyer_org_id,v.seller_org_id,auth.uid());
    END IF;
  END IF;
  UPDATE public.orders SET status='approved',approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid(),updated_at=now()
    WHERE id=p_order_id RETURNING * INTO v;

  -- Close Serapp hold if still active (approve may skip Serapp warehouse-accept).
  UPDATE public.serapp_order_holds
  SET
    status = 'accepted',
    accepted_at = COALESCE(accepted_at, now()),
    accepted_by = COALESCE(accepted_by, auth.uid()),
    updated_at = now()
  WHERE order_id = p_order_id
    AND status = 'active';

  RETURN v;
END $$;

COMMENT ON FUNCTION public.orders_approve(uuid) IS
  'Approve submitted order, fulfill inventory for D2H/S2D, ensure SO/DO/Invoice (or PO) without duplicating Serapp pre-created docs, and close any active Serapp hold.';

-- Heal already-approved Serapp orders whose hold was left active or wrongly
-- marked cancelled_by_distributor (UI said cancelled while order stayed approved).
UPDATE public.serapp_order_holds AS h
SET
  status = 'accepted',
  accepted_at = COALESCE(h.accepted_at, now()),
  updated_at = now(),
  cancelled_at = NULL
FROM public.orders AS o
WHERE h.order_id = o.id
  AND o.status IN ('approved', 'warehouse_packed', 'closed')
  AND h.status IN ('active', 'cancelled_by_distributor');
