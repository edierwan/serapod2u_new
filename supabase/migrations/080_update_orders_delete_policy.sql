-- Update orders_delete policy to allow Seller to delete orders (e.g. cleanup on failure)
DROP POLICY IF EXISTS orders_delete ON public.orders;

CREATE POLICY orders_delete ON public.orders FOR DELETE TO authenticated USING (
  (
    (buyer_org_id = public.current_user_org_id()) AND 
    (status = ANY (ARRAY['draft'::public.order_status, 'submitted'::public.order_status]))
  ) OR 
  (
    (seller_org_id = public.current_user_org_id()) AND 
    (status = ANY (ARRAY['draft'::public.order_status, 'submitted'::public.order_status]))
  ) OR
  (
    (public.get_org_type(public.current_user_org_id()) = 'HQ') AND 
    public.is_power_user() AND 
    (company_id = public.get_company_id(public.current_user_org_id()))
  )
);
