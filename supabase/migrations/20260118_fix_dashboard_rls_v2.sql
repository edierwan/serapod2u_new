-- Fix Dashboard RLS - V2 (Robust & Widened Access)
-- Date: 2026-01-18
-- Description: Improve is_super_admin function to handle edge cases and include HQ Admins (Level 10)

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_level int;
  v_role_code text;
BEGIN
  -- Get user's role code
  SELECT role_code INTO v_role_code
  FROM public.users
  WHERE id = auth.uid();

  -- 1. Check strict 'SA' code (common Super Admin code)
  IF v_role_code = 'SA' THEN 
    RETURN true; 
  END IF;

  -- 2. Check role level from roles table
  SELECT role_level INTO v_role_level
  FROM public.roles
  WHERE role_code = v_role_code;

  -- Widen access to Level 10 (HQ Admin) as they should also see Executive Dashboard
  IF v_role_level <= 10 THEN 
     RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Grant permissions explicitly
GRANT EXECUTE ON FUNCTION public.is_super_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin TO service_role;

-- Re-assert policies on key tables to ensure they are using the function (just in case)
-- This is redundant if policies exist, but safe as "CREATE POLICY IF NOT EXISTS" logic isn't standard SQL without DO block
-- We assume policies from previous migration exist.
