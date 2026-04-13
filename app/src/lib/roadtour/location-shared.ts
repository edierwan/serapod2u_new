export type RoadtourLocationStatus =
    | 'resolved'
    | 'captured'
    | 'permission_denied'
    | 'timeout'
    | 'unavailable'
    | 'error'
    | 'missing'

export interface RoadtourLocationPayload {
    lat?: number | null
    lng?: number | null
    accuracy?: number | null
    status?: RoadtourLocationStatus | null
    error?: string | null
    source?: 'browser' | 'server' | null
    attempted_at?: string | null
    captured_at?: string | null
}

export function getRoadtourLocationStatusLabel(status?: RoadtourLocationStatus | null, hasCoordinates = false) {
    switch (status) {
        case 'resolved':
            return 'Location resolved'
        case 'captured':
            return hasCoordinates ? 'Location captured' : 'Resolving location...'
        case 'permission_denied':
            return 'Permission denied'
        case 'timeout':
            return 'Location unavailable'
        case 'unavailable':
            return 'Location unavailable'
        case 'error':
            return 'Location unavailable'
        case 'missing':
        default:
            return hasCoordinates ? 'Location captured' : 'Location unavailable'
    }
}