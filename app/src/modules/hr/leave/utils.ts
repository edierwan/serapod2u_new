/**
 * HR Leave – Duration & Date Utilities
 *
 * Business-day calculator that excludes weekends (Sat/Sun) and
 * public holidays. Also includes formatting helpers.
 */

import type { PublicHoliday } from './types'

// ── Helpers ─────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    )
}

function toDateOnly(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// ── Business Days ───────────────────────────────────────────────

/**
 * Calculate the number of working days between two dates (inclusive),
 * excluding weekends (Saturday, Sunday) and listed public holidays.
 */
export function calculateBusinessDays(
    startDate: Date | string,
    endDate: Date | string,
    holidays: PublicHoliday[] = [],
    isHalfDay = false,
): number {
    const start = toDateOnly(typeof startDate === 'string' ? new Date(startDate) : startDate)
    const end = toDateOnly(typeof endDate === 'string' ? new Date(endDate) : endDate)

    if (start > end) return 0

    const holidayDates = holidays.map((h) => toDateOnly(new Date(h.date)))
    let days = 0
    const current = new Date(start)

    while (current <= end) {
        const dow = current.getDay()
        const isWeekend = dow === 0 || dow === 6
        const isHoliday = holidayDates.some((h) => isSameDay(h, current))

        if (!isWeekend && !isHoliday) {
            days++
        }
        current.setDate(current.getDate() + 1)
    }

    if (isHalfDay && days >= 1) {
        days -= 0.5
    }

    return Math.max(0, days)
}

// ── Formatting ──────────────────────────────────────────────────

/** "12 Jan 2025" */
export function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-MY', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}

/** "12 Jan – 15 Jan 2025" */
export function formatDateRange(start: string, end: string): string {
    const s = new Date(start)
    const e = new Date(end)
    if (isSameDay(s, e)) return formatDate(start)

    const sameYear = s.getFullYear() === e.getFullYear()
    const sameMonth = sameYear && s.getMonth() === e.getMonth()

    if (sameMonth) {
        return `${s.getDate()} – ${e.getDate()} ${e.toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })}`
    }
    if (sameYear) {
        return `${s.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    return `${formatDate(start)} – ${formatDate(end)}`
}

/** "2 days" / "0.5 day" */
export function formatDuration(days: number): string {
    if (days === 1) return '1 day'
    if (days === 0.5) return '½ day'
    return `${days} days`
}

/** Relative time — "2 hours ago", "3 days ago" */
export function timeAgo(iso: string): string {
    const now = Date.now()
    const then = new Date(iso).getTime()
    const diff = now - then
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return formatDate(iso)
}

/** ISO string for today */
export function todayISO(): string {
    return new Date().toISOString().split('T')[0]
}

/** ISO string for date N days from now */
export function daysFromNow(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return d.toISOString().split('T')[0]
}
