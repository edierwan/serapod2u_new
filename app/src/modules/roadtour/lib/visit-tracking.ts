// Visit Log display helpers.
//
// Participant identity resolution is shared with RoadTour Reporting so the same
// person reads the same way in the Visit Log, the shop drill-down and the export.

import {
    NO_CONTEXT_PLACEHOLDER,
    resolveParticipantDisplay,
} from '@/modules/roadtour/lib/reporting/shopDisplay'

export interface VisitParticipantDisplay {
    primary: string
    secondary: string | null
    isPlaceholder: boolean
}

export function resolveVisitParticipantDisplay(
    participantName?: string | null,
    participantPhone?: string | null,
): VisitParticipantDisplay {
    return resolveParticipantDisplay({
        participantCount: 1,
        latestParticipantName: participantName,
        latestParticipantPhone: participantPhone,
    })
}

export function formatVisitParticipantCsvValue(
    participantName?: string | null,
    participantPhone?: string | null,
): string {
    const display = resolveVisitParticipantDisplay(participantName, participantPhone)

    if (display.isPlaceholder) return NO_CONTEXT_PLACEHOLDER
    if (display.secondary) return `${display.primary} (${display.secondary})`
    return display.primary
}

export function formatVisitDateTime(visitDate: string, createdAt: string) {
    const dateLabel = (() => {
        try {
            return new Date(`${visitDate}T00:00:00`).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            })
        } catch {
            return visitDate
        }
    })()

    const timeLabel = (() => {
        try {
            return new Date(createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            })
        } catch {
            return '—'
        }
    })()

    return {
        dateLabel,
        timeLabel,
    }
}
