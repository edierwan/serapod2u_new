-- Fix RLS to allow viewing Independent Users
-- Date: 2026-01-20
-- Description: Update user visibility policy to allow viewing users with NULL organization (Independent) if viewer has sufficient level.

-- Drop previous policy to replace it
DROP POLICY IF EXISTS "Users can view organization members based on hierarchy_v2" ON public.users;

CREATE POLICY "Users can view hierarchy including independents"
ON public.users
FOR SELECT
TO authenticated
USING (
    -- Case A: User seeing themselves (always allowed)
    auth.uid() = id
    OR
    -- Case B: Global Super Admin override
    public.is_super_admin()
    OR
    -- Case C: Organization & Hierarchy Logic
    EXISTS (
        SELECT 1 
        FROM public.get_auth_user_info() my
        WHERE 
            (
                -- 1. Same Organization
                my.organization_id = users.organization_id
                
                OR 
                
                -- 2. Target is Independent (No Org)
                --    Allow if viewer is Level 40 or better (Manager/HQ)
                (users.organization_id IS NULL AND my.role_level <= 40)
            )
            AND
            (
                -- Hierarchy check (Rank Logic: Lower Number = Higher Rank)
                -- e.g. Me(40) can see Target(50) [40 <= 50]
                -- e.g. Me(40) cannot see Target(30) [40 <= 30 is False]
                
                my.role_level <= 20 -- Power users bypass rank check
                OR
                my.role_level <= (
                    SELECT COALESCE(r2.role_level, 999) 
                    FROM public.roles r2 
                    WHERE r2.role_code = users.role_code
                )
            )
    )
);
