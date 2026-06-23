// Canonical HR permissions + access-group seeding logic.
// Single source of truth shared by:
//   - POST /api/hr/settings/permissions  (seed_permissions_catalog, seed_template_groups)
//   - POST /api/hr/config/audit           (default_access_groups)
// so there is no second divergent seed path.

export interface HrPermissionSeed {
    code: string
    module: string
    name: string
    description: string
}

// Comprehensive HR permission catalog (global, keyed by `code`).
export const HR_PERMISSIONS: HrPermissionSeed[] = [
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

// `'ALL'` is a sentinel meaning "every permission code in the catalog".
export interface HrTemplateGroupSeed {
    name: string
    description: string
    permCodes: string[] | 'ALL'
}

export const HR_TEMPLATE_GROUPS: HrTemplateGroupSeed[] = [
    {
        name: 'HR Admin',
        description: 'Full HR module access — all permissions across all modules',
        permCodes: 'ALL',
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

/**
 * Upsert the global HR permission catalog. Returns the number upserted.
 */
export async function seedPermissionsCatalog(supabase: any): Promise<number> {
    let added = 0
    for (const p of HR_PERMISSIONS) {
        const { error } = await supabase
            .from('hr_permissions')
            .upsert({ ...p, is_system: true }, { onConflict: 'code' })
        if (!error) added++
    }
    return added
}

/**
 * Create the template access groups for an organization and map their
 * permissions via the hr_access_group_permissions join table.
 * Assumes the permission catalog has been seeded; seeds it if empty.
 * Returns the number of groups created/updated.
 */
export async function seedTemplateGroups(supabase: any, orgId: string): Promise<number> {
    let { data: allPerms } = await supabase.from('hr_permissions').select('id, code')
    if (!allPerms || allPerms.length === 0) {
        await seedPermissionsCatalog(supabase)
        const reread = await supabase.from('hr_permissions').select('id, code')
        allPerms = reread.data
    }

    const permMap = new Map<string, string>()
    allPerms?.forEach((p: any) => permMap.set(p.code, p.id))

    let created = 0
    for (const tg of HR_TEMPLATE_GROUPS) {
        const permCodes = tg.permCodes === 'ALL' ? Array.from(permMap.keys()) : tg.permCodes

        const { data: group } = await supabase
            .from('hr_access_groups')
            .upsert({
                organization_id: orgId,
                name: tg.name,
                description: tg.description,
            }, { onConflict: 'organization_id,name' })
            .select('id')
            .single()

        if (group) {
            await supabase.from('hr_access_group_permissions').delete().eq('group_id', group.id)
            const rows = permCodes
                .filter((c: string) => permMap.has(c))
                .map((c: string) => ({ group_id: group.id, permission_id: permMap.get(c)! }))
            if (rows.length > 0) {
                await supabase.from('hr_access_group_permissions').insert(rows)
            }
            created++
        }
    }
    return created
}
