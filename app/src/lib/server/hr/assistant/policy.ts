/**
 * HR Assistant — Data Access Policy & RBAC
 *
 * Defines field sensitivity levels, role permissions, and
 * row-level access rules. All tool outputs must pass through
 * the sanitizer before being returned to users.
 */
import 'server-only'

// ─── Data Sensitivity Levels ───────────────────────────────────────

export type Sensitivity = 'public' | 'internal' | 'sensitive' | 'highly_sensitive'

/** Field → sensitivity mapping for employee data */
export const FIELD_SENSITIVITY: Record<string, Sensitivity> = {
  // Public / Internal — safe to show any org member
  full_name: 'public',
  employee_code: 'public',
  email: 'internal',
  work_email: 'internal',
  department_name: 'public',
  dept_name: 'public',
  position_title: 'public',
  position_name: 'public',
  manager_name: 'public',
  status: 'public',
  is_active: 'public',
  hire_date: 'internal',
  employment_type: 'internal',
  role_code: 'internal',

  // Sensitive — HR_STAFF+ only
  phone: 'sensitive',
  mobile_phone: 'sensitive',
  date_of_birth: 'sensitive',
  home_address: 'sensitive',
  address: 'sensitive',
  emergency_contact: 'sensitive',

  // Highly Sensitive — HR_MANAGER+ only
  salary: 'highly_sensitive',
  basic_salary: 'highly_sensitive',
  gross_salary: 'highly_sensitive',
  net_salary: 'highly_sensitive',
  salary_amount: 'highly_sensitive',
  bank_account_number: 'highly_sensitive',
  bank_id: 'highly_sensitive',
  bank_name: 'highly_sensitive',
  ic_number: 'highly_sensitive',
  nric: 'highly_sensitive',
  tax_id: 'highly_sensitive',
  epf_number: 'highly_sensitive',
  socso_number: 'highly_sensitive',
  eis_number: 'highly_sensitive',
  payslip: 'highly_sensitive',
}

// ─── HR Role Hierarchy ─────────────────────────────────────────────

export type HrRole = 'SUPER_ADMIN' | 'HR_MANAGER' | 'HR_STAFF' | 'MANAGER' | 'EMPLOYEE'

/** Minimum sensitivity level each role can access */
const ROLE_ACCESS: Record<HrRole, Sensitivity[]> = {
  SUPER_ADMIN: ['public', 'internal', 'sensitive', 'highly_sensitive'],
  HR_MANAGER: ['public', 'internal', 'sensitive', 'highly_sensitive'],
  HR_STAFF: ['public', 'internal', 'sensitive'],
  MANAGER: ['public', 'internal'],
  EMPLOYEE: ['public'],
}

// ─── Viewer Context ────────────────────────────────────────────────

export interface Viewer {
  userId: string
  orgId: string
  roles: string[]
  hrRole: HrRole
  locale: 'ms' | 'en'
}

/** Map DB role data to our HrRole hierarchy */
export function resolveHrRole(
  roleCode: string | null,
  roleLevel: number | null,
): HrRole {
  // Super Admin: role_level <= 10
  if (roleLevel !== null && roleLevel <= 10) return 'SUPER_ADMIN'
  // HR Manager: explicit code or admin level
  if (roleCode === 'HR_MANAGER' || (roleLevel !== null && roleLevel <= 20)) return 'HR_MANAGER'
  // HR Staff
  if (roleCode === 'HR_STAFF') return 'HR_STAFF'
  // Manager: role_level <= 50 or explicit
  if (roleCode === 'MANAGER' || (roleLevel !== null && roleLevel <= 50)) return 'MANAGER'
  // Default
  return 'EMPLOYEE'
}

// ─── Permission Checks ─────────────────────────────────────────────

/** Can this viewer access fields of the given sensitivity? */
export function canAccessSensitivity(viewer: Viewer, level: Sensitivity): boolean {
  return ROLE_ACCESS[viewer.hrRole].includes(level)
}

/** Can this viewer see salary data? */
export function canViewSalary(viewer: Viewer): boolean {
  return canAccessSensitivity(viewer, 'highly_sensitive')
}

/** Can this viewer see a specific field? */
export function canViewField(viewer: Viewer, fieldName: string): boolean {
  const sensitivity = FIELD_SENSITIVITY[fieldName] ?? 'internal'
  return canAccessSensitivity(viewer, sensitivity)
}

// ─── Row Sanitizer ─────────────────────────────────────────────────

/**
 * Strip fields the viewer is not allowed to see.
 * Returns a new object with only permitted fields.
 */
export function sanitizeRow<T extends Record<string, any>>(
  viewer: Viewer,
  row: T,
  fieldMap?: Record<string, Sensitivity>,
): Partial<T> {
  const map = fieldMap ?? FIELD_SENSITIVITY
  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(row)) {
    const sensitivity = map[key] ?? 'internal'
    if (canAccessSensitivity(viewer, sensitivity)) {
      result[key] = value
    }
  }

  return result as Partial<T>
}

/** Sanitize an array of rows */
export function sanitizeRows<T extends Record<string, any>>(
  viewer: Viewer,
  rows: T[],
  fieldMap?: Record<string, Sensitivity>,
): Partial<T>[] {
  return rows.map((row) => sanitizeRow(viewer, row, fieldMap))
}

// ─── Refusal Messages ──────────────────────────────────────────────

export function getSensitivityRefusal(
  viewer: Viewer,
  topic: string,
): string {
  const lang = viewer.locale

  if (lang === 'ms') {
    switch (topic) {
      case 'salary':
        return 'Maaf, maklumat gaji hanya boleh diakses oleh HR Manager. Anda boleh tanya tentang "status setup payroll" sebagai alternatif.'
      case 'bank':
        return 'Maaf, maklumat bank pekerja hanya boleh diakses oleh HR Manager.'
      case 'personal':
        return 'Maaf, maklumat peribadi hanya boleh diakses oleh pihak HR.'
      default:
        return 'Maaf, maklumat ini memerlukan kebenaran yang lebih tinggi.'
    }
  }

  switch (topic) {
    case 'salary':
      return 'Sorry, salary details are restricted to HR Managers. You can ask about "payroll setup status" as an alternative.'
    case 'bank':
      return 'Sorry, employee bank information is restricted to HR Managers.'
    case 'personal':
      return 'Sorry, personal details are restricted to HR staff.'
    default:
      return 'Sorry, this information requires higher permissions.'
  }
}
