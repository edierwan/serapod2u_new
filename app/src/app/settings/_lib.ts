import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Server-only context helper for Settings pages.
 * Mirrors the HR/Finance pattern.
 *
 * Returns the authenticated user profile and whether the user
 * has permission to view Settings (HQ org, role_level ≤ 40).
 */
export async function getSettingsPageContext() {
    const supabase = await createClient()

    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) redirect('/login')

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

    if (userProfileError || !userProfile) redirect('/login')

    const organization = Array.isArray(userProfile.organizations)
        ? userProfile.organizations[0]
        : userProfile.organizations
    const roles = Array.isArray(userProfile.roles)
        ? userProfile.roles[0]
        : userProfile.roles
    const organizationId = userProfile.organization_id ?? organization?.id ?? null

    if (!organizationId) redirect('/login')

    const transformedUserProfile = {
        ...userProfile,
        organization_id: organizationId,
        organizations: organization,
        roles
    }

    // Settings is accessible to HQ users with role_level ≤ 40
    const canViewSettings =
        organization?.org_type_code === 'HQ' &&
        roles?.role_level != null &&
        roles.role_level <= 40

    return { user, userProfile: transformedUserProfile, canViewSettings }
}
