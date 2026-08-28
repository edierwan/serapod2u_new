// Small sorting primitives shared by the RoadTour reporting tables.
//
// Every reporting table keeps its own business default order until the user
// clicks a header, so this module only describes HOW a chosen column sorts —
// never what the default order is.

export type SortDirection = 'asc' | 'desc'

export interface SortState<Key extends string> {
    key: Key
    direction: SortDirection
}

/** Values a column can sort on. Missing values always sink to the bottom. */
export type SortValue = string | number | null | undefined

/** First click sorts ascending, a second click reverses, another column resets. */
export function nextSortState<Key extends string>(
    current: SortState<Key> | null,
    key: Key,
): SortState<Key> {
    if (current && current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    }
    return { key, direction: 'asc' }
}

function isMissing(value: SortValue): boolean {
    return value === null || value === undefined || value === ''
}

/** Case-insensitive, locale-aware text comparison. */
export function compareText(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

/**
 * Chronological comparison of ISO dates or datetimes. Values that do not parse
 * fall back to a plain string compare so the order is still deterministic.
 */
export function compareDate(a: string, b: string): number {
    const aTime = Date.parse(a.length === 10 ? `${a}T00:00:00+08:00` : a)
    const bTime = Date.parse(b.length === 10 ? `${b}T00:00:00+08:00` : b)
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime
    return compareText(a, b)
}

export function compareSortValue(a: SortValue, b: SortValue): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return compareText(String(a), String(b))
}

export interface SortColumn<Row> {
    /** The value this column sorts on — not necessarily the value it renders. */
    value: (row: Row) => SortValue
    /** Defaults to numeric-or-text; pass `compareDate` for date columns. */
    compare?: (a: any, b: any) => number
}

/**
 * Sorts a copy of `rows`. Rows with a missing value stay at the bottom in both
 * directions, and `tieBreak` keeps equal rows in a stable, deterministic order.
 */
export function applySort<Row>(
    rows: Row[],
    column: SortColumn<Row>,
    direction: SortDirection,
    tieBreak: (row: Row) => string,
): Row[] {
    const factor = direction === 'desc' ? -1 : 1
    const compare = column.compare ?? compareSortValue

    return [...rows].sort((a, b) => {
        const aValue = column.value(a)
        const bValue = column.value(b)
        const aMissing = isMissing(aValue)
        const bMissing = isMissing(bValue)
        if (aMissing !== bMissing) return aMissing ? 1 : -1
        if (!aMissing) {
            const delta = compare(aValue, bValue)
            if (delta !== 0) return delta * factor
        }
        return compareText(tieBreak(a), tieBreak(b))
    })
}
