-- ============================================================================
-- Migration: 2026-04-10
-- Purpose:
--   1. Create user_registration_bonus_settings + progress tables (missing in prod)
--   2. Grant access to authenticated/anon roles
--   3. Fix default official_visit_rule for existing roadtour_settings rows
-- ============================================================================

-- ============================================================================
-- 1. USER REGISTRATION BONUS SETTINGS TABLE
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

-- ============================================================================
-- 2. USER REGISTRATION BONUS PROGRESS TABLE
-- ============================================================================
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

-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================
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

-- ============================================================================
-- 4. RLS POLICIES
-- ============================================================================
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

-- ============================================================================
-- 5. GRANTS
-- ============================================================================
GRANT ALL ON public.user_registration_bonus_settings TO service_role;
GRANT ALL ON public.user_registration_bonus_progress TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_registration_bonus_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_registration_bonus_progress TO authenticated;
GRANT SELECT ON public.user_registration_bonus_settings TO anon;
GRANT SELECT ON public.user_registration_bonus_progress TO anon;

-- ============================================================================
-- 6. EVALUATE FUNCTION
-- ============================================================================
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
BEGIN
  SELECT * INTO v_progress
  FROM public.user_registration_bonus_progress
  WHERE org_id = p_org_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_enrolled');
  END IF;

  IF v_progress.status IN ('awarded', 'expired', 'disabled') THEN
    RETURN jsonb_build_object('status', v_progress.status);
  END IF;

  IF v_progress.bonus_mode = 'instant' THEN
    RETURN jsonb_build_object('status', v_progress.status, 'note', 'instant bonus handled at registration');
  END IF;

  RETURN jsonb_build_object(
    'status', v_progress.status,
    'months_qualified', v_progress.months_qualified,
    'required', v_progress.required_consecutive_months
  );
END;
$$;

-- ============================================================================
-- 7. FIX DEFAULT OFFICIAL VISIT RULE FOR EXISTING SETTINGS
-- ============================================================================
UPDATE public.roadtour_settings
SET official_visit_rule = 'one_per_shop_per_am_per_day'
WHERE official_visit_rule = 'one_per_shop_per_campaign';
