export interface VisitParticipantDisplay {
    primary: string
    secondary: string | null
    isPlaceholder: boolean
}

export function resolveVisitParticipantDisplay(
    participantName?: string | null,
    participantPhone?: string | null,
): VisitParticipantDisplay {
    const name = typeof participantName === 'string' ? participantName.trim() : ''
    const phone = typeof participantPhone === 'string' ? participantPhone.trim() : ''

    if (name && phone) {
        return {
            primary: name,
            secondary: phone,
            isPlaceholder: false,
        }
    }

    if (name) {
        return {
            primary: name,
            secondary: null,
            isPlaceholder: false,
        }
    }

    if (phone) {
        return {
            primary: phone,
            secondary: null,
            isPlaceholder: false,
        }
    }

    return {
        primary: '-',
        secondary: null,
        isPlaceholder: true,
    }
}

export function formatVisitParticipantCsvValue(
    participantName?: string | null,
    participantPhone?: string | null,
): string {
    const display = resolveVisitParticipantDisplay(participantName, participantPhone)

    if (display.secondary) {
        return `${display.primary} (${display.secondary})`
    }

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