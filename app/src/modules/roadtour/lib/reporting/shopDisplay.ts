// Shop and participant display resolution for RoadTour Reporting.
//
// Both are populated once, in the shared loader, so every report renders the same
// name from the same fields. A participant we cannot name but can still contact
// is shown as an "Unregistered Participant" with the phone — never as a dash and
// never as an invented name.

import { formatPhoneDisplay } from '@/utils/phone'
import { UNREGISTERED_PARTICIPANT_LABEL } from './types'

export interface ShopDisplay {
    /** `Kloud Room (Seberang Perai Tengah)` */
    fullLabel: string
    /** `Kloud Room` */
    primaryName: string
    /** `(Seberang Perai Tengah)` or null */
    branchLabel: string | null
}

export interface ParticipantDisplay {
    primary: string
    secondary: string | null
    /** True only when there is no usable shop/participant context at all. */
    isPlaceholder: boolean
}

export const NO_CONTEXT_PLACEHOLDER = '—'

function normalizeText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function wrapBranchLabel(value: string): string {
    const trimmed = value.trim()
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed
    return `(${trimmed})`
}

/**
 * Shop resolution uses the official visit's `shop_id` → `organizations` row.
 * `org_name` is the primary name and `branch` is the qualifier; both are kept
 * separate so a table can show the branch as a subtitle.
 */
export function resolveShopDisplay(options: {
    shopName?: string | null
    branch?: string | null
}): ShopDisplay {
    const primaryName = normalizeText(options.shopName)
    const branch = normalizeText(options.branch)

    if (!primaryName) {
        return { fullLabel: NO_CONTEXT_PLACEHOLDER, primaryName: NO_CONTEXT_PLACEHOLDER, branchLabel: null }
    }

    if (!branch) {
        return { fullLabel: primaryName, primaryName, branchLabel: null }
    }

    const branchLabel = wrapBranchLabel(branch)
    return { fullLabel: `${primaryName} ${branchLabel}`, primaryName, branchLabel }
}

/**
 * Participant resolution order: registered name, then a contactable phone, then
 * the no-context placeholder.
 */
export function resolveParticipantDisplay(options: {
    participantCount?: number | null
    latestParticipantName?: string | null
    latestParticipantPhone?: string | null
    pluralLabel?: string
}): ParticipantDisplay {
    const participantCount = typeof options.participantCount === 'number' ? options.participantCount : 0
    const name = normalizeText(options.latestParticipantName)
    const rawPhone = normalizeText(options.latestParticipantPhone)
    const phone = rawPhone ? formatPhoneDisplay(rawPhone) || rawPhone : null
    const pluralLabel = normalizeText(options.pluralLabel) || 'participants'

    if (participantCount > 1) {
        return {
            primary: `${participantCount} ${pluralLabel}`,
            secondary: name ? `Latest: ${name}` : phone ? `Latest: ${phone}` : null,
            isPlaceholder: false,
        }
    }

    if (name) {
        return { primary: name, secondary: phone, isPlaceholder: false }
    }

    if (phone) {
        return { primary: UNREGISTERED_PARTICIPANT_LABEL, secondary: phone, isPlaceholder: false }
    }

    return { primary: NO_CONTEXT_PLACEHOLDER, secondary: null, isPlaceholder: true }
}
