/**
 * HR Assistant — Tool Catalog
 *
 * Server-side tools the assistant can call to answer HR queries.
 * Every tool is scoped by tenant (organization_id) and respects RBAC.
 * Tools NEVER return sensitive fields to unauthorized viewers.
 */
import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'
import {
  type Viewer,
  canViewSalary,
  getSensitivityRefusal,
} from './policy'

// ─── Tool Result ───────────────────────────────────────────────────

export interface ToolResult {
  success: boolean
  tool: string
  /** Summary line for the response */
  summary: string
  /** Structured data rows (safe for display) */
  rows?: Record<string, any>[]
  totalCount?: number
  /** If rows were truncated */
  truncated?: boolean
  /** Error / refusal message */
  error?: string
  /** Navigation deep link */
  deepLink?: string
}

// ─── Tool Registry ─────────────────────────────────────────────────

export type ToolName =
  | 'employeesMissingManager'
  | 'employeesMissingPosition'
  | 'departmentsMissingManager'
  | 'listDepartments'
  | 'listPositions'
  | 'orgSummary'
  | 'hrConfigAudit'
  | 'payrollSetupStatus'
  | 'salaryInfo'
  | 'leaveTypesSummary'
  | 'attendanceSummary'
  | 'leaveBalance'
  | 'myLeaveRequests'
  | 'publicHolidays'
  | 'payrollDateInfo'
  | 'employeeSearch'
  | 'applyLeave'

export interface ToolDef {
  name: ToolName
  description: string
  sensitiveLevel: 'public' | 'internal' | 'sensitive' | 'highly_sensitive'
}

export const TOOL_CATALOG: ToolDef[] = [
  { name: 'employeesMissingManager', description: 'List employees who have no manager assigned', sensitiveLevel: 'internal' },
  { name: 'employeesMissingPosition', description: 'List employees who have no position assigned', sensitiveLevel: 'internal' },
  { name: 'departmentsMissingManager', description: 'List departments with no manager', sensitiveLevel: 'internal' },
  { name: 'listDepartments', description: 'List all active departments', sensitiveLevel: 'public' },
  { name: 'listPositions', description: 'List all active positions/job titles', sensitiveLevel: 'public' },
  { name: 'orgSummary', description: 'Get organization headcount and structure summary', sensitiveLevel: 'public' },
  { name: 'hrConfigAudit', description: 'Run the HR configuration readiness audit', sensitiveLevel: 'internal' },
  { name: 'payrollSetupStatus', description: 'Check payroll configuration status (safe, no salary data)', sensitiveLevel: 'internal' },
  { name: 'salaryInfo', description: 'Get salary information (HR_MANAGER only)', sensitiveLevel: 'highly_sensitive' },
  { name: 'leaveTypesSummary', description: 'List configured leave types', sensitiveLevel: 'public' },
  { name: 'attendanceSummary', description: 'Attendance setup summary', sensitiveLevel: 'public' },
  { name: 'leaveBalance', description: 'Check leave balance for current user or all employees', sensitiveLevel: 'internal' },
  { name: 'myLeaveRequests', description: 'List my leave requests or pending approvals', sensitiveLevel: 'public' },
  { name: 'publicHolidays', description: 'List upcoming public holidays', sensitiveLevel: 'public' },
  { name: 'payrollDateInfo', description: 'Check payroll processing dates and status', sensitiveLevel: 'internal' },
  { name: 'employeeSearch', description: 'Search for an employee by name', sensitiveLevel: 'internal' },
  { name: 'applyLeave', description: 'Help user apply for leave', sensitiveLevel: 'public' },
]

const MAX_ROWS = 50

// ─── Tool Implementations ──────────────────────────────────────────

export async function executeTool(
  toolName: ToolName,
  viewer: Viewer,
  supabase: SupabaseClient,
  _args?: Record<string, any>,
): Promise<ToolResult> {
  const orgId = viewer.orgId

  switch (toolName) {
    case 'employeesMissingManager':
      return employeesMissingManager(supabase, orgId, viewer)

    case 'employeesMissingPosition':
      return employeesMissingPosition(supabase, orgId, viewer)

    case 'departmentsMissingManager':
      return departmentsMissingManager(supabase, orgId)

    case 'listDepartments':
      return listDepartments(supabase, orgId)

    case 'listPositions':
      return listPositions(supabase, orgId)

    case 'orgSummary':
      return orgSummary(supabase, orgId)

    case 'payrollSetupStatus':
      return payrollSetupStatus(supabase, orgId)

    case 'salaryInfo':
      if (!canViewSalary(viewer)) {
        return {
          success: false,
          tool: 'salaryInfo',
          summary: getSensitivityRefusal(viewer, 'salary'),
          error: 'access_denied',
        }
      }
      return salaryInfo(supabase, orgId)

    case 'leaveTypesSummary':
      return leaveTypesSummary(supabase, orgId)

    case 'attendanceSummary':
      return attendanceSummary(supabase, orgId)

    case 'leaveBalance':
      return leaveBalance(supabase, orgId, viewer)

    case 'myLeaveRequests':
      return myLeaveRequests(supabase, orgId, viewer)

    case 'publicHolidays':
      return publicHolidaysTool(supabase, orgId)

    case 'payrollDateInfo':
      return payrollDateInfo(supabase, orgId)

    case 'employeeSearch':
      return employeeSearch(supabase, orgId, viewer, _args?.query)

    case 'applyLeave':
      return applyLeaveInfo(supabase, orgId, viewer)

    case 'hrConfigAudit':
      // Delegate to existing audit — imported dynamically to avoid circular dep
      return hrConfigAuditTool(supabase, orgId)

    default:
      return { success: false, tool: toolName, summary: `Unknown tool: ${toolName}`, error: 'unknown_tool' }
  }
}

// ─── Tool: Employees Missing Manager ───────────────────────────────

async function employeesMissingManager(
  supabase: SupabaseClient,
  orgId: string,
  _viewer: Viewer,
): Promise<ToolResult> {
  const { count: totalCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const { data, count } = await supabase
    .from('users')
    .select('id, full_name, email, department_id, position_id, departments(dept_name), hr_positions(title)', { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('manager_user_id', null)
    .order('full_name')
    .limit(MAX_ROWS)

  const missingCount = count ?? 0
  const total = totalCount ?? 0
  const rows = (data ?? []).map((row: any) => ({
    name: row.full_name ?? row.email ?? 'Unknown',
    department: row.departments?.dept_name ?? '—',
    position: (row.hr_positions as any)?.title ?? '—',
  }))

  return {
    success: true,
    tool: 'employeesMissingManager',
    summary: `${missingCount}/${total} pekerja tiada manager`,
    rows,
    totalCount: missingCount,
    truncated: missingCount > MAX_ROWS,
    deepLink: '/hr/people/employees?filter=missing_manager',
  }
}

// ─── Tool: Employees Missing Position ──────────────────────────────

async function employeesMissingPosition(
  supabase: SupabaseClient,
  orgId: string,
  _viewer: Viewer,
): Promise<ToolResult> {
  const { count: totalCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const { data, count } = await supabase
    .from('users')
    .select('id, full_name, email, department_id, departments(dept_name)', { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('position_id', null)
    .order('full_name')
    .limit(MAX_ROWS)

  const missingCount = count ?? 0
  const total = totalCount ?? 0
  const rows = (data ?? []).map((row: any) => ({
    name: row.full_name ?? row.email ?? 'Unknown',
    department: row.departments?.dept_name ?? '—',
  }))

  return {
    success: true,
    tool: 'employeesMissingPosition',
    summary: `${missingCount}/${total} pekerja tiada position`,
    rows,
    totalCount: missingCount,
    truncated: missingCount > MAX_ROWS,
    deepLink: '/hr/people/employees?filter=missing_position',
  }
}

// ─── Tool: Departments Missing Manager ─────────────────────────────

async function departmentsMissingManager(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const { data, count } = await supabase
    .from('departments')
    .select('id, dept_name, dept_code', { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('manager_user_id', null)
    .order('dept_name')
    .limit(MAX_ROWS)

  const missingCount = count ?? 0
  const rows = (data ?? []).map((row: any) => ({
    department: row.dept_name ?? row.dept_code ?? 'Unknown',
    code: row.dept_code ?? '—',
  }))

  return {
    success: true,
    tool: 'departmentsMissingManager',
    summary: `${missingCount} department(s) tiada manager`,
    rows,
    totalCount: missingCount,
    truncated: missingCount > MAX_ROWS,
    deepLink: '/hr/settings/departments',
  }
}

// ─── Tool: List Departments ────────────────────────────────────────

async function listDepartments(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const { data, count } = await supabase
    .from('departments')
    .select('id, dept_name, dept_code, manager_user_id, users!departments_manager_user_id_fkey(full_name)', { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('dept_name')
    .limit(MAX_ROWS)

  const rows = (data ?? []).map((row: any) => ({
    department: row.dept_name ?? row.dept_code,
    code: row.dept_code ?? '—',
    manager: (row.users as any)?.full_name ?? 'Tiada',
  }))

  return {
    success: true,
    tool: 'listDepartments',
    summary: `${count ?? 0} active department(s)`,
    rows,
    totalCount: count ?? 0,
  }
}

// ─── Tool: List Positions ──────────────────────────────────────────

async function listPositions(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const { data, count } = await supabase
    .from('hr_positions')
    .select('id, title, department_id, departments(dept_name)', { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('title')
    .limit(MAX_ROWS)

  const rows = (data ?? []).map((row: any) => ({
    position: row.title ?? 'Untitled',
    department: row.departments?.dept_name ?? '—',
  }))

  return {
    success: true,
    tool: 'listPositions',
    summary: `${count ?? 0} active position(s)`,
    rows,
    totalCount: count ?? 0,
  }
}

// ─── Tool: Org Summary ─────────────────────────────────────────────

async function orgSummary(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const [empRes, deptRes, posRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
    supabase.from('departments').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
    supabase.from('hr_positions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
  ])

  const employees = empRes.count ?? 0
  const departments = deptRes.count ?? 0
  const positions = posRes.count ?? 0

  return {
    success: true,
    tool: 'orgSummary',
    summary: `${employees} employee(s), ${departments} department(s), ${positions} position(s)`,
    rows: [{ metric: 'Employees', count: employees }, { metric: 'Departments', count: departments }, { metric: 'Positions', count: positions }],
    totalCount: employees,
  }
}

// ─── Tool: Payroll Setup Status ────────────────────────────────────

async function payrollSetupStatus(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const [salaryBands, allowances, deductions, glMappings, missingBank] = await Promise.all([
    supabase.from('hr_salary_bands').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('hr_allowance_types').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('hr_deduction_types').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('hr_gl_mappings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true).or('bank_account_number.is.null,bank_id.is.null'),
  ])

  const rows = [
    { item: 'Salary Bands', count: salaryBands.count ?? 0, status: (salaryBands.count ?? 0) > 0 ? 'OK' : 'Missing' },
    { item: 'Allowance Types', count: allowances.count ?? 0, status: (allowances.count ?? 0) > 0 ? 'OK' : 'Missing' },
    { item: 'Deduction Types', count: deductions.count ?? 0, status: (deductions.count ?? 0) > 0 ? 'OK' : 'Missing' },
    { item: 'GL Mappings', count: glMappings.count ?? 0, status: (glMappings.count ?? 0) > 0 ? 'OK' : 'Missing' },
    { item: 'Missing Bank Details', count: missingBank.count ?? 0, status: (missingBank.count ?? 0) === 0 ? 'OK' : 'Incomplete' },
  ]

  const configured = rows.filter((r) => r.status === 'OK').length
  return {
    success: true,
    tool: 'payrollSetupStatus',
    summary: `Payroll setup: ${configured}/${rows.length} items configured`,
    rows,
    totalCount: rows.length,
  }
}

// ─── Tool: Salary Info (gated) ─────────────────────────────────────

async function salaryInfo(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const { data, count } = await supabase
    .from('hr_employee_compensation')
    .select('employee_id, basic_salary, users!inner(full_name, organization_id)', { count: 'exact' })
    .eq('users.organization_id', orgId)
    .order('basic_salary', { ascending: false })
    .limit(MAX_ROWS)

  const rows = (data ?? []).map((row: any) => ({
    name: row.users?.full_name ?? 'Unknown',
    basicSalary: row.basic_salary ?? 0,
  }))

  return {
    success: true,
    tool: 'salaryInfo',
    summary: `${count ?? 0} employee(s) with compensation records`,
    rows,
    totalCount: count ?? 0,
    truncated: (count ?? 0) > MAX_ROWS,
  }
}

// ─── Tool: Leave Types Summary ─────────────────────────────────────

async function leaveTypesSummary(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const { data, count } = await supabase
    .from('hr_leave_types')
    .select('id, name, annual_entitlement, is_paid, requires_approval', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('name')
    .limit(MAX_ROWS)

  const rows = (data ?? []).map((row: any) => ({
    type: row.name ?? 'Unnamed',
    entitlement: row.annual_entitlement ?? 0,
    paid: row.is_paid ? 'Yes' : 'No',
    approval: row.requires_approval ? 'Yes' : 'No',
  }))

  return {
    success: true,
    tool: 'leaveTypesSummary',
    summary: `${count ?? 0} leave type(s) configured`,
    rows,
    totalCount: count ?? 0,
  }
}

// ─── Tool: Attendance Summary ──────────────────────────────────────

async function attendanceSummary(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const [policies, shifts, overtime] = await Promise.all([
    supabase.from('hr_attendance_policies').select('id, name', { count: 'exact' }).eq('organization_id', orgId),
    supabase.from('hr_shifts').select('id, name', { count: 'exact' }).eq('organization_id', orgId),
    supabase.from('hr_overtime_policies').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  const rows = [
    { item: 'Attendance Policies', count: policies.count ?? 0 },
    { item: 'Work Shifts', count: shifts.count ?? 0 },
    { item: 'Overtime Policies', count: overtime.count ?? 0 },
  ]

  const configured = rows.filter((r) => r.count > 0).length
  return {
    success: true,
    tool: 'attendanceSummary',
    summary: `Attendance setup: ${configured}/${rows.length} items configured`,
    rows,
    totalCount: rows.length,
  }
}

// ─── Tool: HR Config Audit (wrapper) ───────────────────────────────

/** Mapping from audit issue keywords to the settings page where user can fix it */
const AUDIT_FIX_LINKS: Record<string, { link: string; label: string }> = {
  'hr settings': { link: '/hr/settings/configuration', label: 'HR Configuration' },
  'hr_settings': { link: '/hr/settings/configuration', label: 'HR Configuration' },
  timezone: { link: '/hr/settings/configuration', label: 'HR Configuration' },
  currency: { link: '/hr/settings/configuration', label: 'HR Configuration' },
  payroll_currency: { link: '/hr/settings/configuration', label: 'HR Configuration' },
  work_week: { link: '/hr/settings/configuration', label: 'HR Configuration' },
  workday: { link: '/hr/settings/configuration', label: 'HR Configuration' },
  shift: { link: '/hr/attendance/clock-in-out', label: 'Attendance Settings' },
  overtime: { link: '/hr/attendance/clock-in-out', label: 'Attendance Settings' },
  leave_type: { link: '/hr/leave/types', label: 'Leave Types' },
  leave: { link: '/hr/leave/types', label: 'Leave Types' },
  approval: { link: '/hr/leave/approval-flow', label: 'Approval Flow' },
  salary: { link: '/hr/payroll/salary-structure', label: 'Salary Structure' },
  salary_band: { link: '/hr/payroll/salary-structure', label: 'Salary Structure' },
  allowance: { link: '/hr/payroll/allowances-deductions', label: 'Allowances & Deductions' },
  deduction: { link: '/hr/payroll/allowances-deductions', label: 'Allowances & Deductions' },
  department: { link: '/hr/settings/departments', label: 'Departments' },
  position: { link: '/hr/settings/positions', label: 'Positions' },
  manager: { link: '/hr/people/employees', label: 'Employee Management' },
  holiday: { link: '/hr/settings/configuration', label: 'Public Holidays' },
  gl: { link: '/hr/settings/accounting', label: 'GL Accounting' },
  bank: { link: '/hr/people/employees', label: 'Employee Details' },
}

function getFixLink(issueText: string): { link: string; label: string } | null {
  const lower = issueText.toLowerCase()
  for (const [keyword, linkInfo] of Object.entries(AUDIT_FIX_LINKS)) {
    if (lower.includes(keyword)) return linkInfo
  }
  return null
}

async function hrConfigAuditTool(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const { runHrAudit, buildAuditContextForAi } = await import('@/lib/ai/hrAudit')
  const audit = await runHrAudit(supabase, orgId)
  const context = buildAuditContextForAi(audit)

  const criticalIssues = (context.criticalIssues as string[]) ?? []
  const summary = `HR Audit: ${audit.summary.configured}/${audit.summary.total} configured. ${criticalIssues.length} critical issue(s).`

  const rows = criticalIssues.map((issue: string) => {
    const fixInfo = getFixLink(issue)
    return {
      issue,
      status: 'Missing',
      settingsLink: fixInfo?.link ?? null,
      settingsLabel: fixInfo?.label ?? null,
    }
  })

  return {
    success: true,
    tool: 'hrConfigAudit',
    summary,
    rows,
    totalCount: audit.summary.total,
    deepLink: '/hr/settings/configuration',
  }
}

// ─── Tool: Leave Balance ───────────────────────────────────────────

async function leaveBalance(
  supabase: SupabaseClient,
  orgId: string,
  viewer: Viewer,
): Promise<ToolResult> {
  // If employee role, show only their own balance
  // If HR/Manager, show all or specific employee
  const isHr = viewer.hrRole === 'SUPER_ADMIN' || viewer.hrRole === 'HR_MANAGER' || viewer.hrRole === 'HR_STAFF'
  const currentYear = new Date().getFullYear()

  let query = supabase
    .from('hr_leave_balances')
    .select(`
      id, employee_id, year, entitled, taken, pending, carried_forward, adjustment,
      users!hr_leave_balances_employee_id_fkey(full_name),
      hr_leave_types!hr_leave_balances_leave_type_id_fkey(name, code)
    `)
    .eq('organization_id', orgId)
    .eq('year', currentYear)
    .order('employee_id')
    .limit(MAX_ROWS)

  if (!isHr) {
    query = query.eq('employee_id', viewer.userId)
  }

  const { data, count, error } = await query

  if (error) {
    return {
      success: true,
      tool: 'leaveBalance',
      summary: 'Baki cuti belum di-setup lagi. Sila setup leave types dan leave balance dahulu.',
      rows: [],
      deepLink: '/hr/leave/types',
    }
  }

  const rows = (data ?? []).map((row: any) => {
    const entitled = Number(row.entitled ?? 0)
    const taken = Number(row.taken ?? 0)
    const pending = Number(row.pending ?? 0)
    const cf = Number(row.carried_forward ?? 0)
    const adj = Number(row.adjustment ?? 0)
    const remaining = entitled + cf + adj - taken - pending

    return {
      name: row.users?.full_name ?? 'Unknown',
      leaveType: row.hr_leave_types?.name ?? row.hr_leave_types?.code ?? '—',
      entitled,
      taken,
      pending,
      remaining,
    }
  })

  const uniqueNames = new Set(rows.map((r: any) => r.name))
  const summaryText = isHr
    ? `Baki cuti ${currentYear} untuk ${uniqueNames.size} pekerja`
    : `Baki cuti anda tahun ${currentYear}`

  return {
    success: true,
    tool: 'leaveBalance',
    summary: summaryText,
    rows,
    totalCount: rows.length,
    deepLink: isHr ? '/hr/leave/requests' : '/hr/mobile/leave',
  }
}

// ─── Tool: My Leave Requests ───────────────────────────────────────

async function myLeaveRequests(
  supabase: SupabaseClient,
  orgId: string,
  viewer: Viewer,
): Promise<ToolResult> {
  const isHr = viewer.hrRole === 'SUPER_ADMIN' || viewer.hrRole === 'HR_MANAGER' || viewer.hrRole === 'HR_STAFF'

  let query = supabase
    .from('hr_leave_requests')
    .select(`
      id, start_date, end_date, total_days, status, reason, is_half_day,
      users!hr_leave_requests_employee_id_fkey(full_name),
      hr_leave_types!hr_leave_requests_leave_type_id_fkey(name)
    `)
    .eq('organization_id', orgId)
    .order('start_date', { ascending: false })
    .limit(20)

  if (!isHr) {
    query = query.eq('employee_id', viewer.userId)
  }

  const { data, error } = await query

  if (error || !data?.length) {
    return {
      success: true,
      tool: 'myLeaveRequests',
      summary: isHr ? 'Tiada permohonan cuti dijumpai.' : 'Anda belum ada permohonan cuti.',
      rows: [],
      deepLink: isHr ? '/hr/leave/requests' : '/hr/mobile/leave',
    }
  }

  const rows = data.map((row: any) => ({
    name: row.users?.full_name ?? 'N/A',
    type: row.hr_leave_types?.name ?? '—',
    from: row.start_date,
    to: row.end_date,
    days: row.total_days,
    status: row.status,
    halfDay: row.is_half_day ? 'Ya' : '—',
  }))

  const pendingCount = rows.filter((r: any) => r.status === 'pending').length
  const summaryText = isHr
    ? `${rows.length} permohonan cuti (${pendingCount} pending)`
    : `Anda ada ${rows.length} permohonan cuti (${pendingCount} pending)`

  return {
    success: true,
    tool: 'myLeaveRequests',
    summary: summaryText,
    rows,
    totalCount: rows.length,
    deepLink: isHr ? '/hr/leave/requests' : '/hr/mobile/leave',
  }
}

// ─── Tool: Public Holidays ─────────────────────────────────────────

async function publicHolidaysTool(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  const today = new Date().toISOString().split('T')[0]

  const { data, count } = await supabase
    .from('hr_public_holidays')
    .select('id, name, date, is_recurring, state', { count: 'exact' })
    .eq('organization_id', orgId)
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(MAX_ROWS)

  if (!data?.length) {
    return {
      success: true,
      tool: 'publicHolidays',
      summary: 'Tiada cuti umum dijumpai. Sila tambah cuti umum di settings.',
      rows: [],
      deepLink: '/hr/settings/configuration',
    }
  }

  const rows = data.map((row: any) => ({
    holiday: row.name,
    date: row.date,
    state: row.state ?? 'Kebangsaan',
    recurring: row.is_recurring ? 'Ya' : 'Tidak',
  }))

  return {
    success: true,
    tool: 'publicHolidays',
    summary: `${count ?? 0} cuti umum akan datang`,
    rows,
    totalCount: count ?? 0,
    deepLink: '/hr/settings/configuration',
  }
}

// ─── Tool: Payroll Date Info ───────────────────────────────────────

async function payrollDateInfo(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ToolResult> {
  // Get latest payroll run
  const { data: latestRun } = await supabase
    .from('hr_payroll_runs')
    .select('id, period_start, period_end, payroll_date, status, total_gross, total_net, calculated_at')
    .eq('organization_id', orgId)
    .order('period_end', { ascending: false })
    .limit(5)

  // Get hr_settings for payroll config
  const { data: settings } = await supabase
    .from('hr_settings')
    .select('config')
    .eq('organization_id', orgId)
    .maybeSingle()

  const config = (settings?.config ?? {}) as Record<string, any>
  const payDay = config.pay_day ?? config.payroll_pay_day ?? null

  if (!latestRun?.length) {
    const summaryLines = ['Belum ada payroll run diproses.']
    if (payDay) {
      summaryLines.push(`Ikut setting, gaji akan masuk pada hari ke-${payDay} setiap bulan.`)
    } else {
      summaryLines.push('Pay day belum di-set dalam HR settings.')
    }
    return {
      success: true,
      tool: 'payrollDateInfo',
      summary: summaryLines.join(' '),
      rows: [],
      deepLink: '/hr/payroll/salary-structure',
    }
  }

  const rows = latestRun.map((run: any) => ({
    period: `${run.period_start} - ${run.period_end}`,
    payrollDate: run.payroll_date ?? '—',
    status: run.status,
    totalNet: run.total_net ? `RM ${Number(run.total_net).toLocaleString()}` : '—',
  }))

  const latest = latestRun[0]
  let summary = `Payroll terkini: ${latest.period_start} - ${latest.period_end} (${latest.status})`
  if (payDay) {
    summary += `. Gaji biasanya masuk pada hari ke-${payDay} setiap bulan.`
  }

  return {
    success: true,
    tool: 'payrollDateInfo',
    summary,
    rows,
    totalCount: rows.length,
    deepLink: '/hr/payroll/payslips',
  }
}

// ─── Tool: Employee Search ─────────────────────────────────────────

async function employeeSearch(
  supabase: SupabaseClient,
  orgId: string,
  _viewer: Viewer,
  searchQuery?: string,
): Promise<ToolResult> {
  const q = searchQuery?.trim()
  if (!q) {
    return {
      success: true,
      tool: 'employeeSearch',
      summary: 'Sila nyatakan nama pekerja yang ingin dicari.',
      rows: [],
    }
  }

  const { data, count } = await supabase
    .from('users')
    .select(`
      id, full_name, email, phone,
      departments(dept_name),
      hr_positions(title)
    `, { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .ilike('full_name', `%${q}%`)
    .order('full_name')
    .limit(10)

  const rows = (data ?? []).map((row: any) => ({
    name: row.full_name ?? row.email,
    department: row.departments?.dept_name ?? '—',
    position: (row.hr_positions as any)?.title ?? '—',
    email: row.email ?? '—',
  }))

  return {
    success: true,
    tool: 'employeeSearch',
    summary: `${count ?? 0} pekerja dijumpai untuk "${q}"`,
    rows,
    totalCount: count ?? 0,
    deepLink: '/hr/people/employees',
  }
}

// ─── Tool: Apply Leave Info ────────────────────────────────────────

async function applyLeaveInfo(
  supabase: SupabaseClient,
  orgId: string,
  viewer: Viewer,
): Promise<ToolResult> {
  // Get current user's leave balance and available types
  const currentYear = new Date().getFullYear()

  const [balanceRes, typesRes] = await Promise.all([
    supabase
      .from('hr_leave_balances')
      .select(`
        entitled, taken, pending, carried_forward, adjustment,
        hr_leave_types!hr_leave_balances_leave_type_id_fkey(name, code)
      `)
      .eq('organization_id', orgId)
      .eq('employee_id', viewer.userId)
      .eq('year', currentYear),
    supabase
      .from('hr_leave_types')
      .select('id, name, code, is_paid_leave, requires_approval, min_notice_days')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .order('name'),
  ])

  const balances = (balanceRes.data ?? []).map((b: any) => {
    const entitled = Number(b.entitled ?? 0)
    const taken = Number(b.taken ?? 0)
    const pending = Number(b.pending ?? 0)
    const cf = Number(b.carried_forward ?? 0)
    const adj = Number(b.adjustment ?? 0)
    return {
      type: b.hr_leave_types?.name ?? b.hr_leave_types?.code ?? '—',
      entitled,
      taken,
      remaining: entitled + cf + adj - taken - pending,
    }
  })

  const leaveTypes = (typesRes.data ?? []).map((t: any) => t.name).join(', ')

  let summary: string
  if (balances.length === 0) {
    summary = 'Baki cuti anda belum di-setup. Sila hubungi HR untuk setup leave balance.'
  } else {
    const availableTypes = balances.filter((b: any) => b.remaining > 0)
    summary = availableTypes.length > 0
      ? `Anda boleh mohon cuti. Baki tersedia: ${availableTypes.map((b: any) => `${b.type} (${b.remaining} hari)`).join(', ')}. Untuk mohon, pergi ke halaman cuti.`
      : 'Semua baki cuti anda sudah habis untuk tahun ini.'
  }

  if (leaveTypes) {
    summary += `\n\nJenis cuti yang tersedia: ${leaveTypes}`
  }

  return {
    success: true,
    tool: 'applyLeave',
    summary,
    rows: balances,
    totalCount: balances.length,
    deepLink: '/hr/mobile/leave',
  }
}
