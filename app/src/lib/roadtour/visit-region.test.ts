import { describe, expect, it } from 'vitest'

import { buildVisitRegionDataset, extractVisitRegionFromLocation, resolveVisitRegion } from './visit-region'

describe('visit-region', () => {
    describe('extractVisitRegionFromLocation', () => {
        it('normalizes Pulau Pinang addresses', () => {
            expect(extractVisitRegionFromLocation('Bandar Perda, Bukit Mertajam, Pulau Pinang, Malaysia')).toBe('Pulau Pinang')
            expect(extractVisitRegionFromLocation('Bukit Jambul, George Town, Pulau Pinang, Malaysia')).toBe('Pulau Pinang')
            expect(extractVisitRegionFromLocation('Seberang Jaya, Permatang Pauh, Pulau Pinang, Malaysia')).toBe('Pulau Pinang')
        })

        it('extracts other supported Malaysian states', () => {
            expect(extractVisitRegionFromLocation('Melaka Tengah, Melaka, Malaysia')).toBe('Melaka')
            expect(extractVisitRegionFromLocation('Alor Setar, Kedah, Malaysia')).toBe('Kedah')
        })

        it('returns null for missing locations', () => {
            expect(extractVisitRegionFromLocation('')).toBeNull()
            expect(extractVisitRegionFromLocation(null)).toBeNull()
        })
    })

    describe('resolveVisitRegion', () => {
        it('prefers structured captured state when available', () => {
            expect(resolveVisitRegion({
                capturedState: 'Penang',
                capturedAddress: 'Melaka Tengah, Melaka, Malaysia',
            })).toBe('Pulau Pinang')
        })

        it('returns Unknown when no captured location exists', () => {
            expect(resolveVisitRegion({ capturedState: '', capturedAddress: null, capturedLabel: undefined })).toBe('Unknown')
        })
    })

    describe('buildVisitRegionDataset', () => {
        it('aggregates visits by captured location region', () => {
            const dataset = buildVisitRegionDataset([
                { capturedAddress: 'Bandar Perda, Bukit Mertajam, Pulau Pinang, Malaysia' },
                { capturedAddress: 'Bukit Jambul, George Town, Pulau Pinang, Malaysia' },
                { capturedAddress: 'Bandar Perda, Seberang Perai, Pulau Pinang, Malaysia' },
                { capturedAddress: 'Seberang Jaya, Permatang Pauh, Pulau Pinang, Malaysia' },
                { capturedAddress: 'Bukit Tengah, Seberang Perai, Pulau Pinang, Malaysia' },
                { capturedAddress: 'Jelutong, Pulau Pinang, Malaysia' },
            ])

            expect(dataset).toEqual([
                { regionName: 'Pulau Pinang', visitCount: 6 },
            ])
        })
    })
})