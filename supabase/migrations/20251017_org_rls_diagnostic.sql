-- ================================================================
-- ORGANIZATION RLS DIAGNOSTIC QUERIES
-- Date: 2025-10-17
-- Purpose: Step-by-step verification of RLS policy issues
-- Issue: Organizations disappear from list after editing
-- ================================================================

-- ================================================================
-- PHASE 1: VERIFY RLS POLICIES EXIST
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 1: CHECKING RLS POLICIES ON ORGANIZATIONS TABLE'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Show all current policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as command,
  CASE 
    WHEN cmd = 'SELECT' THEN 'Viewing organizations'
    WHEN cmd = 'INSERT' THEN 'Creating organizations'
    WHEN cmd = 'UPDATE' THEN 'Editing organizations'
    WHEN cmd = 'DELETE' THEN 'Deleting organizations'
    ELSE 'Other'
  END as operation_type,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies 
WHERE tablename = 'organizations'
ORDER BY 
  CASE cmd
    WHEN 'SELECT' THEN 1
    WHEN 'INSERT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
    ELSE 5
  END;

\echo ''
\echo '✓ Expected UPDATE policy: orgs_update_hierarchy'
\echo '✗ Old problematic policy (should NOT exist): orgs_admin_all'
\echo ''

-- ================================================================
-- PHASE 2: TEST HELPER FUNCTIONS
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 2: TESTING HELPER FUNCTIONS'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Test as current user (run this while logged in as the Super Admin having issues)
\echo 'Run these as the logged-in Super Admin user:'
\echo ''
\echo '-- Check if is_hq_admin() returns TRUE:'
SELECT 
  'is_hq_admin() Result' as test,
  public.is_hq_admin() as result,
  CASE 
    WHEN public.is_hq_admin() = true THEN '✓ PASS - User is HQ Admin'
    ELSE '✗ FAIL - User is NOT HQ Admin (this is the problem!)'
  END as status;

\echo ''
\echo '-- Check current user organization:'
SELECT 
  'current_user_org_id()' as test,
  public.current_user_org_id() as result,
  CASE 
    WHEN public.current_user_org_id() IS NOT NULL THEN '✓ PASS'
    ELSE '✗ FAIL - No organization assigned'
  END as status;

\echo ''
\echo '-- Check user details:'
SELECT 
  u.id,
  u.email,
  u.role_code,
  r.role_name,
  r.role_level,
  u.organization_id,
  u.is_active,
  o.org_name as organization_name,
  o.org_type_code,
  CASE 
    WHEN r.role_level <= 10 THEN '✓ Should have HQ Admin access'
    WHEN r.role_level <= 20 THEN '⚠ Power User - may have limited access'
    ELSE '✗ Regular user - no admin access'
  END as admin_status
FROM public.users u
LEFT JOIN public.roles r ON r.role_code = u.role_code
LEFT JOIN public.organizations o ON o.id = u.organization_id
WHERE u.id = auth.uid();

\echo ''

-- ================================================================
-- PHASE 3: TEST UPDATE PERMISSION
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 3: TESTING UPDATE PERMISSIONS'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Find a manufacturer organization to test with
\echo 'Test organization (first active manufacturer):'
SELECT 
  id,
  org_code,
  org_name,
  org_type_code,
  is_active,
  contact_name,
  contact_phone,
  contact_email
FROM public.organizations
WHERE org_type_code = 'MFG' AND is_active = true
ORDER BY created_at DESC
LIMIT 1;

\echo ''
\echo 'To test UPDATE permission, use this query (replace <ORG_ID> with actual ID):'
\echo 'UPDATE public.organizations SET contact_name = ''Test Update'' WHERE id = ''<ORG_ID>'' RETURNING id, contact_name, is_active;'
\echo ''

-- ================================================================
-- PHASE 4: VERIFY SELECT POLICY COMPATIBILITY
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 4: CHECKING SELECT POLICY COMPATIBILITY'
\echo '════════════════════════════════════════════════════════════'
\echo ''

\echo 'The orgs_select policy allows viewing if:'
\echo '  1. is_active = true, OR'
\echo '  2. id = current_user_org_id(), OR'
\echo '  3. is_hq_admin() = true'
\echo ''

-- Check which condition makes an org visible
WITH test_org AS (
  SELECT id, org_name, org_type_code, is_active
  FROM public.organizations
  WHERE org_type_code = 'MFG' AND is_active = true
  LIMIT 1
)
SELECT 
  t.id,
  t.org_name,
  t.is_active as org_is_active,
  (t.id = public.current_user_org_id()) as is_user_org,
  public.is_hq_admin() as user_is_hq_admin,
  CASE
    WHEN t.is_active = true THEN '✓ Visible (is_active = true)'
    WHEN t.id = public.current_user_org_id() THEN '✓ Visible (user''s org)'
    WHEN public.is_hq_admin() = true THEN '✓ Visible (HQ admin override)'
    ELSE '✗ NOT VISIBLE - Will disappear!'
  END as visibility_status
FROM test_org t;

\echo ''

-- ================================================================
-- PHASE 5: CHECK APPLICATION UPDATE PAYLOAD
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 5: APPLICATION UPDATE ANALYSIS'
\echo '════════════════════════════════════════════════════════════'
\echo ''

\echo 'The SettingsView.tsx update includes these fields:'
\echo '  - org_name'
\echo '  - contact_name'
\echo '  - contact_phone'
\echo '  - contact_email'
\echo '  - address'
\echo '  - city'
\echo '  - state'
\echo '  - postal_code'
\echo '  - country'
\echo '  - updated_at'
\echo ''
\echo '⚠ CRITICAL: is_active is NOT included in the update!'
\echo '  → If default value or trigger sets it to false, record disappears'
\echo ''

-- Check for triggers that might modify is_active
SELECT 
  trigger_name,
  event_manipulation as on_event,
  action_timing as timing,
  action_statement as function_called
FROM information_schema.triggers
WHERE event_object_table = 'organizations'
ORDER BY trigger_name;

\echo ''

-- ================================================================
-- PHASE 6: CHECK AUDIT LOGS FOR CLUES
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 6: REVIEW RECENT AUDIT LOGS'
\echo '════════════════════════════════════════════════════════════'
\echo ''

\echo 'Recent organization updates (last 10):'
SELECT 
  al.created_at,
  al.user_email,
  al.action,
  al.entity_id,
  o.org_name,
  o.org_type_code,
  al.changed_fields,
  CASE 
    WHEN (al.old_values->>'is_active')::boolean = true 
     AND (al.new_values->>'is_active')::boolean = false 
    THEN '🔴 FOUND IT! is_active changed from true to false'
    WHEN al.old_values->>'is_active' IS NULL
     AND (al.new_values->>'is_active')::boolean = false
    THEN '🔴 FOUND IT! is_active set to false'
    ELSE '✓ is_active unchanged or not affected'
  END as is_active_status,
  al.old_values->>'is_active' as old_is_active,
  al.new_values->>'is_active' as new_is_active
FROM public.audit_logs al
LEFT JOIN public.organizations o ON o.id = al.entity_id
WHERE al.entity_type = 'organizations' 
  AND al.action = 'UPDATE'
ORDER BY al.created_at DESC
LIMIT 10;

\echo ''

-- ================================================================
-- PHASE 7: DETAILED DIAGNOSIS FOR A SPECIFIC ORGANIZATION
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 7: DETAILED DIAGNOSIS (Replace <ORG_ID> with actual ID)'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Create a diagnostic function for a specific org
CREATE OR REPLACE FUNCTION public.diagnose_org_visibility(p_org_id uuid)
RETURNS TABLE (
  check_name text,
  result boolean,
  details text,
  status text
) AS $$
BEGIN
  -- Check if org exists
  RETURN QUERY
  SELECT 
    'Organization Exists'::text,
    EXISTS(SELECT 1 FROM public.organizations WHERE id = p_org_id),
    'Record found in database: ' || COALESCE((SELECT org_name FROM public.organizations WHERE id = p_org_id), 'NOT FOUND'),
    CASE WHEN EXISTS(SELECT 1 FROM public.organizations WHERE id = p_org_id) 
      THEN '✓ PASS' ELSE '✗ FAIL' END;

  -- Check is_active status
  RETURN QUERY
  SELECT 
    'is_active Field'::text,
    (SELECT is_active FROM public.organizations WHERE id = p_org_id),
    'Current value: ' || COALESCE((SELECT is_active::text FROM public.organizations WHERE id = p_org_id), 'NULL'),
    CASE WHEN (SELECT is_active FROM public.organizations WHERE id = p_org_id) = true
      THEN '✓ PASS' ELSE '✗ FAIL - This causes invisibility!' END;

  -- Check if user is HQ admin
  RETURN QUERY
  SELECT 
    'is_hq_admin()'::text,
    public.is_hq_admin(),
    'Returns: ' || public.is_hq_admin()::text,
    CASE WHEN public.is_hq_admin() = true 
      THEN '✓ PASS' ELSE '✗ FAIL - User cannot see inactive orgs' END;

  -- Check if it's user's own org
  RETURN QUERY
  SELECT 
    'Is User Org'::text,
    (p_org_id = public.current_user_org_id()),
    'User org: ' || COALESCE(public.current_user_org_id()::text, 'NULL') || ', Test org: ' || p_org_id::text,
    CASE WHEN (p_org_id = public.current_user_org_id())
      THEN '✓ PASS' ELSE 'INFO - Different org' END;

  -- Overall visibility verdict
  RETURN QUERY
  SELECT 
    'OVERALL VISIBILITY'::text,
    (
      (SELECT is_active FROM public.organizations WHERE id = p_org_id) = true
      OR (p_org_id = public.current_user_org_id())
      OR public.is_hq_admin() = true
    ),
    'Will organization be visible in list?',
    CASE WHEN (
      (SELECT is_active FROM public.organizations WHERE id = p_org_id) = true
      OR (p_org_id = public.current_user_org_id())
      OR public.is_hq_admin() = true
    ) THEN '✅ VISIBLE' ELSE '❌ HIDDEN BY RLS' END;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

\echo 'Created diagnostic function: diagnose_org_visibility(uuid)'
\echo ''
\echo 'Usage: SELECT * FROM public.diagnose_org_visibility(''<your-org-id>'');'
\echo ''

-- ================================================================
-- PHASE 8: TEST SCENARIO SIMULATION
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 8: SIMULATING THE BUG'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Create test scenario explanation
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'REPRODUCTION STEPS:';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '1. As Super Admin, go to Settings → Organization tab';
  RAISE NOTICE '2. Edit any field (e.g., contact_name)';
  RAISE NOTICE '3. Click Save';
  RAISE NOTICE '4. Open Browser Console → Network tab';
  RAISE NOTICE '5. Check the UPDATE request payload';
  RAISE NOTICE '';
  RAISE NOTICE 'EXPECTED PAYLOAD (from SettingsView.tsx lines 181-195):';
  RAISE NOTICE '{';
  RAISE NOTICE '  org_name: "...",';
  RAISE NOTICE '  contact_name: "...",';
  RAISE NOTICE '  contact_phone: "...",';
  RAISE NOTICE '  contact_email: "...",';
  RAISE NOTICE '  address: "...",';
  RAISE NOTICE '  city: "...",';
  RAISE NOTICE '  state: "...",';
  RAISE NOTICE '  postal_code: "...",';
  RAISE NOTICE '  country: "...",';
  RAISE NOTICE '  updated_at: "2025-10-17T..."';
  RAISE NOTICE '}';
  RAISE NOTICE '';
  RAISE NOTICE '⚠ CRITICAL OBSERVATION:';
  RAISE NOTICE '  → is_active is NOT included in the payload!';
  RAISE NOTICE '';
  RAISE NOTICE 'POTENTIAL ROOT CAUSES:';
  RAISE NOTICE '  A. Database has default value is_active = false';
  RAISE NOTICE '  B. A trigger is setting is_active = false on UPDATE';
  RAISE NOTICE '  C. Partial update causes is_active to be set to default';
  RAISE NOTICE '  D. RLS WITH CHECK clause rejects the update silently';
  RAISE NOTICE '';
END $$;

-- ================================================================
-- PHASE 9: CHECK DATABASE DEFAULTS AND CONSTRAINTS
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 9: CHECKING TABLE DEFAULTS AND CONSTRAINTS'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Check column defaults
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable,
  CASE 
    WHEN column_name = 'is_active' AND column_default = 'true' 
      THEN '✓ Default is true - Good'
    WHEN column_name = 'is_active' AND column_default IS NULL
      THEN '⚠ No default - could be problem'
    WHEN column_name = 'is_active'
      THEN '✗ Default is not true - BUG!'
    ELSE 'N/A'
  END as analysis
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'organizations'
  AND column_name IN ('is_active', 'org_name', 'contact_name', 'updated_at')
ORDER BY ordinal_position;

\echo ''

-- ================================================================
-- PHASE 10: CREATE SAFE UPDATE STATEMENT
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 10: SAFE UPDATE STATEMENT'
\echo '════════════════════════════════════════════════════════════'
\echo ''

DO $$
BEGIN
  RAISE NOTICE 'RECOMMENDED FIX FOR APPLICATION CODE:';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'In SettingsView.tsx, line 181-196, change to:';
  RAISE NOTICE '';
  RAISE NOTICE 'const { error } = await supabase';
  RAISE NOTICE '  .from(''organizations'')';
  RAISE NOTICE '  .update({';
  RAISE NOTICE '    org_name: orgSettings.org_name,';
  RAISE NOTICE '    contact_name: orgSettings.contact_name || null,';
  RAISE NOTICE '    contact_phone: orgSettings.contact_phone || null,';
  RAISE NOTICE '    contact_email: orgSettings.contact_email || null,';
  RAISE NOTICE '    address: orgSettings.address || null,';
  RAISE NOTICE '    city: orgSettings.city || null,';
  RAISE NOTICE '    state: orgSettings.state || null,';
  RAISE NOTICE '    postal_code: orgSettings.postal_code || null,';
  RAISE NOTICE '    country: orgSettings.country || null,';
  RAISE NOTICE '    is_active: true,  // ← ADD THIS LINE!';
  RAISE NOTICE '    updated_at: new Date().toISOString()';
  RAISE NOTICE '  })';
  RAISE NOTICE '  .eq(''id'', userProfile.organizations.id)';
  RAISE NOTICE '';
  RAISE NOTICE 'This explicitly preserves is_active = true during updates.';
  RAISE NOTICE '';
END $$;

-- ================================================================
-- PHASE 11: VERIFICATION QUERY AFTER FIX
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'PHASE 11: POST-FIX VERIFICATION'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- Query to run after applying fix
CREATE OR REPLACE FUNCTION public.verify_org_update_fix()
RETURNS TABLE (
  step text,
  status text,
  details text
) AS $$
BEGIN
  -- Step 1: Check policies
  RETURN QUERY
  SELECT 
    '1. UPDATE Policy Exists'::text,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'organizations' 
      AND policyname = 'orgs_update_hierarchy'
      AND cmd = 'UPDATE'
    ) THEN '✓ PASS' ELSE '✗ FAIL' END,
    'Policy orgs_update_hierarchy should exist for UPDATE operations';

  -- Step 2: Check old policy is gone
  RETURN QUERY
  SELECT 
    '2. Old Policy Removed'::text,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'organizations' 
      AND policyname = 'orgs_admin_all'
    ) THEN '✓ PASS' ELSE '⚠ WARNING' END,
    'Old orgs_admin_all policy should be removed to avoid conflicts';

  -- Step 3: Check helper function
  RETURN QUERY
  SELECT 
    '3. is_hq_admin() Works'::text,
    CASE WHEN public.is_hq_admin() = true THEN '✓ PASS' ELSE '✗ FAIL' END,
    'Current user: ' || COALESCE((SELECT email FROM public.users WHERE id = auth.uid()), 'unknown');

  -- Step 4: Count visible orgs
  RETURN QUERY
  SELECT 
    '4. Visible Organizations'::text,
    '✓ INFO',
    'Can see ' || COUNT(*)::text || ' organizations'
  FROM public.organizations;

  -- Step 5: Test update permission
  RETURN QUERY
  SELECT 
    '5. Update Permission Test'::text,
    CASE WHEN public.is_hq_admin() = true THEN '✓ PASS' ELSE '✗ FAIL' END,
    'User ' || CASE WHEN public.is_hq_admin() = true 
      THEN 'CAN' ELSE 'CANNOT' END || ' update organizations';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

\echo 'Created verification function: verify_org_update_fix()'
\echo ''
\echo 'Usage: SELECT * FROM public.verify_org_update_fix();'
\echo ''

-- ================================================================
-- FINAL CHECKLIST
-- ================================================================

\echo '════════════════════════════════════════════════════════════'
\echo 'DEBUGGING CHECKLIST'
\echo '════════════════════════════════════════════════════════════'
\echo ''

SELECT 
  checklist_item,
  CASE 
    WHEN check_passes THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as status,
  details
FROM (
  SELECT 1 as order_num, 'RLS UPDATE policy exists' as checklist_item,
    EXISTS(SELECT 1 FROM pg_policies WHERE tablename='organizations' AND cmd='UPDATE') as check_passes,
    'Policy name: ' || COALESCE((SELECT policyname FROM pg_policies WHERE tablename='organizations' AND cmd='UPDATE' LIMIT 1), 'NONE') as details
  
  UNION ALL
  SELECT 2, 'Old conflicting policy removed',
    NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='orgs_admin_all'),
    'Should not see orgs_admin_all policy'
  
  UNION ALL
  SELECT 3, 'User has HQ Admin role',
    public.is_hq_admin(),
    'Role level: ' || COALESCE((
      SELECT r.role_level::text 
      FROM public.users u 
      JOIN public.roles r ON r.role_code = u.role_code 
      WHERE u.id = auth.uid()
    ), 'unknown')
  
  UNION ALL
  SELECT 4, 'User is active',
    (SELECT is_active FROM public.users WHERE id = auth.uid()),
    'User status in database'
  
  UNION ALL
  SELECT 5, 'Helper functions exist',
    (
      EXISTS(SELECT 1 FROM pg_proc WHERE proname='is_hq_admin')
      AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='current_user_org_id')
      AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_org_type')
    ),
    'All three helper functions must exist'
  
  UNION ALL
  SELECT 6, 'Organizations table has RLS enabled',
    (
      SELECT relrowsecurity 
      FROM pg_class 
      WHERE relname = 'organizations' 
      AND relnamespace = 'public'::regnamespace
    ),
    'Row Level Security must be enabled'
  
) checks
ORDER BY order_num;

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo 'END OF DIAGNOSTIC REPORT'
\echo '════════════════════════════════════════════════════════════'
\echo ''