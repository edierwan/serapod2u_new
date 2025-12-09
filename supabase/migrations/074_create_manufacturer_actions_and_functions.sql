-- 074_create_manufacturer_actions_and_functions.sql
-- Adds stock_adjustment_manufacturer_actions table and helper functions for assignment and acknowledgement

BEGIN;

-- 1) table for manufacturer actions / audit trail
CREATE TABLE IF NOT EXISTS public.stock_adjustment_manufacturer_actions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  adjustment_id uuid NOT NULL,
  manufacturer_org_id uuid NOT NULL,
  action_type text NOT NULL, -- 'assigned','acknowledged','resolved','rejected'
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stock_adj_man_actions_pkey PRIMARY KEY (id)
);

ALTER TABLE public.stock_adjustment_manufacturer_actions
  ADD CONSTRAINT fk_sm_actions_adjustment FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE;

ALTER TABLE public.stock_adjustment_manufacturer_actions
  ADD CONSTRAINT fk_sm_actions_manufacturer FOREIGN KEY (manufacturer_org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Enable RLS for actions
ALTER TABLE public.stock_adjustment_manufacturer_actions ENABLE ROW LEVEL SECURITY;

-- Allow manufacturer org members to insert actions for their organization (auth check via users table)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions insert for their organization' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions insert for their organization" ON public.stock_adjustment_manufacturer_actions
      FOR INSERT
      WITH CHECK ((manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;
END $$;

-- Allow manufacturer org members and super admin to select and view actions for their org
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions view for their organization' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions view for their organization" ON public.stock_adjustment_manufacturer_actions
      FOR SELECT
      USING ((manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;
END $$;

-- Allow super admin to update/delete (audit records typically immutable; allow for admin edits only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions admin update' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions admin update" ON public.stock_adjustment_manufacturer_actions
      FOR UPDATE, DELETE
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;
END $$;

-- 2) function: assign adjustment to manufacturer
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

  -- update assignment fields
  UPDATE public.stock_adjustments SET
    target_manufacturer_org_id = p_manufacturer_org_id,
    manufacturer_assigned_at = v_now,
    manufacturer_status = 'pending'
  WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  -- insert action audit
  INSERT INTO public.stock_adjustment_manufacturer_actions (adjustment_id, manufacturer_org_id, action_type, notes, created_by, created_at)
  VALUES (p_adjustment_id, p_manufacturer_org_id, 'assigned', NULL, auth.uid(), v_now);

  RETURN v_adj;
END;
$$;

COMMENT ON FUNCTION public.assign_adjustment_to_manufacturer IS 'Assign an existing stock_adjustment to a manufacturer org and record an action.';

-- 3) function: manufacturer acknowledges adjustment
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

  -- Check that current user belongs to the manufacturer org OR is super admin
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

-- 4) function: admin resolves/rejects adjustment (must be super admin or org owner)
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

COMMIT;
