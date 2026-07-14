CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  warehouse_organization_id uuid NOT NULL REFERENCES public.organizations(id),
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  count_type text NOT NULL DEFAULT 'full_count',
  reference_name text,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  total_variants_counted integer DEFAULT 0,
  variance_items integer DEFAULT 0,
  net_quantity_adjustment integer DEFAULT 0,
  estimated_adjustment_value numeric(15,2) DEFAULT 0,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamp with time zone,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT stock_count_sessions_count_type_check CHECK (count_type IN ('full_count', 'cycle_count', 'spot_check')),
  CONSTRAINT stock_count_sessions_status_check CHECK (status IN ('draft', 'posted')),
  CONSTRAINT stock_count_sessions_no_future_date CHECK (count_date <= CURRENT_DATE),
  CONSTRAINT stock_count_sessions_posted_once CHECK (
    (status = 'draft' AND posted_at IS NULL) OR
    (status = 'posted' AND posted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.stock_count_session_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  sku text,
  system_quantity integer NOT NULL,
  physical_quantity integer,
  adjustment_quantity integer,
  unit_cost numeric(12,2),
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT stock_count_session_items_qty_check CHECK (physical_quantity IS NULL OR physical_quantity >= 0),
  CONSTRAINT stock_count_session_items_unique_variant UNIQUE (session_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_sessions_warehouse_status
  ON public.stock_count_sessions (warehouse_organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_count_session_items_session
  ON public.stock_count_session_items (session_id);

ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_session_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_count_sessions_manage_org ON public.stock_count_sessions
  TO authenticated
  USING (public.can_access_org(warehouse_organization_id) OR public.is_hq_admin())
  WITH CHECK (public.can_access_org(warehouse_organization_id) OR public.is_hq_admin());

CREATE POLICY stock_count_session_items_manage_org ON public.stock_count_session_items
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.stock_count_sessions sessions
      WHERE sessions.id = stock_count_session_items.session_id
        AND (public.can_access_org(sessions.warehouse_organization_id) OR public.is_hq_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.stock_count_sessions sessions
      WHERE sessions.id = stock_count_session_items.session_id
        AND (public.can_access_org(sessions.warehouse_organization_id) OR public.is_hq_admin())
    )
  );
