-- ============================================================================
-- Return Product Module (Supply Chain > Quality & Returns)
-- ----------------------------------------------------------------------------
-- Introduces a simple, warehouse/support-driven product return flow that moves
-- return cases from shops to a warehouse through five statuses:
--
--   return_draft -> return_submitted -> return_received
--                -> return_processing -> return_completed
--
-- (plus an optional return_cancelled terminal state before completion).
--
-- This is a NEW, self-contained feature. It does NOT modify or depend on the
-- older manufacturer "quality issues" (stock_adjustments) flow, so it is safe
-- and backward-compatible.
--
-- Tables:
--   return_settings            singleton config (default warehouse, SLA, PDF text)
--   return_reasons             master list of return reasons
--   return_conditions          master list of item conditions
--   return_cases               one return case (header)
--   return_case_items          line items in a return case
--   return_case_status_history activity log of status transitions
--
-- Idempotent: safe to run multiple times.
--
-- ROLLBACK NOTES (manual):
--   DROP TABLE IF EXISTS public.return_case_status_history CASCADE;
--   DROP TABLE IF EXISTS public.return_case_items          CASCADE;
--   DROP TABLE IF EXISTS public.return_cases               CASCADE;
--   DROP TABLE IF EXISTS public.return_conditions          CASCADE;
--   DROP TABLE IF EXISTS public.return_reasons             CASCADE;
--   DROP TABLE IF EXISTS public.return_settings            CASCADE;
--   DROP FUNCTION IF EXISTS public.generate_return_no();
--   DROP FUNCTION IF EXISTS public.return_current_user_org_id();
--   DROP FUNCTION IF EXISTS public.return_current_user_is_manager();
--   DROP SEQUENCE IF EXISTS public.return_case_no_seq;
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Helper functions (self-contained; do not depend on other RLS helpers
--    that may be missing on some environments).
-- ─────────────────────────────────────────────────────────────────────────

-- Caller's own organization id.
CREATE OR REPLACE FUNCTION public.return_current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$;

-- True when the caller may manage return cases beyond their own shop
-- (i.e. warehouse / support / HQ / distributor / manufacturer / super admin),
-- false for SHOP users who are limited to their own shop's returns.
CREATE OR REPLACE FUNCTION public.return_current_user_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE u.id = auth.uid()
      AND (
        COALESCE(o.org_type_code, '') <> 'SHOP'
        OR u.role_code = 'SA'
      )
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Return number generator: RTN-YYYYMM-##### (monotonic sequence).
-- ─────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.return_case_no_seq;

CREATE OR REPLACE FUNCTION public.generate_return_no()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'RTN-' || to_char(now(), 'YYYYMM') || '-'
         || lpad(nextval('public.return_case_no_seq')::text, 5, '0')
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Settings (singleton), reasons & conditions master lists.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.return_settings (
  id                              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_return_warehouse_id     uuid REFERENCES public.organizations(id),
  sla_submitted_to_received_days  integer NOT NULL DEFAULT 3 CHECK (sla_submitted_to_received_days >= 0),
  sla_received_to_processing_days integer NOT NULL DEFAULT 2 CHECK (sla_received_to_processing_days >= 0),
  sla_processing_to_completed_days integer NOT NULL DEFAULT 5 CHECK (sla_processing_to_completed_days >= 0),
  pdf_instruction_text            text,
  shop_self_service_enabled       boolean NOT NULL DEFAULT true,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid
);

CREATE TABLE IF NOT EXISTS public.return_reasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  label      text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.return_conditions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  label      text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Return cases (header) + items + status history.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.return_cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no            text NOT NULL UNIQUE DEFAULT public.generate_return_no(),
  shop_org_id          uuid NOT NULL REFERENCES public.organizations(id),
  return_warehouse_id  uuid REFERENCES public.organizations(id),
  contact_person       text,
  contact_phone        text,
  status               text NOT NULL DEFAULT 'return_draft'
                         CHECK (status IN (
                           'return_draft',
                           'return_submitted',
                           'return_received',
                           'return_processing',
                           'return_completed',
                           'return_cancelled'
                         )),
  notes                text,
  -- Warehouse processing block
  received_by          text,
  received_date        date,
  processing_notes     text,
  action_taken         text,
  return_courier       text,
  tracking_no          text,
  completed_date       date,
  -- Audit timestamps
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  submitted_at         timestamptz,
  received_at          timestamptz,
  processing_started_at timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_return_cases_shop      ON public.return_cases(shop_org_id);
CREATE INDEX IF NOT EXISTS idx_return_cases_warehouse ON public.return_cases(return_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_return_cases_status    ON public.return_cases(status);
CREATE INDEX IF NOT EXISTS idx_return_cases_created   ON public.return_cases(created_at DESC);

CREATE TABLE IF NOT EXISTS public.return_case_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_case_id uuid NOT NULL REFERENCES public.return_cases(id) ON DELETE CASCADE,
  product_id     uuid,
  variant_id     uuid,
  sku            text,
  product_name   text,
  variant_name   text,
  quantity       numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost      numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  reason         text,
  condition      text,
  photo_url      text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_case_items_case ON public.return_case_items(return_case_id);

CREATE TABLE IF NOT EXISTS public.return_case_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_case_id uuid NOT NULL REFERENCES public.return_cases(id) ON DELETE CASCADE,
  from_status    text,
  to_status      text NOT NULL,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  notes          text
);

CREATE INDEX IF NOT EXISTS idx_return_status_history_case ON public.return_case_status_history(return_case_id, changed_at);

-- keep updated_at fresh on the header
CREATE OR REPLACE FUNCTION public.return_cases_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_cases_updated_at ON public.return_cases;
CREATE TRIGGER trg_return_cases_updated_at
  BEFORE UPDATE ON public.return_cases
  FOR EACH ROW EXECUTE FUNCTION public.return_cases_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security.
--    Writes normally flow through API routes using the service-role/admin
--    client (which bypasses RLS) and are scoped in application code. These
--    policies cover direct authenticated reads and provide defence-in-depth.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.return_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_reasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_conditions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_cases               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_case_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_case_status_history ENABLE ROW LEVEL SECURITY;

-- Settings / master lists: readable by any authenticated user, writable by managers.
DROP POLICY IF EXISTS return_settings_read ON public.return_settings;
CREATE POLICY return_settings_read ON public.return_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS return_settings_write ON public.return_settings;
CREATE POLICY return_settings_write ON public.return_settings
  FOR ALL TO authenticated
  USING (public.return_current_user_is_manager())
  WITH CHECK (public.return_current_user_is_manager());

DROP POLICY IF EXISTS return_reasons_read ON public.return_reasons;
CREATE POLICY return_reasons_read ON public.return_reasons
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS return_reasons_write ON public.return_reasons;
CREATE POLICY return_reasons_write ON public.return_reasons
  FOR ALL TO authenticated
  USING (public.return_current_user_is_manager())
  WITH CHECK (public.return_current_user_is_manager());

DROP POLICY IF EXISTS return_conditions_read ON public.return_conditions;
CREATE POLICY return_conditions_read ON public.return_conditions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS return_conditions_write ON public.return_conditions;
CREATE POLICY return_conditions_write ON public.return_conditions
  FOR ALL TO authenticated
  USING (public.return_current_user_is_manager())
  WITH CHECK (public.return_current_user_is_manager());

-- Cases: shop users see/manage only their own shop's returns; managers see all.
DROP POLICY IF EXISTS return_cases_select ON public.return_cases;
CREATE POLICY return_cases_select ON public.return_cases
  FOR SELECT TO authenticated
  USING (
    public.return_current_user_is_manager()
    OR shop_org_id = public.return_current_user_org_id()
  );
DROP POLICY IF EXISTS return_cases_write ON public.return_cases;
CREATE POLICY return_cases_write ON public.return_cases
  FOR ALL TO authenticated
  USING (
    public.return_current_user_is_manager()
    OR shop_org_id = public.return_current_user_org_id()
  )
  WITH CHECK (
    public.return_current_user_is_manager()
    OR shop_org_id = public.return_current_user_org_id()
  );

-- Items / history: visible when the parent case is visible.
DROP POLICY IF EXISTS return_case_items_all ON public.return_case_items;
CREATE POLICY return_case_items_all ON public.return_case_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.return_cases c
    WHERE c.id = return_case_id
      AND (public.return_current_user_is_manager()
           OR c.shop_org_id = public.return_current_user_org_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.return_cases c
    WHERE c.id = return_case_id
      AND (public.return_current_user_is_manager()
           OR c.shop_org_id = public.return_current_user_org_id())
  ));

DROP POLICY IF EXISTS return_status_history_all ON public.return_case_status_history;
CREATE POLICY return_status_history_all ON public.return_case_status_history
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.return_cases c
    WHERE c.id = return_case_id
      AND (public.return_current_user_is_manager()
           OR c.shop_org_id = public.return_current_user_org_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.return_cases c
    WHERE c.id = return_case_id
      AND (public.return_current_user_is_manager()
           OR c.shop_org_id = public.return_current_user_org_id())
  ));

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Seed defaults (idempotent).
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO public.return_settings (id, pdf_instruction_text)
VALUES (1, 'Please pack all returned items securely and include this return form inside the parcel. Keep a copy of the tracking number for your records.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.return_reasons (code, label, sort_order) VALUES
  ('defective',          'Defective',          10),
  ('damaged',            'Damaged',            20),
  ('wrong_item',         'Wrong Item',         30),
  ('expired',            'Expired',            40),
  ('leaking',            'Leaking',            50),
  ('customer_complaint', 'Customer Complaint', 60),
  ('other',              'Other',              70)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.return_conditions (code, label, sort_order) VALUES
  ('unopened',          'Unopened',          10),
  ('opened',            'Opened',            20),
  ('damaged_packaging', 'Damaged Packaging', 30),
  ('missing_item',      'Missing Item',      40),
  ('not_sellable',      'Not Sellable',      50)
ON CONFLICT (code) DO NOTHING;

COMMIT;
