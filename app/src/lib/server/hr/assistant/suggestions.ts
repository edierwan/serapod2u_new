/**
 * HR Assistant — Suggestion Generator
 *
 * After every response, generates contextual follow-up suggestions
 * (like Kodee chips) based on what the user just asked and their role.
 */
import 'server-only'

import { type Lang } from './intentRouter'
import { type ToolName } from './tools'
import { type HrRole } from './policy'

export interface Suggestion {
  label: string
  /** Intent to fire when tapped */
  intent: ToolName | 'general'
}

// ─── Suggestion Catalog ────────────────────────────────────────────

interface SuggestionEntry {
  intent: ToolName | 'general'
  en: string
  ms: string
  /** Minimum role required (lower roles won't see this) */
  minRole: HrRole
}

const ROLE_LEVEL: Record<HrRole, number> = {
  SUPER_ADMIN: 0,
  HR_MANAGER: 1,
  HR_STAFF: 2,
  MANAGER: 3,
  EMPLOYEE: 4,
}

function hasMinRole(viewer: HrRole, minRole: HrRole): boolean {
  return ROLE_LEVEL[viewer] <= ROLE_LEVEL[minRole]
}

const SUGGESTION_POOL: SuggestionEntry[] = [
  { intent: 'hrSetupGuidance', en: 'How to start setup?', ms: 'Macam mana nak mula setup?', minRole: 'HR_STAFF' },
  { intent: 'orgSummary', en: 'How many employees?', ms: 'Berapa ramai pekerja?', minRole: 'EMPLOYEE' },
  { intent: 'employeesMissingManager', en: 'Who has no manager?', ms: 'Siapa tiada manager?', minRole: 'MANAGER' },
  { intent: 'employeesMissingPosition', en: 'Missing positions?', ms: 'Siapa tiada jawatan?', minRole: 'MANAGER' },
  { intent: 'departmentsMissingManager', en: 'Departments without manager?', ms: 'Jabatan tanpa pengurus?', minRole: 'HR_STAFF' },
  { intent: 'listDepartments', en: 'List departments', ms: 'Senarai jabatan', minRole: 'EMPLOYEE' },
  { intent: 'listPositions', en: 'List positions', ms: 'Senarai jawatan', minRole: 'EMPLOYEE' },
  { intent: 'hrConfigAudit', en: 'Run HR audit', ms: 'Audit HR', minRole: 'HR_STAFF' },
  { intent: 'payrollSetupStatus', en: 'Payroll setup status', ms: 'Status setup payroll', minRole: 'HR_STAFF' },
  { intent: 'salaryInfo', en: 'Salary overview', ms: 'Ringkasan gaji', minRole: 'HR_MANAGER' },
  { intent: 'leaveTypesSummary', en: 'Leave types', ms: 'Jenis cuti', minRole: 'EMPLOYEE' },
  { intent: 'attendanceSummary', en: 'Attendance setup', ms: 'Setup kehadiran', minRole: 'HR_STAFF' },
  { intent: 'leaveBalance', en: 'My leave balance', ms: 'Baki cuti saya', minRole: 'EMPLOYEE' },
  { intent: 'myLeaveRequests', en: 'My leave requests', ms: 'Permohonan cuti saya', minRole: 'EMPLOYEE' },
  { intent: 'publicHolidays', en: 'Upcoming holidays', ms: 'Cuti umum akan datang', minRole: 'EMPLOYEE' },
  { intent: 'payrollDateInfo', en: 'When is payday?', ms: 'Bila gaji masuk?', minRole: 'EMPLOYEE' },
  { intent: 'applyLeave', en: 'Apply for leave', ms: 'Mohon cuti', minRole: 'EMPLOYEE' },
]

// ─── Follow-Up Map (what to suggest after each tool) ───────────────

const FOLLOW_UP: Partial<Record<ToolName | 'general' | 'casual', (ToolName | 'general')[]>> = {
  casual: ['leaveBalance', 'publicHolidays', 'orgSummary', 'hrSetupGuidance'],
  orgSummary: ['employeesMissingManager', 'employeesMissingPosition', 'listDepartments'],
  employeesMissingManager: ['employeesMissingPosition', 'departmentsMissingManager', 'orgSummary'],
  employeesMissingPosition: ['employeesMissingManager', 'listPositions', 'orgSummary'],
  departmentsMissingManager: ['listDepartments', 'employeesMissingManager', 'hrConfigAudit'],
  listDepartments: ['departmentsMissingManager', 'listPositions', 'orgSummary'],
  listPositions: ['employeesMissingPosition', 'listDepartments'],
  hrConfigAudit: ['hrSetupGuidance', 'payrollSetupStatus', 'attendanceSummary'],
  hrSetupGuidance: ['hrConfigAudit', 'leaveTypesSummary', 'payrollSetupStatus', 'orgSummary'],
  payrollSetupStatus: ['salaryInfo', 'hrConfigAudit', 'payrollDateInfo'],
  salaryInfo: ['payrollSetupStatus', 'payrollDateInfo', 'orgSummary'],
  leaveTypesSummary: ['leaveBalance', 'publicHolidays', 'applyLeave'],
  attendanceSummary: ['leaveTypesSummary', 'hrConfigAudit'],
  leaveBalance: ['applyLeave', 'myLeaveRequests', 'publicHolidays', 'leaveTypesSummary'],
  myLeaveRequests: ['leaveBalance', 'applyLeave', 'publicHolidays'],
  publicHolidays: ['leaveBalance', 'applyLeave', 'leaveTypesSummary'],
  payrollDateInfo: ['payrollSetupStatus', 'salaryInfo', 'leaveBalance'],
  applyLeave: ['leaveBalance', 'myLeaveRequests', 'publicHolidays'],
  employeeSearch: ['orgSummary', 'employeesMissingManager', 'listDepartments'],
  general: ['hrSetupGuidance', 'leaveBalance', 'publicHolidays', 'orgSummary'],
}

// ─── Generator ─────────────────────────────────────────────────────

/**
 * Generate 2-4 follow-up suggestion chips after a response.
 */
export function generateSuggestions(
  lastIntent: ToolName | 'general' | 'casual',
  hrRole: HrRole,
  lang: Lang,
  maxCount = 4,
): Suggestion[] {
  const followUps = FOLLOW_UP[lastIntent] ?? FOLLOW_UP.general!
  const catalogMap = new Map(SUGGESTION_POOL.map((s) => [s.intent, s]))

  const suggestions: Suggestion[] = []
  for (const intent of followUps) {
    if (suggestions.length >= maxCount) break
    const entry = catalogMap.get(intent)
    if (!entry) continue
    if (!hasMinRole(hrRole, entry.minRole)) continue

    suggestions.push({
      label: lang === 'ms' ? entry.ms : entry.en,
      intent: entry.intent,
    })
  }

  return suggestions
}

/**
 * Initial suggestions shown when the chat is first opened.
 */
export function getWelcomeSuggestions(
  hrRole: HrRole,
  lang: Lang,
): Suggestion[] {
  // Show the most commonly useful tools first
  const starters: (ToolName | 'general')[] = [
    'hrSetupGuidance',
    'leaveBalance',
    'publicHolidays',
    'payrollDateInfo',
    'orgSummary',
    'hrConfigAudit',
    'applyLeave',
  ]
  const catalogMap = new Map(SUGGESTION_POOL.map((s) => [s.intent, s]))

  const suggestions: Suggestion[] = []
  for (const intent of starters) {
    if (suggestions.length >= 4) break
    const entry = catalogMap.get(intent)
    if (!entry) continue
    if (!hasMinRole(hrRole, entry.minRole)) continue
    suggestions.push({
      label: lang === 'ms' ? entry.ms : entry.en,
      intent: entry.intent,
    })
  }

  return suggestions
}
