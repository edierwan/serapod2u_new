-- Update orders_insert policy to allow Seller (Warehouse/HQ) to create orders
DROP POLICY IF EXISTS orders_insert ON public.orders;

CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated WITH CHECK (
  (buyer_org_id = public.current_user_org_id()) OR 
  (seller_org_id = public.current_user_org_id()) OR
  (
    public.get_org_type(public.current_user_org_id()) = 'HQ' AND 
    public.is_power_user() AND 
    company_id = public.get_company_id(public.current_user_org_id())
  )
);

-- Update orders_update policy to allow Seller to update orders
DROP POLICY IF EXISTS orders_update ON public.orders;

CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated USING (
  (
    (buyer_org_id = public.current_user_org_id()) AND 
    (status = ANY (ARRAY['draft'::public.order_status, 'submitted'::public.order_status, 'approved'::public.order_status]))
  ) OR 
  (
    (seller_org_id = public.current_user_org_id()) AND 
    (status = ANY (ARRAY['draft'::public.order_status, 'submitted'::public.order_status, 'approved'::public.order_status]))
  ) OR
  (
    (public.get_org_type(public.current_user_org_id()) = 'HQ') AND 
    public.is_power_user() AND 
    (company_id = public.get_company_id(public.current_user_org_id()))
  )
) WITH CHECK (
  (buyer_org_id = public.current_user_org_id()) OR 
  (seller_org_id = public.current_user_org_id()) OR
  (
    (public.get_org_type(public.current_user_org_id()) = 'HQ') AND 
    public.is_power_user() AND 
    (company_id = public.get_company_id(public.current_user_org_id()))
  )
);
