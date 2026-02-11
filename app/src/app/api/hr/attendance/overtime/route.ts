import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

// ─── GET /api/hr/attendance/overtime ──────────────────────────
// Returns overtime policy + rules + presets for the org.

export async function GET() {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }
        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        // Fetch policy, rules, presets in parallel
        const [policyRes, rulesRes, presetsRes] = await Promise.all([
            supabase
                .from('hr_overtime_policies')
                .select('*')
                .eq('organization_id', ctx.organizationId)
                .maybeSingle(),
            supabase
                .from('hr_overtime_rules')
                .select('*')
                .eq('policy_id',
                    supabase.from('hr_overtime_policies').select('id').eq('organization_id', ctx.organizationId).limit(1)
                )
                .order('priority', { ascending: true }),
            supabase
                .from('hr_overtime_presets')
                .select('*')
                .order('name', { ascending: true }),
        ])

        // If no policy exists yet, return empty with defaults
        const policy = policyRes.data || null

        // Get rules directly by policy_id if available
        let rules: any[] = []
        if (policy) {
            const { data: ruleData } = await supabase
                .from('hr_overtime_rules')
                .select('*')
                .eq('policy_id', policy.id)
                .eq('is_active', true)
                .order('priority', { ascending: true })
            rules = ruleData || []
        }

        return NextResponse.json({
            success: true,
            policy,
            rules,
            presets: presetsRes.data || [],
        })
    } catch (error: any) {
        console.error('Failed to load overtime config:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

// ─── POST /api/hr/attendance/overtime ─────────────────────────
// Create or update overtime policy + rules.

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }
        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }
        if (!(await canManageAttendance(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const body = await request.json()

        // ── Upsert policy ────────────────────────────────────────
        const policyPayload = {
            organization_id: ctx.organizationId,
            enabled: !!body.enabled,
            compensation_mode: body.compensation_mode || 'pay',
            toil_conversion_rate: body.toil_conversion_rate ?? 1.0,
            toil_expiry_days: body.toil_expiry_days ?? 90,
            approval_required: body.approval_required ?? true,
            approval_routing: body.approval_routing || 'direct_manager',
            auto_create_request: body.auto_create_request ?? true,
            block_unapproved_ot: body.block_unapproved_ot ?? true,
            ot_grace_minutes: body.ot_grace_minutes ?? 15,
            auto_deduct_break: body.auto_deduct_break ?? 0,
            rounding_mode: body.rounding_mode || 'none',
            rounding_interval: body.rounding_interval ?? 15,
            max_ot_per_day_hours: body.max_ot_per_day_hours ?? 4.0,
            max_ot_per_week_hours: body.max_ot_per_week_hours ?? 20.0,
            min_ot_block_minutes: body.min_ot_block_minutes ?? 15,
            require_reason_over_cap: body.require_reason_over_cap ?? true,
            applies_to: body.applies_to || 'all',
            exclude_managers: !!body.exclude_managers,
            exclude_part_time: !!body.exclude_part_time,
            exclude_probation: !!body.exclude_probation,
            updated_by: ctx.userId,
            updated_at: new Date().toISOString(),
        }

        const { data: policy, error: policyError } = await supabase
            .from('hr_overtime_policies')
            .upsert({ ...policyPayload, created_by: ctx.userId }, { onConflict: 'organization_id' })
            .select('*')
            .single()

        if (policyError) {
            return NextResponse.json({ success: false, error: policyError.message }, { status: 500 })
        }

        // Also update the legacy overtime_policy_json on hr_attendance_policies
        await supabase
            .from('hr_attendance_policies')
            .update({
                overtime_policy_json: {
                    enabled: !!body.enabled,
                    autoApprove: !(body.approval_required ?? true),
                    maxDailyMinutes: (body.max_ot_per_day_hours ?? 4.0) * 60,
                    rate: body.rules?.[0]?.multiplier_t1 ?? 1.5,
                },
                updated_at: new Date().toISOString(),
            })
            .eq('organization_id', ctx.organizationId)

        // ── Save rules (replace all) ─────────────────────────────
        if (Array.isArray(body.rules)) {
            // Delete existing rules
            await supabase
                .from('hr_overtime_rules')
                .delete()
                .eq('policy_id', policy.id)

            // Insert new rules
            if (body.rules.length > 0) {
                const rulesPayload = body.rules.map((r: any, i: number) => ({
                    policy_id: policy.id,
                    rule_type: r.rule_type || 'daily',
                    threshold_minutes_t1: r.threshold_minutes_t1 ?? 480,
                    threshold_minutes_t2: r.threshold_minutes_t2 || null,
                    multiplier_t1: r.multiplier_t1 ?? 1.5,
                    multiplier_t2: r.multiplier_t2 ?? 2.0,
                    rest_day_multiplier: r.rest_day_multiplier ?? 2.0,
                    holiday_multiplier: r.holiday_multiplier ?? 3.0,
                    weekly_threshold_hours: r.weekly_threshold_hours || null,
                    consecutive_days_trigger: r.consecutive_days_trigger || null,
                    scope_filter: r.scope_filter || [],
                    priority: i,
                    is_active: true,
                }))

                const { error: rulesError } = await supabase
                    .from('hr_overtime_rules')
                    .insert(rulesPayload)

                if (rulesError) {
                    console.error('Failed to insert OT rules:', rulesError)
                }
            }
        }

        // Fetch final state
        const { data: finalRules } = await supabase
            .from('hr_overtime_rules')
            .select('*')
            .eq('policy_id', policy.id)
            .eq('is_active', true)
            .order('priority', { ascending: true })

        return NextResponse.json({
            success: true,
            policy,
            rules: finalRules || [],
            message: 'Overtime configuration saved',
        })
    } catch (error: any) {
        console.error('Failed to save overtime config:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}
