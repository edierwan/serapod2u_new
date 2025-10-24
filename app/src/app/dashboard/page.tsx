import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardContent from '@/components/dashboard/DashboardContent'
import { headers } from 'next/headers'

// Force dynamic rendering to ensure fresh user data on every request
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DashboardPage() {
  // Force Next.js to treat this as dynamic by reading headers
  await headers()
  
  const supabase = await createClient()
  
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
    .select(`
      *,
      organizations:organization_id (
        id,
        org_name,
        org_type_code,
        org_code
      ),
      roles:role_code (
        role_name,
        role_level
      )
    `)
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

  // Transform the data structure for nested relationships
  const transformedUserProfile = {
    ...userProfile,
    organizations: Array.isArray(userProfile.organizations) 
      ? userProfile.organizations[0] 
      : userProfile.organizations,
    roles: Array.isArray(userProfile.roles) 
      ? userProfile.roles[0] 
      : userProfile.roles
  }

  return <DashboardContent userProfile={transformedUserProfile} />
}