import { describe, it, expect } from 'vitest'
import { getVariantDisplayName, classifyProductLine, productLineLabel, getUnitsPerCase } from './format'

describe('getVariantDisplayName', () => {
    // Spec §5 display-extraction table.
    it.each([
        ['Zero Edition Novella [ Buttercake ]', 'Buttercake'],
        ['Zero Edition Novella [ Strawberry Vanilla ]', 'Strawberry Vanilla'],
        ['Deluxe Cellera Cartridge [ Banana Milk ]', 'Banana Milk'],
        ['Cellera Zero [ Novella ] [ Buttercake ]', 'Buttercake'],
        ['Honeydew', 'Honeydew'],
    ])('%s -> %s', (input, expected) => {
        expect(getVariantDisplayName(input)).toBe(expected)
    })

    it('falls back to the full name when brackets are empty', () => {
        expect(getVariantDisplayName('Plain Name [  ]')).toBe('Plain Name [  ]')
    })

    it('handles null/undefined/blank', () => {
        expect(getVariantDisplayName(null)).toBe('')
        expect(getVariantDisplayName(undefined)).toBe('')
        expect(getVariantDisplayName('   ')).toBe('')
    })
})

describe('classifyProductLine', () => {
    it.each([
        ['Cellera Hero', 'hero'],
        ['Cellera Zero', 'zero'],
        ['CELLERA HERO', 'hero'],
        ['Some Device', 'other'],
        [null, 'other'],
    ])('%s -> %s', (input, expected) => {
        expect(classifyProductLine(input as any)).toBe(expected)
    })
})

describe('productLineLabel', () => {
    it('maps lines to badge labels', () => {
        expect(productLineLabel('hero')).toBe('Hero')
        expect(productLineLabel('zero')).toBe('Zero')
        expect(productLineLabel('other')).toBe('Other')
    })
})

describe('getUnitsPerCase', () => {
    it('uses the Cellera default of 4 when master data is unreliable (1 / null)', () => {
        expect(getUnitsPerCase('Cellera Hero', 1)).toBe(4)
        expect(getUnitsPerCase('Cellera Zero', 1)).toBe(4)
        expect(getUnitsPerCase('Cellera Hero', null)).toBe(4)
        expect(getUnitsPerCase('Cellera Zero', undefined)).toBe(4)
    })
    it('never silently defaults Cellera Hero/Zero to 1', () => {
        expect(getUnitsPerCase('Cellera Hero', 0)).toBe(4)
        expect(getUnitsPerCase('Cellera Zero', 1)).not.toBe(1)
    })
    it('prefers a reliable configured pack size (> 1) from master data', () => {
        expect(getUnitsPerCase('Cellera Hero', 6)).toBe(6)
        expect(getUnitsPerCase('Some Device', 12)).toBe(12)
    })
    it('falls back to 1 for non-Cellera products without a reliable pack size', () => {
        expect(getUnitsPerCase('Some Device', 1)).toBe(1)
        expect(getUnitsPerCase('Accessory', null)).toBe(1)
    })
})
