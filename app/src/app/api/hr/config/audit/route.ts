import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ─── Types ────────────────────────────────────────────────────────

type AuditStatus = 'configured' | 'partial' | 'missing'

interface AuditCheck {
    key: string
    label: string
    status: AuditStatus
    detail: string
    link?: string            // deep-link view id (dashboard internal nav)
    linkLabel?: string
    autoSetupKey?: string    // key for auto-setup action
    count?: number           // numeric indicator (e.g. # shifts)
}

interface AuditSection {
    section: string
    icon: string
    checks: AuditCheck[]
}

// ─── Helpers ──────────────────────────────────────────────────────

async function getOrgContext(supabase: any) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return null

    const { data: userData } = await supabase
        .from('users')
        .select('organization_id, roles!inner(role_level)')
        .eq('id', user.id)
        .single()

    if (!userData) return null
    return { user, orgId: userData.organization_id, roleLevel: userData.roles.role_level }
}

// ─── GET /api/hr/config/audit ─────────────────────────────────────

export async function GET() {
    try {
        const supabase = await createClient() as any
        const ctx = await getOrgContext(supabase)
        if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { orgId } = ctx

        // ═══ Parallel DB queries ═══
        const [
            attendancePolicyRes,
            shiftsRes,
            holidaysRes,
            leaveTypesRes,
            approvalChainsRes,
            delegationRulesRes,
            salaryBandsRes,
            allowanceTypesRes,
            deductionTypesRes,
            hrSettingsRes,
            hrEmployeesRes,
            accessGroupsRes,
            notifSettingsRes,
            glMappingsRes,
            controlAccountsRes,
        ] = await Promise.all([
            supabase.from('hr_attendance_policies').select('id, workdays, timezone, grace_minutes, require_shift, overtime_policy_json').eq('organization_id', orgId).maybeSingle(),
            supabase.from('hr_shifts').select('id').eq('organization_id', orgId).eq('is_active', true),
            supabase.from('hr_public_holidays').select('id').eq('organization_id', orgId),
            supabase.from('hr_leave_types').select('id, carry_forward, accrual_frequency').eq('organization_id', orgId).eq('status', 'active'),
            supabase.from('hr_approval_chains').select('id').eq('organization_id', orgId),
            supabase.from('hr_delegation_rules').select('id').eq('organization_id', orgId).eq('is_active', true),
            supabase.from('hr_salary_bands').select('id').eq('organization_id', orgId).eq('is_active', true),
            supabase.from('hr_allowance_types').select('id').eq('organization_id', orgId).eq('is_active', true),
            supabase.from('hr_deduction_types').select('id').eq('organization_id', orgId).eq('is_active', true),
            supabase.from('hr_settings').select('config').eq('organization_id', orgId).maybeSingle(),
            supabase.from('hr_employees').select('id').eq('organization_id', orgId).limit(1),
            supabase.from('hr_access_groups').select('id, hr_access_group_members(id)').eq('organization_id', orgId),
            supabase.from('notification_settings').select('id, event_code, enabled').eq('org_id', orgId),
            supabase.from('hr_payroll_gl_mappings').select('id, component_code, gl_account_id').eq('organization_id', orgId),
            supabase.from('hr_control_accounts').select('id, account_type').eq('organization_id', orgId),
        ])

        // ═══ Parse results ═══
        const policy = attendancePolicyRes.data
        const shifts = shiftsRes.data || []
        const holidays = holidaysRes.data || []
        const leaveTypes = leaveTypesRes.data || []
        const chains = approvalChainsRes.data || []
        const delegations = delegationRulesRes.data || []
        const salaryBands = salaryBandsRes.data || []
        const allowanceTypes = allowanceTypesRes.data || []
        const deductionTypes = deductionTypesRes.data || []
        const hrSettings = hrSettingsRes.data?.config || {}
        const employees = hrEmployeesRes.data || []
        const accessGroups = accessGroupsRes.data || []
        const notifSettings = notifSettingsRes.data || []
        const glMappings = glMappingsRes.data || []
        const controlAccounts = controlAccountsRes.data || []

        // HR notification settings
        const hrNotifs = notifSettings.filter((n: any) => n.event_code?.startsWith('hr.'))
        const hrNotifsEnabled = hrNotifs.filter((n: any) => n.enabled)

        // access groups with members
        const groupsWithMembers = accessGroups.filter((g: any) => g.hr_access_group_members?.length > 0)

        // Check carry-forward configured on any leave type
        const hasCarryForward = leaveTypes.some((lt: any) => {
            try {
                const cf = typeof lt.carry_forward === 'string' ? JSON.parse(lt.carry_forward) : lt.carry_forward
                return cf?.enabled === true
            } catch { return false }
        })

        // OT config
        const otEnabled = policy?.overtime_policy_json?.enabled === true

        // Payroll clearing + bank
        const hasClearingAcct = controlAccounts.some((ca: any) => ca.account_type === 'CLEARING')
        const hasBankAcct = controlAccounts.some((ca: any) => ca.account_type === 'BANK')

        // ═══ Build audit sections ═══
        const sections: AuditSection[] = [
            // ─── A) Company Defaults ───
            {
                section: 'Company Defaults',
                icon: 'building',
                checks: [
                    {
                        key: 'timezone',
                        label: 'Timezone',
                        status: policy?.timezone ? 'configured' : 'missing',
                        detail: policy?.timezone || 'Not set (default: Asia/Kuala_Lumpur)',
                        link: 'hr/attendance/clock-in-out',
                        linkLabel: 'Attendance Policy',
                        autoSetupKey: 'default_workweek',
                    },
                    {
                        key: 'workweek',
                        label: 'Workweek Template',
                        status: policy?.workdays?.length > 0 ? 'configured' : 'missing',
                        detail: policy?.workdays?.length > 0
                            ? `${policy.workdays.join(', ')} (${policy.workdays.length} days)`
                            : 'No workweek defined',
                        link: 'hr/attendance/clock-in-out',
                        linkLabel: 'Attendance Policy',
                        autoSetupKey: 'default_workweek',
                    },
                    {
                        key: 'holidays',
                        label: 'Public Holiday Calendar',
                        status: holidays.length > 0 ? 'configured' : 'missing',
                        detail: holidays.length > 0
                            ? `${holidays.length} holiday(s) configured`
                            : 'No holidays added',
                        count: holidays.length,
                        link: 'hr/attendance/public-holidays',
                        linkLabel: 'Public Holidays',
                        autoSetupKey: 'default_holidays_my',
                    },
                ],
            },

            // ─── B) Attendance Setup ───
            {
                section: 'Attendance Setup',
                icon: 'clock',
                checks: [
                    {
                        key: 'attendance_policy',
                        label: 'Attendance Policy',
                        status: policy ? 'configured' : 'missing',
                        detail: policy
                            ? `Grace: ${policy.grace_minutes}min | Shift required: ${policy.require_shift ? 'Yes' : 'No'}`
                            : 'No attendance policy created',
                        link: 'hr/attendance/clock-in-out',
                        linkLabel: 'Attendance',
                        autoSetupKey: 'default_workweek',
                    },
                    {
                        key: 'shifts',
                        label: 'Shifts',
                        status: !policy?.require_shift
                            ? 'configured'
                            : shifts.length > 0
                                ? 'configured'
                                : 'missing',
                        detail: !policy?.require_shift
                            ? 'Shifts not required'
                            : shifts.length > 0
                                ? `${shifts.length} active shift(s)`
                                : 'Shifts required but none configured',
                        count: shifts.length,
                        link: 'hr/attendance/clock-in-out',
                        linkLabel: 'Attendance',
                    },
                    {
                        key: 'overtime',
                        label: 'Overtime Rules',
                        status: otEnabled ? 'configured' : 'partial',
                        detail: otEnabled
                            ? `OT enabled (rate: ${policy?.overtime_policy_json?.rate || 1.5}x)`
                            : 'Overtime tracking disabled',
                        link: 'hr/attendance/clock-in-out',
                        linkLabel: 'Attendance',
                        autoSetupKey: 'enable_overtime_ea1955',
                    },
                    {
                        key: 'timesheet_config',
                        label: 'Timesheet Periods',
                        status: hrSettings.timesheet_period ? 'configured' : 'partial',
                        detail: hrSettings.timesheet_period
                            ? `Period: ${hrSettings.timesheet_period}`
                            : 'Using default weekly periods',
                        link: 'hr/attendance/timesheets',
                        linkLabel: 'Timesheets',
                    },
                ],
            },

            // ─── C) Leave Setup ───
            {
                section: 'Leave Setup',
                icon: 'calendar',
                checks: [
                    {
                        key: 'leave_types',
                        label: 'Leave Types',
                        status: leaveTypes.length > 0 ? 'configured' : 'missing',
                        detail: leaveTypes.length > 0
                            ? `${leaveTypes.length} active leave type(s)`
                            : 'No leave types created — leave module blocked',
                        count: leaveTypes.length,
                        link: 'hr/leave/types',
                        linkLabel: 'Manage Leave Types',
                        autoSetupKey: 'default_leave_types',
                    },
                    {
                        key: 'approval_chains',
                        label: 'Approval Chains',
                        status: chains.length > 0 ? 'configured' : 'missing',
                        detail: chains.length > 0
                            ? `${chains.length} approval chain(s)`
                            : 'No approval chains — leave approvals will not work',
                        count: chains.length,
                        link: 'hr/leave/approval-flow',
                        linkLabel: 'Approval Flow',
                        autoSetupKey: 'default_approval_chain',
                    },
                    {
                        key: 'delegation_rules',
                        label: 'Delegation / Fallback',
                        status: delegations.length > 0 ? 'configured' : 'partial',
                        detail: delegations.length > 0
                            ? `${delegations.length} active delegation(s)`
                            : 'No delegation rules (approver absence not covered)',
                        count: delegations.length,
                        link: 'hr/leave/approval-flow',
                        linkLabel: 'Manage Delegation',
                    },
                    {
                        key: 'carry_forward',
                        label: 'Carry-Forward Rules',
                        status: hasCarryForward ? 'configured' : 'partial',
                        detail: hasCarryForward
                            ? 'At least one leave type has carry-forward enabled'
                            : 'No carry-forward configured on any leave type',
                        link: 'hr/leave/types',
                        linkLabel: 'Leave Types',
                    },
                ],
            },

            // ─── D) Payroll Setup ───
            {
                section: 'Payroll Setup',
                icon: 'wallet',
                checks: [
                    {
                        key: 'salary_bands',
                        label: 'Salary Bands',
                        status: salaryBands.length > 0 ? 'configured' : 'missing',
                        detail: salaryBands.length > 0
                            ? `${salaryBands.length} active band(s)`
                            : 'No salary bands — payroll blocked',
                        count: salaryBands.length,
                        link: 'hr/payroll/salary-structure',
                        linkLabel: 'Salary Structure',
                        autoSetupKey: 'default_salary_bands',
                    },
                    {
                        key: 'allowance_types',
                        label: 'Allowance Types',
                        status: allowanceTypes.length > 0 ? 'configured' : 'partial',
                        detail: allowanceTypes.length > 0
                            ? `${allowanceTypes.length} active type(s)`
                            : 'No allowance types',
                        count: allowanceTypes.length,
                        link: 'hr/payroll/allowances-deductions',
                        linkLabel: 'Allowances & Deductions',
                    },
                    {
                        key: 'deduction_types',
                        label: 'Deduction Types',
                        status: deductionTypes.length > 0 ? 'configured' : 'partial',
                        detail: deductionTypes.length > 0
                            ? `${deductionTypes.length} active type(s)`
                            : 'No deduction types',
                        count: deductionTypes.length,
                        link: 'hr/payroll/allowances-deductions',
                        linkLabel: 'Allowances & Deductions',
                    },
                    {
                        key: 'gl_mappings',
                        label: 'Payroll → GL Mapping',
                        status: glMappings.length > 0 ? (glMappings.every((m: any) => m.gl_account_id) ? 'configured' : 'partial') : 'missing',
                        detail: glMappings.length > 0
                            ? `${glMappings.length} mapping(s)` + (glMappings.some((m: any) => !m.gl_account_id) ? ' (some unmapped)' : '')
                            : 'No GL mappings configured',
                        count: glMappings.length,
                        link: 'hr/settings/accounting',
                        linkLabel: 'HR Accounting',
                    },
                    {
                        key: 'clearing_bank',
                        label: 'Clearing & Bank Accounts',
                        status: hasClearingAcct && hasBankAcct ? 'configured' : hasClearingAcct || hasBankAcct ? 'partial' : 'missing',
                        detail: hasClearingAcct && hasBankAcct
                            ? 'Clearing and bank accounts configured'
                            : `Missing: ${[!hasClearingAcct && 'Clearing', !hasBankAcct && 'Bank'].filter(Boolean).join(', ')}`,
                        link: 'hr/settings/accounting',
                        linkLabel: 'HR Accounting',
                    },
                ],
            },

            // ─── E) Security & Notifications ───
            {
                section: 'Security & Notifications',
                icon: 'shield',
                checks: [
                    {
                        key: 'access_groups',
                        label: 'HR Access Groups',
                        status: groupsWithMembers.length > 0 ? 'configured' : accessGroups.length > 0 ? 'partial' : 'missing',
                        detail: groupsWithMembers.length > 0
                            ? `${accessGroups.length} group(s), ${groupsWithMembers.length} with members`
                            : accessGroups.length > 0
                                ? `${accessGroups.length} group(s) but no members assigned`
                                : 'No HR access groups created',
                        count: accessGroups.length,
                        link: 'hr/settings/permissions',
                        linkLabel: 'HR Permissions',
                        autoSetupKey: 'default_access_groups',
                    },
                    {
                        key: 'hr_notifications',
                        label: 'HR Notification Rules',
                        status: hrNotifsEnabled.length > 0 ? 'configured' : hrNotifs.length > 0 ? 'partial' : 'missing',
                        detail: hrNotifsEnabled.length > 0
                            ? `${hrNotifsEnabled.length} of ${hrNotifs.length} HR notification(s) enabled`
                            : hrNotifs.length > 0
                                ? `${hrNotifs.length} rule(s) configured but none enabled`
                                : 'No HR notification rules set up',
                        count: hrNotifsEnabled.length,
                        link: 'settings/notifications/types',
                        linkLabel: 'Notification Settings',
                        autoSetupKey: 'default_hr_notifications',
                    },
                    {
                        key: 'employees_exist',
                        label: 'Employee Records',
                        status: employees.length > 0 ? 'configured' : 'missing',
                        detail: employees.length > 0 ? 'Employee records exist' : 'No employee records found',
                        link: 'hr/people/employees',
                        linkLabel: 'People',
                    },
                ],
            },
        ]

        // ═══ Summary stats ═══
        const allChecks = sections.flatMap(s => s.checks)
        const summary = {
            total: allChecks.length,
            configured: allChecks.filter(c => c.status === 'configured').length,
            partial: allChecks.filter(c => c.status === 'partial').length,
            missing: allChecks.filter(c => c.status === 'missing').length,
        }

        return NextResponse.json({ sections, summary, orgId })
    } catch (error) {
        console.error('Error in HR config audit:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// ─── POST /api/hr/config/audit — Auto-Setup actions ──────────────

export async function POST(request: Request) {
    try {
        const supabase = await createClient() as any
        const ctx = await getOrgContext(supabase)
        if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        if (ctx.roleLevel > 20) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

        const body = await request.json()
        const { action } = body

        if (action === 'default_workweek') {
            // Upsert attendance policy with default Mon-Fri
            const { error } = await supabase
                .from('hr_attendance_policies')
                .upsert({
                    organization_id: ctx.orgId,
                    workdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                    timezone: 'Asia/Kuala_Lumpur',
                    grace_minutes: 10,
                    require_shift: false,
                    late_after_minutes: 15,
                    early_leave_before_minutes: 15,
                }, { onConflict: 'organization_id' })
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, message: 'Default workweek (Mon–Fri) created' })
        }

        if (action === 'default_holidays_my') {
            // Seed Malaysian public holidays for current year
            const year = new Date().getFullYear()
            const holidays = [
                { name: 'New Year', date: `${year}-01-01`, is_recurring: true },
                { name: 'Thaipusam', date: `${year}-01-25`, is_recurring: false },
                { name: 'Federal Territory Day', date: `${year}-02-01`, is_recurring: true, state: 'WP' },
                { name: 'Nuzul Al-Quran', date: `${year}-03-27`, is_recurring: false },
                { name: 'Labour Day', date: `${year}-05-01`, is_recurring: true },
                { name: 'Vesak Day', date: `${year}-05-12`, is_recurring: false },
                { name: 'Agong Birthday', date: `${year}-06-02`, is_recurring: false },
                { name: 'Hari Raya Aidilfitri', date: `${year}-03-30`, is_recurring: false },
                { name: 'Hari Raya Haji', date: `${year}-06-07`, is_recurring: false },
                { name: 'Awal Muharram', date: `${year}-06-27`, is_recurring: false },
                { name: 'Malaysia Day', date: `${year}-09-16`, is_recurring: true },
                { name: 'Mawlid Nabi', date: `${year}-09-05`, is_recurring: false },
                { name: 'Deepavali', date: `${year}-10-20`, is_recurring: false },
                { name: 'Christmas Day', date: `${year}-12-25`, is_recurring: true },
                { name: 'Merdeka Day', date: `${year}-08-31`, is_recurring: true },
            ]

            const rows = holidays.map(h => ({
                organization_id: ctx.orgId,
                name: h.name,
                date: h.date,
                is_recurring: h.is_recurring,
                state: h.state || null,
            }))

            const { error } = await supabase.from('hr_public_holidays').insert(rows)
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, message: `${rows.length} Malaysian holidays added for ${year}` })
        }

        if (action === 'enable_overtime_ea1955') {
            // Enable OT tracking in attendance policy + seed Malaysia EA 1955 preset
            const { error: policyErr } = await supabase
                .from('hr_attendance_policies')
                .upsert({
                    organization_id: ctx.orgId,
                    overtime_policy_json: { enabled: true, rate: 1.5 },
                }, { onConflict: 'organization_id' })
            if (policyErr) return NextResponse.json({ error: policyErr.message }, { status: 400 })

            // Upsert Malaysia EA 1955 OT preset
            await supabase.from('hr_overtime_presets').upsert({
                organization_id: ctx.orgId,
                name: 'Malaysia EA 1955',
                country_code: 'MY',
                rules_json: {
                    multiplier_normal: 1.5,
                    multiplier_rest_day: 2.0,
                    multiplier_holiday: 3.0,
                    multiplier_extended: 2.0,
                    extended_after_minutes: 720,
                    max_daily_hours: 4,
                },
            }, { onConflict: 'organization_id,name' })

            return NextResponse.json({ success: true, message: 'Overtime enabled with Malaysia EA 1955 rates (1.5×/2.0×/3.0×)' })
        }

        if (action === 'default_hr_notifications') {
            // Enable default HR notification rules (all off by default, just create the rows)
            const hrEventCodes = [
                'hr.leave.requested', 'hr.leave.approved', 'hr.leave.rejected',
                'hr.payroll.ready', 'hr.attendance.missed',
            ]

            const rows = hrEventCodes.map(ec => ({
                org_id: ctx.orgId,
                event_code: ec,
                enabled: false,
                channels_enabled: ['email'],
                priority: 'normal',
            }))

            // Upsert to avoid duplicates
            for (const row of rows) {
                await supabase
                    .from('notification_settings')
                    .upsert(row, { onConflict: 'org_id,event_code' })
            }

            return NextResponse.json({ success: true, message: `${rows.length} HR notification rules created (disabled by default)` })
        }

        if (action === 'default_leave_types') {
            // Seed common leave types: Annual, Sick, Unpaid
            const leaveTypes = [
                { code: 'ANNUAL', name: 'Annual Leave', default_days: 14, carry_forward: JSON.stringify({ enabled: true, max_days: 5 }), accrual_frequency: 'monthly', color: '#3B82F6' },
                { code: 'SICK', name: 'Sick Leave', default_days: 14, carry_forward: JSON.stringify({ enabled: false }), accrual_frequency: 'none', color: '#EF4444' },
                { code: 'UNPAID', name: 'Unpaid Leave', default_days: 30, carry_forward: JSON.stringify({ enabled: false }), accrual_frequency: 'none', color: '#6B7280' },
                { code: 'MATERNITY', name: 'Maternity Leave', default_days: 98, carry_forward: JSON.stringify({ enabled: false }), accrual_frequency: 'none', color: '#EC4899' },
                { code: 'PATERNITY', name: 'Paternity Leave', default_days: 7, carry_forward: JSON.stringify({ enabled: false }), accrual_frequency: 'none', color: '#8B5CF6' },
            ]

            const rows = leaveTypes.map(lt => ({
                organization_id: ctx.orgId,
                code: lt.code,
                name: lt.name,
                default_days: lt.default_days,
                carry_forward: lt.carry_forward,
                accrual_frequency: lt.accrual_frequency,
                color: lt.color,
                status: 'active',
            }))

            const { error } = await supabase.from('hr_leave_types').upsert(rows, { onConflict: 'organization_id,code' })
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, message: `${rows.length} default leave types created (Annual, Sick, Unpaid, Maternity, Paternity)` })
        }

        if (action === 'default_approval_chain') {
            // Create default Manager → HR approval chain
            const { error } = await supabase
                .from('hr_approval_chains')
                .upsert({
                    organization_id: ctx.orgId,
                    name: 'Default Approval Chain',
                    description: 'Manager → HR Admin approval flow',
                    steps: JSON.stringify([
                        { order: 1, role: 'manager', label: 'Direct Manager' },
                        { order: 2, role: 'hr_admin', label: 'HR Admin' },
                    ]),
                    is_default: true,
                    is_active: true,
                }, { onConflict: 'organization_id,name' })
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, message: 'Default approval chain created (Manager → HR Admin)' })
        }

        if (action === 'default_salary_bands') {
            // Create placeholder salary bands
            const bands = [
                { code: 'EXEC', name: 'Executive', min_salary: 2000, max_salary: 4000 },
                { code: 'SENIOR', name: 'Senior Executive', min_salary: 4000, max_salary: 7000 },
                { code: 'MANAGER', name: 'Manager', min_salary: 7000, max_salary: 12000 },
                { code: 'DIRECTOR', name: 'Director', min_salary: 12000, max_salary: 25000 },
            ]

            const rows = bands.map(b => ({
                organization_id: ctx.orgId,
                code: b.code,
                name: b.name,
                min_salary: b.min_salary,
                max_salary: b.max_salary,
                currency: 'MYR',
                is_active: true,
            }))

            const { error } = await supabase.from('hr_salary_bands').upsert(rows, { onConflict: 'organization_id,code' })
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, message: `${rows.length} salary bands created (Executive → Director)` })
        }

        if (action === 'default_access_groups') {
            // Create default HR Admin + Manager access groups
            const groups = [
                { name: 'HR Admin', description: 'Full HR module access', permissions: JSON.stringify(['hr.*']) },
                { name: 'HR Manager', description: 'Department-level HR access', permissions: JSON.stringify(['hr.view', 'hr.attendance', 'hr.leave.approve']) },
                { name: 'HR Viewer', description: 'Read-only HR access', permissions: JSON.stringify(['hr.view']) },
            ]

            for (const g of groups) {
                await supabase
                    .from('hr_access_groups')
                    .upsert({
                        organization_id: ctx.orgId,
                        name: g.name,
                        description: g.description,
                        permissions: g.permissions,
                    }, { onConflict: 'organization_id,name' })
            }

            return NextResponse.json({ success: true, message: '3 default HR access groups created (Admin, Manager, Viewer)' })
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    } catch (error) {
        console.error('Error in HR config auto-setup:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
