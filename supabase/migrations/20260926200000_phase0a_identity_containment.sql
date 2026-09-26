-- Phase 0A containment: protect authorization fields on self-service updates
-- and make sync_user_profile an explicitly service-role-only provisioning RPC.
--
-- Before: PUBLIC/anon/authenticated could inherit EXECUTE on sync_user_profile,
-- and users_update_own allowed an authenticated user to change every users column.
-- After: only service_role may execute sync_user_profile, and authenticated users
-- cannot change protected identity/access/employment columns on their own row.

CREATE OR REPLACE FUNCTION public.sync_user_profile(
  p_user_id uuid,
  p_email text,
  p_role_code text DEFAULT 'GUEST',
  p_organization_id uuid DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result json;
  v_scope text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'sync_user_profile is restricted to trusted provisioning services'
      USING ERRCODE = '42501';
  END IF;

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
    v_scope, true, true, now(), now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    role_code = EXCLUDED.role_code,
    organization_id = EXCLUDED.organization_id,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    account_scope = EXCLUDED.account_scope,
    is_active = EXCLUDED.is_active,
    is_verified = EXCLUDED.is_verified,
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at = now();

  SELECT json_build_object(
    'success', true,
    'user_id', p_user_id,
    'email', p_email
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_profile(uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_user_profile(uuid, text, text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.sync_user_profile(uuid, text, text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_profile(uuid, text, text, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.sync_user_profile(uuid, text, text, uuid, text, text) IS
  'Trusted provisioning RPC. Only service_role may create/sync a public.users identity.';

CREATE OR REPLACE FUNCTION public.prevent_self_service_access_field_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = OLD.id AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.email IS DISTINCT FROM OLD.email OR
    NEW.role_code IS DISTINCT FROM OLD.role_code OR
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.account_scope IS DISTINCT FROM OLD.account_scope OR
    NEW.is_active IS DISTINCT FROM OLD.is_active OR
    NEW.is_verified IS DISTINCT FROM OLD.is_verified OR
    NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at OR
    NEW.department_id IS DISTINCT FROM OLD.department_id OR
    NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id OR
    NEW.position_id IS DISTINCT FROM OLD.position_id OR
    NEW.employment_type IS DISTINCT FROM OLD.employment_type OR
    NEW.join_date IS DISTINCT FROM OLD.join_date OR
    NEW.employment_status IS DISTINCT FROM OLD.employment_status OR
    NEW.employee_no IS DISTINCT FROM OLD.employee_no OR
    NEW.can_be_reference IS DISTINCT FROM OLD.can_be_reference
  ) THEN
    RAISE EXCEPTION 'Self-service cannot modify protected identity, access, or employment fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_self_service_access_field_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_self_service_access_field_update() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_self_service_access_field_update() FROM authenticated;

DROP TRIGGER IF EXISTS users_prevent_self_service_access_field_update ON public.users;
CREATE TRIGGER users_prevent_self_service_access_field_update
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_access_field_update();

-- Rollback strategy (do not apply automatically):
--   DROP TRIGGER users_prevent_self_service_access_field_update ON public.users;
--   DROP FUNCTION public.prevent_self_service_access_field_update();
--   Restore the prior sync_user_profile definition and grants from an audited backup.
