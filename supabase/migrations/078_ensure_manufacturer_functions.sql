-- Migration: Ensure manufacturer tables and functions exist
-- This migration fixes the missing stock_adjustment_manufacturer_actions table and ensures the acknowledge function exists.

BEGIN;

-- 1. Create stock_adjustment_manufacturer_actions table if it doesn't exist
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

-- 2. Add Foreign Keys if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sm_actions_adjustment') THEN
    ALTER TABLE public.stock_adjustment_manufacturer_actions
      ADD CONSTRAINT fk_sm_actions_adjustment FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sm_actions_manufacturer') THEN
    ALTER TABLE public.stock_adjustment_manufacturer_actions
      ADD CONSTRAINT fk_sm_actions_manufacturer FOREIGN KEY (manufacturer_org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Enable RLS
ALTER TABLE public.stock_adjustment_manufacturer_actions ENABLE ROW LEVEL SECURITY;

-- 4. Create Policies
DO $$
BEGIN
  -- Insert Policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions insert for their organization' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions insert for their organization" ON public.stock_adjustment_manufacturer_actions
      FOR INSERT
      WITH CHECK ((manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;

  -- Select Policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions view for their organization' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions view for their organization" ON public.stock_adjustment_manufacturer_actions
      FOR SELECT
      USING ((manufacturer_org_id IN ( SELECT users.organization_id FROM public.users WHERE users.id = auth.uid())) OR public.is_super_admin());
  END IF;

  -- Admin Update Policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions admin update' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions admin update" ON public.stock_adjustment_manufacturer_actions
      FOR UPDATE
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;

  -- Admin Delete Policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Manufacturer actions admin delete' AND polrelid = 'public.stock_adjustment_manufacturer_actions'::regclass
  ) THEN
    CREATE POLICY "Manufacturer actions admin delete" ON public.stock_adjustment_manufacturer_actions
      FOR DELETE
      USING (public.is_super_admin());
  END IF;
END $$;

-- 5. Create/Update the Acknowledge Function
CREATE OR REPLACE FUNCTION public.manufacturer_acknowledge_adjustment(p_adjustment_id uuid, p_notes text DEFAULT NULL::text)
RETURNS public.stock_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamp := now();
  v_adj public.stock_adjustments%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_user_org_id uuid;
BEGIN
  -- Get user's org
  SELECT organization_id INTO v_user_org_id FROM public.users WHERE id = v_user_id;

  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found: %', p_adjustment_id;
  END IF;

  -- Check permission: must be assigned manufacturer OR super admin
  IF v_adj.target_manufacturer_org_id IS DISTINCT FROM v_user_org_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to acknowledge this adjustment';
  END IF;

  -- Update status
  UPDATE public.stock_adjustments SET
    manufacturer_status = 'acknowledged',
    manufacturer_acknowledged_by = v_user_id,
    manufacturer_acknowledged_at = v_now,
    manufacturer_notes = COALESCE(p_notes, manufacturer_notes)
  WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  -- Insert action audit
  INSERT INTO public.stock_adjustment_manufacturer_actions (adjustment_id, manufacturer_org_id, action_type, notes, created_by, created_at)
  VALUES (p_adjustment_id, COALESCE(v_user_org_id, v_adj.target_manufacturer_org_id), 'acknowledged', p_notes, v_user_id, v_now);

  RETURN v_adj;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manufacturer_acknowledge_adjustment TO authenticated;

COMMIT;
