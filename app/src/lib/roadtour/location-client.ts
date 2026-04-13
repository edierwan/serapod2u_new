'use client'

import type { RoadtourLocationPayload } from './location-shared'

function mapBrowserGeolocationError(code?: number): Pick<RoadtourLocationPayload, 'status' | 'error'> {
    switch (code) {
        case 1:
            return {
                status: 'permission_denied',
                error: 'User denied browser geolocation permission.',
            }
        case 3:
            return {
                status: 'timeout',
                error: 'Browser geolocation timed out before coordinates were captured.',
            }
        case 2:
            return {
                status: 'unavailable',
                error: 'Browser geolocation could not determine the device location.',
            }
        default:
            return {
                status: 'error',
                error: 'Browser geolocation failed unexpectedly.',
            }
    }
}

function getCurrentPosition(options: PositionOptions) {
    return new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options)
    })
}

export async function captureRoadtourGeolocation(options: {
    forcePrompt?: boolean
    previousLocation?: RoadtourLocationPayload | null
} = {}): Promise<RoadtourLocationPayload> {
    const { forcePrompt = false, previousLocation = null } = options

    if (!forcePrompt && previousLocation?.lat != null && previousLocation?.lng != null) {
        return previousLocation
    }

    const attemptedAt = new Date().toISOString()

    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
        return {
            status: 'unavailable',
            error: 'Browser geolocation is not available in this session.',
            source: 'browser',
            attempted_at: attemptedAt,
        }
    }

    const attempts: PositionOptions[] = forcePrompt
        ? [
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        ]
        : [
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
        ]

    let lastError: Pick<RoadtourLocationPayload, 'status' | 'error'> | null = null

    for (const attempt of attempts) {
        try {
            const position = await getCurrentPosition(attempt)

            return {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                status: 'captured',
                source: 'browser',
                attempted_at: attemptedAt,
                captured_at: new Date().toISOString(),
            }
        } catch (error: any) {
            lastError = mapBrowserGeolocationError(error?.code)
            if (lastError.status === 'permission_denied') break
        }
    }

    return {
        ...lastError,
        source: 'browser',
        attempted_at: attemptedAt,
    }
}