-- ================================================================
-- RLS POLICY FIX FOR ORGANIZATIONS TABLE
-- Date: 2025-10-17
-- Issue: Organizations disappear from list after editing
-- Root Cause: Missing dedicated UPDATE policy, potential RLS conflicts
-- ================================================================

-- ================================================================
-- STEP 1: VERIFY CURRENT STATE
-- ================================================================

-- Check existing policies (for documentation)
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  RAISE NOTICE '=== CURRENT POLICIES ON organizations TABLE ===';
  FOR policy_record IN 
    SELECT 
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies 
    WHERE tablename = 'organizations' 
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'Policy: %, Command: %, Permissive: %', 
      policy_record.policyname, 
      policy_record.cmd,
      policy_record.permissive;
  END LOOP;
END $$;

-- ================================================================
-- STEP 2: DROP OLD CONFLICTING POLICIES
-- ================================================================

-- Drop the generic policy that may be causing conflicts
DROP POLICY IF EXISTS orgs_admin_all ON public.organizations;

RAISE NOTICE '✓ Dropped generic orgs_admin_all policy';

-- ================================================================
-- STEP 3: CREATE SPECIFIC OPERATION POLICIES
-- ================================================================

-- SELECT Policy: Allow viewing organizations
CREATE POLICY orgs_select ON public.organizations 
  FOR SELECT 
  TO authenticated 
  USING (
    is_active = true 
    OR id = public.current_user_org_id() 
    OR public.is_hq_admin()
  );

RAISE NOTICE '✓ Created orgs_select policy';

-- INSERT Policy: Only HQ Admins can create organizations
CREATE POLICY orgs_insert ON public.organizations 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_hq_admin());

RAISE NOTICE '✓ Created orgs_insert policy';

-- UPDATE Policy: HQ Admins can update any organization
-- This is the critical policy that was missing!
CREATE POLICY orgs_update_hierarchy ON public.organizations 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_hq_admin())
  WITH CHECK (public.is_hq_admin());

RAISE NOTICE '✓ Created orgs_update_hierarchy policy';

-- DELETE Policy: Only HQ Admins can delete (soft delete via is_active)
CREATE POLICY orgs_delete ON public.organizations 
  FOR DELETE 
  TO authenticated 
  USING (public.is_hq_admin());

RAISE NOTICE '✓ Created orgs_delete policy';

-- ================================================================
-- STEP 4: ADD COMMENTS FOR DOCUMENTATION
-- ================================================================

COMMENT ON POLICY orgs_select ON public.organizations IS 
  'Allows viewing organizations if: active OR user''s own org OR HQ admin';

COMMENT ON POLICY orgs_insert ON public.organizations IS 
  'Only HQ Admins (role_level <= 10) can create organizations';

COMMENT ON POLICY orgs_update_hierarchy ON public.organizations IS 
  'Only HQ Admins (role_level <= 10) can update organizations. This ensures Super Admin and HQ Admin can edit all orgs without RLS conflicts.';

COMMENT ON POLICY orgs_delete ON public.organizations IS 
  'Only HQ Admins can delete organizations (typically soft delete via is_active=false)';

-- ================================================================
-- STEP 5: VERIFY HELPER FUNCTIONS
-- ================================================================

-- Verify is_hq_admin() function exists and works
DO $$
DECLARE
  func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'is_hq_admin' 
    AND pronamespace = 'public'::regnamespace
  ) INTO func_exists;
  
  IF NOT func_exists THEN
    RAISE EXCEPTION 'CRITICAL: is_hq_admin() function does not exist!';
  END IF;
  
  RAISE NOTICE '✓ is_hq_admin() function exists';
END $$;

-- Verify current_user_org_id() function exists
DO $$
DECLARE
  func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'current_user_org_id' 
    AND pronamespace = 'public'::regnamespace
  ) INTO func_exists;
  
  IF NOT func_exists THEN
    RAISE EXCEPTION 'CRITICAL: current_user_org_id() function does not exist!';
  END IF;
  
  RAISE NOTICE '✓ current_user_org_id() function exists';
END $$;

-- Verify get_org_type() function exists
DO $$
DECLARE
  func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'get_org_type' 
    AND pronamespace = 'public'::regnamespace
  ) INTO func_exists;
  
  IF NOT func_exists THEN
    RAISE EXCEPTION 'CRITICAL: get_org_type() function does not exist!';
  END IF;
  
  RAISE NOTICE '✓ get_org_type() function exists';
END $$;

-- ================================================================
-- STEP 6: GRANT EXECUTE PERMISSIONS
-- ================================================================

-- Ensure authenticated users can execute helper functions
GRANT EXECUTE ON FUNCTION public.is_hq_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_type(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_org(uuid) TO authenticated;

RAISE NOTICE '✓ Granted execute permissions on helper functions';

-- ================================================================
-- FINAL STATUS
-- ================================================================

RAISE NOTICE '';
RAISE NOTICE '════════════════════════════════════════════════════════════';
RAISE NOTICE 'RLS POLICY FIX COMPLETED SUCCESSFULLY';
RAISE NOTICE '════════════════════════════════════════════════════════════';
RAISE NOTICE '';
RAISE NOTICE 'New Policies Created:';
RAISE NOTICE '  ✓ orgs_select - For viewing organizations';
RAISE NOTICE '  ✓ orgs_insert - For creating organizations';
RAISE NOTICE '  ✓ orgs_update_hierarchy - For updating organizations';
RAISE NOTICE '  ✓ orgs_delete - For deleting organizations';
RAISE NOTICE '';
RAISE NOTICE 'Next Steps:';
RAISE NOTICE '  1. Test organization update as Super Admin';
RAISE NOTICE '  2. Verify record remains visible after save';
RAISE NOTICE '  3. Check browser console for any errors';
RAISE NOTICE '  4. Review audit_logs table for successful UPDATE';
RAISE NOTICE '';