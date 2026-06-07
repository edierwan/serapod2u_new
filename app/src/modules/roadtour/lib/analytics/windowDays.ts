import type { ImpactWindow } from '@/modules/roadtour/types/analytics'

export const IMPACT_WINDOW_PRESETS = [3, 7, 30, 60, 90] as const
export const DEFAULT_IMPACT_WINDOW_DAYS: ImpactWindow = 7
export const MIN_IMPACT_WINDOW_DAYS = 1
export const MAX_IMPACT_WINDOW_DAYS = 365
export const IMPACT_WINDOW_ERROR_MESSAGE = 'Enter a valid number of days.'

function parseImpactWindowDays(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : null
    }

    const normalized = String(value ?? '').trim()
    if (!/^\d+$/.test(normalized)) return null

    return Number(normalized)
}

export function validateImpactWindowDays(value: unknown): { value: ImpactWindow | null; error: string | null } {
    const parsedValue = parseImpactWindowDays(value)

    if (
        parsedValue === null
        || parsedValue < MIN_IMPACT_WINDOW_DAYS
        || parsedValue > MAX_IMPACT_WINDOW_DAYS
    ) {
        return { value: null, error: IMPACT_WINDOW_ERROR_MESSAGE }
    }

    return { value: parsedValue as ImpactWindow, error: null }
}

export function normalizeImpactWindowDays(
    value: unknown,
    fallback: ImpactWindow = DEFAULT_IMPACT_WINDOW_DAYS,
): ImpactWindow {
    const validation = validateImpactWindowDays(value)
    return validation.value ?? fallback
}

export function isPresetImpactWindow(value: number): value is (typeof IMPACT_WINDOW_PRESETS)[number] {
    return IMPACT_WINDOW_PRESETS.includes(value as (typeof IMPACT_WINDOW_PRESETS)[number])
}

export function formatImpactWindowShortLabel(days: number): string {
    return `${days}D`
}

export function formatImpactWindowComparison(days: number): string {
    return `${days} Days Before vs ${days} Days After Visit`
}