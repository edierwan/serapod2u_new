import { describe, expect, it } from 'vitest'
import { EMPTY_RETURN_META, getCategorySelectorState, normalizeReturnMeta } from './meta'

describe('normalizeReturnMeta', () => {
    const category = { id: 'vape', category_code: 'VAPE', category_name: 'Vape' }

    it('preserves categories from a complete response', () => {
        const result = normalizeReturnMeta({
            ...EMPTY_RETURN_META,
            categories: [category],
        })
        expect(result.categories).toEqual([category])
    })

    it.each([
        ['missing', {}],
        ['null', { categories: null }],
        ['invalid', { categories: 'Vape' }],
        ['empty', { categories: [] }],
    ])('normalizes %s categories to an empty array', (_label, response) => {
        expect(normalizeReturnMeta(response).categories).toEqual([])
    })

    it('normalizes every metadata collection independently', () => {
        const result = normalizeReturnMeta({
            shops: null,
            warehouses: {},
            reasons: 'invalid',
            conditions: undefined,
        })
        expect(result.shops).toEqual([])
        expect(result.warehouses).toEqual([])
        expect(result.reasons).toEqual([])
        expect(result.conditions).toEqual([])
    })
})

describe('category selector metadata states', () => {
    const categories = [{ id: 'vape', category_code: 'VAPE', category_name: 'Vape' }]

    it('is disabled with a loading placeholder while metadata loads', () => {
        expect(getCategorySelectorState(EMPTY_RETURN_META, true, false)).toMatchObject({
            disabled: true,
            placeholder: 'Loading categories...',
            empty: false,
        })
    })

    it('handles empty categories without mapping over undefined', () => {
        expect(getCategorySelectorState(EMPTY_RETURN_META, false, false)).toMatchObject({
            categories: [], disabled: true, empty: true,
        })
    })

    it('shows active manual options for an unresolved program', () => {
        const meta = normalizeReturnMeta({ categories })
        expect(getCategorySelectorState(meta, false, false)).toMatchObject({
            categories, disabled: false, showManual: true,
        })
    })

    it('does not request the manual selector for an auto-resolved Cellera category', () => {
        const meta = normalizeReturnMeta({ categories })
        expect(getCategorySelectorState(meta, false, true).showManual).toBe(false)
    })
})
