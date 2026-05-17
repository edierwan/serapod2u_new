export const RECOVERY_PURPOSES = [
    'recovery_notice',
    'password_reset_recovery',
    'registration_recovery',
    'qr_claim_recovery',
] as const

export const FAILED_STATUSES = ['failed', 'send_failed'] as const
export const RECOVERY_SENT_STATUSES = ['recovery_sent', 'sent'] as const
export const RESOLVED_STATUSES = ['resolved', 'verified', 'completed'] as const

const MONITORING_DISMISSED_AT_KEY = 'recovery_monitoring_dismissed_at'
const MONITORING_DISMISSED_BY_KEY = 'recovery_monitoring_dismissed_by'
const MONITORING_DISMISSED_REASON_KEY = 'recovery_monitoring_dismissed_reason'

export interface RecoveryTrendPoint {
    hour: string
    failed: number
    recoverySent: number
    delivered: number
    read: number
    resolved: number
}

export function isRecoveryPurpose(purpose?: string | null) {
    const normalized = String(purpose || '').trim()
    return RECOVERY_PURPOSES.some((value) => value === normalized)
}

export function isFailedStatus(status?: string | null) {
    const normalized = String(status || '').trim()
    return FAILED_STATUSES.some((value) => value === normalized)
}

export function isRecoverySentStatus(status?: string | null) {
    const normalized = String(status || '').trim()
    return RECOVERY_SENT_STATUSES.some((value) => value === normalized)
}

export function isResolvedStatus(status?: string | null) {
    const normalized = String(status || '').trim()
    return RESOLVED_STATUSES.some((value) => value === normalized)
}

export function createEmptyTrendPoint(hour: string): RecoveryTrendPoint {
    return {
        hour,
        failed: 0,
        recoverySent: 0,
        delivered: 0,
        read: 0,
        resolved: 0,
    }
}

export function normalizeActivityMetadata(value: unknown): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, any>
            }
        } catch {
            return {}
        }
    }

    return {}
}

export function isMonitoringDismissed(value: unknown) {
    return Boolean(normalizeActivityMetadata(value)[MONITORING_DISMISSED_AT_KEY])
}

export function applyMonitoringDismissedMetadata(
    value: unknown,
    params: { dismissedAt: string; dismissedBy: string; reason?: string; rawFallbackKey?: string },
) {
    const existing = normalizeActivityMetadata(value)
    const base = Object.keys(existing).length > 0
        ? existing
        : (value == null ? {} : { [params.rawFallbackKey || 'raw_value']: value })

    return {
        ...base,
        [MONITORING_DISMISSED_AT_KEY]: params.dismissedAt,
        [MONITORING_DISMISSED_BY_KEY]: params.dismissedBy,
        [MONITORING_DISMISSED_REASON_KEY]: params.reason || 'manual_clear',
    }
}

export function addRecordToTrendPoint(point: RecoveryTrendPoint, status?: string | null, purpose?: string | null) {
    if (isFailedStatus(status)) point.failed += 1
    if (isRecoveryPurpose(purpose) && isRecoverySentStatus(status)) point.recoverySent += 1
    if (status === 'delivered') point.delivered += 1
    if (status === 'read') point.read += 1
    if (isResolvedStatus(status)) point.resolved += 1
}

export function hasTrendActivity(trend: RecoveryTrendPoint[]) {
    return trend.some((point) => (
        point.failed > 0 ||
        point.recoverySent > 0 ||
        point.delivered > 0 ||
        point.read > 0 ||
        point.resolved > 0
    ))
}