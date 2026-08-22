// Attribution rules for shops visited more than once inside the selected month.
//
// Approved policy:
//  * Operational ownership/status — the LATEST visit of the month owns the shop's
//    current status and responsible AM in the follow-up queue ("current row").
//  * AM performance credit — the shop-month outcome is credited to the LATEST
//    visit whose observation window is already MATURE ("attributed row"). A shop
//    therefore contributes at most one outcome, so two AMs can never both be
//    credited for the same post-visit scan activity.
//  * When no visit of the month has matured yet, the shop has no attributed row
//    and is reported as Pending Observation instead of being counted anywhere.

export interface AttributableVisit {
    visit_id: string
    shop_id: string
    /** ISO instant of the visit anchor. */
    visit_at: string
    matured: boolean
    window_days: number
}

export interface ShopAttribution<T extends AttributableVisit> {
    shopId: string
    /** Latest visit of the month — drives follow-up ownership and current status. */
    currentRow: T
    /** Latest matured visit — the only row credited with the shop's outcome. */
    attributedRow: T | null
    visitCount: number
}

/** Latest wins; visit_id breaks exact-timestamp ties so results are deterministic. */
function isLater(candidate: AttributableVisit, incumbent: AttributableVisit): boolean {
    if (candidate.visit_at !== incumbent.visit_at) return candidate.visit_at > incumbent.visit_at
    return candidate.visit_id > incumbent.visit_id
}

export function attributeShopVisits<T extends AttributableVisit>(rows: T[]): Map<string, ShopAttribution<T>> {
    const byShop = new Map<string, ShopAttribution<T>>()

    for (const row of rows) {
        const existing = byShop.get(row.shop_id)
        if (!existing) {
            byShop.set(row.shop_id, {
                shopId: row.shop_id,
                currentRow: row,
                attributedRow: row.matured ? row : null,
                visitCount: 1,
            })
            continue
        }

        existing.visitCount += 1
        if (isLater(row, existing.currentRow)) existing.currentRow = row
        if (row.matured && (!existing.attributedRow || isLater(row, existing.attributedRow))) {
            existing.attributedRow = row
        }
    }

    return byShop
}

/**
 * Two visits to the same shop whose before/after windows overlap would otherwise
 * count the same scans twice. Attribution already collapses each shop to one
 * credited row; this helper reports where the situation occurs so the limitation
 * stays visible in tests and diagnostics.
 */
export function findOverlappingObservationWindows<T extends AttributableVisit>(rows: T[]): Array<[T, T]> {
    const overlaps: Array<[T, T]> = []
    const byShop = new Map<string, T[]>()

    for (const row of rows) {
        const list = byShop.get(row.shop_id) || []
        list.push(row)
        byShop.set(row.shop_id, list)
    }

    for (const list of byShop.values()) {
        const ordered = [...list].sort((a, b) => a.visit_at.localeCompare(b.visit_at))
        for (let i = 1; i < ordered.length; i++) {
            const previous = ordered[i - 1]
            const current = ordered[i]
            const gapMs = new Date(current.visit_at).getTime() - new Date(previous.visit_at).getTime()
            if (gapMs < previous.window_days * 86_400_000) overlaps.push([previous, current])
        }
    }

    return overlaps
}
