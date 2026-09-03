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

    it('keeps participant name and shows the phone underneath', () => {
        expect(resolveVisitParticipantDisplay('Birdie For Edi', '0122023624')).toEqual({
            primary: 'Birdie For Edi',
            secondary: '+60 12-202 3624',
            isPlaceholder: false,
        })
    })

    it('labels a contactable participant with no name as unregistered', () => {
        expect(resolveVisitParticipantDisplay(null, '0178950361')).toEqual({
            primary: 'Unregistered Participant',
            secondary: '+60 17-895 0361',
            isPlaceholder: false,
        })
    })

    it('falls back to the no-context placeholder when nothing is known', () => {
        expect(resolveVisitParticipantDisplay(null, null)).toEqual({
            primary: '—',
            secondary: null,
            isPlaceholder: true,
        })
    })

    it('formats participant csv values without dropping the phone fallback', () => {
        expect(formatVisitParticipantCsvValue('Birdie For Edi', '0122023624')).toBe('Birdie For Edi (+60 12-202 3624)')
        expect(formatVisitParticipantCsvValue(null, '0178950361')).toBe('Unregistered Participant (+60 17-895 0361)')
        expect(formatVisitParticipantCsvValue(null, null)).toBe('—')
    })
})
