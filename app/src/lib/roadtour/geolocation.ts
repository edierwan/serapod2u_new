import { getRoadtourLocationStatusLabel, type RoadtourLocationPayload, type RoadtourLocationStatus } from './location-shared'

export interface RoadtourGeolocationInput extends RoadtourLocationPayload { }

export interface ReverseGeocodedRoadtourLocation {
    geo_label: string | null
    geo_city: string | null
    geo_state: string | null
    geo_country: string | null
    geo_full_address: string | null
    geo_resolved: boolean
}

function asFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function hasRoadtourCoordinates(geolocation?: RoadtourGeolocationInput | null) {
    return asFiniteNumber(geolocation?.lat) !== null && asFiniteNumber(geolocation?.lng) !== null
}

function normalizeRoadtourLocationStatus(value: unknown): RoadtourLocationStatus | null {
    if (typeof value !== 'string') return null

    switch (value) {
        case 'resolved':
        case 'captured':
        case 'permission_denied':
        case 'timeout':
        case 'unavailable':
        case 'error':
        case 'missing':
            return value
        default:
            return null
    }
}

function pickFirstText(...values: Array<unknown>) {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim()
            if (trimmed) return trimmed
        }
    }

    return null
}

function uniqueParts(parts: Array<string | null>) {
    const seen = new Set<string>()
    const ordered: string[] = []

    for (const part of parts) {
        if (!part) continue
        const normalized = part.toLowerCase()
        if (seen.has(normalized)) continue
        seen.add(normalized)
        ordered.push(part)
    }

    return ordered
}

export function normalizeRoadtourGeolocationInput(geolocation?: RoadtourGeolocationInput | null): RoadtourLocationPayload | null {
    if (!geolocation || typeof geolocation !== 'object') return null

    const lat = asFiniteNumber(geolocation.lat)
    const lng = asFiniteNumber(geolocation.lng)
    const accuracy = asFiniteNumber(geolocation.accuracy)
    const status = normalizeRoadtourLocationStatus(geolocation.status)
    const error = pickFirstText(geolocation.error)
    const source = geolocation.source === 'server' ? 'server' : geolocation.source === 'browser' ? 'browser' : null
    const attemptedAt = pickFirstText(geolocation.attempted_at)
    const capturedAt = pickFirstText(geolocation.captured_at)

    if (
        lat === null &&
        lng === null &&
        accuracy === null &&
        !status &&
        !error &&
        !source &&
        !attemptedAt &&
        !capturedAt
    ) {
        return null
    }

    return {
        lat,
        lng,
        accuracy,
        status,
        error,
        source,
        attempted_at: attemptedAt,
        captured_at: capturedAt,
    }
}

export function buildRoadtourGeoFallback(geolocation?: RoadtourGeolocationInput | null): ReverseGeocodedRoadtourLocation {
    const normalized = normalizeRoadtourGeolocationInput(geolocation)
    const status = getRoadtourLocationStatus(normalized)
    return {
        geo_label: getRoadtourLocationStatusLabel(status, hasRoadtourCoordinates(normalized)),
        geo_city: null,
        geo_state: null,
        geo_country: null,
        geo_full_address: null,
        geo_resolved: false,
    }
}

export function getRoadtourLocationStatus(
    geolocation?: RoadtourGeolocationInput | null,
    location?: Partial<ReverseGeocodedRoadtourLocation> | null,
) {
    const normalized = normalizeRoadtourGeolocationInput(geolocation)
    const explicitStatus = normalizeRoadtourLocationStatus(normalized?.status)

    if (location?.geo_resolved) return 'resolved'
    if (explicitStatus === 'permission_denied') return 'permission_denied'
    if (explicitStatus === 'timeout') return 'timeout'
    if (explicitStatus === 'unavailable') return 'unavailable'
    if (explicitStatus === 'error') return 'error'
    if (hasRoadtourCoordinates(normalized)) return 'captured'
    return explicitStatus || 'missing'
}

export function getRoadtourLocationError(geolocation?: RoadtourGeolocationInput | null, status?: RoadtourLocationStatus | null) {
    const normalized = normalizeRoadtourGeolocationInput(geolocation)
    const explicitError = pickFirstText(normalized?.error)
    if (explicitError) return explicitError

    switch (status || getRoadtourLocationStatus(normalized)) {
        case 'permission_denied':
            return 'User denied browser geolocation permission.'
        case 'timeout':
            return 'Browser geolocation timed out before coordinates were captured.'
        case 'unavailable':
            return 'Browser geolocation is unavailable in this session.'
        case 'error':
            return 'Browser geolocation failed unexpectedly.'
        default:
            return null
    }
}

export function getRoadtourGeoLabel(location?: Partial<ReverseGeocodedRoadtourLocation> | null, geolocation?: RoadtourGeolocationInput | null) {
    const label = typeof location?.geo_label === 'string' ? location.geo_label.trim() : ''
    if (label) return label
    const status = getRoadtourLocationStatus(geolocation, location)
    return getRoadtourLocationStatusLabel(status, hasRoadtourCoordinates(geolocation))
}

export async function reverseGeocodeRoadtourLocation(geolocation?: RoadtourGeolocationInput | null): Promise<ReverseGeocodedRoadtourLocation> {
    const normalized = normalizeRoadtourGeolocationInput(geolocation)

    if (!hasRoadtourCoordinates(normalized)) {
        return buildRoadtourGeoFallback(normalized)
    }

    const lat = asFiniteNumber(normalized?.lat)
    const lng = asFiniteNumber(normalized?.lng)
    if (lat === null || lng === null) {
        return buildRoadtourGeoFallback(normalized)
    }

    for (const timeoutMs of [8000, 12000]) {
        const url = new URL('https://nominatim.openstreetmap.org/reverse')
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('lat', String(lat))
        url.searchParams.set('lon', String(lng))
        url.searchParams.set('zoom', '18')
        url.searchParams.set('addressdetails', '1')

        try {
            const response = await fetch(url.toString(), {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'serapod2u-roadtour/1.0',
                },
                signal: AbortSignal.timeout(timeoutMs),
                cache: 'no-store',
            })

            if (!response.ok) {
                throw new Error(`Reverse geocode failed with HTTP ${response.status}`)
            }

            const payload = await response.json().catch(() => null)
            const address = payload?.address || {}

            const geoCity = pickFirstText(
                address.city,
                address.town,
                address.village,
                address.municipality,
                address.county,
                address.state_district,
                address.suburb,
            )
            const geoState = pickFirstText(address.state, address.region, address.province, address.state_district)
            const geoCountry = pickFirstText(address.country)
            const geoFullAddress = pickFirstText(payload?.display_name)
            const geoPrimaryArea = pickFirstText(
                address.suburb,
                address.neighbourhood,
                address.road,
                address.city_district,
                address.municipality,
                address.county,
                address.state_district,
                geoCity,
            )

            const geoLabelParts = uniqueParts([geoPrimaryArea, geoCity, geoState, geoCountry])
            const geoLabel = geoLabelParts.join(', ') || pickFirstText(
                payload?.name,
                address.road,
                address.suburb,
                address.neighbourhood,
                geoState,
                geoCountry,
            ) || getRoadtourLocationStatusLabel('captured', true)

            return {
                geo_label: geoLabel,
                geo_city: geoCity,
                geo_state: geoState,
                geo_country: geoCountry,
                geo_full_address: geoFullAddress,
                geo_resolved: true,
            }
        } catch (error) {
            console.warn('[RT] reverse geocode attempt failed:', error)
        }
    }

    return buildRoadtourGeoFallback(normalized)
}