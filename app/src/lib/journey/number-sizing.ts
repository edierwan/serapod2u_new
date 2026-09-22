/**
 * Length-aware font sizing for full (never abbreviated) numeric values on the
 * Journey Builder dashboard. The size is picked from the rendered string, so
 * "23" / "101,580" stay prominent while "1,372,760" steps down just enough to
 * fit its card. Values are always shown in full: no K / M abbreviation.
 *
 * Every class set includes tabular numerals and no-wrap so digits align and a
 * long figure never breaks across lines.
 */

const NUMERIC_BASE = 'tabular-nums whitespace-nowrap'

/** Visible length of a formatted value, e.g. "1,372,760" -> 9. */
export function displayLength(value: string | number): number {
    return String(value).trim().length
}

/** Top-of-page KPI value (Total QR Generated, Total Scans, ...). */
export function kpiValueSizeClass(value: string | number): string {
    const len = displayLength(value)
    const size = len <= 7 ? 'text-2xl' : len <= 9 ? 'text-xl' : 'text-lg'
    return `${size} ${NUMERIC_BASE}`
}

/** Journey card 2x2 metric value (Generated / Scanned / Collected / Failed). */
export function metricValueSizeClass(value: string | number): string {
    const len = displayLength(value)
    const size = len <= 5 ? 'text-lg' : len <= 7 ? 'text-[15px]' : len <= 9 ? 'text-[13px]' : 'text-xs'
    return `${size} ${NUMERIC_BASE}`
}
