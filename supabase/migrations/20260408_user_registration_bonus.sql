-- ============================================================================
-- Migration: User Registration Bonus Configuration and Tracking
-- Date: 2026-04-08
-- Purpose:
--   1. Add configurable welcome bonus settings per organization
--   2. Track each registered user bonus lifecycle
--   3. Support instant bonus and conditional bonus release
--   4. Provide SQL function to evaluate and auto-release conditional bonus
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_registration_bonus_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  bonus_mode text NOT NULL DEFAULT 'conditional' CHECK (bonus_mode IN ('instant', 'conditional')),
  bonus_points integer NOT NULL DEFAULT 50 CHECK (bonus_points > 0),
  min_valid_scans_per_month integer NOT NULL DEFAULT 1 CHECK (min_valid_scans_per_month > 0),
  required_consecutive_months integer NOT NULL DEFAULT 3 CHECK (required_consecutive_months > 0),
  only_unique_qr_scans boolean NOT NULL DEFAULT true,
  allow_grace_month boolean NOT NULL DEFAULT false,
  bonus_expiry_days integer,
  max_bonus_claims_per_user integer NOT NULL DEFAULT 1 CHECK (max_bonus_claims_per_user > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_registration_bonus_settings_org UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_registration_bonus_settings_org
  ON public.user_registration_bonus_settings (org_id);

CREATE TABLE IF NOT EXISTS public.user_registration_bonus_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  settings_id uuid REFERENCES public.user_registration_bonus_settings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'awarded', 'expired', 'disabled')),
  bonus_mode text NOT NULL CHECK (bonus_mode IN ('instant', 'conditional')),
  bonus_points integer NOT NULL CHECK (bonus_points > 0),
  min_valid_scans_per_month integer,
  required_consecutive_months integer,
  only_unique_qr_scans boolean NOT NULL DEFAULT true,
  allow_grace_month boolean NOT NULL DEFAULT false,
  bonus_expiry_days integer,
  max_bonus_claims_per_user integer NOT NULL DEFAULT 1,
  months_qualified integer NOT NULL DEFAULT 0,
  registration_source text NOT NULL DEFAULT 'premium_loyalty',
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz,
  qualified_at timestamptz,
  awarded_at timestamptz,
  expires_at timestamptz,
  awarded_transaction_id uuid REFERENCES public.points_transactions(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_registration_bonus_progress UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_registration_bonus_progress_status
  ON public.user_registration_bonus_progress (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_registration_bonus_progress_user
  ON public.user_registration_bonus_progress (user_id, status);

CREATE OR REPLACE FUNCTION public.set_updated_at_user_registration_bonus()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_registration_bonus_settings_updated_at ON public.user_registration_bonus_settings;
CREATE TRIGGER trg_user_registration_bonus_settings_updated_at
BEFORE UPDATE ON public.user_registration_bonus_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_user_registration_bonus();

DROP TRIGGER IF EXISTS trg_user_registration_bonus_progress_updated_at ON public.user_registration_bonus_progress;
CREATE TRIGGER trg_user_registration_bonus_progress_updated_at
BEFORE UPDATE ON public.user_registration_bonus_progress
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_user_registration_bonus();

ALTER TABLE public.user_registration_bonus_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_registration_bonus_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_registration_bonus_settings_admin_select ON public.user_registration_bonus_settings;
CREATE POLICY user_registration_bonus_settings_admin_select
ON public.user_registration_bonus_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
  )
);

DROP POLICY IF EXISTS user_registration_bonus_settings_admin_manage ON public.user_registration_bonus_settings;
CREATE POLICY user_registration_bonus_settings_admin_manage
ON public.user_registration_bonus_settings
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
  )
);

DROP POLICY IF EXISTS user_registration_bonus_progress_admin_select ON public.user_registration_bonus_progress;
CREATE POLICY user_registration_bonus_progress_admin_select
ON public.user_registration_bonus_progress
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
  )
  OR user_id = auth.uid()
);

GRANT ALL ON public.user_registration_bonus_settings TO service_role;
GRANT ALL ON public.user_registration_bonus_progress TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_user_registration_bonus(
  p_org_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_progress public.user_registration_bonus_progress%ROWTYPE;
  v_balance integer := 0;
  v_txn_id uuid;
  v_month date;
  v_scan_count integer;
  v_streak integer := 0;
  v_best_streak integer := 0;
  v_grace_used boolean := false;
  v_start_month date;
  v_end_month date;
  v_description text;
  v_phone text;
  v_email text;
BEGIN
  SELECT *
  INTO v_progress
  FROM public.user_registration_bonus_progress
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND status IN ('pending', 'qualified')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'No pending registration bonus found for this user.');
  END IF;

  v_start_month := date_trunc('month', COALESCE(v_progress.registered_at, v_progress.created_at))::date;
  v_end_month := date_trunc('month', now())::date;

  FOR v_month IN
    SELECT generate_series(v_start_month, v_end_month, interval '1 month')::date
  LOOP
    IF v_progress.only_unique_qr_scans THEN
      SELECT COUNT(DISTINCT cqs.qr_code_id)
      INTO v_scan_count
      FROM public.consumer_qr_scans cqs
      WHERE cqs.consumer_id = p_user_id
        AND cqs.collected_points = true
        AND COALESCE(cqs.is_manual_adjustment, false) = false
        AND date_trunc('month', COALESCE(cqs.points_collected_at, cqs.scanned_at))::date = v_month;
    ELSE
      SELECT COUNT(*)
      INTO v_scan_count
      FROM public.consumer_qr_scans cqs
      WHERE cqs.consumer_id = p_user_id
        AND cqs.collected_points = true
        AND COALESCE(cqs.is_manual_adjustment, false) = false
        AND date_trunc('month', COALESCE(cqs.points_collected_at, cqs.scanned_at))::date = v_month;
    END IF;

    IF COALESCE(v_scan_count, 0) >= COALESCE(v_progress.min_valid_scans_per_month, 1) THEN
      v_streak := v_streak + 1;
      v_best_streak := GREATEST(v_best_streak, v_streak);
    ELSIF v_progress.allow_grace_month AND v_streak > 0 AND NOT v_grace_used THEN
      v_grace_used := true;
    ELSE
      v_streak := 0;
      v_grace_used := false;
    END IF;
  END LOOP;

  UPDATE public.user_registration_bonus_progress
  SET months_qualified = v_best_streak,
      last_evaluated_at = now(),
      status = CASE WHEN v_best_streak >= COALESCE(v_progress.required_consecutive_months, 1) THEN 'qualified' ELSE status END,
      qualified_at = CASE WHEN v_best_streak >= COALESCE(v_progress.required_consecutive_months, 1) AND qualified_at IS NULL THEN now() ELSE qualified_at END
  WHERE id = v_progress.id;

  IF v_best_streak < COALESCE(v_progress.required_consecutive_months, 1) THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'pending',
      'months_qualified', v_best_streak,
      'required_months', COALESCE(v_progress.required_consecutive_months, 1),
      'message', 'Conditional registration bonus is still pending qualification.'
    );
  END IF;

  SELECT COALESCE(v.current_balance, 0)
  INTO v_balance
  FROM public.v_consumer_points_balance v
  WHERE v.user_id = p_user_id;

  SELECT u.phone, u.email INTO v_phone, v_email
  FROM public.users u
  WHERE u.id = p_user_id;

  v_description := format(
    'Welcome bonus released after %s consecutive qualified month(s).',
    COALESCE(v_progress.required_consecutive_months, 1)
  );

  INSERT INTO public.points_transactions (
    company_id,
    consumer_phone,
    consumer_email,
    transaction_type,
    points_amount,
    balance_after,
    description,
    transaction_date,
    user_id,
    created_by
  )
  VALUES (
    p_org_id,
    COALESCE(v_phone, ''),
    v_email,
    'adjust',
    v_progress.bonus_points,
    v_balance + v_progress.bonus_points,
    v_description,
    now(),
    p_user_id,
    p_user_id
  )
  RETURNING id INTO v_txn_id;

  UPDATE public.user_registration_bonus_progress
  SET status = 'awarded',
      awarded_at = now(),
      awarded_transaction_id = v_txn_id,
      last_evaluated_at = now(),
      notes = COALESCE(notes, v_description)
  WHERE id = v_progress.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'awarded',
    'transaction_id', v_txn_id,
    'bonus_points', v_progress.bonus_points,
    'message', 'Conditional registration bonus awarded successfully.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_user_registration_bonus(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_user_registration_bonus(uuid, uuid) TO service_role;
