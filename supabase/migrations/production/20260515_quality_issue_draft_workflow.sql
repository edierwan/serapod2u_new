BEGIN;

ALTER TABLE public.stock_adjustments
    DROP CONSTRAINT IF EXISTS stock_adjustments_manufacturer_status_check;

ALTER TABLE public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_manufacturer_status_check
    CHECK (
        manufacturer_status = ANY (
            ARRAY[
                'draft'::text,
                'pending'::text,
                'pending_manufacturer'::text,
                'acknowledged'::text,
                'resolved'::text,
                'rejected'::text
            ]
        )
    );

CREATE OR REPLACE FUNCTION public.manufacturer_acknowledge_adjustment(
    p_adjustment_id uuid,
    p_notes text DEFAULT NULL::text
) RETURNS public.stock_adjustments
    LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_now timestamp := now();
  v_adj public.stock_adjustments%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_user_org_id uuid;
BEGIN
  SELECT organization_id INTO v_user_org_id FROM public.users WHERE id = v_user_id;

  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found: %', p_adjustment_id;
  END IF;

  IF v_adj.target_manufacturer_org_id IS DISTINCT FROM v_user_org_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to acknowledge this adjustment';
  END IF;

  IF v_adj.manufacturer_status IS NULL OR v_adj.manufacturer_status NOT IN ('pending', 'pending_manufacturer') THEN
    RAISE EXCEPTION 'Adjustment must be sent to manufacturer before acknowledgement';
  END IF;

  UPDATE public.stock_adjustments SET
    manufacturer_status = 'acknowledged',
    manufacturer_acknowledged_by = v_user_id,
    manufacturer_acknowledged_at = v_now,
    manufacturer_notes = COALESCE(p_notes, manufacturer_notes)
  WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  INSERT INTO public.stock_adjustment_manufacturer_actions (
    adjustment_id,
    manufacturer_org_id,
    action_type,
    notes,
    created_by,
    created_at
  )
  VALUES (
    p_adjustment_id,
    COALESCE(v_user_org_id, v_adj.target_manufacturer_org_id),
    'acknowledged',
    p_notes,
    v_user_id,
    v_now
  );

  RETURN v_adj;
END;
$$;

COMMIT;