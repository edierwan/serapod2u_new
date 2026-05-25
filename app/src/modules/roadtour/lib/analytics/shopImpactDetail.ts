import { formatPhoneDisplay } from '@/utils/phone'

export interface ShopImpactDisplay {
    primaryName: string
    branchLabel: string | null
}

export interface ShopImpactParticipantDisplay {
    primary: string
    secondary: string | null
    isPlaceholder: boolean
}

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

function stripWrappingParentheses(value: string): string {
    return value.replace(/^\(/, '').replace(/\)$/, '').trim()
}

function parseTrailingParenthetical(fullLabel: string): { primaryName: string; branchLabel: string } | null {
    const match = fullLabel.match(/^(.*?)\s*(\([^()]+\))$/)
    if (!match) return null

    const primaryName = normalizeText(match[1])
    const branchLabel = normalizeText(match[2])
    if (!primaryName || !branchLabel) return null
    if (primaryName.includes('(') || primaryName.includes(')')) return null

    return {
        primaryName,
        branchLabel,
    }
}

export function resolveShopImpactDisplay(options: {
    fullLabel?: string | null
    shopName?: string | null
    branch?: string | null
    city?: string | null
    region?: string | null
}): ShopImpactDisplay {
    const structuredName = normalizeText(options.shopName)
    const structuredBranch = normalizeText(options.branch)
    const fullLabel = normalizeText(options.fullLabel) || structuredName || '-'

    if (structuredName && structuredBranch) {
        return {
            primaryName: structuredName,
            branchLabel: wrapBranchLabel(structuredBranch),
        }
    }

    const parsed = parseTrailingParenthetical(fullLabel)
    if (parsed) {
        const parsedBranch = stripWrappingParentheses(parsed.branchLabel).toLowerCase()
        const locationHints = [options.city, options.region]
            .map((value) => normalizeText(value)?.toLowerCase())
            .filter((value): value is string => Boolean(value))

        const matchesKnownLocation = locationHints.some((hint) => parsedBranch.includes(hint) || hint.includes(parsedBranch))
        if (matchesKnownLocation) {
            return parsed
        }
    }

    return {
        primaryName: structuredName || fullLabel,
        branchLabel: null,
    }
}

export function resolveShopImpactParticipantDisplay(options: {
    participantCount?: number | null
    latestParticipantName?: string | null
    latestParticipantPhone?: string | null
    pluralLabel?: string
}): ShopImpactParticipantDisplay {
    const participantCount = typeof options.participantCount === 'number' ? options.participantCount : 0
    const latestParticipantName = normalizeText(options.latestParticipantName)
    const latestParticipantPhone = normalizeText(options.latestParticipantPhone)
    const formattedPhone = latestParticipantPhone ? formatPhoneDisplay(latestParticipantPhone) : null
    const pluralLabel = normalizeText(options.pluralLabel) || 'participants'

    if (participantCount > 1) {
        return {
            primary: `${participantCount} ${pluralLabel}`,
            secondary: formattedPhone ? `Latest: ${formattedPhone}` : null,
            isPlaceholder: false,
        }
    }

    if (latestParticipantName && formattedPhone) {
        return {
            primary: latestParticipantName,
            secondary: formattedPhone,
            isPlaceholder: false,
        }
    }

    if (latestParticipantName) {
        return {
            primary: latestParticipantName,
            secondary: null,
            isPlaceholder: false,
        }
    }

    if (formattedPhone) {
        return {
            primary: formattedPhone,
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