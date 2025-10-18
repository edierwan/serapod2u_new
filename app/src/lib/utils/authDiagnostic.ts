import { createClient } from '@/lib/supabase/client'

/**
 * Debug utility to diagnose authentication and RLS policy issues
 * This should only be used in development
 */
export async function diagnoseAuthIssues() {
  const supabase = createClient()
  
  console.log('🔍 SUPABASE AUTH DIAGNOSTIC REPORT')
  console.log('='.repeat(60))

  try {
    // Check 1: Get current user
    console.log('\n1️⃣  Checking current user...')
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError) {
      console.error('❌ Error getting user:', userError)
    } else if (!user) {
      console.warn('⚠️  No user logged in - auth.uid() will be NULL in RLS policies')
    } else {
      console.log('✓ User authenticated:', user.email, '| UID:', user.id)
    }

    // Check 2: Get session
    console.log('\n2️⃣  Checking session...')
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('❌ Error getting session:', sessionError)
    } else if (!session) {
      console.warn('⚠️  No active session - JWT token not available')
    } else {
      console.log('✓ Session active:', session.user.email)
      console.log('   Access token present:', !!session.access_token)
      console.log('   Token expires at:', new Date(session.expires_at! * 1000).toISOString())
    }

    // Check 3: Test a simple query with RLS
    console.log('\n3️⃣  Testing RLS policy with a simple query...')
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name')
        .limit(1)

      if (error) {
        console.error('❌ RLS query failed:', error.message)
        console.log('   This usually means auth.uid() is NULL')
      } else {
        console.log('✓ RLS query successful')
        console.log('   Records returned:', data?.length || 0)
      }
    } catch (e) {
      console.error('❌ Query error:', e)
    }

    // Check 4: Headers
    console.log('\n4️⃣  Checking request headers...')
    console.log('   API URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
    console.log('   Anon key configured:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  } catch (error) {
    console.error('❌ Diagnostic error:', error)
  }

  console.log('\n' + '='.repeat(60))
  console.log('📋 DIAGNOSTIC COMPLETE\n')
}
