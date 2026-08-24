// Participant identity for the Visit Log.
//
// The Visit Log used to read the participant straight from the browser, through
// an embed on `users` hanging off the official scan event. `users` is RLS-scoped
// to the viewer's own organization and a RoadTour participant is a shop or
// consumer account outside HQ, so that embed came back empty and a scan that was
// correctly linked through `scanned_by_user_id` still rendered as an
// "Unregistered Participant" with only a phone number.
//
// Resolution therefore happens on the server with the service role, exactly the
// way RoadTour Reporting already resolves the same people, and the browser only
// merges the resolved identity into the rows it already holds. The resolution
// rules themselves are the shared ones in `reporting/identity` so a participant
// reads the same in the Visit Log, the shop drill-down and the export.

import {
    buildUserPhoneIndex,
    resolveParticipantIdentity,
    type IdentityUser,
    type ParticipantIdentitySource,
} from '@/modules/roadtour/lib/reporting/identity'

/** The scan fields participant identity is resolved from. */
export interface VisitParticipantScan {
    id: string
    scanned_by_user_id: string | null
    consumer_phone: string | null
}

/** A visit only needs its own id and the scan it was made official by. */
export interface VisitParticipantVisitRef {
    id: string
    official_scan_event_id: string | null
}

export interface VisitParticipantResolution {
    name: string | null
    /** Normalised E.164 where one could be derived. */
    phone: string | null
    source: ParticipantIdentitySource
}

/** Keyed by visit id — the Visit Log row is what the browser merges into. */
export type VisitParticipantMap = Record<string, VisitParticipantResolution>

/**
 * Resolve one participant per visit from its official scan.
 *
 * The scan's own `shop_id` is deliberately not consulted: it is nullable and the
 * shop shown in the Visit Log comes from the official visit's own `shop_id`, so
 * a null scan shop can never erase a participant that resolved correctly.
 */
export function buildVisitParticipantMap(input: {
    visits: VisitParticipantVisitRef[]
    scans: VisitParticipantScan[]
    users: IdentityUser[]
}): VisitParticipantMap {
    const scanById = new Map(input.scans.map((scan) => [scan.id, scan]))
    const usersById = new Map(input.users.map((user) => [user.id, user]))
    const usersByPhone = buildUserPhoneIndex(input.users)

    const resolved: VisitParticipantMap = {}
    for (const visit of input.visits) {
        const scan = visit.official_scan_event_id ? scanById.get(visit.official_scan_event_id) : undefined
        if (!scan) continue

        const identity = resolveParticipantIdentity({
            scannedByUserId: scan.scanned_by_user_id,
            consumerPhone: scan.consumer_phone,
            usersById,
            usersByPhone,
        })

        resolved[visit.id] = { name: identity.name, phone: identity.phone, source: identity.source }
    }
    return resolved
}

/** The row fields the merge touches; everything else on the row is carried over. */
export interface VisitParticipantFields {
    id: string
    participant_name?: string | null
    participant_phone?: string | null
}

/**
 * Merge server-resolved identities into the rows the browser already loaded.
 *
 * Only the two participant fields are replaced, and only when the server had
 * something to say — an unavailable or partial resolution leaves the row exactly
 * as the page loaded it, so shop, campaign, account manager and location are
 * never disturbed by this step.
 */
export function mergeVisitParticipants<T extends VisitParticipantFields>(
    visits: T[],
    resolved: VisitParticipantMap | null | undefined,
): T[] {
    if (!resolved) return visits

    return visits.map((visit) => {
        const identity = resolved[visit.id]
        if (!identity) return visit
        return {
            ...visit,
            participant_name: identity.name ?? visit.participant_name ?? null,
            participant_phone: identity.phone ?? visit.participant_phone ?? null,
        }
    })
}
