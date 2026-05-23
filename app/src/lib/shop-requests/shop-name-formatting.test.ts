import { describe, expect, it } from 'vitest'

import { formatShopNameTitleCase, normalizeShopNameForSubmit } from './shop-name-formatting'

describe('shop name formatting', () => {
    it('title-cases normal shop names', () => {
        expect(formatShopNameTitleCase('test new shop')).toBe('Test New Shop')
        expect(formatShopNameTitleCase('kedai maju jaya')).toBe('Kedai Maju Jaya')
        expect(formatShopNameTitleCase('RESTORAN ALI MAJU')).toBe('Restoran Ali Maju')
        expect(formatShopNameTitleCase('mini mart taman desa')).toBe('Mini Mart Taman Desa')
    })

    it('trims and collapses spaces before submit', () => {
        expect(normalizeShopNameForSubmit('  test   new   shop  ')).toBe('Test New Shop')
    })

    it('preserves or canonicalizes common brand and acronym tokens', () => {
        expect(normalizeShopNameForSubmit('99 speedmart taman desa')).toBe('99 Speedmart Taman Desa')
        expect(normalizeShopNameForSubmit('7-eleven seksyen 9')).toBe('7-Eleven Seksyen 9')
        expect(normalizeShopNameForSubmit('s.box station')).toBe('S.Box Station')
        expect(normalizeShopNameForSubmit('abc mart')).toBe('ABC Mart')
        expect(normalizeShopNameForSubmit('kk mart')).toBe('KK Mart')
        expect(normalizeShopNameForSubmit('mr diy shah alam')).toBe('MR DIY Shah Alam')
    })

    it('preserves trailing space for smooth completed-word typing', () => {
        expect(formatShopNameTitleCase('test new shop ')).toBe('Test New Shop ')
    })
})