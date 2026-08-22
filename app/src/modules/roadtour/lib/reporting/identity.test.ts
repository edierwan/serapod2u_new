import { describe, expect, it } from 'vitest'

import {
    buildUserPhoneIndex,
    normalizeParticipantPhone,
    resolveParticipantIdentity,
    type IdentityUser,
} from './identity'

const registered: IdentityUser = { id: 'user-1', full_name: 'Nayli Nadhirah', phone: '+60145600453' }
// Stored in local format on purpose: raw string matching would miss this row.
const localFormat: IdentityUser = { id: 'user-2', full_name: 'Aravin', phone: '0178950361' }
const nameless: IdentityUser = { id: 'user-3', full_name: '   ', phone: '+60122023624' }

const usersById = new Map<string, IdentityUser>([
    [registered.id, registered],
    [localFormat.id, localFormat],
    [nameless.id, nameless],
])
const usersByPhone = buildUserPhoneIndex(usersById.values())

describe('phone normalisation', () => {
    it('normalises Malaysian formats to a single key', () => {
        expect(normalizeParticipantPhone('0178950361')).toBe('+60178950361')
        expect(normalizeParticipantPhone('+60178950361')).toBe('+60178950361')
        expect(normalizeParticipantPhone('  60178950361 ')).toBe('+60178950361')
    })

    it('returns an empty key for unusable values', () => {
        expect(normalizeParticipantPhone(null)).toBe('')
        expect(normalizeParticipantPhone('')).toBe('')
        expect(normalizeParticipantPhone('   ')).toBe('')
    })
})

describe('participant identity resolution', () => {
    it('resolves by user id first', () => {
        expect(resolveParticipantIdentity({
            scannedByUserId: 'user-1', consumerPhone: '+60999999999', usersById, usersByPhone,
        })).toEqual({ userId: 'user-1', name: 'Nayli Nadhirah', phone: '+60145600453', source: 'user_id' })
    })

    it('resolves by normalised phone when the scan carries no user id', () => {
        expect(resolveParticipantIdentity({
            scannedByUserId: null, consumerPhone: '+60178950361', usersById, usersByPhone,
        })).toEqual({ userId: 'user-2', name: 'Aravin', phone: '+60178950361', source: 'phone_match' })
    })

    it('keeps a phone-only participant contactable instead of dropping it', () => {
        expect(resolveParticipantIdentity({
            scannedByUserId: null, consumerPhone: '011-2233 4455', usersById, usersByPhone,
        })).toEqual({ userId: null, name: null, phone: '+601122334455', source: 'phone_only' })
    })

    it('never invents a name for a user record with a blank name', () => {
        const identity = resolveParticipantIdentity({
            scannedByUserId: 'user-3', consumerPhone: null, usersById, usersByPhone,
        })
        expect(identity.name).toBeNull()
        expect(identity.phone).toBe('+60122023624')
    })

    it('reports no identity when neither a user nor a phone is available', () => {
        expect(resolveParticipantIdentity({
            scannedByUserId: null, consumerPhone: null, usersById, usersByPhone,
        })).toEqual({ userId: null, name: null, phone: null, source: 'none' })
    })

    it('survives an enrichment query that returned nothing', () => {
        const empty = new Map<string, IdentityUser>()
        expect(resolveParticipantIdentity({
            scannedByUserId: 'user-1', consumerPhone: '+60145600453', usersById: empty, usersByPhone: empty,
        })).toEqual({ userId: null, name: null, phone: '+60145600453', source: 'phone_only' })
    })
})
