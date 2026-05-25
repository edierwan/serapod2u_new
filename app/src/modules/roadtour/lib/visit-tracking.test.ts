import { describe, expect, it } from 'vitest'

import {
    formatVisitDateTime,
    formatVisitParticipantCsvValue,
    resolveVisitParticipantDisplay,
} from './visit-tracking'

describe('visit tracking helpers', () => {
    it('formats visit date and time as separate labels', () => {
        expect(formatVisitDateTime('2026-05-25', '2026-05-25T14:45:00')).toEqual({
            dateLabel: 'May 25, 2026',
            timeLabel: '02:45 PM',
        })
    })

    it('keeps participant name and phone when both are available', () => {
        expect(resolveVisitParticipantDisplay('Birdie For Edi', '0122023624')).toEqual({
            primary: 'Birdie For Edi',
            secondary: '0122023624',
            isPlaceholder: false,
        })
    })

    it('falls back to phone or placeholder when participant data is incomplete', () => {
        expect(resolveVisitParticipantDisplay(null, '0178950361')).toEqual({
            primary: '0178950361',
            secondary: null,
            isPlaceholder: false,
        })

        expect(resolveVisitParticipantDisplay(null, null)).toEqual({
            primary: '-',
            secondary: null,
            isPlaceholder: true,
        })
    })

    it('formats participant csv values without dropping phone fallback', () => {
        expect(formatVisitParticipantCsvValue('Birdie For Edi', '0122023624')).toBe('Birdie For Edi (0122023624)')
        expect(formatVisitParticipantCsvValue(null, '0178950361')).toBe('0178950361')
    })
})