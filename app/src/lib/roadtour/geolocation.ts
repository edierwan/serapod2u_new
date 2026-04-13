export interface RoadtourGeolocationInput {
    lat?: number | null
    lng?: number | null
    accuracy?: number | null
}

export interface ReverseGeocodedRoadtourLocation {
    geo_label: string
    geo_city: string | null
    geo_state: string | null
    geo_country: string | null
    geo_full_address: string | null
}

const UNKNOWN_LOCATION_LABEL = 'Unknown location'
const DETECTED_LOCATION_LABEL = 'Location detected'

function asFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function hasCoordinates(geolocation?: RoadtourGeolocationInput | null) {
    return asFiniteNumber(geolocation?.lat) !== null && asFiniteNumber(geolocation?.lng) !== null
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

export function buildRoadtourGeoFallback(geolocation?: RoadtourGeolocationInput | null): ReverseGeocodedRoadtourLocation {
    return {
        geo_label: hasCoordinates(geolocation) ? DETECTED_LOCATION_LABEL : UNKNOWN_LOCATION_LABEL,
        geo_city: null,
        geo_state: null,
        geo_country: null,
        geo_full_address: null,
    }
}

export function getRoadtourGeoLabel(location?: Partial<ReverseGeocodedRoadtourLocation> | null, hasGeolocation = false) {
    const label = typeof location?.geo_label === 'string' ? location.geo_label.trim() : ''
    if (label) return label
    return hasGeolocation ? DETECTED_LOCATION_LABEL : UNKNOWN_LOCATION_LABEL
}

export async function reverseGeocodeRoadtourLocation(geolocation?: RoadtourGeolocationInput | null): Promise<ReverseGeocodedRoadtourLocation> {
    if (!hasCoordinates(geolocation)) {
        return buildRoadtourGeoFallback(geolocation)
    }

    const lat = asFiniteNumber(geolocation?.lat)
    const lng = asFiniteNumber(geolocation?.lng)
    if (lat === null || lng === null) {
        return buildRoadtourGeoFallback(geolocation)
    }

    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('zoom', '14')
    url.searchParams.set('addressdetails', '1')

    try {
        const response = await fetch(url.toString(), {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'serapod2u-roadtour/1.0',
            },
            signal: AbortSignal.timeout(8000),
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

        const geoLabelParts = uniqueParts([geoCity, geoState, geoCountry])
        const geoLabel = geoLabelParts.join(', ') || pickFirstText(
            payload?.name,
            address.suburb,
            address.neighbourhood,
            address.road,
            geoState,
            geoCountry,
        ) || DETECTED_LOCATION_LABEL

        return {
            geo_label: geoLabel,
            geo_city: geoCity,
            geo_state: geoState,
            geo_country: geoCountry,
            geo_full_address: geoFullAddress,
        }
    } catch (error) {
        console.warn('[RT] reverse geocode fallback:', error)
        return buildRoadtourGeoFallback(geolocation)
    }
}