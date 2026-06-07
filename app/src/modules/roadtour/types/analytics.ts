// RoadTour Post-Visit Impact Analytics — shared types.
// See docs/roadtourmodules/22-post-visit-impact-reporting-ui-implementation.md

export type ImpactWindow = number

export type ImpactStatus =
    | 'improved'
    | 'maintained'
    | 'dropped'
    | 'newly_activated'
    | 'no_response'

export type FollowUpPriority = 'high' | 'medium' | 'low' | 'healthy'

export interface VisitImpactRow {
    visit_id: string
    visit_date: string // ISO date
    campaign_id: string
    campaign_name: string
    account_manager_user_id: string
    account_manager_name: string
    shop_id: string
    shop_name: string
    shop_code: string | null
    shop_region: string | null
    before_scans: number
    after_scans: number
    scan_lift: number
    scan_lift_percent: number | null
    status: ImpactStatus
    days_since_visit: number
    first_scan_after_at: string | null
    last_scan_after_at: string | null
    daily_before: { day: number; count: number }[] // day offsets -window..-1
    daily_after: { day: number; count: number }[] // day offsets 1..+window
    notes: string | null
}

export interface ImpactSummary {
    visited_shops: number
    improved_shops: number
    maintained_shops: number
    dropped_shops: number
    newly_activated_shops: number
    no_response_shops: number
    total_before_scans: number
    total_after_scans: number
    avg_scan_lift_percent: number | null
    median_scan_lift_percent: number | null
    visit_to_scan_conversion: number // 0..1
}

export interface CampaignRef { id: string; name: string }
export interface AccountManagerRef { id: string; name: string }
export interface RegionRef { id: string; name: string }

export interface ImpactDataset {
    visits: VisitImpactRow[]
    summary: ImpactSummary
    campaigns: CampaignRef[]
    accountManagers: AccountManagerRef[]
    regions: RegionRef[]
    windowDays: ImpactWindow
    dateFrom: string | null
    dateTo: string | null
    missingDataNote: string | null
}

// ---------- classification helpers ----------

export function classifyImpactStatus(before: number, after: number): ImpactStatus {
    if (before === 0 && after === 0) return 'no_response'
    if (before === 0 && after > 0) return 'newly_activated'
    if (after === 0) return 'no_response'
    if (after > before) return 'improved'
    if (after < before) return 'dropped'
    return 'maintained'
}

export function computeScanLiftPercent(before: number, after: number): number | null {
    if (before > 0) return ((after - before) / before) * 100
    // before == 0
    if (after > 0) return null // newly activated; displayed separately
    return null
}

export function getLatestVisitRowsByShop(rows: VisitImpactRow[]): VisitImpactRow[] {
    const latestByShop = new Map<string, VisitImpactRow>()

    for (const row of rows) {
        const existing = latestByShop.get(row.shop_id)
        if (!existing || existing.visit_date < row.visit_date) {
            latestByShop.set(row.shop_id, row)
        }
    }

    return Array.from(latestByShop.values())
}

export function classifyFollowUpPriority(
    row: Pick<VisitImpactRow, 'before_scans' | 'after_scans' | 'days_since_visit' | 'status'>,
    windowDays = 7,
): FollowUpPriority {
    const { before_scans, after_scans, days_since_visit, status } = row
    const responseWindowDays = Math.max(1, Math.trunc(windowDays))
    const mediumWindowStart = Math.min(3, responseWindowDays)

    // High priority: no scan across the selected window OR drop > 50%
    if (after_scans === 0 && days_since_visit >= responseWindowDays) return 'high'
    if (before_scans > 0 && after_scans < before_scans && (before_scans - after_scans) / before_scans > 0.5) return 'high'
    // Medium: no scan in the early part of the selected window, low response after visit, or newly activated needing nurture
    if (after_scans === 0 && days_since_visit >= mediumWindowStart && days_since_visit < responseWindowDays) return 'medium'
    if (status === 'newly_activated') return 'medium'
    if (status === 'dropped') return 'medium'
    if (status === 'maintained' && after_scans <= 1) return 'medium'
    // Healthy = strong positive lift
    if (status === 'improved' && before_scans > 0) {
        const lift = (after_scans - before_scans) / before_scans
        if (lift >= 0.5) return 'healthy'
    }
    // Otherwise low
    return 'low'
}

export function recommendedAction(p: FollowUpPriority, status: ImpactStatus, days_since_visit: number): string {
    if (p === 'high' && status === 'no_response') return 'Immediate Visit'
    if (p === 'high') return 'Call & Re-engage'
    if (p === 'medium' && status === 'newly_activated') return 'Nurture Engagement'
    if (p === 'medium' && status === 'no_response') return 'Follow-up Within 48h'
    if (p === 'medium') return 'Call & Re-engage'
    if (p === 'low' && status === 'improved') return 'Praise & Upsell'
    if (p === 'low' && status === 'maintained') return 'Reinforce Engagement'
    if (p === 'healthy') return 'Praise & Upsell'
    return 'Monitor'
}

export function recommendedFollowUpDate(visitDateIso: string, p: FollowUpPriority): string {
    const d = new Date(visitDateIso + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const addDays = p === 'high' ? 0 : p === 'medium' ? 2 : p === 'healthy' ? 14 : 5
    const due = new Date(today)
    due.setDate(due.getDate() + addDays)
    return due.toISOString().slice(0, 10)
}

export function impactStatusLabel(s: ImpactStatus): string {
    switch (s) {
        case 'improved': return 'Improved'
        case 'maintained': return 'Maintained'
        case 'dropped': return 'Dropped'
        case 'newly_activated': return 'Newly Activated'
        case 'no_response': return 'No Response'
    }
}

export function priorityLabel(p: FollowUpPriority): string {
    switch (p) {
        case 'high': return 'High'
        case 'medium': return 'Medium'
        case 'low': return 'Low'
        case 'healthy': return 'Healthy'
    }
}
