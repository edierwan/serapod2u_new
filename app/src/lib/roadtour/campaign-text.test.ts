import { describe, expect, it } from 'vitest'

import { capitalizeFirstOnly, toTitleCase } from './campaign-text'

describe('campaign-text', () => {
    describe('toTitleCase', () => {
        it('formats lowercase words into title case', () => {
            expect(toTitleCase('test satu')).toBe('Test Satu')
        })

        it('normalizes mixed casing while preserving numbers', () => {
            expect(toTitleCase('ROADTOUR kedah 2026')).toBe('Roadtour Kedah 2026')
        })

        it('handles empty values safely', () => {
            expect(toTitleCase('')).toBe('')
        })

        it('does not crash on leading spaces', () => {
            expect(toTitleCase('  test satu')).toBe('  Test Satu')
        })
    })

    describe('capitalizeFirstOnly', () => {
        it('capitalizes only the first non-space character', () => {
            expect(capitalizeFirstOnly('testing satu')).toBe('Testing satu')
        })

        it('keeps already-capitalized text unchanged', () => {
            expect(capitalizeFirstOnly('Testing satu')).toBe('Testing satu')
        })

        it('preserves the rest of the description as-is', () => {
            expect(capitalizeFirstOnly('roadtour untuk collect user baru')).toBe('Roadtour untuk collect user baru')
        })

        it('handles empty values safely', () => {
            expect(capitalizeFirstOnly('')).toBe('')
        })
    })
})