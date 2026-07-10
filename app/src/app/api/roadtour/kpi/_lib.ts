import { NextResponse } from 'next/server'

import { autoDistributeTarget } from '@/lib/roadtour/kpi'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const roleLevel = (relation: any) => Number(Array.isArray(relation) ? relation[0]?.role_level : relation?.role_level)

export interface KpiAdminContext {
    admin: any
    profile: { id: string; organization_id: string | null; roles: any }
    isGlobalAdmin: boolean
}

/**
 * Authorize the caller as a RoadTour admin (HQ Admin level, role_level <= 20),
 * mirroring the guard used by /api/roadtour/events.
 */
export async function requireKpiAdmin(): Promise<KpiAdminContext | NextResponse> {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient() as any
    const { data: profile, error: profileError } = await admin
        .from('users')
        .select('id, organization_id, roles(role_level)')
        .eq('id', user.id)
        .single()
    if (profileError || !profile) return NextResponse.json({ success: false, error: 'User profile not found.' }, { status: 404 })
    const level = roleLevel(profile.roles)
    if (!Number.isFinite(level) || level > 20) {
        return NextResponse.json({ success: false, error: 'Insufficient permissions. HQ Admin required.' }, { status: 403 })
    }
    return { admin, profile, isGlobalAdmin: level === 1 }
}

/** Enforce org access: global admins may target any org, others only their own. */
export function assertOrgAccess(ctx: KpiAdminContext, orgId: string): NextResponse | null {
    if (!orgId) return NextResponse.json({ success: false, error: 'Organization is required.' }, { status: 400 })
    if (!ctx.isGlobalAdmin && orgId !== ctx.profile.organization_id) {
        return NextResponse.json({ success: false, error: 'Access denied for this organization.' }, { status: 403 })
    }
    return null
}

export function jsonError(message: string, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

export const PLAN_SELECT = 'id, org_id, roadtour_run_id, plan_name, effective_from_month, effective_to_month, reporting_scope, status, leader_bonus_enabled, am_incentive_mode, config_cycle_id, activated_at, created_at, updated_at'
export const PLAN_SELECT_LEGACY = 'id, org_id, roadtour_run_id, plan_name, effective_from_month, effective_to_month, reporting_scope, status, leader_bonus_enabled, config_cycle_id, activated_at, created_at, updated_at'
export const CYCLE_SELECT = 'id, org_id, roadtour_run_id, kpi_plan_id, kpi_month, period_start, period_end, reporting_scope, status, freeze_members_targets, lock_campaign_qr_attribution, activated_at, created_at, updated_at'
export const TEAM_SELECT = 'id, org_id, kpi_cycle_id, team_name, leader_user_id, monthly_team_target, incentive_budget, status, created_at, updated_at'
export const MEMBER_SELECT = 'id, org_id, kpi_cycle_id, team_id, am_user_id, auto_target_scans, manual_target_scans, target_source, created_at'
export const RULE_SELECT = 'id, org_id, kpi_cycle_id, team_id, rule_name, applies_to, achievement_threshold_percent, incentive_amount, bonus_type, status, created_at, updated_at'

/** True when the KPI tables have not been migrated yet (rolling deploys). */
export function isMissingKpiSchema(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
    if (!error) return false
    const message = String(error.message || '').toLowerCase()
    // Column-only gaps (additive migrations) are not "schema missing".
    if (message.includes('column') && message.includes('could not find')) return false
    return error.code === '42P01'
        || error.code === 'PGRST205'
        || (message.includes('roadtour_kpi_') && (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache')))
}

/**
 * True when a write failed because a specific column does not exist yet — used
 * so the max_incentive_per_am cap can be written best-effort even when its
 * additive migration has not been applied on a rolling deploy. Callers retry
 * the write without the column.
 */
export function isMissingColumn(error: { code?: string | null; message?: string | null } | null | undefined, column: string): boolean {
    if (!error) return false
    const message = String(error.message || '').toLowerCase()
    return error.code === '42703'
        || error.code === 'PGRST204'
        || (message.includes(column.toLowerCase()) && (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache')))
}

/**
 * Load a cycle and verify the caller can access its org.
 * Returns the cycle row or an error response.
 */
export async function loadCycleForUpdate(ctx: KpiAdminContext, cycleId: string): Promise<any | NextResponse> {
    const { data: cycle, error } = await ctx.admin
        .from('roadtour_kpi_cycles')
        .select(CYCLE_SELECT)
        .eq('id', cycleId)
        .maybeSingle()
    if (error) {
        if (isMissingKpiSchema(error)) return jsonError('RoadTour KPI tables are not migrated yet.', 503)
        return jsonError(error.message || 'Failed to load KPI cycle.', 500)
    }
    if (!cycle) return jsonError('KPI cycle not found.', 404)
    const denied = assertOrgAccess(ctx, cycle.org_id)
    if (denied) return denied
    return cycle
}

/**
 * Load a KPI plan and verify the caller can access its org.
 * Returns the plan row or an error response.
 */
export async function loadPlanForUpdate(ctx: KpiAdminContext, planId: string): Promise<any | NextResponse> {
    let { data: plan, error } = await ctx.admin
        .from('roadtour_kpi_plans')
        .select(PLAN_SELECT)
        .eq('id', planId)
        .maybeSingle()
    if (error && isMissingColumn(error, 'am_incentive_mode')) {
        const legacy = await ctx.admin
            .from('roadtour_kpi_plans')
            .select(PLAN_SELECT_LEGACY)
            .eq('id', planId)
            .maybeSingle()
        plan = legacy.data ? { ...legacy.data, am_incentive_mode: 'volume_tiers' } : null
        error = legacy.error
    }
    if (error) {
        if (isMissingKpiSchema(error)) return jsonError('RoadTour KPI plan tables are not migrated yet.', 503)
        if (isMissingColumn(error, 'am_incentive_mode')) {
            return jsonError('Apply supabase/migrations/20260709_roadtour_kpi_am_incentive_mode.sql to enable Custom tiers.', 503)
        }
        return jsonError(error.message || 'Failed to load KPI plan.', 500)
    }
    if (!plan) return jsonError('KPI plan not found.', 404)
    const denied = assertOrgAccess(ctx, plan.org_id)
    if (denied) return denied
    return plan
}

/** Attach nested teams (with members) + rules to a config cycle, for plan detail responses. */
export async function loadCycleConfig(admin: any, cycleId: string | null): Promise<{ teams: any[]; rules: any[] }> {
    if (!cycleId) return { teams: [], rules: [] }
    const [teamsRes, membersRes, rulesRes] = await Promise.all([
        admin.from('roadtour_kpi_teams').select(TEAM_SELECT).eq('kpi_cycle_id', cycleId).order('created_at'),
        admin.from('roadtour_kpi_team_members').select(MEMBER_SELECT).eq('kpi_cycle_id', cycleId).order('created_at'),
        admin.from('roadtour_kpi_incentive_rules').select(RULE_SELECT).eq('kpi_cycle_id', cycleId).order('created_at'),
    ])
    const members = membersRes.data || []
    const teams = (teamsRes.data || []).map((t: any) => ({ ...t, members: members.filter((m: any) => m.team_id === t.id) }))
    return { teams, rules: rulesRes.data || [] }
}

export interface KpiMemberInput {
    am_user_id: string
    manual_target_scans?: number | null
}

/** Validate a members payload; returns the parsed list or an error message. */
export function parseMembers(raw: any): KpiMemberInput[] | string {
    if (!Array.isArray(raw)) return 'Members must be an array.'
    const members: KpiMemberInput[] = []
    const seen = new Set<string>()
    for (const item of raw) {
        const amUserId = String(item?.am_user_id || '').trim()
        if (!amUserId) return 'Each member requires am_user_id.'
        if (seen.has(amUserId)) return 'Duplicate member in team.'
        seen.add(amUserId)
        let manual: number | null = null
        if (item?.manual_target_scans !== undefined && item?.manual_target_scans !== null && item?.manual_target_scans !== '') {
            manual = Number(item.manual_target_scans)
            if (!Number.isInteger(manual) || manual < 0) return 'Manual AM targets must be non-negative integers.'
        }
        members.push({ am_user_id: amUserId, manual_target_scans: manual })
    }
    return members
}

/** Build insert rows for team members with auto-distributed targets. */
export function buildMemberRows(args: {
    orgId: string
    cycleId: string
    teamId: string
    teamTarget: number
    members: KpiMemberInput[]
}) {
    const autoTargets = autoDistributeTarget(args.teamTarget, args.members.length)
    return args.members.map((m, i) => ({
        org_id: args.orgId,
        kpi_cycle_id: args.cycleId,
        team_id: args.teamId,
        am_user_id: m.am_user_id,
        auto_target_scans: autoTargets[i] ?? 0,
        manual_target_scans: m.manual_target_scans ?? null,
        target_source: m.manual_target_scans != null ? 'manual' : 'auto',
    }))
}

/**
 * Load the existing AM incentive tiers for a cycle plus the effective per-AM
 * cap (the highest Max Incentive / AM configured across the cycle's teams — a
 * tier must be payable to at least the best-capped AM). Used to validate a new
 * or edited AM tier server-side. `excludeRuleId` drops the tier being edited.
 */
export async function loadAmTierContext(admin: any, cycleId: string, excludeRuleId?: string | null): Promise<{
    existingTiers: { id: string; achievement_threshold_percent: number; incentive_amount: number }[]
    maxIncentivePerAm: number
}> {
    const [rulesRes, teamsRes] = await Promise.all([
        admin.from('roadtour_kpi_incentive_rules')
            .select('id, achievement_threshold_percent, incentive_amount, applies_to')
            .eq('kpi_cycle_id', cycleId)
            .eq('applies_to', 'all_ams'),
        admin.from('roadtour_kpi_teams').select('incentive_budget').eq('kpi_cycle_id', cycleId),
    ])
    const existingTiers = (rulesRes.data || [])
        .filter((r: any) => !(excludeRuleId && r.id === excludeRuleId))
        .map((r: any) => ({
            id: r.id,
            achievement_threshold_percent: Number(r.achievement_threshold_percent),
            incentive_amount: Number(r.incentive_amount),
        }))
    const maxIncentivePerAm = (teamsRes.data || [])
        .reduce((max: number, t: any) => Math.max(max, Number(t.incentive_budget) || 0), 0)
    return { existingTiers, maxIncentivePerAm }
}

/** Fetch AM display names for a set of user ids. */
export async function fetchUserNames(admin: any, userIds: string[]): Promise<Map<string, { full_name: string; email: string | null }>> {
    const map = new Map<string, { full_name: string; email: string | null }>()
    if (userIds.length === 0) return map
    const { data } = await admin
        .from('users')
        .select('id, full_name, email')
        .in('id', [...new Set(userIds)])
    for (const row of data || []) map.set(row.id, { full_name: row.full_name || 'Unknown', email: row.email || null })
    return map
}
