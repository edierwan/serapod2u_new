DROP POLICY IF EXISTS order_items_write ON public.order_items;

CREATE POLICY order_items_write ON public.order_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.status = 'draft'::public.order_status) AND ((o.buyer_org_id = public.current_user_org_id()) OR (o.seller_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (o.company_id = public.get_company_id(public.current_user_org_id())))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.status = 'draft'::public.order_status) AND ((o.buyer_org_id = public.current_user_org_id()) OR (o.seller_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (o.company_id = public.get_company_id(public.current_user_org_id()))))))));
