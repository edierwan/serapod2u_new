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

export function extractVisitRegionFromLocation(locationText: string | null | undefined): string | null {
    const value = typeof locationText === 'string' ? locationText.trim() : ''
    if (!value) return null

    for (const matcher of REGION_MATCHERS) {
        if (matcher.pattern.test(value)) return matcher.label
    }

    return null
}

export function resolveVisitRegion(source: VisitRegionSource): string {
    const structuredState = extractVisitRegionFromLocation(source.capturedState)
    if (structuredState) return structuredState

    const capturedAddress = extractVisitRegionFromLocation(source.capturedAddress)
    if (capturedAddress) return capturedAddress

    const capturedLabel = extractVisitRegionFromLocation(source.capturedLabel)
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