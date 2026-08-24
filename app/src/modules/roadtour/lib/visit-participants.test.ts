import { describe, expect, it } from 'vitest'

import {
    buildVisitParticipantMap,
    mergeVisitParticipants,
} from './visit-participants'
import { resolveVisitParticipantDisplay } from './visit-tracking'

// The production row that exposed the bug: a `success` scan correctly linked to a
// registered GUEST participant, rendered as "Unregistered Participant" because the
// browser could not read the `users` row through RLS.
const LINKED_PARTICIPANT = {
    id: '878f6fb3-c3e4-4a2d-bf7f-860f39f7fd16',
    full_name: 'Muhammad Adam Airel',
    phone: '+601111676885',
}

const LINKED_SCAN = {
    id: '66f0e0f6-1771-478e-ae7f-fcd359abf640',
    scanned_by_user_id: LINKED_PARTICIPANT.id,
    consumer_phone: '+601111676885',
}

// The same scan as it comes off the table, where `shop_id` is null — the Visit
// Log takes its shop from the official visit, never from the scan.
const LINKED_SCAN_ROW = { ...LINKED_SCAN, shop_id: null }

const LINKED_VISIT = {
    id: 'b2b470be-4c39-40e8-91c0-99f690530a0d',
    official_scan_event_id: LINKED_SCAN.id,
}

describe('buildVisitParticipantMap', () => {
    it('resolves the registered participant through scanned_by_user_id', () => {
        const resolved = buildVisitParticipantMap({
            visits: [LINKED_VISIT],
            scans: [LINKED_SCAN],
            users: [LINKED_PARTICIPANT],
        })

        expect(resolved[LINKED_VISIT.id]).toEqual({
            name: 'Muhammad Adam Airel',
            phone: '+601111676885',
            source: 'user_id',
        })
    })

    it('keeps the participant when the source scan has no shop of its own', () => {
        const resolved = buildVisitParticipantMap({
            visits: [LINKED_VISIT],
            scans: [LINKED_SCAN_ROW],
            users: [LINKED_PARTICIPANT],
        })

        expect(resolved[LINKED_VISIT.id]?.name).toBe('Muhammad Adam Airel')
        expect(resolved[LINKED_VISIT.id]?.source).toBe('user_id')
    })

    it('prefers the linked user over anyone else holding the scan phone', () => {
        const resolved = buildVisitParticipantMap({
            visits: [LINKED_VISIT],
            scans: [LINKED_SCAN],
            users: [
                LINKED_PARTICIPANT,
                { id: 'other-user', full_name: 'Someone Else', phone: '+601111676885' },
            ],
        })

        expect(resolved[LINKED_VISIT.id]?.name).toBe('Muhammad Adam Airel')
    })

    it('leaves a genuinely unregistered scan without a name', () => {
        const visit = { id: 'visit-unregistered', official_scan_event_id: 'scan-unregistered' }
        const resolved = buildVisitParticipantMap({
            visits: [visit],
            scans: [{ id: 'scan-unregistered', scanned_by_user_id: null, consumer_phone: '0178950361' }],
            users: [LINKED_PARTICIPANT],
        })

        expect(resolved[visit.id]).toEqual({ name: null, phone: '+60178950361', source: 'phone_only' })
    })

    it('skips a visit that has no official scan', () => {
        const resolved = buildVisitParticipantMap({
            visits: [{ id: 'visit-manual', official_scan_event_id: null }],
            scans: [LINKED_SCAN],
            users: [LINKED_PARTICIPANT],
        })

        expect(resolved['visit-manual']).toBeUndefined()
    })
})

describe('mergeVisitParticipants', () => {
    const row = {
        id: LINKED_VISIT.id,
        participant_name: null as string | null,
        participant_phone: '+601111676885' as string | null,
        shop_id: 'shop-mr-vapor',
        shop_name: 'Mr Vapor',
        shop_branch: 'Bangi, Selangor',
        campaign_name: 'Road Tour Kl / Selangor ( Tajiy )',
        user_name: 'Noor Amirul Sharfiz Bin Noor El khayazy',
        visit_status: 'official',
    }

    it('replaces only the participant fields and leaves the rest of the row alone', () => {
        const [merged] = mergeVisitParticipants([row], {
            [row.id]: { name: 'Muhammad Adam Airel', phone: '+601111676885', source: 'user_id' },
        })

        expect(merged).toEqual({ ...row, participant_name: 'Muhammad Adam Airel' })
    })

    it('keeps the rows untouched when resolution was unavailable', () => {
        expect(mergeVisitParticipants([row], null)).toEqual([row])
        expect(mergeVisitParticipants([row], {})).toEqual([row])
    })

    it('does not erase a phone the page already had when no name resolved', () => {
        const [merged] = mergeVisitParticipants([row], {
            [row.id]: { name: null, phone: null, source: 'none' },
        })

        expect(merged.participant_name).toBeNull()
        expect(merged.participant_phone).toBe('+601111676885')
    })
})

describe('Visit Log participant column', () => {
    it('shows the registered name over the phone once resolution runs', () => {
        const rows = mergeVisitParticipants(
            [{ id: LINKED_VISIT.id, participant_name: null, participant_phone: '+601111676885' }],
            buildVisitParticipantMap({
                visits: [LINKED_VISIT],
                scans: [LINKED_SCAN],
                users: [LINKED_PARTICIPANT],
            }),
        )

        expect(resolveVisitParticipantDisplay(rows[0].participant_name, rows[0].participant_phone)).toEqual({
            primary: 'Muhammad Adam Airel',
            secondary: '+60 11-1167 6885',
            isPlaceholder: false,
        })
    })

    it('still labels a genuinely unregistered scan', () => {
        const visit = { id: 'visit-unregistered', official_scan_event_id: 'scan-unregistered' }
        const rows = mergeVisitParticipants(
            [{ id: visit.id, participant_name: null, participant_phone: '0178950361' }],
            buildVisitParticipantMap({
                visits: [visit],
                scans: [{ id: 'scan-unregistered', scanned_by_user_id: null, consumer_phone: '0178950361' }],
                users: [LINKED_PARTICIPANT],
            }),
        )

        expect(resolveVisitParticipantDisplay(rows[0].participant_name, rows[0].participant_phone)).toEqual({
            primary: 'Unregistered Participant',
            secondary: '+60 17-895 0361',
            isPlaceholder: false,
        })
    })
})
