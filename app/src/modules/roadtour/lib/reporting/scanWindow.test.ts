import { describe, expect, it } from 'vitest'

import { bucketScansAroundAnchor, resolveVisitAnchorIso } from './scanWindow'

const ANCHOR = '2026-08-10T04:00:00.000Z' // 12:00 Malaysia time

function at(offsetMs: number): { scanned_at: string } {
    return { scanned_at: new Date(new Date(ANCHOR).getTime() + offsetMs).toISOString() }
}

const HOUR = 3_600_000
const DAY = 86_400_000

describe('visit anchor', () => {
    it('prefers the official visit scan instant', () => {
        expect(resolveVisitAnchorIso('2026-08-10', '2026-08-10T04:00:00+00:00')).toBe(ANCHOR)
    })

    it('falls back to Malaysia midnight on the visit date', () => {
        expect(resolveVisitAnchorIso('2026-08-10', null)).toBe('2026-08-09T16:00:00.000Z')
        expect(resolveVisitAnchorIso('2026-08-10', 'not-a-timestamp')).toBe('2026-08-09T16:00:00.000Z')
    })
})

describe('before/after bucketing around the official visit', () => {
    it('splits scans on the visit instant, not on the calendar day', () => {
        const result = bucketScansAroundAnchor(
            [at(-2 * HOUR), at(-1 * HOUR), at(1 * HOUR), at(5 * HOUR)],
            ANCHOR,
            7,
        )
        expect(result.beforeScans).toBe(2)
        expect(result.afterScans).toBe(2)
    })

    it('never credits the visit instant itself as a post-visit response', () => {
        const result = bucketScansAroundAnchor([at(0)], ANCHOR, 7)
        expect(result.afterScans).toBe(0)
        expect(result.beforeScans).toBe(0)
    })

    it('ignores scans outside the window on either side', () => {
        const result = bucketScansAroundAnchor(
            [at(-8 * DAY), at(-7 * DAY), at(7 * DAY), at(7 * DAY + 1)],
            ANCHOR,
            7,
        )
        expect(result.beforeScans).toBe(1)
        expect(result.afterScans).toBe(1)
    })

    it('reports the first and last valid scan after the visit', () => {
        const first = at(2 * HOUR)
        const last = at(3 * DAY)
        const result = bucketScansAroundAnchor([last, at(-1 * HOUR), first], ANCHOR, 7)
        expect(result.firstScanAfterAt).toBe(first.scanned_at)
        expect(result.lastScanAfterAt).toBe(last.scanned_at)
    })

    it('narrows and widens with the drill-down windows', () => {
        const scans = [at(2 * DAY), at(5 * DAY), at(20 * DAY)]
        expect(bucketScansAroundAnchor(scans, ANCHOR, 3).afterScans).toBe(1)
        expect(bucketScansAroundAnchor(scans, ANCHOR, 7).afterScans).toBe(2)
        expect(bucketScansAroundAnchor(scans, ANCHOR, 30).afterScans).toBe(3)
    })

    it('leaves the counts empty when there is no scan data at all', () => {
        expect(bucketScansAroundAnchor([], ANCHOR, 7)).toEqual({
            beforeScans: 0, afterScans: 0, firstScanAfterAt: null, lastScanAfterAt: null,
        })
    })
})
