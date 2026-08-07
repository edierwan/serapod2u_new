BEGIN;

-- Serapp soft reservation holds (Batch 5)
-- Uses the CURRENT D2H allocate-on-submit path. This table tracks the 1-hour
-- acceptance window so unaccepted Serapp orders can expire and release stock
-- without changing Dashboard order behaviour for non-Serapp orders.

CREATE TABLE IF NOT EXISTS public.serapp_order_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_org_id uuid NOT NULL REFERENCES public.organizations(id),
  seller_hq_id uuid NOT NULL REFERENCES public.organizations(id),
  fulfillment_warehouse_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'accepted', 'expired', 'cancelled_by_distributor')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES public.users(id),
  expired_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serapp_order_holds_order_unique UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_serapp_order_holds_active_expires
  ON public.serapp_order_holds (expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_serapp_order_holds_buyer
  ON public.serapp_order_holds (buyer_org_id, created_at DESC);

ALTER TABLE public.serapp_order_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS serapp_order_holds_select ON public.serapp_order_holds;
CREATE POLICY serapp_order_holds_select ON public.serapp_order_holds
  FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR public.can_access_org(buyer_org_id)
    OR public.can_access_org(seller_hq_id)
    OR public.can_access_org(fulfillment_warehouse_id)
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS serapp_order_holds_insert ON public.serapp_order_holds;
CREATE POLICY serapp_order_holds_insert ON public.serapp_order_holds
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_hq_admin()
      OR public.can_access_org(buyer_org_id)
      OR public.can_access_org(seller_hq_id)
    )
  );

DROP POLICY IF EXISTS serapp_order_holds_update ON public.serapp_order_holds;
CREATE POLICY serapp_order_holds_update ON public.serapp_order_holds
  FOR UPDATE TO authenticated
  USING (
    public.is_hq_admin()
    OR public.can_access_org(seller_hq_id)
    OR public.can_access_org(fulfillment_warehouse_id)
    OR public.can_access_org(buyer_org_id)
  )
  WITH CHECK (
    public.is_hq_admin()
    OR public.can_access_org(seller_hq_id)
    OR public.can_access_org(fulfillment_warehouse_id)
    OR public.can_access_org(buyer_org_id)
  );

COMMENT ON TABLE public.serapp_order_holds IS
  'Serapp 1-hour acceptance window over current D2H allocate-on-submit orders. Active holds may expire and cancel/release; accepted holds continue normal warehouse/approval workflow.';

COMMIT;
