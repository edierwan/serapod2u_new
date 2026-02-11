import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { checkPermissionForUser } from '@/lib/server/permissions'

/**
 * Server-only context helper for Finance pages.
 * Mirrors the HR pattern in src/app/hr/_lib.ts.
 *
 * Returns the authenticated user profile and whether the user
 * has permission to view the Finance module.
 */
export async function getFinancePageContext() {
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

    // Finance is accessible to users with view_settings permission
    // or admin-level roles (role_level ≤ 40 covers Finance Admin and above)
    const [viewSettings] = await Promise.all([
        checkPermissionForUser(user.id, 'view_settings'),
    ])

    const canViewFinance =
        viewSettings.allowed ||
        (roles?.role_level != null && roles.role_level <= 40)

    return { user, userProfile: transformedUserProfile, canViewFinance }
}
