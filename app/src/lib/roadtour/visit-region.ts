type VisitRegionSource = {
    capturedState?: string | null
    capturedAddress?: string | null
    capturedLabel?: string | null
}

export type VisitRegionDatum = {
    regionName: string
    visitCount: number
}

const REGION_MATCHERS: Array<{ label: string; pattern: RegExp }> = [
    { label: 'Pulau Pinang', pattern: /\b(?:pulau\s+pinang|penang)\b/i },
    { label: 'Kedah', pattern: /\bkedah\b/i },
    { label: 'Perak', pattern: /\bperak\b/i },
    { label: 'Perlis', pattern: /\bperlis\b/i },
    { label: 'Selangor', pattern: /\bselangor\b/i },
    { label: 'Kuala Lumpur', pattern: /\bkuala\s+lumpur\b|\bkl\b/i },
    { label: 'Putrajaya', pattern: /\bputrajaya\b/i },
    { label: 'Negeri Sembilan', pattern: /\bnegeri\s+sembilan\b/i },
    { label: 'Melaka', pattern: /\bmelaka\b|\bmalacca\b/i },
    { label: 'Johor', pattern: /\bjohor\b/i },
    { label: 'Pahang', pattern: /\bpahang\b/i },
    { label: 'Terengganu', pattern: /\bterengganu\b/i },
    { label: 'Kelantan', pattern: /\bkelantan\b/i },
    { label: 'Sabah', pattern: /\bsabah\b/i },
    { label: 'Sarawak', pattern: /\bsarawak\b/i },
    { label: 'Labuan', pattern: /\blabuan\b/i },
]

const STATE_FLAG_PATHS: Record<string, string> = {
    Johor: '/images/state-flags/johor.png',
    Kedah: '/images/state-flags/kedah.png',
    Kelantan: '/images/state-flags/kelantan.png',
    Melaka: '/images/state-flags/melaka.png',
    'Pulau Pinang': '/images/state-flags/penang.png',
    Pahang: '/images/state-flags/pahang.png',
    Perak: '/images/state-flags/perak.png',
    Perlis: '/images/state-flags/perlis.png',
    Sabah: '/images/state-flags/sabah.png',
    Sarawak: '/images/state-flags/sarawak.png',
    Selangor: '/images/state-flags/selangor.png',
    Terengganu: '/images/state-flags/terengganu.png',
    'Kuala Lumpur': '/images/state-flags/kuala-lumpur.png',
    Labuan: '/images/state-flags/labuan.png',
    Putrajaya: '/images/state-flags/putrajaya.png',
}

export function getStateFromCapturedLocation(locationText: string | null | undefined): string | null {
    const value = typeof locationText === 'string' ? locationText.trim() : ''
    if (!value) return null

    for (const matcher of REGION_MATCHERS) {
        if (matcher.pattern.test(value)) return matcher.label
    }

    return null
}

export function extractVisitRegionFromLocation(locationText: string | null | undefined): string | null {
    return getStateFromCapturedLocation(locationText)
}

export function getStateFlagPath(stateName: string | null | undefined): string | null {
    const normalizedState = getStateFromCapturedLocation(stateName)
    if (!normalizedState) return null
    return STATE_FLAG_PATHS[normalizedState] || null
}

export function resolveVisitRegion(source: VisitRegionSource): string {
    const structuredState = getStateFromCapturedLocation(source.capturedState)
    if (structuredState) return structuredState

    const capturedAddress = getStateFromCapturedLocation(source.capturedAddress)
    if (capturedAddress) return capturedAddress

    const capturedLabel = getStateFromCapturedLocation(source.capturedLabel)
    if (capturedLabel) return capturedLabel

    return 'Unknown'
}

export function buildVisitRegionDataset(visits: VisitRegionSource[]): VisitRegionDatum[] {
    const counts = new Map<string, number>()

    for (const visit of visits) {
        const regionName = resolveVisitRegion(visit)
        counts.set(regionName, (counts.get(regionName) || 0) + 1)
    }

    return Array.from(counts.entries())
        .map(([regionName, visitCount]) => ({ regionName, visitCount }))
        .sort((left, right) => right.visitCount - left.visitCount || left.regionName.localeCompare(right.regionName))
}