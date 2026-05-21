import { describe, expect, it } from 'vitest'

import { buildVisitRegionDataset, extractVisitRegionFromLocation, getStateFlagPath, getStateFromCapturedLocation, resolveVisitRegion } from './visit-region'

describe('visit-region', () => {
    describe('getStateFromCapturedLocation', () => {
        it('normalizes Pulau Pinang addresses', () => {
            expect(getStateFromCapturedLocation('Bandar Perda, Bukit Mertajam, Pulau Pinang, Malaysia')).toBe('Pulau Pinang')
            expect(getStateFromCapturedLocation('Bukit Jambul, George Town, Pulau Pinang, Malaysia')).toBe('Pulau Pinang')
            expect(getStateFromCapturedLocation('Seberang Jaya, Permatang Pauh, Pulau Pinang, Malaysia')).toBe('Pulau Pinang')
        })

        it('extracts other supported Malaysian states', () => {
            expect(getStateFromCapturedLocation('Melaka Tengah, Melaka, Malaysia')).toBe('Melaka')
            expect(getStateFromCapturedLocation('Bandar Hilir, Malacca, Malaysia')).toBe('Melaka')
            expect(getStateFromCapturedLocation('Alor Setar, Kedah, Malaysia')).toBe('Kedah')
            expect(getStateFromCapturedLocation('Kuala Lumpur, Malaysia')).toBe('Kuala Lumpur')
            expect(getStateFromCapturedLocation('Kuala Terengganu, Terengganu, Malaysia')).toBe('Terengganu')
        })

        it('returns null for missing locations', () => {
            expect(getStateFromCapturedLocation('')).toBeNull()
            expect(getStateFromCapturedLocation(null)).toBeNull()
        })

        it('keeps extractVisitRegionFromLocation as a compatibility alias', () => {
            expect(extractVisitRegionFromLocation('Melaka Tengah, Melaka, Malaysia')).toBe('Melaka')
        })
    })

    describe('getStateFlagPath', () => {
        it('maps normalized states to local flag assets', () => {
            expect(getStateFlagPath('Pulau Pinang')).toBe('/images/state-flags/penang.png')
            expect(getStateFlagPath('Penang')).toBe('/images/state-flags/penang.png')
            expect(getStateFlagPath('Melaka')).toBe('/images/state-flags/melaka.png')
            expect(getStateFlagPath('Malacca')).toBe('/images/state-flags/melaka.png')
            expect(getStateFlagPath('Kedah')).toBe('/images/state-flags/kedah.png')
            expect(getStateFlagPath('Kuala Lumpur')).toBe('/images/state-flags/kuala-lumpur.png')
            expect(getStateFlagPath('Terengganu')).toBe('/images/state-flags/terengganu.png')
        })

        it('returns null when no local flag asset is available', () => {
            expect(getStateFlagPath('Negeri Sembilan')).toBeNull()
            expect(getStateFlagPath(null)).toBeNull()
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