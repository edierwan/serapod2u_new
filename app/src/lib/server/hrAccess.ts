import 'server-only'
import { checkPermissionForUser } from '@/lib/server/permissions'

export interface HrAuthContext {
    userId: string
    organizationId: string | null
    roleCode: string | null
    roleLevel: number | null
}

export const HR_ADMIN_ROLE_CODES = new Set([
    'SUPER_ADMIN',
    'SUPERADMIN',
    'SUPER',
    'SA',
    'HQ_ADMIN',
    'ADMIN_HQ',
    'HQ',
    'ADMIN',
])
export const HR_ROLE_CODES = new Set(['HR_MANAGER'])

export const normalizeHrRoleCode = (roleCode?: string | null) =>
    String(roleCode || '').trim().toUpperCase()

export const isHrAdminRole = (ctx: Pick<HrAuthContext, 'roleCode' | 'roleLevel'>) => {
    if (ctx.roleLevel !== null && ctx.roleLevel <= 20) return true
    return HR_ADMIN_ROLE_CODES.has(normalizeHrRoleCode(ctx.roleCode))
}

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
    if (isHrAdminRole(ctx)) return true
    if (HR_ROLE_CODES.has(normalizeHrRoleCode(ctx.roleCode))) return true

    const [manageOrgChart, editOrgSettings] = await Promise.all([
        checkPermissionForUser(ctx.userId, 'manage_org_chart'),
        checkPermissionForUser(ctx.userId, 'edit_org_settings')
    ])

    return manageOrgChart.allowed || editOrgSettings.allowed
}

export const getHrAccessDecision = async (ctx: HrAuthContext) => {
    const isAdmin = isHrAdminRole(ctx)
    const isHrRole = HR_ROLE_CODES.has(normalizeHrRoleCode(ctx.roleCode))
    const roleLabel = `${ctx.roleCode ?? 'unknown'} Level ${ctx.roleLevel ?? 'unknown'}`

    if (isAdmin || isHrRole) {
        return {
            allowed: true,
            roleLabel,
            reason: `Allowed by ${isAdmin ? 'admin role' : 'HR role'}`,
            checks: {
                isAdmin,
                isHrRole,
                viewUsers: false,
                viewSettings: false,
                manageOrgChart: false,
                editOrgSettings: false,
            }
        }
    }

    const [viewUsers, viewSettings, manageOrgChart, editOrgSettings] = await Promise.all([
        checkPermissionForUser(ctx.userId, 'view_users'),
        checkPermissionForUser(ctx.userId, 'view_settings'),
        checkPermissionForUser(ctx.userId, 'manage_org_chart'),
        checkPermissionForUser(ctx.userId, 'edit_org_settings')
    ])

    const allowed =
        isAdmin ||
        isHrRole ||
        viewUsers.allowed ||
        viewSettings.allowed ||
        manageOrgChart.allowed ||
        editOrgSettings.allowed

    const reasons = [
        viewUsers.allowed ? `view_users (${viewUsers.reason})` : null,
        viewSettings.allowed ? `view_settings (${viewSettings.reason})` : null,
        manageOrgChart.allowed ? `manage_org_chart (${manageOrgChart.reason})` : null,
        editOrgSettings.allowed ? `edit_org_settings (${editOrgSettings.reason})` : null,
    ].filter(Boolean)

    return {
        allowed,
        roleLabel,
        reason: allowed
            ? `Allowed by ${reasons.join(', ')}`
            : `${roleLabel} does not match HR admin roles and has no HR entry permissions.`,
        checks: {
            isAdmin,
            isHrRole,
            viewUsers: viewUsers.allowed,
            viewSettings: viewSettings.allowed,
            manageOrgChart: manageOrgChart.allowed,
            editOrgSettings: editOrgSettings.allowed,
        }
    }
}
