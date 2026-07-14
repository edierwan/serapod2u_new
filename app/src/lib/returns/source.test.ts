import { describe, expect, it } from 'vitest'
import {
    RETURN_SOURCE_TYPES,
    RETURN_SOURCE_LABELS,
    RETURN_SOURCE_ORG_TYPE_CODE,
    isReturnSourceType,
    normalizeReturnSourceType,
    sourceTypeForOrgTypeCode,
} from './constants'

describe('return source type helpers', () => {
    it('exposes exactly shop + distributor', () => {
        expect(RETURN_SOURCE_TYPES).toEqual(['shop', 'distributor'])
        expect(RETURN_SOURCE_LABELS).toEqual({ shop: 'Shop', distributor: 'Distributor' })
        expect(RETURN_SOURCE_ORG_TYPE_CODE).toEqual({ shop: 'SHOP', distributor: 'DIST' })
    })

    it('isReturnSourceType only accepts the two valid values', () => {
        expect(isReturnSourceType('shop')).toBe(true)
        expect(isReturnSourceType('distributor')).toBe(true)
        expect(isReturnSourceType('warehouse')).toBe(false)
        expect(isReturnSourceType(null)).toBe(false)
        expect(isReturnSourceType(undefined)).toBe(false)
    })

    it('normalizeReturnSourceType defaults unknown values to shop', () => {
        expect(normalizeReturnSourceType('distributor')).toBe('distributor')
        expect(normalizeReturnSourceType('shop')).toBe('shop')
        expect(normalizeReturnSourceType('DIST')).toBe('shop') // not a source-type value
        expect(normalizeReturnSourceType(undefined)).toBe('shop')
    })

    it('maps org type codes to source types', () => {
        expect(sourceTypeForOrgTypeCode('SHOP')).toBe('shop')
        expect(sourceTypeForOrgTypeCode('shop')).toBe('shop')
        expect(sourceTypeForOrgTypeCode('DIST')).toBe('distributor')
        expect(sourceTypeForOrgTypeCode('WH')).toBeNull()
        expect(sourceTypeForOrgTypeCode('HQ')).toBeNull()
        expect(sourceTypeForOrgTypeCode(null)).toBeNull()
    })
})
