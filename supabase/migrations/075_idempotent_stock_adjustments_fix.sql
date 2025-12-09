-- 075_idempotent_stock_adjustments_fix.sql
-- Safe idempotent migration: ensures stock_adjustments manufacturer fields, audit table, policies and RPC functions exist.
-- Run this migration after you back up the database.

BEGIN;

-- 1) Add missing columns to stock_adjustments if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'target_manufacturer_org_id'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD COLUMN target_manufacturer_org_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'manufacturer_assigned_at'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD COLUMN manufacturer_assigned_at timestamp with time zone;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'manufacturer_status'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD COLUMN manufacturer_status text DEFAULT 'pending'::text NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'manufacturer_acknowledged_by'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD COLUMN manufacturer_acknowledged_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'manufacturer_acknowledged_at'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD COLUMN manufacturer_acknowledged_at timestamp with time zone;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'manufacturer_notes'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD COLUMN manufacturer_notes text;
  END IF;
END $$;

-- 2) Add FK constraints if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_adjustments_target_manufacturer') THEN
    ALTER TABLE public.stock_adjustments
      ADD CONSTRAINT fk_stock_adjustments_target_manufacturer FOREIGN KEY (target_manufacturer_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_adjustments_manufacturer_ack_by') THEN
    ALTER TABLE public.stock_adjustments
      ADD CONSTRAINT fk_stock_adjustments_manufacturer_ack_by FOREIGN KEY (manufacturer_acknowledged_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Ensure manufacturer_status constraint exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustments_manufacturer_status_check') THEN
    ALTER TABLE public.stock_adjustments
      ADD CONSTRAINT stock_adjustments_manufacturer_status_check CHECK (manufacturer_status = ANY (ARRAY['pending','acknowledged','resolved','rejected']));
  END IF;
END $$;

-- 4) Ensure index exists
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_target_manufacturer ON public.stock_adjustments (target_manufacturer_org_id) WHERE (target_manufacturer_org_id IS NOT NULL);

-- 5) Ensure stock_adjustment_manufacturer_actions table exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'stock_adjustment_manufacturer_actions' AND relnamespace = 'public'::regnamespace) THEN
    CREATE TABLE public.stock_adjustment_manufacturer_actions (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      adjustment_id uuid NOT NULL,
      manufacturer_org_id uuid NOT NULL,
      action_type text NOT NULL,
      notes text,
      created_by uuid DEFAULT auth.uid(),
      created_at timestamp with time zone DEFAULT now(),
      CONSTRAINT stock_adj_man_actions_pkey PRIMARY KEY (id)
    );

    ALTER TABLE public.stock_adjustment_manufacturer_actions
      ADD CONSTRAINT fk_sm_actions_adjustment FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE;

    ALTER TABLE public.stock_adjustment_manufacturer_actions
      ADD CONSTRAINT fk_sm_actions_manufacturer FOREIGN KEY (manufacturer_org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6) Enable RLS and create policies safely for actions table
ALTER TABLE public.stock_adjustment_manufacturer_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions insert for their organization' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass) THEN
    CREATE POLICY "Manufacturer actions insert for their organization" ON public.stock_adjustment_manufacturer_actions
      FOR INSERT
      WITH CHECK ((manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions view for their organization' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass) THEN
    CREATE POLICY "Manufacturer actions view for their organization" ON public.stock_adjustment_manufacturer_actions
      FOR SELECT
      USING ((manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions admin update' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass) THEN
    CREATE POLICY "Manufacturer actions admin update" ON public.stock_adjustment_manufacturer_actions
      FOR UPDATE, DELETE
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;
END $$;

-- 7) Create/replace RPCs (idempotent) to ensure functions exist

-- assign_adjustment_to_manufacturer
CREATE OR REPLACE FUNCTION public.assign_adjustment_to_manufacturer(p_adjustment_id uuid, p_manufacturer_org_id uuid)
RETURNS public.stock_adjustments
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp := now();
  v_adj public.stock_adjustments%ROWTYPE;
BEGIN
  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found: %', p_adjustment_id;
  END IF;

  UPDATE public.stock_adjustments SET
    target_manufacturer_org_id = p_manufacturer_org_id,
    manufacturer_assigned_at = v_now,
    manufacturer_status = 'pending'
  WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  INSERT INTO public.stock_adjustment_manufacturer_actions (adjustment_id, manufacturer_org_id, action_type, notes, created_by, created_at)
  VALUES (p_adjustment_id, p_manufacturer_org_id, 'assigned', NULL, auth.uid(), v_now);

  RETURN v_adj;
END;
$$;

COMMENT ON FUNCTION public.assign_adjustment_to_manufacturer IS 'Assign an existing stock_adjustment to a manufacturer org and record an action.';

-- manufacturer_acknowledge_adjustment
CREATE OR REPLACE FUNCTION public.manufacturer_acknowledge_adjustment(p_adjustment_id uuid, p_notes text DEFAULT NULL::text)
RETURNS public.stock_adjustments
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp := now();
  v_adj public.stock_adjustments%ROWTYPE;
  v_man_org uuid;
BEGIN
  SELECT target_manufacturer_org_id INTO v_man_org FROM public.stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND OR v_man_org IS NULL THEN
    RAISE EXCEPTION 'Adjustment not assigned to a manufacturer';
  END IF;

  IF NOT (public.current_user_org_id() = v_man_org OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Not authorized to acknowledge this adjustment';
  END IF;

  UPDATE public.stock_adjustments SET
    manufacturer_acknowledged_by = auth.uid(),
    manufacturer_acknowledged_at = v_now,
    manufacturer_status = 'acknowledged',
    manufacturer_notes = COALESCE(p_notes, manufacturer_notes)
  WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  INSERT INTO public.stock_adjustment_manufacturer_actions (adjustment_id, manufacturer_org_id, action_type, notes, created_by, created_at)
  VALUES (p_adjustment_id, v_man_org, 'acknowledged', p_notes, auth.uid(), v_now);

  RETURN v_adj;
END;
$$;

COMMENT ON FUNCTION public.manufacturer_acknowledge_adjustment IS 'Manufacturer acknowledges an assigned adjustment; records who acknowledged and a note.';

-- admin_update_adjustment_status
CREATE OR REPLACE FUNCTION public.admin_update_adjustment_status(p_adjustment_id uuid, p_status text, p_notes text DEFAULT NULL::text)
RETURNS public.stock_adjustments
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp := now();
  v_adj public.stock_adjustments%ROWTYPE;
  v_man_org uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can change final status';
  END IF;

  SELECT target_manufacturer_org_id INTO v_man_org FROM public.stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found';
  END IF;

  IF p_status NOT IN ('resolved','rejected') THEN
    RAISE EXCEPTION 'Invalid status for admin_update_adjustment_status: %', p_status;
  END IF;

  UPDATE public.stock_adjustments SET
    manufacturer_status = p_status,
    manufacturer_notes = COALESCE(p_notes, manufacturer_notes)
  WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  INSERT INTO public.stock_adjustment_manufacturer_actions (adjustment_id, manufacturer_org_id, action_type, notes, created_by, created_at)
  VALUES (p_adjustment_id, v_man_org, p_status, p_notes, auth.uid(), v_now);

  RETURN v_adj;
END;
$$;

COMMENT ON FUNCTION public.admin_update_adjustment_status IS 'Super admin marks assigned adjustment as resolved or rejected and records notes.';

-- 8) Ensure seed reasons exist
INSERT INTO public.stock_adjustment_reasons (reason_code, reason_name, reason_description, requires_approval, is_active, created_at, updated_at)
VALUES
  ('quality_issue', 'Quality Issue', 'Stock removed due to quality issues', false, true, now(), now()),
  ('return_to_supplier', 'Return to Supplier', 'Stock returned to manufacturer/supplier', true, true, now(), now())
ON CONFLICT (reason_code) DO UPDATE SET reason_name=EXCLUDED.reason_name, reason_description=EXCLUDED.reason_description, requires_approval=EXCLUDED.requires_approval, is_active=EXCLUDED.is_active, updated_at = now();

COMMIT;
