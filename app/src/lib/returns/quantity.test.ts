import { describe, it, expect } from 'vitest'
import { computeReturnTotal, categoryNameForProgram } from './constants'
import { buildReturnItemRows } from './server'

describe('computeReturnTotal (no auto-normalization)', () => {
    // Spec table (1 Full Case = 4 Pcs) — Case/Loose preserved exactly as entered.
    it.each([
        [1, 0, 4, { case_qty: 1, loose_piece_qty: 0, total_units: 4 }],
        [0, 3, 4, { case_qty: 0, loose_piece_qty: 3, total_units: 3 }],
        [1, 1, 4, { case_qty: 1, loose_piece_qty: 1, total_units: 5 }],
        [2, 0, 4, { case_qty: 2, loose_piece_qty: 0, total_units: 8 }],
        [4, 3, 4, { case_qty: 4, loose_piece_qty: 3, total_units: 19 }],
        [4, 6, 4, { case_qty: 4, loose_piece_qty: 6, total_units: 22 }],
    ])('case=%i loose=%i upc=%i', (c, l, upc, expected) => {
        const n = computeReturnTotal(c, l, upc)
        expect(n.case_qty).toBe(expected.case_qty)
        expect(n.loose_piece_qty).toBe(expected.loose_piece_qty)
        expect(n.total_units).toBe(expected.total_units)
    })

    it('does NOT roll loose pieces into cases (0 case + 5 loose stays 0/5)', () => {
        expect(computeReturnTotal(0, 5, 4)).toMatchObject({ case_qty: 0, loose_piece_qty: 5, total_units: 5 })
    })

    it('does NOT roll an over-full loose entry (4 case + 6 loose stays 4/6, total 22)', () => {
        expect(computeReturnTotal(4, 6, 4)).toMatchObject({ case_qty: 4, loose_piece_qty: 6, total_units: 22 })
    })

    it('respects a different units-per-case without normalizing (upc 10)', () => {
        expect(computeReturnTotal(1, 12, 10)).toMatchObject({ case_qty: 1, loose_piece_qty: 12, total_units: 22 })
    })

    it('falls back to upc=1 when master value is missing/invalid (loose == total)', () => {
        expect(computeReturnTotal(0, 5, null)).toMatchObject({ case_qty: 0, loose_piece_qty: 5, total_units: 5, units_per_case: 1 })
        expect(computeReturnTotal(3, 0, 0)).toMatchObject({ total_units: 3, units_per_case: 1 })
    })

    it('floors fractional / negative input to non-negative integers', () => {
        expect(computeReturnTotal(-2, -5, 4)).toMatchObject({ case_qty: 0, loose_piece_qty: 0, total_units: 0 })
    })
})

describe('categoryNameForProgram', () => {
    it.each([
        ['cellera', undefined, 'Vape'],
        [undefined, 'Cellera Loyalty', 'Vape'],
        ['  CeLlErA  ', undefined, 'Vape'],
        ['ellbow', undefined, 'Pet Food'],
        [undefined, '  Ellbow  ', 'Pet Food'],
    ])('maps code=%s name=%s to %s', (code, name, expected) => {
        expect(categoryNameForProgram(code, name)).toBe(expected)
    })

    it('returns null for null / undefined programs', () => {
        expect(categoryNameForProgram()).toBeNull()
        expect(categoryNameForProgram(null, null)).toBeNull()
    })

    it('returns null for an unknown program', () => {
        expect(categoryNameForProgram('unknown')).toBeNull()
    })
})

describe('buildReturnItemRows (server recompute, no normalization)', () => {
    const upc = 4

    it('drops rows with Total Pcs = 0 and recomputes total server-side', () => {
        const { rows, error } = buildReturnItemRows('case-1', [
            { variant_id: 'v1', units_per_case_snapshot: upc, case_qty: 0, loose_piece_qty: 0 }, // dropped
            { variant_id: 'v2', units_per_case_snapshot: upc, case_qty: 4, loose_piece_qty: 3 }, // 19
        ])
        expect(error).toBeUndefined()
        expect(rows).toHaveLength(1)
        expect(rows![0]).toMatchObject({ variant_id: 'v2', case_qty: 4, loose_piece_qty: 3, total_units: 19, quantity: 19 })
    })

    it('preserves an over-full loose entry (4 case + 6 loose stays 4/6, total 22)', () => {
        const { rows } = buildReturnItemRows('c', [
            { variant_id: 'v1', units_per_case_snapshot: upc, case_qty: 4, loose_piece_qty: 6 },
        ])
        expect(rows![0]).toMatchObject({ case_qty: 4, loose_piece_qty: 6, total_units: 22 })
    })

    it('preserves loose-only entry without creating a case (0 case + 5 loose)', () => {
        const { rows } = buildReturnItemRows('c', [
            { variant_id: 'v1', units_per_case_snapshot: upc, case_qty: 0, loose_piece_qty: 5 },
        ])
        expect(rows![0]).toMatchObject({ case_qty: 0, loose_piece_qty: 5, total_units: 5 })
    })

    it('rejects negative / non-integer quantities', () => {
        expect(buildReturnItemRows('c', [{ variant_id: 'v1', units_per_case_snapshot: upc, case_qty: -1, loose_piece_qty: 0 }]).error).toBeTruthy()
        expect(buildReturnItemRows('c', [{ variant_id: 'v1', units_per_case_snapshot: upc, case_qty: 1.5, loose_piece_qty: 0 }]).error).toBeTruthy()
    })

    it('rejects duplicate variants / SKUs', () => {
        const res = buildReturnItemRows('c', [
            { variant_id: 'v1', units_per_case_snapshot: upc, case_qty: 1, loose_piece_qty: 0 },
            { variant_id: 'v1', units_per_case_snapshot: upc, case_qty: 2, loose_piece_qty: 0 },
        ])
        expect(res.error).toMatch(/duplicate/i)
    })
})
