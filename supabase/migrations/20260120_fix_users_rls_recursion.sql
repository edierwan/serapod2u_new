-- Fix Infinite Recursion in Users RLS
-- Date: 2026-01-20
-- Description: Use a SECURITY DEFINER function to fetch current user context to avoid self-referencing RLS loop on public.users.

-- 1. Create a helper function safely to get current user's Org and Role Level
-- This function runs with elevated privileges (SECURITY DEFINER) to bypass RLS on users table itself.
CREATE OR REPLACE FUNCTION public.get_auth_user_info()
RETURNS TABLE (
  organization_id uuid,
  role_level int
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.organization_id,
    COALESCE(r.role_level, 999) as role_level
  FROM public.users u
  LEFT JOIN public.roles r ON r.role_code = u.role_code
  WHERE u.id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_user_info TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_info TO service_role;

-- 2. Drop the recursive policy (and any variations)
DROP POLICY IF EXISTS "Users can view organization members based on hierarchy" ON public.users;
DROP POLICY IF EXISTS "Users can view members of their own organization" ON public.users;

-- 3. Create the optimized, non-recursive policy
CREATE POLICY "Users can view organization members based on hierarchy_v2"
ON public.users
FOR SELECT
TO authenticated
USING (
    -- Case A: User seeing themselves (fast path)
    auth.uid() = id
    OR
    -- Case B: Global Super Admin override (safe via Security Definer)
    public.is_super_admin()
    OR
    -- Case C: Organization & Hierarchy Logic
    EXISTS (
        SELECT 1 
        FROM public.get_auth_user_info() my
        WHERE 
            -- Must be in same organization
            my.organization_id = users.organization_id
            AND
            (
                -- Power Users (<= 20) see all in org
                my.role_level <= 20
                OR
                -- Standard Users see subordinates (My Level <= Target Level)
                -- (Remember: Lower Level Number = Higher Rank)
                my.role_level <= (
                    SELECT COALESCE(r2.role_level, 999) 
                    FROM public.roles r2 
                    WHERE r2.role_code = users.role_code
                )
            )
    )
);
