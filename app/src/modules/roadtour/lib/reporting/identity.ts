// Participant identity resolution shared by the reporting loader and its tests.
//
// The scan row carries either a user id or a phone number (or both). Resolution
// order is: the linked user, then a user whose normalised phone matches the scan
// phone, then the phone on its own. A phone we cannot match to a user is still a
// real, contactable participant — it is never discarded, and a name is never
// invented for it.

import { normalizePhoneE164 } from '@/utils/phone'

export interface IdentityUser {
    id: string
    full_name: string | null
    phone: string | null
}

export type ParticipantIdentitySource = 'user_id' | 'phone_match' | 'phone_only' | 'none'

export interface ParticipantIdentity {
    userId: string | null
    name: string | null
    /** Normalised E.164 where one could be derived. */
    phone: string | null
    source: ParticipantIdentitySource
}

/** Empty string for anything that is not a usable phone, so map keys stay safe. */
export function normalizeParticipantPhone(value: string | null | undefined): string {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    if (!trimmed) return ''
    return normalizePhoneE164(trimmed)
}

/** Index users by normalised phone so raw database formatting never decides a match. */
export function buildUserPhoneIndex(users: Iterable<IdentityUser>): Map<string, IdentityUser> {
    const index = new Map<string, IdentityUser>()
    for (const user of users) {
        const phone = normalizeParticipantPhone(user.phone)
        if (phone && !index.has(phone)) index.set(phone, user)
    }
    return index
}

function cleanName(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export function resolveParticipantIdentity(input: {
    scannedByUserId?: string | null
    consumerPhone?: string | null
    usersById: Map<string, IdentityUser>
    usersByPhone: Map<string, IdentityUser>
}): ParticipantIdentity {
    const scanPhone = normalizeParticipantPhone(input.consumerPhone)

    const byId = input.scannedByUserId ? input.usersById.get(input.scannedByUserId) : undefined
    if (byId) {
        return {
            userId: byId.id,
            name: cleanName(byId.full_name),
            phone: normalizeParticipantPhone(byId.phone) || scanPhone || null,
            source: 'user_id',
        }
    }

    const byPhone = scanPhone ? input.usersByPhone.get(scanPhone) : undefined
    if (byPhone) {
        return {
            userId: byPhone.id,
            name: cleanName(byPhone.full_name),
            phone: normalizeParticipantPhone(byPhone.phone) || scanPhone,
            source: 'phone_match',
        }
    }

    if (scanPhone) {
        return { userId: null, name: null, phone: scanPhone, source: 'phone_only' }
    }

    return { userId: null, name: null, phone: null, source: 'none' }
}
