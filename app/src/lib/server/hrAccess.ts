import 'server-only'
import { checkPermissionForUser } from '@/lib/server/permissions'

export interface HrAuthContext {
    userId: string
    organizationId: string | null
    roleCode: string | null
    roleLevel: number | null
}

export const HR_ROLE_CODES = new Set(['HR_MANAGER'])

export const getHrAuthContext = async (supabase: any) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user?.id) {
        return { success: false, error: 'Not authenticated' as const }
    }

    const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, organization_id, role_code, roles(role_level)')
        .eq('id', user.id)
        .single()

    if (profileError || !profile) {
        return { success: false, error: 'User profile not found' as const }
    }

    return {
        success: true,
        data: {
            userId: profile.id as string,
            organizationId: profile.organization_id as string | null,
            roleCode: (profile as any).role_code as string | null,
            roleLevel: (profile.roles as any)?.role_level ?? null
        } as HrAuthContext
    }
}

export const canManageHr = async (ctx: HrAuthContext) => {
    if (ctx.roleLevel !== null && ctx.roleLevel <= 20) return true
    if (ctx.roleCode && HR_ROLE_CODES.has(ctx.roleCode)) return true

    const [manageOrgChart, editOrgSettings] = await Promise.all([
        checkPermissionForUser(ctx.userId, 'manage_org_chart'),
        checkPermissionForUser(ctx.userId, 'edit_org_settings')
    ])

    return manageOrgChart.allowed || editOrgSettings.allowed
}
