import 'server-only'
import { checkPermissionForUser } from '@/lib/server/permissions'

export interface KpiAuthContext {
    userId: string
    organizationId: string
    roleCode: string | null
    roleLevel: number | null
}

export type KpiAuthResult =
    | { success: true; data: KpiAuthContext }
    | { success: false; error: string; status: number }

/**
 * Resolve the authenticated user + their org. Returns a structured failure
 * result with the appropriate HTTP status when anything is missing.
 */
export async function getKpiAuthContext(supabase: any): Promise<KpiAuthResult> {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user?.id) {
        return { success: false, error: 'Not authenticated', status: 401 }
    }

    const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, organization_id, role_code, roles(role_level)')
        .eq('id', user.id)
        .single()

    if (profileError || !profile) {
        return { success: false, error: 'User profile not found', status: 401 }
    }
    if (!profile.organization_id) {
        return { success: false, error: 'Organization not set on user', status: 400 }
    }

    return {
        success: true,
        data: {
            userId: profile.id as string,
            organizationId: profile.organization_id as string,
            roleCode: (profile as any).role_code as string | null,
            roleLevel: (profile.roles as any)?.role_level ?? null,
        },
    }
}

// ── Role-level shortcuts ─────────────────────────────────────────────────

export const isKpiSuperAdmin = (ctx: KpiAuthContext) =>
    ctx.roleLevel !== null && ctx.roleLevel <= 10

export const isKpiHqAdmin = (ctx: KpiAuthContext) =>
    ctx.roleLevel !== null && ctx.roleLevel <= 15

export const isKpiHrManager = (ctx: KpiAuthContext) =>
    (ctx.roleLevel !== null && ctx.roleLevel <= 20) || ctx.roleCode === 'HR_MANAGER'

// ── Permission gates (server-side; mirror docs/06_rls_and_permission_plan.md) ─

export async function canManageObjectives(ctx: KpiAuthContext) {
    if (isKpiHqAdmin(ctx)) return true
    if (isKpiHrManager(ctx)) return true
    const r = await checkPermissionForUser(ctx.userId, 'kpi.manage_objectives')
    return r.allowed
}

export async function canManageMetrics(ctx: KpiAuthContext) {
    if (isKpiHrManager(ctx)) return true
    const r = await checkPermissionForUser(ctx.userId, 'kpi.manage_metrics')
    return r.allowed
}

export async function canManageTargets(ctx: KpiAuthContext) {
    if (isKpiHrManager(ctx)) return true
    const r = await checkPermissionForUser(ctx.userId, 'kpi.manage_targets')
    return r.allowed
}

export async function canGenerateScorecards(ctx: KpiAuthContext) {
    if (isKpiHrManager(ctx)) return true
    const r = await checkPermissionForUser(ctx.userId, 'kpi.generate_scorecards')
    return r.allowed
}

export async function canApproveReview(ctx: KpiAuthContext) {
    if (isKpiHqAdmin(ctx)) return true
    const r = await checkPermissionForUser(ctx.userId, 'kpi.approve_review')
    return r.allowed
}

export async function canViewAllReports(ctx: KpiAuthContext) {
    if (isKpiHqAdmin(ctx)) return true
    if (isKpiHrManager(ctx)) return true
    const r = await checkPermissionForUser(ctx.userId, 'kpi.view_reports_all')
    return r.allowed
}
