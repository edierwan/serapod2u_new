import { describe, expect, it } from 'vitest'

import { kpiValueSizeClass, metricValueSizeClass } from './number-sizing'

const size = (cls: string) => cls.split(' ').find(c => c.startsWith('text-'))

describe('kpiValueSizeClass', () => {
    it('keeps small and mid values at the prominent text-2xl', () => {
        expect(size(kpiValueSizeClass('0'))).toBe('text-2xl')
        expect(size(kpiValueSizeClass('23'))).toBe('text-2xl')
        expect(size(kpiValueSizeClass('101,580'))).toBe('text-2xl')
    })

    it('steps down for long values so the full figure fits', () => {
        expect(size(kpiValueSizeClass('1,372,760'))).toBe('text-xl')
        expect(size(kpiValueSizeClass('10,000,000'))).toBe('text-lg')
    })

    it('always applies tabular numerals and no-wrap', () => {
        for (const v of ['0', '1,372,760', '10,000,000']) {
            expect(kpiValueSizeClass(v)).toContain('tabular-nums')
            expect(kpiValueSizeClass(v)).toContain('whitespace-nowrap')
        }
    })
})

describe('metricValueSizeClass', () => {
    it('keeps short card metrics at text-lg', () => {
        expect(size(metricValueSizeClass('0'))).toBe('text-lg')
        expect(size(metricValueSizeClass('9,999'))).toBe('text-lg')
    })

    it('shrinks progressively for 44,000 .. 1,000,000 without abbreviating', () => {
        expect(size(metricValueSizeClass('44,000'))).toBe('text-[15px]')
        expect(size(metricValueSizeClass('110,000'))).toBe('text-[15px]')
        expect(size(metricValueSizeClass('999,999'))).toBe('text-[15px]')
        expect(size(metricValueSizeClass('1,000,000'))).toBe('text-[13px]')
        expect(size(metricValueSizeClass('10,000,000'))).toBe('text-xs')
    })

    it('never produces a size under 12px and always sets nowrap + tabular-nums', () => {
        for (const v of ['1', '110,000', '1,000,000', '999,999,999']) {
            const cls = metricValueSizeClass(v)
            expect(cls).toContain('tabular-nums')
            expect(cls).toContain('whitespace-nowrap')
            expect(['text-lg', 'text-[15px]', 'text-[13px]', 'text-xs']).toContain(size(cls))
        }
    })
})
