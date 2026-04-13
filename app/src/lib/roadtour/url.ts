export function slugifyRoadTourSegment(value?: string | null) {
    const normalized = (value || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

    return normalized || 'untitled'
}

export function generateRoadTourShortCode(token?: string | null, length = 8) {
    const compact = String(token || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')

    return (compact || 'roadtour').slice(0, Math.max(6, length))
}

export function extractRoadTourShortCode(referenceSlugWithCode?: string | null) {
    const value = (referenceSlugWithCode || '').trim().toLowerCase()
    if (!value) return null

    const lastDash = value.lastIndexOf('-')
    if (lastDash === -1) return null

    const shortCode = value.slice(lastDash + 1)
    return shortCode || null
}

export function buildRoadTourPath(params: {
    year?: number | string | null
    campaignSlug?: string | null
    referenceSlug?: string | null
    shortCode?: string | null
    routeBase?: 'roadtour' | 'rt'
}) {
    const year = String(params.year || '').trim()
    const campaignSlug = slugifyRoadTourSegment(params.campaignSlug)
    const referenceSlug = slugifyRoadTourSegment(params.referenceSlug)
    const shortCode = String(params.shortCode || '').trim().toLowerCase()
    const routeBase = params.routeBase || 'roadtour'

    if (!year || !shortCode) return null

    return `/${routeBase}/${year}/${campaignSlug}/${referenceSlug}-${shortCode}`
}

export function buildRoadTourUrl(origin: string, path?: string | null) {
    if (!path) return null
    return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}