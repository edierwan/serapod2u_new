// The one place where RoadTour Reporting numbers are derived.
//
// Monthly Overview, AM Performance, Shop Follow-Up and the shop drill-down all
// read from `buildShopEntries()`, so a shop can never be classified one way on
// one page and another way on the next.

import {
    hasResponded,
    medianOf,
    type ShopOutcome,
} from './impactModel'
import {
    classifyFollowUpPriority,
    followUpDueDate,
    followUpState,
    isActionableFollowUp,
    recommendedAction,
    type FollowUpPriority,
    type FollowUpState,
    type RecommendedAction,
} from './followUp'
import { attributeShopVisits } from './attribution'
import type {
    RoadtourReportingDataset,
    RoadtourVisitReportRow,
} from './types'
import { UNASSIGNED_AM_LABEL } from './types'

/** An AM needs this many matured shops before a rate is allowed to rank them. */
export const MIN_MATURED_SAMPLE_FOR_RANKING = 3

export interface ShopReportEntry {
    shopId: string
    shopName: string
    shopNamePrimary: string
    shopBranchLabel: string | null
    shopCode: string | null
    region: string | null
    visitCount: number
    /** Latest visit of the month — ownership, current status, last visit date. */
    currentRow: RoadtourVisitReportRow
    /** Latest MATURED visit — the row credited with the shop's outcome. */
    attributedRow: RoadtourVisitReportRow | null
    outcome: ShopOutcome
    matured: boolean
    responded: boolean
    priority: FollowUpPriority
    action: RecommendedAction
    dueDate: string
    dueState: FollowUpState
    /** Account manager responsible now (from the latest visit). */
    ownerAmId: string | null
    ownerAmName: string | null
    /** Account manager the shop's outcome is credited to. */
    creditedAmId: string | null
    creditedAmName: string | null
}

export function buildShopEntries(
    rows: RoadtourVisitReportRow[],
    now: Date = new Date(),
): ShopReportEntry[] {
    const attribution = attributeShopVisits(rows)
    const entries: ShopReportEntry[] = []

    for (const shop of attribution.values()) {
        const current = shop.currentRow
        const attributed = shop.attributedRow
        const outcome: ShopOutcome = attributed ? attributed.outcome : 'pending_observation'
        const matured = attributed !== null

        const followUpInput = {
            outcome,
            matured,
            beforeScans: attributed?.before_scans ?? current.before_scans,
            afterScans: attributed?.after_scans ?? current.after_scans,
            hasAccountManager: Boolean(current.account_manager_user_id),
        }
        const priority = classifyFollowUpPriority(followUpInput)
        const dueDate = followUpDueDate((attributed ?? current).matures_at, priority)

        entries.push({
            shopId: shop.shopId,
            shopName: current.shop_name,
            shopNamePrimary: current.shop_name_primary,
            shopBranchLabel: current.shop_branch_label,
            shopCode: current.shop_code,
            region: current.shop_region,
            visitCount: shop.visitCount,
            currentRow: current,
            attributedRow: attributed,
            outcome,
            matured,
            responded: attributed ? hasResponded({ matured: true, afterScans: attributed.after_scans }) : false,
            priority,
            action: recommendedAction(followUpInput, priority),
            dueDate,
            dueState: followUpState(dueDate, now),
            ownerAmId: current.account_manager_user_id,
            ownerAmName: current.account_manager_name,
            creditedAmId: (attributed ?? current).account_manager_user_id,
            creditedAmName: (attributed ?? current).account_manager_name,
        })
    }

    return entries.sort((a, b) => a.shopName.localeCompare(b.shopName))
}

/** Overdue actionable follow-ups only — observing shops are never overdue. */
export function isOverdueFollowUp(entry: ShopReportEntry): boolean {
    return isActionableFollowUp(entry.priority) && entry.dueState === 'overdue'
}

export interface OverviewSummary {
    shopsVisited: number
    maturedShops: number
    respondingShops: number
    /** Matured responders ÷ matured shops. null when nothing has matured yet. */
    visitToScanConversion: number | null
    shopsRequiringFollowUp: number
    pendingObservationShops: number
    pendingObservationVisits: number
    totalVisits: number
    outcomeCounts: Record<ShopOutcome, number>
    medianScanLiftPercent: number | null
    unassignedVisits: number
    unassignedShops: number
}

export function buildOverviewSummary(
    entries: ShopReportEntry[],
    rows: RoadtourVisitReportRow[],
): OverviewSummary {
    const outcomeCounts: Record<ShopOutcome, number> = {
        improved: 0, newly_activated: 0, maintained: 0,
        dropped: 0, no_response: 0, pending_observation: 0,
    }
    for (const entry of entries) outcomeCounts[entry.outcome] += 1

    const maturedShops = entries.filter((entry) => entry.matured).length
    const respondingShops = entries.filter((entry) => entry.responded).length

    const requiringFollowUp = entries.filter((entry) => (
        (entry.matured && (entry.outcome === 'dropped' || entry.outcome === 'no_response'))
        || isOverdueFollowUp(entry)
    )).length

    const liftPercents = entries
        .map((entry) => entry.attributedRow?.scan_lift_percent)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    return {
        shopsVisited: entries.length,
        maturedShops,
        respondingShops,
        visitToScanConversion: maturedShops > 0 ? respondingShops / maturedShops : null,
        shopsRequiringFollowUp: requiringFollowUp,
        pendingObservationShops: outcomeCounts.pending_observation,
        pendingObservationVisits: rows.filter((row) => !row.matured).length,
        totalVisits: rows.length,
        outcomeCounts,
        medianScanLiftPercent: medianOf(liftPercents),
        unassignedVisits: rows.filter((row) => !row.account_manager_user_id).length,
        unassignedShops: entries.filter((entry) => !entry.ownerAmId).length,
    }
}

export interface AmPerformanceRow {
    amId: string
    amName: string
    shopsVisited: number
    maturedShops: number
    respondedShops: number
    noResponseShops: number
    improvedOrActivatedShops: number
    droppedShops: number
    followUpsOverdue: number
    /** Matured responders ÷ matured shops; null when the AM has no matured shop. */
    responseRate: number | null
    /** False when the matured sample is too small to rank on a rate. */
    hasRankableSample: boolean
    rank: number | null
}

export interface AmPerformanceResult {
    rows: AmPerformanceRow[]
    activeAms: number
    teamShopsVisited: number
    teamMaturedShops: number
    teamRespondedShops: number
    teamResponseRate: number | null
    teamFollowUpsOverdue: number
    /** Visits that could not be attributed to a real AM — an exception, not a row. */
    unassignedVisits: number
    unassignedShops: number
}

/**
 * Each shop counts exactly once, under the AM credited with its outcome (the
 * latest matured visit) or, while still observing, under the AM of the latest
 * visit. Shops with no resolvable AM never enter the leaderboard.
 */
export function buildAmPerformance(
    entries: ShopReportEntry[],
    rows: RoadtourVisitReportRow[],
): AmPerformanceResult {
    const byAm = new Map<string, AmPerformanceRow>()

    for (const entry of entries) {
        const amId = entry.creditedAmId
        if (!amId) continue

        const existing = byAm.get(amId) || {
            amId,
            amName: entry.creditedAmName || UNASSIGNED_AM_LABEL,
            shopsVisited: 0,
            maturedShops: 0,
            respondedShops: 0,
            noResponseShops: 0,
            improvedOrActivatedShops: 0,
            droppedShops: 0,
            followUpsOverdue: 0,
            responseRate: null,
            hasRankableSample: false,
            rank: null,
        }

        existing.shopsVisited += 1
        if (entry.matured) existing.maturedShops += 1
        if (entry.responded) existing.respondedShops += 1
        if (entry.outcome === 'no_response') existing.noResponseShops += 1
        if (entry.outcome === 'improved' || entry.outcome === 'newly_activated') existing.improvedOrActivatedShops += 1
        if (entry.outcome === 'dropped') existing.droppedShops += 1
        if (isOverdueFollowUp(entry)) existing.followUpsOverdue += 1

        byAm.set(amId, existing)
    }

    const amRows = Array.from(byAm.values()).map((row) => ({
        ...row,
        responseRate: row.maturedShops > 0 ? row.respondedShops / row.maturedShops : null,
        hasRankableSample: row.maturedShops >= MIN_MATURED_SAMPLE_FOR_RANKING,
    }))

    const ranked = amRows.filter((row) => row.hasRankableSample).sort(compareRankableAms)
    const unranked = amRows.filter((row) => !row.hasRankableSample).sort((a, b) => (
        b.maturedShops - a.maturedShops
        || b.shopsVisited - a.shopsVisited
        || a.amName.localeCompare(b.amName)
    ))

    ranked.forEach((row, index) => { row.rank = index + 1 })
    unranked.forEach((row) => { row.rank = null })

    const teamMaturedShops = entries.filter((entry) => entry.matured).length
    const teamRespondedShops = entries.filter((entry) => entry.responded).length

    return {
        rows: [...ranked, ...unranked],
        activeAms: amRows.length,
        teamShopsVisited: entries.length,
        teamMaturedShops,
        teamRespondedShops,
        teamResponseRate: teamMaturedShops > 0 ? teamRespondedShops / teamMaturedShops : null,
        teamFollowUpsOverdue: entries.filter(isOverdueFollowUp).length,
        unassignedVisits: rows.filter((row) => !row.account_manager_user_id).length,
        unassignedShops: entries.filter((entry) => !entry.ownerAmId).length,
    }
}

/**
 * Default ordering favours the 7D response rate but only among AMs with a
 * reasonable matured sample, so one lucky shop can never top the table.
 */
function compareRankableAms(a: AmPerformanceRow, b: AmPerformanceRow): number {
    const rateDelta = (b.responseRate ?? 0) - (a.responseRate ?? 0)
    if (Math.abs(rateDelta) > 1e-9) return rateDelta
    if (b.maturedShops !== a.maturedShops) return b.maturedShops - a.maturedShops
    if (b.improvedOrActivatedShops !== a.improvedOrActivatedShops) {
        return b.improvedOrActivatedShops - a.improvedOrActivatedShops
    }
    if (a.followUpsOverdue !== b.followUpsOverdue) return a.followUpsOverdue - b.followUpsOverdue
    return a.amName.localeCompare(b.amName)
}

/** Priority order used by the Shop Follow-Up queue. */
const PRIORITY_WEIGHT: Record<FollowUpPriority, number> = {
    high: 0, medium: 1, observing: 2, low: 3, healthy: 4,
}

export function sortFollowUpQueue(entries: ShopReportEntry[]): ShopReportEntry[] {
    return [...entries].sort((a, b) => {
        // Unassigned high-priority shops surface first: nobody owns them today.
        const aUnassignedHigh = a.priority === 'high' && !a.ownerAmId
        const bUnassignedHigh = b.priority === 'high' && !b.ownerAmId
        if (aUnassignedHigh !== bUnassignedHigh) return aUnassignedHigh ? -1 : 1

        const weightDelta = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        if (weightDelta !== 0) return weightDelta

        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
        return a.shopName.localeCompare(b.shopName)
    })
}

export interface FollowUpQueueSummary {
    highPriority: number
    dueToday: number
    overdue: number
    unassignedShops: number
}

export function buildFollowUpSummary(entries: ShopReportEntry[]): FollowUpQueueSummary {
    return {
        highPriority: entries.filter((entry) => entry.priority === 'high').length,
        dueToday: entries.filter((entry) => isActionableFollowUp(entry.priority) && entry.dueState === 'due_today').length,
        overdue: entries.filter(isOverdueFollowUp).length,
        unassignedShops: entries.filter((entry) => !entry.ownerAmId).length,
    }
}

/**
 * At most two short, fully derived sentences. No AI commentary, no hard-coded
 * numbers — every value here comes from the calculations above.
 */
export function buildManagementInsights(
    entries: ShopReportEntry[],
    summary: OverviewSummary,
    amPerformance: AmPerformanceResult,
): string[] {
    const insights: string[] = []
    const shops = (count: number) => `${count} ${count === 1 ? 'shop' : 'shops'}`
    const visits = (count: number) => `${count} ${count === 1 ? 'visit' : 'visits'}`

    if (summary.shopsRequiringFollowUp > 0) {
        const needsFollowUp = entries.filter((entry) => (
            (entry.matured && (entry.outcome === 'dropped' || entry.outcome === 'no_response'))
            || isOverdueFollowUp(entry)
        ))
        const byAm = new Map<string, number>()
        for (const entry of needsFollowUp) {
            if (!entry.ownerAmId || !entry.ownerAmName) continue
            byAm.set(entry.ownerAmName, (byAm.get(entry.ownerAmName) || 0) + 1)
        }
        const top = Array.from(byAm.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
        const requires = summary.shopsRequiringFollowUp === 1 ? 'requires' : 'require'
        insights.push(top
            ? `${shops(summary.shopsRequiringFollowUp)} ${requires} follow-up; ${top[1]} ${top[1] === 1 ? 'is' : 'are'} assigned to ${top[0]}.`
            : `${shops(summary.shopsRequiringFollowUp)} ${requires} follow-up.`)
    }

    if (summary.pendingObservationVisits > 0) {
        insights.push(`${visits(summary.pendingObservationVisits)} ${summary.pendingObservationVisits === 1 ? 'is' : 'are'} still pending the full 7-day observation window.`)
    }

    if (insights.length < 2 && amPerformance.unassignedVisits > 0) {
        insights.push(`${visits(amPerformance.unassignedVisits)} ${amPerformance.unassignedVisits === 1 ? 'has' : 'have'} no resolvable account manager and ${amPerformance.unassignedVisits === 1 ? 'is' : 'are'} excluded from the leaderboard.`)
    }

    return insights.slice(0, 2)
}
