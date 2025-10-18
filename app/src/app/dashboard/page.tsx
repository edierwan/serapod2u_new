import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardContent from '@/components/dashboard/DashboardContent'
import { headers } from 'next/headers'

// Force dynamic rendering to ensure fresh user data on every request
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DashboardPage() {
  // Force Next.js to treat this as dynamic by reading headers
  headers()
  
  const supabase = createClient()
  
  // Check authentication
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    redirect('/login')
  }

  console.log('🔍 Dashboard - Auth User ID:', user.id)
  console.log('🔍 Dashboard - Auth User Email:', user.email)

  // Get user profile directly from users table using auth user ID (most reliable)
  // This ensures we always get the current logged-in user's data, not cached email lookups
  const { data: userProfile, error: userProfileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  console.log('🔍 Dashboard - User Profile:', {
    id: userProfile?.id,
    email: userProfile?.email,
    organization_id: userProfile?.organization_id
  })

  if (userProfileError || !userProfile) {
    console.error('User profile error:', userProfileError)
    redirect('/login')
  }
  
  if (!userProfile.is_active) {
    console.error('User account is inactive:', user.email)
    redirect('/login')
  }

  // Fetch organization details using the user's organization_id
  const { data: orgData } = await supabase
    .from('organizations')
    .select('id, org_name, org_type_code, org_code')
    .eq('id', userProfile.organization_id)
    .single()

  console.log('🔍 Dashboard - Organization Data:', {
    id: orgData?.id,
    org_name: orgData?.org_name,
    org_type_code: orgData?.org_type_code
  })

  // Fetch role details using the user's role_code
  const { data: roleData } = await supabase
    .from('roles')
    .select('role_name, role_level')
    .eq('role_code', userProfile.role_code)
    .single()

  // Transform the user profile data to match the interface
  const transformedUserProfile = {
    id: userProfile.id,
    email: userProfile.email,
    role_code: userProfile.role_code,
    organization_id: userProfile.organization_id,
    is_active: userProfile.is_active,
    organizations: orgData ? {
      id: orgData.id,
      org_name: orgData.org_name,
      org_type_code: orgData.org_type_code,
      org_code: orgData.org_code
    } : {
      id: '',
      org_name: 'Unknown Organization',
      org_type_code: 'UNKNOWN',
      org_code: 'UNK'
    },
    roles: roleData ? {
      role_name: roleData.role_name,
      role_level: roleData.role_level
    } : {
      role_name: 'Unknown Role',
      role_level: 0
    }
  }

  return <DashboardContent userProfile={transformedUserProfile} />
}