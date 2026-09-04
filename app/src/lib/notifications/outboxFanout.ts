import { notificationPhoneKey } from '@/lib/notifications/manualPhoneNumbers'

/**
 * Marks outbox rows created by the recipient fan-out.
 *
 * The recipient list is resolved from notification settings, not from the row, so a child
 * row resolves the exact same list as the row that created it. Without this marker every
 * child fans out again on the next worker cycle and the outbox grows without bound.
 */
export const FANOUT_MARKER = '_fanout_child'

export type FanoutSibling = { to_phone?: string | null; to_email?: string | null }

/** Stable identity for a recipient, so the same person is never queued twice. */
export function recipientDedupeKey(phone?: string | null, email?: string | null): string | null {
    const phoneKey = notificationPhoneKey(phone)
    if (phoneKey) return `p:${phoneKey}`
    const emailKey = String(email || '').trim().toLowerCase()
    if (emailKey) return `e:${emailKey}`
    return null
}

export function isFanoutChild(payload: Record<string, any> | null | undefined): boolean {
    return Boolean(payload && payload[FANOUT_MARKER])
}

export function fanoutChildPayload(payload: Record<string, any> | null | undefined): Record<string, any> {
    return { ...(payload || {}), [FANOUT_MARKER]: true }
}

/**
 * Recipients that still need their own outbox row. The first recipient is handled by the
 * row being processed, so only the remainder are candidates.
 */
export function selectFanoutRecipients(input: {
    recipientList: string[]
    channel: string
    payload?: Record<string, any> | null
    existingSiblings?: FanoutSibling[]
}): string[] {
    const { recipientList, channel, payload, existingSiblings } = input

    if (isFanoutChild(payload)) return []
    if (!Array.isArray(recipientList) || recipientList.length < 2) return []

    const isEmail = channel === 'email'
    const primary = recipientList[0]
    const covered = new Set<string>()

    for (const sibling of existingSiblings || []) {
        const key = recipientDedupeKey(sibling?.to_phone, sibling?.to_email)
        if (key) covered.add(key)
    }

    const selected: string[] = []

    for (const target of recipientList.slice(1)) {
        if (!isEmail && notificationPhoneKey(target) && notificationPhoneKey(target) === notificationPhoneKey(primary)) {
            continue
        }

        const key = isEmail
            ? recipientDedupeKey(null, target)
            : recipientDedupeKey(target, null)

        if (key) {
            if (covered.has(key)) continue
            covered.add(key)
        }

        selected.push(target)
    }

    return selected
}
