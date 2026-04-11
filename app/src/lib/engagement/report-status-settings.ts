export type ReportStatusRuleMode = 'balance' | 'activity'
export type ReportStatusTarget = 'shopPerformance' | 'shopStaffPerformance' | 'consumerPerformance'

export interface ReportStatusRule {
  mode: ReportStatusRuleMode
  inactiveAfterDays: number
}

export interface ReportStatusSettings {
  shopPerformance: ReportStatusRule
  shopStaffPerformance: ReportStatusRule
  consumerPerformance: ReportStatusRule
}

const DEFAULT_RULE: ReportStatusRule = {
  mode: 'balance',
  inactiveAfterDays: 30,
}

export const DEFAULT_REPORT_STATUS_SETTINGS: ReportStatusSettings = {
  shopPerformance: { ...DEFAULT_RULE },
  shopStaffPerformance: { ...DEFAULT_RULE },
  consumerPerformance: { ...DEFAULT_RULE },
}

function normalizeRule(value: any): ReportStatusRule {
  const inactiveAfterDays = Number(value?.inactiveAfterDays)
  return {
    mode: value?.mode === 'activity' ? 'activity' : 'balance',
    inactiveAfterDays: Number.isFinite(inactiveAfterDays) && inactiveAfterDays > 0 ? inactiveAfterDays : 30,
  }
}

export function normalizeReportStatusSettings(rawSettings: any): ReportStatusSettings {
  const raw = rawSettings?.report_status_settings || rawSettings || {}
  return {
    shopPerformance: normalizeRule(raw.shopPerformance),
    shopStaffPerformance: normalizeRule(raw.shopStaffPerformance),
    consumerPerformance: normalizeRule(raw.consumerPerformance),
  }
}

export function isReportRowActive(
  balance: number | null | undefined,
  lastActivity: string | null | undefined,
  rule: ReportStatusRule,
  now = new Date()
): boolean {
  if (rule.mode === 'activity') {
    if (!lastActivity) return false
    const activityDate = new Date(lastActivity)
    if (Number.isNaN(activityDate.getTime())) return false
    const diffDays = (now.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24)
    return diffDays <= rule.inactiveAfterDays
  }

  return Number(balance || 0) > 0
}

export function describeReportStatusRule(rule: ReportStatusRule): string {
  if (rule.mode === 'activity') {
    return `Inactive after ${rule.inactiveAfterDays} day${rule.inactiveAfterDays === 1 ? '' : 's'} without activity`
  }
  return 'Inactive when balance is 0'
}
