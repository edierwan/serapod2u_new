import { describe, expect, it } from 'vitest'

import { resolveParticipantDisplay, resolveShopDisplay } from './shopDisplay'

describe('shop name enrichment', () => {
    it('splits the organisation name from its branch', () => {
        expect(resolveShopDisplay({ shopName: 'Kloud Room', branch: 'Seberang Perai Tengah' })).toEqual({
            fullLabel: 'Kloud Room (Seberang Perai Tengah)',
            primaryName: 'Kloud Room',
            branchLabel: '(Seberang Perai Tengah)',
        })
    })

    it('does not double-wrap a branch that is already bracketed', () => {
        expect(resolveShopDisplay({ shopName: 'Kloud Room', branch: '(Bayan Lepas)' }).branchLabel)
            .toBe('(Bayan Lepas)')
    })

    it('keeps a shop with no branch as a single name', () => {
        expect(resolveShopDisplay({ shopName: 'Secret Vape Shop', branch: null })).toEqual({
            fullLabel: 'Secret Vape Shop',
            primaryName: 'Secret Vape Shop',
            branchLabel: null,
        })
        expect(resolveShopDisplay({ shopName: 'Secret Vape Shop', branch: '   ' }).branchLabel).toBeNull()
    })

    it('never treats a bracketed trading name as a branch', () => {
        expect(resolveShopDisplay({ shopName: 'Brand (Lab)', branch: null })).toEqual({
            fullLabel: 'Brand (Lab)',
            primaryName: 'Brand (Lab)',
            branchLabel: null,
        })
    })

    it('falls back to the placeholder only when the shop is unknown', () => {
        expect(resolveShopDisplay({ shopName: null, branch: 'Ampang' }).primaryName).toBe('—')
    })
})

describe('participant display', () => {
    it('shows the registered name with the phone underneath', () => {
        expect(resolveParticipantDisplay({
            participantCount: 1, latestParticipantName: 'Nayli Nadhirah', latestParticipantPhone: '+60145600453',
        })).toEqual({ primary: 'Nayli Nadhirah', secondary: '+60 14-560 0453', isPlaceholder: false })
    })

    it('labels a contactable but unregistered participant', () => {
        expect(resolveParticipantDisplay({
            participantCount: 1, latestParticipantName: null, latestParticipantPhone: '+60178950361',
        })).toEqual({ primary: 'Unregistered Participant', secondary: '+60 17-895 0361', isPlaceholder: false })
    })

    it('summarises multiple participants and names the latest', () => {
        expect(resolveParticipantDisplay({
            participantCount: 3, latestParticipantName: 'Fitri', latestParticipantPhone: '+60145600453',
        })).toEqual({ primary: '3 participants', secondary: 'Latest: Fitri', isPlaceholder: false })
    })

    it('uses the placeholder only when neither identity nor contact exists', () => {
        expect(resolveParticipantDisplay({
            participantCount: 0, latestParticipantName: null, latestParticipantPhone: null,
        })).toEqual({ primary: '—', secondary: null, isPlaceholder: true })
    })
})
