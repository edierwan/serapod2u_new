import 'server-only'

// Server-side participant resolution for the Visit Log.
//
// Runs with the service role for the same reason the reporting loader does:
// `users` is RLS-scoped to the viewer's organization, so the browser cannot read
// the participant that a scan is linked to. Organization scope is re-applied
// here through the visit's campaign — the same join `roadtour_official_visits`
// RLS uses — so a caller can only ever resolve participants for visits they were
// already entitled to see.

import {
    normalizeParticipantPhone,
    type IdentityUser,
} from '@/modules/roadtour/lib/reporting/identity'
import {
    buildVisitParticipantMap,
    type VisitParticipantMap,
    type VisitParticipantScan,
    type VisitParticipantVisitRef,
} from '@/modules/roadtour/lib/visit-participants'

/** Matches the row limit the Visit Log page query uses. */
export const MAX_VISIT_PARTICIPANT_IDS = 500

function normalizeText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function toIdentityUsers(rows: any[]): IdentityUser[] {
    return rows.map((row) => ({
        id: row.id,
        full_name: normalizeText(row.full_name),
        phone: normalizeText(row.phone),
    }))
}

export async function loadVisitParticipants(params: {
    admin: any
    orgId: string
    visitIds: string[]
}): Promise<VisitParticipantMap> {
    const visitIds = Array.from(new Set(params.visitIds.filter((id) => typeof id === 'string' && id.length > 0)))
        .slice(0, MAX_VISIT_PARTICIPANT_IDS)
    if (visitIds.length === 0) return {}

    const { data: visitRows, error: visitError } = await params.admin
        .from('roadtour_official_visits')
        .select('id, official_scan_event_id, roadtour_campaigns!inner(org_id)')
        .in('id', visitIds)
        .eq('roadtour_campaigns.org_id', params.orgId)
    if (visitError) throw new Error(visitError.message || 'Failed to load visits for participant resolution.')

    const visits: VisitParticipantVisitRef[] = ((visitRows || []) as any[]).map((visit) => ({
        id: visit.id,
        official_scan_event_id: visit.official_scan_event_id ?? null,
    }))

    const scanIds = Array.from(new Set(visits.map((visit) => visit.official_scan_event_id).filter(Boolean))) as string[]
    if (scanIds.length === 0) return {}

    const { data: scanRows, error: scanError } = await params.admin
        .from('roadtour_scan_events')
        .select('id, scanned_by_user_id, consumer_phone')
        .in('id', scanIds)
    if (scanError) throw new Error(scanError.message || 'Failed to load scans for participant resolution.')

    const scans: VisitParticipantScan[] = ((scanRows || []) as any[]).map((scan) => ({
        id: scan.id,
        scanned_by_user_id: scan.scanned_by_user_id ?? null,
        consumer_phone: normalizeText(scan.consumer_phone),
    }))

    // The linked user is the authoritative relationship; the phone lookup only
    // covers historical scans that were never linked, matching how the same
    // participant already resolves in RoadTour Reporting.
    const userIds = Array.from(new Set(scans.map((scan) => scan.scanned_by_user_id).filter(Boolean))) as string[]
    const scanPhones = Array.from(new Set(
        scans
            .filter((scan) => !scan.scanned_by_user_id)
            .map((scan) => normalizeParticipantPhone(scan.consumer_phone))
            .filter(Boolean),
    ))

    const [linkedResult, phoneResult] = await Promise.all([
        userIds.length > 0
            ? params.admin.from('users').select('id, full_name, phone').in('id', userIds)
            : Promise.resolve({ data: [], error: null }),
        scanPhones.length > 0
            ? params.admin.from('users').select('id, full_name, phone').in('phone', scanPhones)
            : Promise.resolve({ data: [], error: null }),
    ])

    if (linkedResult.error) {
        throw new Error(linkedResult.error.message || 'Failed to load participants for the Visit Log.')
    }

    const users = toIdentityUsers([
        ...((linkedResult.data || []) as any[]),
        // A failed phone lookup is not fatal: linked participants still resolve.
        ...(phoneResult.error ? [] : ((phoneResult.data || []) as any[])),
    ])

    return buildVisitParticipantMap({ visits, scans, users })
}
