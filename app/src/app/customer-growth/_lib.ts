import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Server-only context helper for Customer & Growth pages.
 * Mirrors the Supply Chain pattern in src/app/supply-chain/_lib.ts.
 *
 * Customer & Growth is a domain grouping — accessible to all authenticated users.
 * Individual child modules (CRM, Marketing, Loyalty, Catalog) handle their own permissions.
 */
export async function getCustomerGrowthPageContext() {
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

    // Customer & Growth is accessible to all authenticated users
    // Individual child modules handle their own permission checks
    const canViewCustomerGrowth = true

    return { user, userProfile: transformedUserProfile, canViewCustomerGrowth }
}
