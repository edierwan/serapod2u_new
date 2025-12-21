import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardContent from '@/components/dashboard/DashboardContent'
import { headers } from 'next/headers'

// Force dynamic rendering to ensure fresh user data on every request
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Force Next.js to treat this as dynamic by reading headers
  await headers()
  const resolvedSearchParams = await searchParams
  
  const supabase = await createClient()
  
  // Check authentication
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    console.log('🔴 Dashboard - No user found, redirecting to login', error)
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
    // Don't redirect immediately on profile error, let the client handle it or show error
    // redirect('/login')
  }
  
  if (userProfile && !userProfile.is_active) {
    console.error('User account is inactive:', user.email)
    redirect('/login')
  }

  // Transform the data structure for nested relationships
  const transformedUserProfile = userProfile ? {
    ...userProfile,
    organizations: Array.isArray(userProfile.organizations) 
      ? userProfile.organizations[0] 
      : userProfile.organizations,
    roles: Array.isArray(userProfile.roles) 
      ? userProfile.roles[0] 
      : userProfile.roles
  } : null

  if (!transformedUserProfile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Profile Error</h1>
          <p className="text-gray-600">Could not load user profile. Please contact support.</p>
          <p className="text-xs text-gray-400 mt-2">User ID: {user.id}</p>
        </div>
      </div>
    )
  }

  return (
    <DashboardContent 
      userProfile={transformedUserProfile} 
      initialView={resolvedSearchParams?.view as string}
      initialOrderId={resolvedSearchParams?.order_id as string}
    />
  )
}