-- 073_add_manufacturer_ack_to_stock_adjustments.sql
-- Adds manufacturer assignment & acknowledgement columns + policies for stock_adjustments
-- Run this migration against your supabase database

BEGIN;

-- 1) add columns to stock_adjustments
ALTER TABLE public.stock_adjustments
  ADD COLUMN target_manufacturer_org_id uuid,
  ADD COLUMN manufacturer_assigned_at timestamp with time zone,
  ADD COLUMN manufacturer_status text DEFAULT 'pending'::text NOT NULL,
  ADD COLUMN manufacturer_acknowledged_by uuid,
  ADD COLUMN manufacturer_acknowledged_at timestamp with time zone,
  ADD COLUMN manufacturer_notes text;

-- 2) add constraints and FK relations
ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT fk_stock_adjustments_target_manufacturer FOREIGN KEY (target_manufacturer_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT fk_stock_adjustments_manufacturer_ack_by FOREIGN KEY (manufacturer_acknowledged_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) Add check constraint to ensure manufacturer_status is one of expected values
ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_manufacturer_status_check CHECK (manufacturer_status = ANY (ARRAY['pending','acknowledged','resolved','rejected']));

-- 4) Index for fast access by manufacturer
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_target_manufacturer ON public.stock_adjustments (target_manufacturer_org_id) WHERE (target_manufacturer_org_id IS NOT NULL);

-- 5) Ensure attachments bucket policy exists (policy in current_schema already present)
-- NOTE: attachments are stored in storage.objects with bucket 'stock-adjustments' via existing policies

-- 6) RLS policies for manufacturer access + super admins
-- Allow organization members (including manufacturer org users) to view adjustments in their org OR assigned to them
-- Many projects use users.organization_id to match an org — we reuse that pattern.

-- First enable row level security if not already enabled (schema already shows enabled in current_schema.sql, but make idempotent)
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

-- Allow users to insert adjustments for their org (existing policy likely exists; add intent for completeness)
-- (Existing create policy usually present in schema; we won't attempt to re-create it unconditionally.)

-- View: allow users in the organization (warehouses, shops) to view their org entries
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Users can view adjustments for their organization' AND polrelid = 'public.stock_adjustments'::regclass) THEN
    CREATE POLICY "Users can view adjustments for their organization" ON public.stock_adjustments
      FOR SELECT
      USING ((organization_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR (target_manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())));
  END IF;
END $$;

-- Manufacturer specific policy: manufacturers / super admins should be able to select adjustments assigned to them
-- The function to detect super admin depends on your app. If you have role column on users or organizations, adapt accordingly.
-- The policy below lets members of the manufacturer org view rows where target_manufacturer_org_id = user's organization.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Manufacturers can view assigned adjustments' AND polrelid = 'public.stock_adjustments'::regclass) THEN
    CREATE POLICY "Manufacturers can view assigned adjustments" ON public.stock_adjustments
      FOR SELECT
      USING ((target_manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;
END $$;

-- Allow manufacturers to update manufacturer acknowledgement columns for adjustments assigned to them
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Manufacturers can acknowledge assigned adjustments' AND polrelid = 'public.stock_adjustments'::regclass) THEN
    CREATE POLICY "Manufacturers can acknowledge assigned adjustments" ON public.stock_adjustments
      FOR UPDATE
      USING ((target_manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin())
      WITH CHECK ((target_manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;
END $$;

COMMIT;

-- 7) Seed stock_adjustment_reasons for UI reasons if not present
BEGIN;
INSERT INTO public.stock_adjustment_reasons (reason_code, reason_name, reason_description, requires_approval, is_active)
  VALUES
    ('quality_issue', 'Quality Issue', 'Stock removed due to quality issues', false, true),
    ('return_to_supplier', 'Return to Supplier', 'Stock returned to manufacturer/supplier', true, true)
  ON CONFLICT (reason_code) DO NOTHING;
COMMIT;
