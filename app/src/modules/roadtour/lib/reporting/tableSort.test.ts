import { describe, expect, it } from 'vitest'

import { applySort, compareDate, compareText, nextSortState } from './tableSort'

describe('nextSortState', () => {
    it('sorts ascending on the first click', () => {
        expect(nextSortState(null, 'shop')).toEqual({ key: 'shop', direction: 'asc' })
    })

    it('reverses on the second click of the same column', () => {
        expect(nextSortState({ key: 'shop', direction: 'asc' }, 'shop'))
            .toEqual({ key: 'shop', direction: 'desc' })
        expect(nextSortState({ key: 'shop', direction: 'desc' }, 'shop'))
            .toEqual({ key: 'shop', direction: 'asc' })
    })

    it('switches to another column ascending', () => {
        expect(nextSortState({ key: 'shop', direction: 'desc' }, 'region'))
            .toEqual({ key: 'region', direction: 'asc' })
    })
})

describe('comparators', () => {
    it('compares text case-insensitively', () => {
        expect(compareText('alpha', 'Alpha')).toBe(0)
        expect(compareText('alpha', 'bravo')).toBeLessThan(0)
    })

    it('compares dates chronologically, not as formatted text', () => {
        expect(compareDate('2026-08-02', '2026-08-10')).toBeLessThan(0)
        expect(compareDate('2026-08-10T02:00:00.000Z', '2026-08-10T05:00:00.000Z')).toBeLessThan(0)
    })
})

describe('applySort', () => {
    const rows = [
        { id: 'c', name: 'Charlie', score: 2 as number | null },
        { id: 'a', name: 'alpha', score: 1 as number | null },
        { id: 'b', name: 'Bravo', score: null as number | null },
        { id: 'd', name: 'Delta', score: 2 as number | null },
    ]
    const column = { value: (row: (typeof rows)[number]) => row.score }
    const tieBreak = (row: (typeof rows)[number]) => row.id

    it('sorts ascending and descending', () => {
        expect(applySort(rows, column, 'asc', tieBreak).map((r) => r.id)).toEqual(['a', 'c', 'd', 'b'])
        expect(applySort(rows, column, 'desc', tieBreak).map((r) => r.id)).toEqual(['c', 'd', 'a', 'b'])
    })

    it('keeps missing values at the bottom in both directions', () => {
        expect(applySort(rows, column, 'asc', tieBreak).at(-1)!.id).toBe('b')
        expect(applySort(rows, column, 'desc', tieBreak).at(-1)!.id).toBe('b')
    })

    it('breaks ties deterministically so equal rows never reorder', () => {
        const first = applySort(rows, column, 'asc', tieBreak).map((r) => r.id)
        const second = applySort([...rows].reverse(), column, 'asc', tieBreak).map((r) => r.id)
        expect(second).toEqual(first)
    })

    it('does not mutate the input', () => {
        const input = [...rows]
        applySort(input, column, 'desc', tieBreak)
        expect(input.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    })
})
