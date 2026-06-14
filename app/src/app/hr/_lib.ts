import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getHrAccessDecision } from '@/lib/server/hrAccess'

const shouldShowHrAccessDiagnostic = () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || ''
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    return (
        process.env.NODE_ENV !== 'production' ||
        appUrl.includes('localhost') ||
        appUrl.includes('stg.') ||
        supabaseUrl.includes('stg')
    )
}

export async function getHrPageContext() {
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

    const hrAccess = await getHrAccessDecision({
        userId: user.id,
        organizationId,
        roleCode: userProfile.role_code ?? null,
        roleLevel: roles?.role_level ?? null,
    })

    const hrUnauthorizedReason =
        !hrAccess.allowed && shouldShowHrAccessDiagnostic()
            ? `Your account role was detected as ${roles?.role_name ?? userProfile.role_code ?? 'Unknown'} Level ${roles?.role_level ?? 'unknown'}, but this route requires HR admin permission. ${hrAccess.reason}`
            : null

    return {
        user,
        userProfile: transformedUserProfile,
        canViewHr: hrAccess.allowed,
        hrAccess,
        hrUnauthorizedReason,
    }
}
