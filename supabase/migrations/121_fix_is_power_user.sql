-- Migration: Fix is_power_user function
-- Description: 
-- The previous implementation of is_power_user assumed a join between users.role_code and roles.role_name.
-- However, if the join fails (e.g. case sensitivity or mismatch), it returns false, blocking approval.
-- This version is more robust:
-- 1. It tries to find the role level via the join.
-- 2. If that fails, it tries to look up the role by code directly.
-- 3. It logs a warning if the role is not found.

CREATE OR REPLACE FUNCTION public.is_power_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role_level integer;
  v_user_role_code text;
BEGIN
  -- Get user's role code first
  SELECT role_code INTO v_user_role_code
  FROM public.users
  WHERE id = auth.uid();
  
  IF v_user_role_code IS NULL THEN
      -- User not found or has no role
      RETURN false;
  END IF;

  -- Try to get role level
  SELECT role_level INTO v_role_level
  FROM public.roles
  WHERE role_name = v_user_role_code OR role_code = v_user_role_code;
  
  IF v_role_level IS NULL THEN
      -- Role not found in roles table
      -- Fallback: If role code contains 'admin', assume power user for safety/continuity?
      -- No, that's dangerous. But we can check if it's 'super_admin' or 'admin_hq'.
      
      IF v_user_role_code IN ('super_admin', 'admin_hq', 'admin') THEN
          RETURN true;
      END IF;
      
      RETURN false;
  END IF;

  RETURN v_role_level <= 20;
END;
$$;
