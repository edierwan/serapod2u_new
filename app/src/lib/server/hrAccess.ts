import 'server-only'
import { NextResponse } from 'next/server'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { authorizeOperation, organizationResource } from '@/lib/security-access/operation'
import type { LegacyEvaluator } from '@/lib/security-access/authorization'

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

/**
 * S&A decision for an HR operation in the caller's own organization (the
 * verified profile's organization — never a request parameter). The legacy
 * evaluator is the module's historical check and decides only in
 * LEGACY_ENFORCED/SHADOW; in NEW_ENFORCED/LEGACY_RETIRED the S&A decision is
 * authoritative. Any evaluation failure denies.
 */
export const hrCan = async (
    ctx: Pick<HrAuthContext, 'userId' | 'organizationId' | 'roleCode' | 'roleLevel'>,
    permission: string,
    legacy: LegacyEvaluator = () => canManageHr(ctx as HrAuthContext),
): Promise<boolean> => {
    try {
        const decision = await authorizeOperation({
            actorId: ctx.userId,
            permission,
            resource: organizationResource('hr_organization', ctx.organizationId),
            legacy,
        })
        return decision.decision === 'ALLOW'
    } catch {
        return false
    }
}

/**
 * S&A decision for an HR operation on a record that belongs to
 * `organizationId` — taken from a row the server loaded, never from the
 * request. Replaces the historical "same organization, or role_level <= N"
 * rule for cross-organization edits: S&A scopes decide whether the caller
 * reaches that organization (an organization scope covers its descendants).
 */
export const hrCanIn = (
    ctx: Pick<HrAuthContext, 'userId' | 'organizationId' | 'roleCode' | 'roleLevel'>,
    permission: string,
    organizationId: string | null,
    legacy: LegacyEvaluator,
): Promise<boolean> => hrCan({ ...ctx, organizationId }, permission, legacy)

/** Employee self-service on the caller's own record (own_record scope). */
export const hrSelfCan = async (
    ctx: Pick<HrAuthContext, 'userId' | 'organizationId'>,
    permission = 'hr.self_service.use',
): Promise<boolean> => {
    try {
        const decision = await authorizeOperation({
            actorId: ctx.userId,
            permission,
            resource: organizationResource('hr_employee_record', ctx.organizationId, { ownerUserId: ctx.userId }),
            legacy: () => true,
        })
        return decision.decision === 'ALLOW'
    } catch {
        return false
    }
}

export const hrForbidden = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
