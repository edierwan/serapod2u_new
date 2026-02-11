import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getCompanyContext(supabase: any) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { error: 'Unauthorized', status: 401 }

    const { data: userData } = await supabase
        .from('users')
        .select('organization_id, roles!inner(role_level)')
        .eq('id', user.id)
        .single()

    if (!userData) return { error: 'User not found', status: 404 }

    return { user, userData, orgId: userData.organization_id, roleLevel: userData.roles.role_level }
}

/**
 * GET /api/hr/settings/permissions
 * Fetch all permissions, access groups with members and permissions
 */
export async function GET() {
    try {
        const supabase = await createClient() as any
        const ctx = await getCompanyContext(supabase)
        if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

        // Fetch all available permissions
        const { data: permissions } = await supabase
            .from('hr_permissions')
            .select('*')
            .order('module')
            .order('code')

        // Fetch access groups for this organization
        const { data: groups } = await supabase
            .from('hr_access_groups')
            .select(`
        *,
        hr_access_group_permissions (
          id, permission_id,
          hr_permissions ( id, code, module, name )
        ),
        hr_access_group_members (
          id, user_id, scope_type, scope_value, granted_by
        )
      `)
            .eq('organization_id', ctx.orgId)
            .order('name')

        // Fetch potential members (users in org)
        const { data: orgUsers } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('organization_id', ctx.orgId)
            .eq('is_active', true)
            .order('full_name')

        return NextResponse.json({
            permissions: permissions || [],
            groups: groups || [],
            users: orgUsers || [],
            isAdmin: ctx.roleLevel <= 20,
        })
    } catch (error) {
        console.error('Error fetching HR permissions:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * POST /api/hr/settings/permissions
 * Create an access group, or add members/permissions to a group
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient() as any
        const ctx = await getCompanyContext(supabase)
        if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
        if (ctx.roleLevel > 20) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

        const body = await request.json()
        const { action } = body

        if (action === 'create_group') {
            const { data: group, error } = await supabase
                .from('hr_access_groups')
                .insert({
                    organization_id: ctx.orgId,
                    name: body.name,
                    description: body.description || '',
                })
                .select()
                .single()
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, group })
        }

        if (action === 'add_member') {
            const { data: member, error } = await supabase
                .from('hr_access_group_members')
                .insert({
                    group_id: body.group_id,
                    user_id: body.user_id,
                    scope_type: body.scope_type || 'global',
                    scope_value: body.scope_value || null,
                    granted_by: ctx.user.id,
                })
                .select()
                .single()
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, member })
        }

        if (action === 'set_permissions') {
            // Replace all permissions for a group
            const { group_id, permission_ids } = body

            // Delete existing
            await supabase
                .from('hr_access_group_permissions')
                .delete()
                .eq('group_id', group_id)

            // Insert new
            if (permission_ids && permission_ids.length > 0) {
                const rows = permission_ids.map((pid: string) => ({
                    group_id,
                    permission_id: pid,
                }))
                const { error } = await supabase
                    .from('hr_access_group_permissions')
                    .insert(rows)
                if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            }

            return NextResponse.json({ success: true })
        }

        if (action === 'seed_permissions_catalog') {
            // Comprehensive HR permission seed based on all HR objects
            const PERMISSIONS = [
                // Employee module
                { code: 'employee.view', module: 'employee', name: 'View Employees', description: 'View employee list and basic info' },
                { code: 'employee.create', module: 'employee', name: 'Create Employee', description: 'Add new employees' },
                { code: 'employee.edit', module: 'employee', name: 'Edit Employee', description: 'Edit employee details' },
                { code: 'employee.delete', module: 'employee', name: 'Delete Employee', description: 'Remove employees' },
                { code: 'employee.profile', module: 'employee', name: 'View HR Profile', description: 'View sensitive profile (IC, bank, emergency)' },
                { code: 'employee.profile.edit', module: 'employee', name: 'Edit HR Profile', description: 'Edit sensitive profile fields' },
                // Attendance
                { code: 'attendance.view', module: 'attendance', name: 'View Attendance', description: 'View attendance records' },
                { code: 'attendance.clock', module: 'attendance', name: 'Clock In/Out', description: 'Perform clock in/out' },
                { code: 'attendance.manage', module: 'attendance', name: 'Manage Attendance', description: 'Manage attendance policy, shifts' },
                { code: 'attendance.corrections', module: 'attendance', name: 'Approve Corrections', description: 'Review and approve attendance corrections' },
                { code: 'attendance.overtime', module: 'attendance', name: 'Manage Overtime', description: 'Configure overtime rules and approve OT' },
                { code: 'attendance.timesheets', module: 'attendance', name: 'Manage Timesheets', description: 'View and approve timesheets' },
                // Leave
                { code: 'leave.view', module: 'leave', name: 'View Leave', description: 'View leave records' },
                { code: 'leave.apply', module: 'leave', name: 'Apply Leave', description: 'Submit leave applications' },
                { code: 'leave.approve', module: 'leave', name: 'Approve Leave', description: 'Approve or reject leave requests' },
                { code: 'leave.types.manage', module: 'leave', name: 'Manage Leave Types', description: 'Create and edit leave type definitions' },
                { code: 'leave.balance', module: 'leave', name: 'View All Balances', description: 'View all employee leave balances' },
                { code: 'leave.holidays', module: 'leave', name: 'Manage Public Holidays', description: 'Manage public holiday calendar' },
                // Payroll
                { code: 'payroll.view', module: 'payroll', name: 'View Payroll', description: 'View payroll data' },
                { code: 'payroll.manage', module: 'payroll', name: 'Manage Payroll', description: 'Run payroll, manage salary bands' },
                { code: 'payroll.salary', module: 'payroll', name: 'Manage Compensation', description: 'Set employee salary and bands' },
                { code: 'payroll.allowances', module: 'payroll', name: 'Manage Allowances', description: 'Configure allowance types and assignments' },
                { code: 'payroll.deductions', module: 'payroll', name: 'Manage Deductions', description: 'Configure deduction types and assignments' },
                { code: 'payroll.payslips', module: 'payroll', name: 'View Payslips', description: 'View and generate payslips' },
                // Reports
                { code: 'reports.attendance', module: 'reports', name: 'Attendance Reports', description: 'Generate attendance reports' },
                { code: 'reports.leave', module: 'reports', name: 'Leave Reports', description: 'Generate leave reports' },
                { code: 'reports.payroll', module: 'reports', name: 'Payroll Reports', description: 'Generate payroll reports' },
                { code: 'reports.headcount', module: 'reports', name: 'Headcount Reports', description: 'View headcount and turnover analytics' },
                // Settings
                { code: 'settings.org', module: 'settings', name: 'Org Settings', description: 'Edit organization HR settings' },
                { code: 'settings.permissions', module: 'settings', name: 'Manage Permissions', description: 'Manage access groups and permissions' },
                { code: 'settings.notifications', module: 'settings', name: 'Manage Notifications', description: 'Configure HR notification rules' },
                // Expense
                { code: 'expense.submit', module: 'expense', name: 'Submit Expense', description: 'Submit expense claims' },
                { code: 'expense.approve', module: 'expense', name: 'Approve Expense', description: 'Review and approve expense claims' },
                { code: 'expense.manage', module: 'expense', name: 'Manage Expenses', description: 'Full expense management access' },
                // Recruitment
                { code: 'recruitment.view', module: 'recruitment', name: 'View Recruitment', description: 'View job postings and candidates' },
                { code: 'recruitment.manage', module: 'recruitment', name: 'Manage Recruitment', description: 'Create postings, manage pipeline' },
            ]

            let added = 0
            for (const p of PERMISSIONS) {
                const { error } = await supabase
                    .from('hr_permissions')
                    .upsert({ ...p, is_system: true }, { onConflict: 'code' })
                if (!error) added++
            }

            return NextResponse.json({ success: true, message: `${added} permissions seeded in catalog` })
        }

        if (action === 'seed_template_groups') {
            // Get all permissions for mapping
            const { data: allPerms } = await supabase.from('hr_permissions').select('id, code')
            const permMap = new Map<string, string>()
            allPerms?.forEach((p: any) => permMap.set(p.code, p.id))

            const TEMPLATE_GROUPS = [
                {
                    name: 'HR Admin',
                    description: 'Full HR module access — all permissions across all modules',
                    permCodes: Array.from(permMap.keys()), // All permissions
                },
                {
                    name: 'HR Manager',
                    description: 'Department-level HR management — employee, attendance, leave, basic payroll',
                    permCodes: ['employee.view', 'employee.create', 'employee.edit', 'employee.profile', 'attendance.view', 'attendance.manage', 'attendance.corrections', 'attendance.overtime', 'attendance.timesheets', 'leave.view', 'leave.approve', 'leave.types.manage', 'leave.balance', 'leave.holidays', 'payroll.view', 'reports.attendance', 'reports.leave', 'reports.headcount'],
                },
                {
                    name: 'Payroll Admin',
                    description: 'Full payroll access — salary, allowances, deductions, payslips, reports',
                    permCodes: ['employee.view', 'employee.profile', 'payroll.view', 'payroll.manage', 'payroll.salary', 'payroll.allowances', 'payroll.deductions', 'payroll.payslips', 'reports.payroll'],
                },
                {
                    name: 'Leave Manager',
                    description: 'Leave administration — approve leave, manage types, view balances',
                    permCodes: ['employee.view', 'leave.view', 'leave.apply', 'leave.approve', 'leave.types.manage', 'leave.balance', 'leave.holidays', 'reports.leave'],
                },
                {
                    name: 'HR Viewer',
                    description: 'Read-only access — view employees, attendance, leave, payroll',
                    permCodes: ['employee.view', 'attendance.view', 'leave.view', 'payroll.view'],
                },
                {
                    name: 'Department Head',
                    description: 'Department-scoped — approve leave, view attendance, submit expenses',
                    permCodes: ['employee.view', 'attendance.view', 'attendance.corrections', 'leave.view', 'leave.approve', 'expense.approve', 'reports.attendance', 'reports.leave'],
                },
            ]

            let created = 0
            for (const tg of TEMPLATE_GROUPS) {
                // Create or find group
                const { data: group } = await supabase
                    .from('hr_access_groups')
                    .upsert({
                        organization_id: ctx.orgId,
                        name: tg.name,
                        description: tg.description,
                    }, { onConflict: 'organization_id,name' })
                    .select('id')
                    .single()

                if (group) {
                    // Clear existing perms
                    await supabase.from('hr_access_group_permissions').delete().eq('group_id', group.id)
                    // Insert mapped perms
                    const rows = tg.permCodes.filter(c => permMap.has(c)).map(c => ({
                        group_id: group.id,
                        permission_id: permMap.get(c)!,
                    }))
                    if (rows.length > 0) {
                        await supabase.from('hr_access_group_permissions').insert(rows)
                    }
                    created++
                }
            }

            return NextResponse.json({ success: true, message: `${created} template access groups created with permissions` })
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    } catch (error) {
        console.error('Error in HR permissions POST:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/hr/settings/permissions
 * Remove a group, member, or permission mapping
 */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient() as any
        const ctx = await getCompanyContext(supabase)
        if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
        if (ctx.roleLevel > 20) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

        const { searchParams } = new URL(request.url)
        const type = searchParams.get('type')
        const id = searchParams.get('id')

        if (!type || !id) return NextResponse.json({ error: 'Missing type/id' }, { status: 400 })

        if (type === 'group') {
            // Check system group
            const { data: group } = await supabase
                .from('hr_access_groups')
                .select('is_system')
                .eq('id', id)
                .single()
            if (group?.is_system) {
                return NextResponse.json({ error: 'Cannot delete system group' }, { status: 400 })
            }
            const { error } = await supabase.from('hr_access_groups').delete().eq('id', id)
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        } else if (type === 'member') {
            const { error } = await supabase.from('hr_access_group_members').delete().eq('id', id)
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        } else {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error in HR permissions DELETE:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
