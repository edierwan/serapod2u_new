// Before/after bucketing of product-QR scans around one official visit.
//
// The anchor is the official visit event itself. A scan is "after" only when it
// happened STRICTLY after that instant, so activity recorded at the shop before
// the account manager arrived can never be read as a post-visit response — and
// the official visit scan itself, which lives in a different table entirely
// (`roadtour_scan_events` against `roadtour_qr_codes`, not `consumer_qr_scans`
// against `qr_codes`), is never part of this dataset in the first place.

import { DAY_MS } from './impactModel'

export interface WindowedScan {
    scanned_at: string
}

export interface ScanWindowCounts {
    beforeScans: number
    afterScans: number
    firstScanAfterAt: string | null
    lastScanAfterAt: string | null
}

export function bucketScansAroundAnchor(
    scans: WindowedScan[],
    anchorIso: string,
    windowDays: number,
): ScanWindowCounts {
    const anchorMs = new Date(anchorIso).getTime()
    const windowMs = windowDays * DAY_MS

    let beforeScans = 0
    let afterScans = 0
    let firstScanAfterAt: string | null = null
    let lastScanAfterAt: string | null = null

    for (const scan of [...scans].sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))) {
        const offsetMs = new Date(scan.scanned_at).getTime() - anchorMs
        if (Number.isNaN(offsetMs)) continue

        if (offsetMs < 0 && offsetMs >= -windowMs) {
            beforeScans += 1
        } else if (offsetMs > 0 && offsetMs <= windowMs) {
            afterScans += 1
            if (!firstScanAfterAt) firstScanAfterAt = scan.scanned_at
            lastScanAfterAt = scan.scanned_at
        }
    }

    return { beforeScans, afterScans, firstScanAfterAt, lastScanAfterAt }
}

/**
 * The impact anchor for a visit: the official scan's timestamp when it is known,
 * otherwise midnight Malaysia time on the recorded visit date.
 */
export function resolveVisitAnchorIso(visitDate: string, officialScanTime: string | null | undefined): string {
    if (officialScanTime) {
        const parsed = new Date(officialScanTime)
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    }
    return new Date(`${visitDate}T00:00:00+08:00`).toISOString()
}
