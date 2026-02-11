/**
 * HR Configuration Readiness Audit
 *
 * Performs a comprehensive check of HR module configuration for an org.
 * All queries are read-only and scoped to the caller's organization.
 * This function NEVER exposes PII — only counts and status flags.
 */
import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'
import {
  type HrAuditResult,
  type AuditSection,
  type AuditCheck,
  type AuditStatus,
} from './types'

// ─── Helpers ───────────────────────────────────────────────────────

function status(ok: boolean, partial?: boolean): AuditStatus {
  if (ok) return 'configured'
  if (partial) return 'partial'
  return 'missing'
}

function sectionStatus(checks: AuditCheck[]): AuditStatus {
  const all = checks.length
  const configured = checks.filter((c) => c.status === 'configured').length
  if (configured === all) return 'configured'
  if (configured > 0) return 'partial'
  return 'missing'
}

async function safeCount(
  supabase: SupabaseClient,
  table: string,
  orgCol: string,
  orgId: string,
  extraFilter?: (q: any) => any,
): Promise<number> {
  try {
    let q = supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(orgCol, orgId)
    if (extraFilter) q = extraFilter(q)
    const { count } = await q
    return count ?? 0
  } catch {
    return 0
  }
}

// ─── Main Audit Function ───────────────────────────────────────────

export async function runHrAudit(
  supabase: SupabaseClient,
  orgId: string,
): Promise<HrAuditResult> {
  const sections: AuditSection[] = []

  // ──────────────────────────────────────────────────────────────────
  // 1. Company / Org Defaults
  // ──────────────────────────────────────────────────────────────────
  const companyChecks: AuditCheck[] = []

  // Check HR settings exist
  const { data: hrSettings } = await supabase
    .from('hr_settings')
    .select('organization_id, config')
    .eq('organization_id', orgId)
    .maybeSingle()

  const hasHrSettings = !!hrSettings?.config
  const config = (hrSettings?.config ?? {}) as Record<string, any>
  const hasTimezone = !!config.timezone
  const hasCurrency = !!config.payroll_currency || !!config.currency
  const hasWorkWeek = !!config.work_week || !!config.workdays

  companyChecks.push({
    key: 'hr_settings_exist',
    label: 'HR Settings record',
    status: status(hasHrSettings),
    detail: hasHrSettings ? 'HR settings configured' : 'No HR settings found for this organization',
    fix_key: 'create_hr_settings',
  })
  companyChecks.push({
    key: 'timezone',
    label: 'Timezone configured',
    status: status(hasTimezone),
    detail: hasTimezone ? `Timezone: ${config.timezone}` : 'No timezone set',
    fix_key: 'set_timezone',
  })
  companyChecks.push({
    key: 'payroll_currency',
    label: 'Payroll currency',
    status: status(hasCurrency),
    detail: hasCurrency ? `Currency: ${config.payroll_currency || config.currency}` : 'No payroll currency configured',
    fix_key: 'set_payroll_currency',
  })
  companyChecks.push({
    key: 'work_week',
    label: 'Work week / workdays',
    status: status(hasWorkWeek),
    detail: hasWorkWeek ? 'Work week defined' : 'No work week / workdays configuration',
    fix_key: 'set_work_week',
  })

  sections.push({
    key: 'company_defaults',
    label: 'Company Defaults',
    status: sectionStatus(companyChecks),
    checks: companyChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 2. Org Structure
  // ──────────────────────────────────────────────────────────────────
  const orgChecks: AuditCheck[] = []

  const deptCount = await safeCount(supabase, 'departments', 'organization_id', orgId, (q) =>
    q.eq('is_active', true),
  )
  orgChecks.push({
    key: 'departments',
    label: 'Departments defined',
    status: status(deptCount > 0),
    detail: deptCount > 0 ? `${deptCount} active department(s)` : 'No departments configured',
    fix_key: 'create_departments',
  })

  const positionCount = await safeCount(supabase, 'hr_positions', 'organization_id', orgId, (q) =>
    q.eq('is_active', true),
  )
  orgChecks.push({
    key: 'positions',
    label: 'Positions / Job Titles',
    status: status(positionCount > 0),
    detail: positionCount > 0 ? `${positionCount} active position(s)` : 'No positions / job titles configured',
    fix_key: 'create_default_positions',
  })

  // Employees
  const totalEmployees = await safeCount(supabase, 'users', 'organization_id', orgId, (q) =>
    q.eq('is_active', true),
  )

  // Employees missing manager
  const { count: missingManagerCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('manager_user_id', null)
  const missingManager = missingManagerCount ?? 0

  orgChecks.push({
    key: 'employee_managers',
    label: 'Employees with manager assigned',
    status: status(missingManager === 0, missingManager < totalEmployees),
    detail:
      missingManager === 0
        ? 'All employees have a manager assigned'
        : `${missingManager} of ${totalEmployees} employees missing manager`,
    fix_key: 'assign_missing_managers',
  })

  // Employees missing position
  const { count: missingPositionCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('position_id', null)
  const missingPosition = missingPositionCount ?? 0

  orgChecks.push({
    key: 'employee_positions',
    label: 'Employees with position assigned',
    status: status(missingPosition === 0, missingPosition < totalEmployees),
    detail:
      missingPosition === 0
        ? 'All employees have a position assigned'
        : `${missingPosition} of ${totalEmployees} employees missing position`,
    fix_key: 'assign_missing_positions',
  })

  // Employees missing department
  const { count: missingDeptCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('department_id', null)
  const missingDept = missingDeptCount ?? 0

  orgChecks.push({
    key: 'employee_departments',
    label: 'Employees with department assigned',
    status: status(missingDept === 0, missingDept < totalEmployees),
    detail:
      missingDept === 0
        ? 'All employees have a department assigned'
        : `${missingDept} of ${totalEmployees} employees missing department`,
  })

  // Org chart – check departments have a manager
  const { count: deptsWithoutManager } = await supabase
    .from('departments')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('manager_user_id', null)
  const noMgrDepts = deptsWithoutManager ?? 0

  orgChecks.push({
    key: 'dept_managers',
    label: 'Departments with manager assigned',
    status: status(noMgrDepts === 0 && deptCount > 0, deptCount > 0),
    detail:
      deptCount === 0
        ? 'No departments to check'
        : noMgrDepts === 0
          ? 'All departments have a manager'
          : `${noMgrDepts} department(s) missing manager`,
  })

  sections.push({
    key: 'org_structure',
    label: 'Organization Structure',
    status: sectionStatus(orgChecks),
    checks: orgChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 3. Attendance Setup
  // ──────────────────────────────────────────────────────────────────
  const attendanceChecks: AuditCheck[] = []

  const policyCount = await safeCount(supabase, 'hr_attendance_policies', 'organization_id', orgId)
  attendanceChecks.push({
    key: 'attendance_policy',
    label: 'Attendance policy defined',
    status: status(policyCount > 0),
    detail: policyCount > 0 ? `${policyCount} attendance policy/policies` : 'No attendance policy configured',
    fix_key: 'create_attendance_policy',
  })

  const shiftCount = await safeCount(supabase, 'hr_shifts', 'organization_id', orgId)
  attendanceChecks.push({
    key: 'shifts',
    label: 'Work shifts defined',
    status: status(shiftCount > 0),
    detail: shiftCount > 0 ? `${shiftCount} shift(s) defined` : 'No shifts configured',
    fix_key: 'create_default_shifts',
  })

  const otPolicyCount = await safeCount(supabase, 'hr_overtime_policies', 'organization_id', orgId)
  attendanceChecks.push({
    key: 'overtime_policy',
    label: 'Overtime policy',
    status: status(otPolicyCount > 0),
    detail: otPolicyCount > 0 ? 'Overtime policy configured' : 'No overtime policy set',
    fix_key: 'create_overtime_policy',
  })

  sections.push({
    key: 'attendance_setup',
    label: 'Attendance Setup',
    status: sectionStatus(attendanceChecks),
    checks: attendanceChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 4. Leave Setup
  // ──────────────────────────────────────────────────────────────────
  const leaveChecks: AuditCheck[] = []

  const leaveTypeCount = await safeCount(supabase, 'hr_leave_types', 'organization_id', orgId)
  leaveChecks.push({
    key: 'leave_types',
    label: 'Leave types defined',
    status: status(leaveTypeCount > 0),
    detail: leaveTypeCount > 0 ? `${leaveTypeCount} leave type(s)` : 'No leave types configured',
    fix_key: 'define_leave_types',
  })

  const approvalChainCount = await safeCount(supabase, 'hr_approval_chains', 'organization_id', orgId)
  leaveChecks.push({
    key: 'approval_flow',
    label: 'Leave approval flow configured',
    status: status(approvalChainCount > 0),
    detail: approvalChainCount > 0 ? `${approvalChainCount} approval chain(s)` : 'No leave approval flow configured',
    fix_key: 'define_leave_approval_flow',
  })

  // Check public holidays
  const holidayCount = await safeCount(supabase, 'hr_public_holidays', 'organization_id', orgId)
  leaveChecks.push({
    key: 'public_holidays',
    label: 'Public holidays defined',
    status: status(holidayCount > 0),
    detail: holidayCount > 0 ? `${holidayCount} public holiday(s)` : 'No public holidays configured',
    fix_key: 'add_public_holidays',
  })

  sections.push({
    key: 'leave_setup',
    label: 'Leave Management Setup',
    status: sectionStatus(leaveChecks),
    checks: leaveChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 5. Payroll Setup
  // ──────────────────────────────────────────────────────────────────
  const payrollChecks: AuditCheck[] = []

  const salaryBandCount = await safeCount(supabase, 'hr_salary_bands', 'organization_id', orgId)
  payrollChecks.push({
    key: 'salary_bands',
    label: 'Salary bands / structures',
    status: status(salaryBandCount > 0),
    detail: salaryBandCount > 0 ? `${salaryBandCount} salary band(s)` : 'No salary bands configured',
    fix_key: 'create_salary_bands',
  })

  const allowanceTypeCount = await safeCount(supabase, 'hr_allowance_types', 'organization_id', orgId)
  payrollChecks.push({
    key: 'allowance_types',
    label: 'Allowance types defined',
    status: status(allowanceTypeCount > 0),
    detail: allowanceTypeCount > 0 ? `${allowanceTypeCount} allowance type(s)` : 'No allowance types configured',
  })

  const deductionTypeCount = await safeCount(supabase, 'hr_deduction_types', 'organization_id', orgId)
  payrollChecks.push({
    key: 'deduction_types',
    label: 'Deduction types defined',
    status: status(deductionTypeCount > 0),
    detail: deductionTypeCount > 0 ? `${deductionTypeCount} deduction type(s)` : 'No deduction types configured',
  })

  // Employee compensation records
  const compensationCount = await safeCount(
    supabase,
    'hr_employee_compensation',
    'employee_id',
    orgId,
  ).catch(() => 0)

  // Use a different approach: count employees that have compensation via users table
  let empWithCompensation = 0
  try {
    const { count: compCount } = await supabase
      .from('hr_employee_compensation')
      .select('employee_id', { count: 'exact', head: true })
    empWithCompensation = compCount ?? 0
  } catch { /* table may not exist yet */ }

  // Employee bank details completeness
  const { count: missingBankCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .or('bank_account_number.is.null,bank_id.is.null')
  const missingBank = missingBankCount ?? 0

  payrollChecks.push({
    key: 'employee_bank_details',
    label: 'Employee bank details complete',
    status: status(missingBank === 0 && totalEmployees > 0, totalEmployees > 0 && missingBank < totalEmployees),
    detail:
      totalEmployees === 0
        ? 'No employees'
        : missingBank === 0
          ? 'All employees have bank details'
          : `${missingBank} of ${totalEmployees} employee(s) missing bank/account details`,
    fix_key: 'request_employee_bank_details',
  })

  // GL Mapping
  const glMappingCount = await safeCount(supabase, 'hr_gl_mappings', 'organization_id', orgId)
  payrollChecks.push({
    key: 'gl_mapping',
    label: 'GL account mapping (payroll)',
    status: status(glMappingCount > 0),
    detail: glMappingCount > 0 ? `${glMappingCount} GL mapping(s)` : 'No GL account mappings for payroll',
    fix_key: 'configure_gl_mappings',
  })

  sections.push({
    key: 'payroll_setup',
    label: 'Payroll Setup',
    status: sectionStatus(payrollChecks),
    checks: payrollChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 6. Security & Roles
  // ──────────────────────────────────────────────────────────────────
  const securityChecks: AuditCheck[] = []

  // Check for HR-related access groups
  const accessGroupCount = await safeCount(supabase, 'hr_access_groups', 'organization_id', orgId)
  securityChecks.push({
    key: 'access_groups',
    label: 'HR access groups defined',
    status: status(accessGroupCount > 0),
    detail: accessGroupCount > 0 ? `${accessGroupCount} HR access group(s)` : 'No HR access groups configured',
  })

  // Check for HR admin user (role_level <= 20 or HR_MANAGER role)
  const { count: hrAdminCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .eq('role_code', 'HR_MANAGER')
  const hrAdmins = hrAdminCount ?? 0

  const { count: superAdminCount } = await supabase
    .from('users')
    .select('id, roles!inner(role_level)', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .lte('roles.role_level', 20)
  const superAdmins = superAdminCount ?? 0

  securityChecks.push({
    key: 'hr_admin_exists',
    label: 'HR Admin / Manager role assigned',
    status: status(hrAdmins > 0 || superAdmins > 0),
    detail:
      hrAdmins > 0 || superAdmins > 0
        ? `${hrAdmins} HR Manager(s), ${superAdmins} Super Admin(s)`
        : 'No HR Manager or Super Admin found',
  })

  // Check delegation rules
  const delegationCount = await safeCount(supabase, 'hr_delegation_rules', 'delegator_id', orgId).catch(() => 0)

  sections.push({
    key: 'security_roles',
    label: 'Security & Roles',
    status: sectionStatus(securityChecks),
    checks: securityChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 7. Benefits Setup (bonus section)
  // ──────────────────────────────────────────────────────────────────
  const benefitChecks: AuditCheck[] = []

  const benefitPlanCount = await safeCount(supabase, 'hr_benefit_plans', 'id', orgId).catch(() => 0)
  // benefit plans may not be org-scoped directly – try provider
  const benefitProviderCount = await safeCount(supabase, 'hr_benefit_providers', 'organization_id', orgId)

  benefitChecks.push({
    key: 'benefit_providers',
    label: 'Benefit providers configured',
    status: status(benefitProviderCount > 0),
    detail: benefitProviderCount > 0 ? `${benefitProviderCount} benefit provider(s)` : 'No benefit providers configured (optional)',
  })

  sections.push({
    key: 'benefits_setup',
    label: 'Benefits Setup (Optional)',
    status: sectionStatus(benefitChecks),
    checks: benefitChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // 8. Onboarding (bonus section)
  // ──────────────────────────────────────────────────────────────────
  const onboardingChecks: AuditCheck[] = []

  let onboardingTemplateCount = 0
  try {
    const { count } = await supabase
      .from('hr_onboarding_templates')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    onboardingTemplateCount = count ?? 0
  } catch { /* table may not exist */ }

  onboardingChecks.push({
    key: 'onboarding_templates',
    label: 'Onboarding templates',
    status: status(onboardingTemplateCount > 0),
    detail: onboardingTemplateCount > 0 ? `${onboardingTemplateCount} active template(s)` : 'No onboarding templates (optional)',
  })

  sections.push({
    key: 'onboarding',
    label: 'Onboarding (Optional)',
    status: sectionStatus(onboardingChecks),
    checks: onboardingChecks,
  })

  // ──────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────
  const allChecks = sections.flatMap((s) => s.checks)
  const summary = {
    total: allChecks.length,
    configured: allChecks.filter((c) => c.status === 'configured').length,
    partial: allChecks.filter((c) => c.status === 'partial').length,
    missing: allChecks.filter((c) => c.status === 'missing').length,
  }

  return {
    orgId,
    generatedAt: new Date().toISOString(),
    summary,
    sections,
  }
}

/**
 * Build a compact context payload from audit results for AI consumption.
 * Never includes PII — only counts and status flags.
 */
export function buildAuditContextForAi(audit: HrAuditResult): Record<string, any> {
  const context: Record<string, any> = {
    orgId: audit.orgId,
    generatedAt: audit.generatedAt,
    overallScore: `${audit.summary.configured}/${audit.summary.total} configured`,
    missingCount: audit.summary.missing,
    partialCount: audit.summary.partial,
    sections: audit.sections.map((s) => ({
      label: s.label,
      status: s.status,
      issues: s.checks
        .filter((c) => c.status !== 'configured')
        .map((c) => ({
          label: c.label,
          status: c.status,
          detail: c.detail,
          fix_key: c.fix_key,
        })),
    })),
    criticalIssues: audit.sections
      .flatMap((s) => s.checks)
      .filter((c) => c.status === 'missing')
      .map((c) => c.label),
  }
  return context
}
