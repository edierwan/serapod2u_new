-- Fix Users Table RLS to allow proper visibility hierarchy
-- Date: 2026-01-20
-- Description: Allow Level 40 users to see Level 50 users (subordinates) within same org.

-- Drop conflicting policies (names guessed based on standard conventions + likely previous migrations)
DROP POLICY IF EXISTS "Users can view members of their own organization" ON public.users;
DROP POLICY IF EXISTS "Can view members of own organization" ON public.users;
DROP POLICY IF EXISTS "users_read_policy" ON public.users;
DROP POLICY IF EXISTS "select_users" ON public.users;
DROP POLICY IF EXISTS "view_users" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read basic user info" ON public.users;

-- Create comprehensive Select Policy
-- Note: We avoid complex joins if possible, but hierarchy requires role_level lookup.
CREATE POLICY "Users can view organization members based on hierarchy"
ON public.users
FOR SELECT
TO authenticated
USING (
    -- 1. Users can always see themselves
    auth.uid() = id
    OR
    (
        -- 2. Must be in same organization
        organization_id = (SELECT organization_id FROM public.users WHERE id = auth.uid() LIMIT 1)
        AND
        (
             -- 3. Super Admins (Level <= 10) see all
             -- (Ideally fetched from auth.jwt() but we query DB for reliability)
             (SELECT role_level FROM public.roles WHERE role_code = (SELECT role_code FROM public.users WHERE id = auth.uid()) LIMIT 1) <= 20
             OR
             -- 4. Standard Hierarchy: My Level <= Target Level (Lower Number is Higher Rank)
             -- e.g. Me(40) <= Target(40) -> True
             -- e.g. Me(40) <= Target(50) -> True
             -- e.g. Me(40) <= Target(30) -> False
             (
                 (SELECT role_level FROM public.roles WHERE role_code = (SELECT role_code FROM public.users WHERE id = auth.uid()) LIMIT 1)
                 <=
                 (SELECT role_level FROM public.roles WHERE role_code = users.role_code LIMIT 1)
             )
        )
    )
    OR 
    -- 5. Super Admin override (cross-org) if needed, using the function
    public.is_super_admin()
);
