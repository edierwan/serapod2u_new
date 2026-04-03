-- Fix: sync_user_profile was not setting account_scope.
-- Admin-created users got the DB default ('store') even when assigned to
-- an organization, so they could never reach /dashboard.
--
-- 1. Backfill existing users: any user with an organization_id who still has
--    account_scope = 'store' should be upgraded to 'portal'.
-- 2. Replace sync_user_profile to infer account_scope from organization_id.

-- ── 1. Backfill ──────────────────────────────────────────────────────────────
UPDATE public.users
SET    account_scope = 'portal',
       updated_at    = NOW()
WHERE  organization_id IS NOT NULL
  AND  account_scope = 'store'
  AND  role_code NOT IN ('GUEST', 'CONSUMER');

-- ── 2. Replace function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_user_profile(
  p_user_id        uuid,
  p_email          text,
  p_role_code      text    DEFAULT 'GUEST',
  p_organization_id uuid   DEFAULT NULL,
  p_full_name      text    DEFAULT NULL,
  p_phone          text    DEFAULT NULL
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_result   JSON;
  v_scope    TEXT;
BEGIN
  -- Infer account_scope: users with an organization are portal users
  IF p_organization_id IS NOT NULL AND p_role_code NOT IN ('GUEST', 'CONSUMER') THEN
    v_scope := 'portal';
  ELSE
    v_scope := 'store';
  END IF;

  INSERT INTO public.users (
    id, email, role_code, organization_id, full_name, phone,
    account_scope, is_active, is_verified, email_verified_at,
    created_at, updated_at
  ) VALUES (
    p_user_id, p_email, p_role_code, p_organization_id, p_full_name, p_phone,
    v_scope, TRUE, TRUE, NOW(),
    NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email              = EXCLUDED.email,
    role_code          = EXCLUDED.role_code,
    organization_id    = EXCLUDED.organization_id,
    full_name          = EXCLUDED.full_name,
    phone              = EXCLUDED.phone,
    account_scope      = EXCLUDED.account_scope,
    is_active          = EXCLUDED.is_active,
    is_verified        = EXCLUDED.is_verified,
    email_verified_at  = EXCLUDED.email_verified_at,
    updated_at         = NOW();

  SELECT json_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'email',   p_email
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.sync_user_profile IS
  'Syncs or creates public.users record after auth.users is created. '
  'Automatically sets account_scope=portal when organization_id is provided.';
