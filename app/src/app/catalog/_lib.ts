import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Server-only context helper for Catalog pages.
 * Mirrors the Loyalty pattern in src/app/loyalty/_lib.ts.
 *
 * Catalog is accessible to HQ, DIST, and SHOP org types (maxRoleLevel ≤ 50).
 */
export async function getCatalogPageContext() {
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

    // Catalog is accessible to HQ, DIST, and SHOP org types with role level ≤ 50
    const orgType = organization?.org_type_code
    const roleLevel = roles?.role_level ?? 999
    const canViewCatalog = ['HQ', 'DIST', 'SHOP'].includes(orgType) && roleLevel <= 50

    return { user, userProfile: transformedUserProfile, canViewCatalog }
}
